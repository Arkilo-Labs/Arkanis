export class Roundtable {
    constructor({ agents, settings, mcpClient, logger, auditorAgent = null }) {
        this.agents = agents;
        this.settings = settings;
        this.mcpClient = mcpClient;
        this.logger = logger;
        this.auditorAgent = auditorAgent;
        this.auditHistory = [];
    }

    _findLastTurn(transcript, predicate) {
        for (let i = (transcript?.length ?? 0) - 1; i >= 0; i--) {
            const t = transcript[i];
            if (predicate(t)) return t;
        }
        return null;
    }

    _truncateContext(text) {
        const limit = this.settings.max_context_chars ?? 24000;
        if (!text || text.length <= limit) return text;
        return text.slice(-limit);
    }

    _extractJsonObject(text) {
        const raw = String(text || '').trim();
        if (!raw) return null;
        const start = raw.indexOf('{');
        const end = raw.lastIndexOf('}');
        if (start < 0 || end < 0 || end <= start) return null;
        const candidate = raw.slice(start, end + 1);
        try {
            return JSON.parse(candidate);
        } catch {
            return null;
        }
    }

    async _auditTurn({ turn, agent, text }) {
        if (!this.auditorAgent) {
            return null;
        }

        const auditPrompt = [
            `# 审计任务`,
            `- turn: ${turn}`,
            `- speaker: ${agent.name} (${agent.role})`,
            ``,
            `# 待审计发言`,
            text,
        ].join('\n');

        try {
            const llmTimeoutMs = this.settings.llm_timeout_ms ?? 60000;
            const llmRetries = this.settings.llm_retries ?? 1;

            const auditResultText = await this.auditorAgent.speak({
                contextText: auditPrompt,
                imagePaths: [],
                toolResults: [],
                callOptions: { retries: llmRetries, timeoutMs: llmTimeoutMs },
            });

            const auditResult = this._extractJsonObject(auditResultText);
            if (auditResult) {
                this.auditHistory.push(auditResult);
                const status = auditResult.pass ? '通过' : '过滤';
                const score = auditResult.overall_score?.toFixed(2) ?? 'N/A';
                this.logger.info(`[审计] ${agent.name} - ${status} (评分: ${score})`);
            }
            return auditResult;
        } catch (e) {
            this.logger.warn(`[审计失败] ${agent.name}: ${e.message}`);
            return null;
        }
    }

    _applyAudit(text, auditResult) {
        if (!auditResult) {
            return { filteredText: text, isFiltered: false };
        }

        if (!auditResult.pass) {
            return { filteredText: '', isFiltered: true };
        }

        if (auditResult.filtered_content) {
            const filteredText = text.replace(auditResult.filtered_content, '[已过滤: 不相关内容]');
            return { filteredText, isFiltered: false };
        }

        return { filteredText: text, isFiltered: false };
    }

    async _runTools(tools) {
        const { withRetries, withTimeout } = await import('./runtime.js');
        const results = [];
        for (const tool of tools ?? []) {
            if (tool.type !== 'mcp') continue;
            const { server, call } = tool;
            const method = call?.method;
            const params = call?.params ?? {};
            if (!server || !method) continue;
            try {
                const timeoutMs = this.settings.mcp_timeout_ms ?? 10000;
                const res = await withTimeout(
                    withRetries(() => this.mcpClient.call(server, method, params), {
                        retries: 1,
                        baseDelayMs: 800,
                    }),
                    timeoutMs,
                    `MCP(${server} ${method})`,
                );
                results.push({ tool: 'mcp', server, method, result: res });
            } catch (e) {
                this.logger.warn(`[工具失败] mcp:${server} ${method}：${e.message}`);
                let availableTools = null;
                try {
                    if (String(method) === 'tools/call') {
                        const timeoutMs = this.settings.mcp_timeout_ms ?? 10000;
                        availableTools = await withTimeout(
                            this.mcpClient.call(server, 'tools/list', {}),
                            timeoutMs,
                            `MCP(${server} tools/list)`,
                        );
                    }
                } catch {
                    // 仅用于辅助诊断，不强依赖
                }
                results.push({
                    tool: 'mcp',
                    server,
                    method,
                    error: String(e.message || e),
                    availableTools,
                });
            }
        }
        return results;
    }

    _buildTurnContext({ baseContext, turn, maxTurns, agent, lastTurn, selfLastTurn, debateRules, extraSections }) {
        const parts = [];

        parts.push(`# 回合信息\n- turn: ${turn}/${maxTurns}\n- speaker: ${agent.name} (${agent.role})`);

        if (debateRules) {
            parts.push(`# 交锋规则（必须遵守）\n${debateRules}`);
        }

        for (const s of extraSections ?? []) {
            if (s) parts.push(String(s));
        }

        if (selfLastTurn) {
            parts.push(
                `# 你上一轮发言（不要复述；只回应质疑/补充变化）\n【${selfLastTurn.name}｜${selfLastTurn.role}】\n${selfLastTurn.text}`,
            );
        }

        if (lastTurn) {
            parts.push(
                `# 上一位发言（请直接回应/反驳其中至少 1 条具体观点）\n【${lastTurn.name}｜${lastTurn.role}】\n${lastTurn.text}`,
            );
        }

        parts.push(`# 会议上下文（可能被截断）\n${baseContext}`);
        return parts.join('\n\n');
    }

    _getAgentsByName() {
        const map = new Map();
        for (const a of this.agents) map.set(a.name, a);
        return map;
    }

    _splitAgents() {
        const { summary_agent: summaryName, final_agent: finalName } = this.settings;
        const byName = this._getAgentsByName();
        const summaryAgent = summaryName ? byName.get(summaryName) : null;
        const chairAgent = finalName ? byName.get(finalName) : null;

        const participants = this.agents
            .filter((a) => a !== summaryAgent && a !== chairAgent)
            .slice()
            .sort((x, y) => (x.order ?? 0) - (y.order ?? 0));

        return { participants, summaryAgent, chairAgent };
    }

    _buildOpeningInstructions({ chairAgent, participants }) {
        const who = participants.map((a) => `${a.name}(${a.role})`).join('、');
        return [
            `# 开场陈述任务（只做立场与逻辑，不要辩论）`,
            `- 请把你的结论、依据、关键价位、以及“哪些信息会让你改变观点”讲清楚。`,
            `- 目标是把信息讲给主席（${chairAgent.name}）听，让主席后续决定谁继续发言、谁来回应谁。`,
            `- 如果你认为需要其他角色入场（例如新闻/技术/风控）来裁决某个点，请点名说明理由。`,
            ``,
            `# 本次圆桌参与者`,
            `- 主席：${chairAgent.name}(${chairAgent.role})`,
            `- 其他参与者：${who}`,
        ].join('\n');
    }

    _buildChairModerationNotes({ participants }) {
        const roster = participants.map((a) => `- ${a.name} (${a.role})`).join('\n');
        return [
            `# 主席职责（你要决定“下一位谁发言”）`,
            `- 你不需要每次都让所有人轮流说；你要按分歧点推进讨论，直到矛盾解除或你判断无法达成一致。`,
            `- 强默认规则：如果 A 发言后，B 明确质疑/反驳 A，那么下一次优先让 A 回应，直到矛盾解除或达成共识。`,
            `- 例外：如果需要第三方证据裁决（新闻、技术、风控等），你可以插入对应角色发言，但必须说明原因。`,
            ``,
            `# 可选发言人（next_speaker 只能从这里选）`,
            roster,
        ].join('\n');
    }

    _normalizeNextSpeaker({ requested, participants, lastSpeakerName }) {
        const byName = new Map(participants.map((a) => [a.name, a]));
        if (requested && byName.has(requested)) return byName.get(requested);

        const idx = participants.findIndex((a) => a.name === lastSpeakerName);
        if (idx >= 0) return participants[(idx + 1) % participants.length];
        return participants[0] ?? null;
    }

    async run({ contextSeed, imagePaths }) {
        const transcript = [];
        let context = contextSeed ?? '';
        const maxRounds = this.settings.max_rounds ?? 3;
        const maxTurns = maxRounds * (this.agents.length || 1);
        const llmTimeoutMs = this.settings.llm_timeout_ms ?? 60000;
        const llmRetries = this.settings.llm_retries ?? 1;
        const debateRules =
            this.settings.debate_rules ??
            [
                '- 必须指出至少 1 条你不同意/质疑的点（引用“上一位发言”或上下文的原话）。',
                '- 你的反驳必须给出可验证条件：什么情况下对方成立/你成立。',
                '- 不要复述别人说过的话；只补充新信息、反证或更严格的条件。',
            ].join('\n');

        const { participants, summaryAgent, chairAgent } = this._splitAgents();
        if (!chairAgent) {
            throw new Error('roundtable_settings.final_agent 未配置或不存在');
        }
        if (!participants.length) {
            throw new Error('roundtable 参与者为空：请在 agents.json 配置至少 1 个非主席/非总结的 agent');
        }

        let consensus = false;
        let lastChairJson = null;

        let turn = 0;

        // 0) 开场：每位参与者各发一次，先把立场与逻辑讲给主席
        this.logger.info('开场：全员立场陈述');
        for (const agent of participants) {
            if (turn >= maxTurns) break;
            turn += 1;
            const lastTurn = transcript.length ? transcript[transcript.length - 1] : null;
            const selfLastTurn = this._findLastTurn(transcript, (t) => t?.name === agent.name);
            const baseContext = this._truncateContext(context);
            const opening = this._buildOpeningInstructions({ chairAgent, participants });
            const turnContext = this._buildTurnContext({
                baseContext,
                turn,
                maxTurns,
                agent,
                lastTurn,
                selfLastTurn,
                debateRules: null,
                extraSections: [opening],
            });

            this.logger.info(`发言：${agent.name} (${agent.role})`);
            const toolResults = await this._runTools(agent.tools);
            const text = await agent.speak({
                contextText: turnContext,
                imagePaths,
                toolResults,
                callOptions: { retries: llmRetries, timeoutMs: llmTimeoutMs },
            });

            const auditResult = await this._auditTurn({ turn, agent, text });
            const { filteredText, isFiltered } = this._applyAudit(text, auditResult);
            transcript.push({ name: agent.name, role: agent.role, text: filteredText, audited: !!auditResult, filtered: isFiltered });
            if (!isFiltered) {
                context += `\n\n【${agent.name}】\n${filteredText}\n`;
            }
        }

        // 1) 讨论：每轮先由主席决定 next_speaker，再由对应发言人回应
        while (turn < maxTurns) {
            // 1.1 主席：给出 next_speaker + 当前是否共识 + 决策草案
            turn += 1;
            const lastTurn = transcript.length ? transcript[transcript.length - 1] : null;
            const selfLastTurn = this._findLastTurn(transcript, (t) => t?.name === chairAgent.name);
            const baseContext = this._truncateContext(context);
            const chairNotes = this._buildChairModerationNotes({ participants });
            const chairExtra = [
                chairNotes,
                lastChairJson ? `# 你上一轮主席 JSON（仅用于延续节奏）\n${JSON.stringify(lastChairJson)}` : null,
            ].filter(Boolean);
            const chairContext = this._buildTurnContext({
                baseContext,
                turn,
                maxTurns,
                agent: chairAgent,
                lastTurn,
                selfLastTurn,
                debateRules,
                extraSections: chairExtra,
            });

            this.logger.info(`主席：${chairAgent.name} (${chairAgent.role})`);
            const chairToolResults = await this._runTools(chairAgent.tools);
            const chairText = await chairAgent.speak({
                contextText: chairContext,
                imagePaths,
                toolResults: chairToolResults,
                callOptions: { retries: llmRetries, timeoutMs: llmTimeoutMs },
            });

            const chairAuditResult = await this._auditTurn({ turn, agent: chairAgent, text: chairText });
            const { filteredText: chairFilteredText, isFiltered: chairIsFiltered } = this._applyAudit(chairText, chairAuditResult);
            transcript.push({
                name: chairAgent.name,
                role: chairAgent.role,
                text: chairFilteredText,
                audited: !!chairAuditResult,
                filtered: chairIsFiltered,
            });
            if (!chairIsFiltered) {
                context += `\n\n【${chairAgent.name}】\n${chairFilteredText}\n`;
            }

            const parsed = this._extractJsonObject(chairText);
            lastChairJson = parsed;
            consensus = Boolean(parsed?.consensus);
            if (consensus) {
                this.logger.info('主席判定已达成一致：提前结束讨论');
                break;
            }
            if (turn >= maxTurns) break;

            // 1.2 主席选择的下一位发言人（无效时走兜底轮换）
            const prevSpeakerName = lastTurn?.name ?? null;
            const nextName = parsed?.next_speaker ?? parsed?.moderation?.next_speaker ?? null;
            const nextAgent = this._normalizeNextSpeaker({
                requested: nextName,
                participants,
                lastSpeakerName: prevSpeakerName,
            });
            if (!nextAgent) break;

            turn += 1;
            const nextLastTurn = transcript.length ? transcript[transcript.length - 1] : null;
            const nextSelfLastTurn = this._findLastTurn(transcript, (t) => t?.name === nextAgent.name);
            const nextBaseContext = this._truncateContext(context);
            const chairAssign = [
                `# 主席指派（请只回答这个任务）`,
                parsed?.next_speaker_reason ? `- 你被点名的原因：${parsed.next_speaker_reason}` : `- 你被主席点名发言。`,
                Array.isArray(parsed?.next_round?.questions) && parsed.next_round.questions.length
                    ? `- 需要澄清的问题：\n${parsed.next_round.questions.map((q) => `  - ${q}`).join('\n')}`
                    : null,
            ]
                .filter(Boolean)
                .join('\n');

            const nextTurnContext = this._buildTurnContext({
                baseContext: nextBaseContext,
                turn,
                maxTurns,
                agent: nextAgent,
                lastTurn: nextLastTurn,
                selfLastTurn: nextSelfLastTurn,
                debateRules,
                extraSections: [chairAssign],
            });

            this.logger.info(`发言：${nextAgent.name} (${nextAgent.role})`);
            const nextToolResults = await this._runTools(nextAgent.tools);
            const nextText = await nextAgent.speak({
                contextText: nextTurnContext,
                imagePaths,
                toolResults: nextToolResults,
                callOptions: { retries: llmRetries, timeoutMs: llmTimeoutMs },
            });

            const nextAuditResult = await this._auditTurn({ turn, agent: nextAgent, text: nextText });
            const { filteredText: nextFilteredText, isFiltered: nextIsFiltered } = this._applyAudit(nextText, nextAuditResult);
            transcript.push({
                name: nextAgent.name,
                role: nextAgent.role,
                text: nextFilteredText,
                audited: !!nextAuditResult,
                filtered: nextIsFiltered,
            });
            if (!nextIsFiltered) {
                context += `\n\n【${nextAgent.name}】\n${nextFilteredText}\n`;
            }
        }

        // 2) 兜底：如果最后一次发言不是主席，补一次主席收敛，保证输出可解析的最终 JSON
        const last = transcript.length ? transcript[transcript.length - 1] : null;
        if (last?.name !== chairAgent.name) {
            const lastTurn = last;
            const selfLastTurn = this._findLastTurn(transcript, (t) => t?.name === chairAgent.name);
            const baseContext = this._truncateContext(context);
            const chairNotes = this._buildChairModerationNotes({ participants });
            const finalize = `# 收敛要求\n- 这是最后一次主席发言：请给出“最终决策 JSON”。\n- next_speaker 设为 null。`;
            const chairContext = this._buildTurnContext({
                baseContext,
                turn: Math.min(turn + 1, maxTurns),
                maxTurns,
                agent: chairAgent,
                lastTurn,
                selfLastTurn,
                debateRules,
                extraSections: [chairNotes, finalize],
            });

            this.logger.info(`主席收敛：${chairAgent.name} (${chairAgent.role})`);
            const chairToolResults = await this._runTools(chairAgent.tools);
            const chairText = await chairAgent.speak({
                contextText: chairContext,
                imagePaths,
                toolResults: chairToolResults,
                callOptions: { retries: llmRetries, timeoutMs: llmTimeoutMs },
            });

            const finalAuditResult = await this._auditTurn({ turn: turn + 1, agent: chairAgent, text: chairText });
            const { filteredText: finalFilteredText, isFiltered: finalIsFiltered } = this._applyAudit(chairText, finalAuditResult);
            transcript.push({
                name: chairAgent.name,
                role: chairAgent.role,
                text: finalFilteredText,
                audited: !!finalAuditResult,
                filtered: finalIsFiltered,
            });
            if (!finalIsFiltered) {
                context += `\n\n【${chairAgent.name}】\n${finalFilteredText}\n`;
            }
        }

        if (summaryAgent) {
            const baseContext = this._truncateContext(context);
            const summaryContext = [
                `# 总结任务`,
                `- turn 上限: ${maxTurns}`,
                `- 是否提前达成一致: ${consensus ? '是' : '否'}`,
                ``,
                `# 会议上下文（可能被截断）`,
                baseContext,
            ].join('\n');

            this.logger.info(`总结：${summaryAgent.name} (${summaryAgent.role})`);
            const toolResults = await this._runTools(summaryAgent.tools);
            const text = await summaryAgent.speak({
                contextText: summaryContext,
                imagePaths,
                toolResults,
                callOptions: { retries: llmRetries, timeoutMs: llmTimeoutMs },
            });
            transcript.push({ name: summaryAgent.name, role: summaryAgent.role, text });
            context += `\n\n【${summaryAgent.name}】\n${text}\n`;
        }

        return { transcript, context: this._truncateContext(context) };
    }

    _computeAuditStatistics() {
        if (!this.auditHistory.length) {
            return null;
        }

        const totalTurns = this.auditHistory.length;
        const passedTurns = this.auditHistory.filter((a) => a.pass).length;
        const filteredTurns = totalTurns - passedTurns;
        const averageScore = this.auditHistory.reduce((sum, a) => sum + (a.overall_score ?? 0), 0) / totalTurns;

        const scoreBySpeaker = {};
        for (const audit of this.auditHistory) {
            if (!scoreBySpeaker[audit.speaker]) {
                scoreBySpeaker[audit.speaker] = { total: 0, count: 0 };
            }
            scoreBySpeaker[audit.speaker].total += audit.overall_score ?? 0;
            scoreBySpeaker[audit.speaker].count += 1;
        }

        return {
            total_turns: totalTurns,
            audited_turns: totalTurns,
            passed_turns: passedTurns,
            filtered_turns: filteredTurns,
            average_score: averageScore,
            score_by_speaker: Object.fromEntries(
                Object.entries(scoreBySpeaker).map(([speaker, data]) => [speaker, data.total / data.count]),
            ),
        };
    }

    generateAuditReport(sessionId) {
        if (!this.auditHistory.length) {
            return null;
        }

        const statistics = this._computeAuditStatistics();
        return {
            session_id: sessionId,
            audit_enabled: true,
            audit_settings: this.settings.audit_settings,
            statistics,
            audit_history: this.auditHistory,
        };
    }

    generateAuditSummaryMarkdown(report) {
        if (!report) {
            return '';
        }

        const { statistics, audit_history, audit_settings } = report;
        const strictModeMap = { strict: '严格', moderate: '平衡', lenient: '宽松' };

        const lines = [
            `# 审计摘要报告`,
            ``,
            `## 会话信息`,
            `- 会话 ID: ${report.session_id}`,
            `- 审计模式: ${strictModeMap[audit_settings?.strict_mode] || 'unknown'}`,
            `- 过滤阈值: ${audit_settings?.filter_threshold ?? 0.6}`,
            ``,
            `## 统计概览`,
            `- 总轮次: ${statistics.total_turns}`,
            `- 审计通过: ${statistics.passed_turns} (${Math.round((statistics.passed_turns / statistics.total_turns) * 100)}%)`,
            `- 过滤轮次: ${statistics.filtered_turns} (${Math.round((statistics.filtered_turns / statistics.total_turns) * 100)}%)`,
            `- 平均评分: ${statistics.average_score?.toFixed(2) ?? 'N/A'}`,
            ``,
            `## 按发言人统计`,
            `| 发言人 | 通过率 | 平均评分 |`,
            `|--------|--------|----------|`,
        ];

        for (const [speaker, score] of Object.entries(statistics.score_by_speaker ?? {})) {
            const speakerAudits = audit_history.filter((a) => a.speaker === speaker);
            const passed = speakerAudits.filter((a) => a.pass).length;
            const rate = Math.round((passed / speakerAudits.length) * 100);
            lines.push(`| ${speaker} | ${rate}% (${passed}/${speakerAudits.length}) | ${score.toFixed(2)} |`);
        }

        lines.push(``, `## 过滤详情`);

        const filteredAudits = audit_history.filter((a) => !a.pass);
        if (filteredAudits.length === 0) {
            lines.push(`无过滤记录，所有发言均通过审计。`);
        } else {
            for (const audit of filteredAudits) {
                lines.push(``, `### 轮次 ${audit.turn} - ${audit.speaker} [已过滤]`);
                lines.push(`- 评分: ${audit.overall_score?.toFixed(2) ?? 'N/A'}`);
                lines.push(`- 原因: ${audit.reason || '未提供'}`);
                if (audit.suggestions?.length) {
                    lines.push(`- 改进建议:`);
                    for (const suggestion of audit.suggestions) {
                        lines.push(`  - ${suggestion}`);
                    }
                }
            }
        }

        return lines.join('\n');
    }
}
