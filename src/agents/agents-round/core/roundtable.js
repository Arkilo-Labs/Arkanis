import { validateRR } from './rrValidator.js';
import { StructuredContext } from './structuredContext.js';
import { BeliefTracker } from './beliefTracker.js';

function safeTruncate(value, maxChars) {
    const text = typeof value === 'string' ? value : String(value ?? '');
    const max = Math.max(0, Number(maxChars) || 0);
    if (!max || text.length <= max) return text;
    return `${text.slice(0, max)}…`;
}

export class Roundtable {
    constructor({ agents, settings, mcpClient, logger, auditorAgent = null, toolbox = null, onEvent = null }) {
        this.agents = agents;
        this.settings = settings;
        this.mcpClient = mcpClient;
        this.logger = logger;
        this.auditorAgent = auditorAgent;
        this.toolbox = toolbox;
        this.onEvent = typeof onEvent === 'function' ? onEvent : null;
        this.auditHistory = [];
        this.structuredContext = new StructuredContext();
        this.beliefTracker = new BeliefTracker({
            agentAccuracy: settings.agent_accuracy ?? {},
        });
    }

    _emitEvent(type, payload) {
        if (!this.onEvent) return;
        try {
            this.onEvent(type, payload);
        } catch (e) {
            const msg = e?.message || String(e);
            this.logger?.warn?.(`[事件回调失败] ${type}: ${msg}`);
        }
    }

    _validateRR(leaderJson) {
        const minRR = this.settings?.min_rr ?? 1.5;
        return validateRR(leaderJson, { minRR });
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

    _isToolRequest(obj) {
        if (!obj || typeof obj !== 'object') return false;
        const action = String(obj.action || '').trim();
        if (action === 'call_tools') return true;
        if (Array.isArray(obj.calls) && obj.calls.length) return true;
        return false;
    }

    _normalizeToolCalls(obj, { maxCalls } = {}) {
        const limit = Math.max(0, Number(maxCalls) || 0) || 4;
        const calls = Array.isArray(obj?.calls) ? obj.calls : [];
        return calls
            .map((c) => (c && typeof c === 'object' ? { name: c.name, args: c.args } : null))
            .filter(Boolean)
            .slice(0, limit);
    }

    _deduplicateToolCalls(newCalls, existingToolResults) {
        // 构建已执行工具的唯一标识集合
        const existingKeys = new Set();
        for (const r of existingToolResults || []) {
            if (r.tool === 'browser.screenshot' && r.url) {
                existingKeys.add(`screenshot:${r.url}`);
            }
            if (r.tool === 'searxng.search' && r.query) {
                existingKeys.add(`search:${r.query}`);
            }
            if (r.tool === 'firecrawl.scrape' && r.url) {
                existingKeys.add(`scrape:${r.url}`);
            }
            if (r.tool === 'orderbook.depth' && r.symbol) {
                existingKeys.add(`orderbook:${r.symbol}`);
            }
        }

        // 过滤重复调用
        return newCalls.filter((call) => {
            const name = String(call.name || '').trim();
            const args = call.args || {};

            if (name === 'browser.screenshot') {
                const key = `screenshot:${args.url}`;
                if (existingKeys.has(key)) {
                    this.logger?.warn?.(`[去重] 跳过重复截图: ${args.url}`);
                    return false;
                }
                existingKeys.add(key);
            }

            if (name === 'searxng.search') {
                const key = `search:${args.query}`;
                if (existingKeys.has(key)) {
                    this.logger?.warn?.(`[去重] 跳过重复搜索: ${args.query}`);
                    return false;
                }
                existingKeys.add(key);
            }

            if (name === 'firecrawl.scrape') {
                const key = `scrape:${args.url}`;
                if (existingKeys.has(key)) {
                    this.logger?.warn?.(`[去重] 跳过重复抓取: ${args.url}`);
                    return false;
                }
                existingKeys.add(key);
            }

            if (name === 'orderbook.depth') {
                const key = `orderbook:${args.symbol}`;
                if (existingKeys.has(key)) {
                    this.logger?.warn?.(`[去重] 跳过重复挂单薄查询: ${args.symbol}`);
                    return false;
                }
                existingKeys.add(key);
            }

            return true;
        });
    }

    async _speakWithToolLoop({ turn, agent, contextText, imagePaths, callOptions } = {}) {
        const baseToolResults = await this._runTools(agent.tools);
        const toolResults = baseToolResults.slice();
        const mergedImages = Array.isArray(imagePaths) ? imagePaths.slice() : [];

        const maxIters = Math.max(0, Number(this.settings?.tool_loop_max_iters) || 0) || 3;
        const maxCalls = Math.max(0, Number(this.settings?.tool_loop_max_calls) || 0) || 4;

        for (let iter = 0; iter <= maxIters; iter++) {
            const extraLimitNote =
                iter >= maxIters
                    ? '\n\n# 约束\n- 工具调用次数已到上限，请基于已有“外部工具数据”直接输出最终答案（不要再请求工具）。\n'
                    : '';

            const text = await agent.speak({
                contextText: `${contextText}${extraLimitNote}`,
                imagePaths: mergedImages,
                toolResults,
                callOptions,
            });

            const parsed = this._extractJsonObject(text);
            if (!this._isToolRequest(parsed)) {
                return { text, toolResults, imagePaths: mergedImages };
            }

            if (!this.toolbox) {
                this._emitEvent('tool-call', {
                    stage: 'error',
                    turn,
                    agent: agent?.name ?? '',
                    error: 'toolbox 未注入，无法执行工具调用',
                });
                toolResults.push({ tool: 'toolbox', ok: false, error: 'toolbox 未注入，无法执行工具调用' });
                continue;
            }

            const calls = this._normalizeToolCalls(parsed, { maxCalls });
            if (!calls.length) {
                this._emitEvent('tool-call', {
                    stage: 'error',
                    turn,
                    agent: agent?.name ?? '',
                    error: '工具请求 JSON 缺少 calls，已忽略',
                });
                toolResults.push({ tool: 'toolbox', ok: false, error: '工具请求 JSON 缺少 calls，已忽略' });
                continue;
            }

            // 去重：过滤已调用过的相同工具
            const deduplicatedCalls = this._deduplicateToolCalls(calls, toolResults);
            if (!deduplicatedCalls.length) {
                this._emitEvent('tool-call', {
                    stage: 'skipped',
                    turn,
                    agent: agent?.name ?? '',
                    calls: calls.map((c) => ({ name: c.name })),
                    note: '所有工具调用均已执行过，已跳过重复调用',
                });
                toolResults.push({ tool: 'toolbox', ok: false, error: '所有工具调用均已执行过，已跳过重复调用' });
                continue;
            }

            this._emitEvent('tool-call', {
                stage: 'request',
                turn,
                agent: agent?.name ?? '',
                calls: deduplicatedCalls.map((c) => ({ name: c.name, args: c.args ?? {} })),
            });

            const { toolResults: newResults, imagePaths: newImages } = await this.toolbox.runCalls({
                calls: deduplicatedCalls,
                agentName: agent.name,
                turn,
            });

            toolResults.push(...(newResults ?? []));
            mergedImages.push(...(newImages ?? []));

            this._emitEvent('tool-call', {
                stage: 'result',
                turn,
                agent: agent?.name ?? '',
                results: this._summarizeToolResultsForEvent(newResults ?? []),
                image_paths: Array.isArray(newImages) ? newImages.slice() : [],
            });
        }

        // 理论不会走到这里（iter>=maxIters 时已强制要求输出最终答案）
        const fallbackText = await agent.speak({ contextText, imagePaths: mergedImages, toolResults, callOptions });
        return { text: fallbackText, toolResults, imagePaths: mergedImages };
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

            const { text: auditResultText } = await this._speakWithToolLoop({
                turn,
                agent: this.auditorAgent,
                contextText: auditPrompt,
                imagePaths: [],
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

    _extractStructuredInfo(text, source, meta = {}) {
        if (!text || !this.structuredContext) return;

        // 提取方向性观点
        const directionPatterns = [
            { pattern: /看多|做多|LONG|买入|上涨趋势/i, direction: 'LONG' },
            { pattern: /看空|做空|SHORT|卖出|下跌趋势/i, direction: 'SHORT' },
            { pattern: /观望|等待|WAIT|不操作|暂不入场/i, direction: 'WAIT' },
        ];

        for (const { pattern, direction } of directionPatterns) {
            if (pattern.test(text)) {
                const confMatch = text.match(/置信度[：:]\s*([\d.]+)/);
                const rawConfidence = confMatch ? parseFloat(confMatch[1]) : 0.6;

                // 使用贝叶斯追踪器校准置信度
                const calibratedConfidence = this.beliefTracker
                    ? this.beliefTracker.calibrateConfidence(source, rawConfidence, direction)
                    : rawConfidence;

                const reasonMatch = text.match(/理由[：:]\s*([^\n]+)/);
                this.structuredContext.addOpinion({
                    source,
                    direction,
                    reason: reasonMatch ? reasonMatch[1].trim() : '',
                    confidence: calibratedConfidence,
                });

                // 更新贝叶斯信念
                if (this.beliefTracker) {
                    const posteriors = this.beliefTracker.update(source, direction, calibratedConfidence);
                    this._emitEvent('belief-update', {
                        turn: meta?.turn ?? null,
                        source,
                        direction,
                        raw_confidence: rawConfidence,
                        confidence: calibratedConfidence,
                        posteriors,
                    });
                }
                break;
            }
        }

        // 提取价格相关事实
        const pricePatterns = [
            { pattern: /RSI[=：:]\s*([\d.]+)/i, template: 'RSI=$1' },
            { pattern: /支撑位?[=：:约]?\s*([\d,]+)/i, template: '支撑位=$1' },
            { pattern: /阻力位?[=：:约]?\s*([\d,]+)/i, template: '阻力位=$1' },
            { pattern: /止损[=：:]\s*([\d,]+)/i, template: '止损=$1' },
            { pattern: /止盈[=：:]\s*([\d,]+)/i, template: '止盈=$1' },
            { pattern: /入场[价位]?[=：:]\s*([\d,]+)/i, template: '入场价=$1' },
        ];

        for (const { pattern, template } of pricePatterns) {
            const match = text.match(pattern);
            if (match) {
                this.structuredContext.addFact({
                    source,
                    content: template.replace('$1', match[1]),
                    category: 'price_level',
                    confidence: 0.85,
                });
            }
        }

        // 检测分歧
        if (/不同意|质疑|反驳|但是|然而|相反/i.test(text)) {
            const conflictMatch = text.match(/(?:不同意|质疑|反驳)[：:]*\s*([^\n。]+)/);
            if (conflictMatch) {
                this.structuredContext.addConflict({
                    description: conflictMatch[1].trim().slice(0, 100),
                    severity: 'medium',
                });
            }
        }
    }

    _buildContextWithStructured(baseContext) {
        const useStructured = this.settings.use_structured_context !== false;
        if (!useStructured || !this.structuredContext) {
            return baseContext;
        }

        const parts = [];

        // 添加结构化信息摘要
        const structuredSummary = this.structuredContext.toCompactString();
        if (structuredSummary.trim()) {
            parts.push(`# 结构化信息摘要\n${structuredSummary}`);
        }

        // 添加贝叶斯信念状态
        if (this.beliefTracker && this.beliefTracker.updateHistory.length > 0) {
            parts.push(this.beliefTracker.toSummaryString());
        }

        parts.push(`# 会议上下文\n${baseContext}`);
        return parts.join('\n\n');
    }

    _summarizeToolResultForEvent(toolResult) {
        if (!toolResult || typeof toolResult !== 'object') return null;
        const tool = String(toolResult.tool || '').trim() || '(unknown)';
        const ok = Boolean(toolResult.ok);
        const base = { tool, ok };

        if (!ok) {
            base.error = safeTruncate(toolResult.error, 500);
            return base;
        }

        if (toolResult.fromCache) base.from_cache = true;

        if (tool === 'searxng.search') {
            base.query = safeTruncate(toolResult.query, 200);
            base.count = Array.isArray(toolResult.result?.results) ? toolResult.result.results.length : null;
            return base;
        }

        if (tool === 'firecrawl.scrape') {
            base.url = safeTruncate(toolResult.url, 500);
            base.markdown_chars = typeof toolResult.markdown === 'string' ? toolResult.markdown.length : null;
            return base;
        }

        if (tool === 'browser.screenshot') {
            base.url = safeTruncate(toolResult.url, 500);
            base.image_path = toolResult.image_path ? String(toolResult.image_path) : null;
            return base;
        }

        if (tool === 'mcp.call') {
            base.server = safeTruncate(toolResult.server, 120);
            base.method = safeTruncate(toolResult.method, 200);
            return base;
        }

        if (tool === 'orderbook.depth') {
            base.symbol = safeTruncate(toolResult.symbol, 80);
            base.note = safeTruncate(toolResult.note, 200);
            return base;
        }

        return base;
    }

    _summarizeToolResultsForEvent(toolResults) {
        const list = Array.isArray(toolResults) ? toolResults : [];
        return list.map((r) => this._summarizeToolResultForEvent(r)).filter(Boolean);
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

        // 使用结构化上下文增强
        const enhancedContext = this._buildContextWithStructured(baseContext);
        parts.push(`# 会议上下文（可能被截断）\n${enhancedContext}`);
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

    async _runParallelOpening({ participants, chairAgent, contextSeed, imagePaths, llmTimeoutMs, llmRetries }) {
        const openingInstructions = this._buildOpeningInstructions({ chairAgent, participants });
        const baseContext = this._truncateContext(contextSeed);

        const parallelTasks = participants.map((agent, idx) => {
            const turnContext = this._buildTurnContext({
                baseContext,
                turn: idx + 1,
                maxTurns: participants.length,
                agent,
                lastTurn: null,
                selfLastTurn: null,
                debateRules: null,
                extraSections: [openingInstructions],
            });

            return this._speakWithToolLoop({
                turn: idx + 1,
                agent,
                contextText: turnContext,
                imagePaths,
                callOptions: { retries: llmRetries, timeoutMs: llmTimeoutMs },
            }).then(async (result) => {
                const auditResult = await this._auditTurn({ turn: idx + 1, agent, text: result.text });
                return { agent, turn: idx + 1, result, auditResult };
            });
        });

        this.logger.info(`并行开场：${participants.length} 位参与者同时发言`);
        const results = await Promise.all(parallelTasks);
        return results;
    }

    _aggregateOpeningResults(results) {
        const transcript = [];
        let contextAdditions = '';

        for (const { agent, turn, result, auditResult } of results) {
            const { filteredText, isFiltered } = this._applyAudit(result.text, auditResult);
            transcript.push({
                name: agent.name,
                role: agent.role,
                text: filteredText,
                audited: !!auditResult,
                filtered: isFiltered,
            });
            this._emitEvent('agent-speak', {
                phase: 'opening',
                turn,
                name: agent.name,
                role: agent.role,
                text: filteredText,
                audited: !!auditResult,
                filtered: isFiltered,
            });
            if (!isFiltered) {
                contextAdditions += `\n\n【${agent.name}】\n${filteredText}\n`;
                this._extractStructuredInfo(filteredText, agent.name, { turn });
            }
            this.logger.info(`开场完成：${agent.name} (${agent.role})`);
        }

        return { transcript, contextAdditions };
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

    _classifyAgentStance(text) {
        const bullPatterns = /看多|做多|LONG|买入|上涨|突破|支撑有效|反弹/i;
        const bearPatterns = /看空|做空|SHORT|卖出|下跌|跌破|阻力有效|回调/i;
        const waitPatterns = /观望|等待|WAIT|不操作|暂不入场|风险较高/i;

        if (waitPatterns.test(text)) return 'WAIT';
        if (bullPatterns.test(text) && !bearPatterns.test(text)) return 'BULL';
        if (bearPatterns.test(text) && !bullPatterns.test(text)) return 'BEAR';
        if (bullPatterns.test(text) && bearPatterns.test(text)) return 'MIXED';
        return 'NEUTRAL';
    }

    _buildAdversarialTeams(openingResults) {
        const bullTeam = [];
        const bearTeam = [];
        const neutralTeam = [];

        for (const { agent, result } of openingResults) {
            const stance = this._classifyAgentStance(result.text);
            if (stance === 'BULL') {
                bullTeam.push({ agent, stance, text: result.text });
            } else if (stance === 'BEAR') {
                bearTeam.push({ agent, stance, text: result.text });
            } else {
                neutralTeam.push({ agent, stance, text: result.text });
            }
        }

        return { bullTeam, bearTeam, neutralTeam };
    }

    _buildCrossExaminationPrompt({ examiner, target, targetStance, targetText }) {
        return [
            `# 交叉质询任务`,
            `你是 ${examiner.name}（${examiner.role}），现在需要质询 ${target.name} 的${targetStance === 'BULL' ? '看多' : '看空'}观点。`,
            ``,
            `# ${target.name} 的原始观点`,
            targetText,
            ``,
            `# 质询要求`,
            `1. 找出对方论点中最薄弱的环节`,
            `2. 提出具体的反驳问题（至少 2 个）`,
            `3. 指出在什么条件下对方的观点会失效`,
            `4. 你的质询必须基于数据或逻辑，不能是主观臆断`,
        ].join('\n');
    }

    _buildRebuttalPrompt({ defender, attackerName, attackText, originalText }) {
        return [
            `# 反驳任务`,
            `你是 ${defender.name}（${defender.role}），${attackerName} 对你的观点提出了质疑。`,
            ``,
            `# 你的原始观点`,
            originalText,
            ``,
            `# ${attackerName} 的质疑`,
            attackText,
            ``,
            `# 反驳要求`,
            `1. 直接回应对方提出的每个质疑点`,
            `2. 提供额外的证据或逻辑支持你的观点`,
            `3. 承认对方有道理的部分（如果有）`,
            `4. 明确在什么条件下你会改变观点`,
        ].join('\n');
    }

    async _runAdversarialDebate({ openingResults, chairAgent, imagePaths, llmTimeoutMs, llmRetries, maxDebateRounds = 2 }) {
        const { bullTeam, bearTeam, neutralTeam } = this._buildAdversarialTeams(openingResults);
        const debateTranscript = [];
        let debateContext = '';

        // 如果没有明显的对立阵营，跳过对抗性辩论
        if (bullTeam.length === 0 || bearTeam.length === 0) {
            this.logger.info('对抗性辩论：未检测到明显对立阵营，跳过');
            return { transcript: [], context: '', skipped: true };
        }

        this.logger.info(`对抗性辩论：Bull=${bullTeam.length}, Bear=${bearTeam.length}, Neutral=${neutralTeam.length}`);

        for (let round = 0; round < maxDebateRounds; round++) {
            // Bull 质询 Bear
            const bullExaminer = bullTeam[round % bullTeam.length];
            const bearTarget = bearTeam[round % bearTeam.length];

            const bullExamPrompt = this._buildCrossExaminationPrompt({
                examiner: bullExaminer.agent,
                target: bearTarget.agent,
                targetStance: 'BEAR',
                targetText: bearTarget.text,
            });

            this.logger.info(`交叉质询：${bullExaminer.agent.name} -> ${bearTarget.agent.name}`);
            const { text: bullExamText } = await this._speakWithToolLoop({
                turn: 100 + round * 4,
                agent: bullExaminer.agent,
                contextText: bullExamPrompt,
                imagePaths,
                callOptions: { retries: llmRetries, timeoutMs: llmTimeoutMs },
            });

            debateTranscript.push({
                name: bullExaminer.agent.name,
                role: bullExaminer.agent.role,
                text: bullExamText,
                phase: 'cross_examination',
                target: bearTarget.agent.name,
            });
            debateContext += `\n\n【${bullExaminer.agent.name} 质询 ${bearTarget.agent.name}】\n${bullExamText}\n`;

            // Bear 反驳
            const bearRebuttalPrompt = this._buildRebuttalPrompt({
                defender: bearTarget.agent,
                attackerName: bullExaminer.agent.name,
                attackText: bullExamText,
                originalText: bearTarget.text,
            });

            this.logger.info(`反驳：${bearTarget.agent.name}`);
            const { text: bearRebuttalText } = await this._speakWithToolLoop({
                turn: 100 + round * 4 + 1,
                agent: bearTarget.agent,
                contextText: bearRebuttalPrompt,
                imagePaths,
                callOptions: { retries: llmRetries, timeoutMs: llmTimeoutMs },
            });

            debateTranscript.push({
                name: bearTarget.agent.name,
                role: bearTarget.agent.role,
                text: bearRebuttalText,
                phase: 'rebuttal',
            });
            debateContext += `\n\n【${bearTarget.agent.name} 反驳】\n${bearRebuttalText}\n`;

            // Bear 质询 Bull
            const bearExaminer = bearTeam[round % bearTeam.length];
            const bullTarget = bullTeam[round % bullTeam.length];

            const bearExamPrompt = this._buildCrossExaminationPrompt({
                examiner: bearExaminer.agent,
                target: bullTarget.agent,
                targetStance: 'BULL',
                targetText: bullTarget.text,
            });

            this.logger.info(`交叉质询：${bearExaminer.agent.name} -> ${bullTarget.agent.name}`);
            const { text: bearExamText } = await this._speakWithToolLoop({
                turn: 100 + round * 4 + 2,
                agent: bearExaminer.agent,
                contextText: bearExamPrompt,
                imagePaths,
                callOptions: { retries: llmRetries, timeoutMs: llmTimeoutMs },
            });

            debateTranscript.push({
                name: bearExaminer.agent.name,
                role: bearExaminer.agent.role,
                text: bearExamText,
                phase: 'cross_examination',
                target: bullTarget.agent.name,
            });
            debateContext += `\n\n【${bearExaminer.agent.name} 质询 ${bullTarget.agent.name}】\n${bearExamText}\n`;

            // Bull 反驳
            const bullRebuttalPrompt = this._buildRebuttalPrompt({
                defender: bullTarget.agent,
                attackerName: bearExaminer.agent.name,
                attackText: bearExamText,
                originalText: bullTarget.text,
            });

            this.logger.info(`反驳：${bullTarget.agent.name}`);
            const { text: bullRebuttalText } = await this._speakWithToolLoop({
                turn: 100 + round * 4 + 3,
                agent: bullTarget.agent,
                contextText: bullRebuttalPrompt,
                imagePaths,
                callOptions: { retries: llmRetries, timeoutMs: llmTimeoutMs },
            });

            debateTranscript.push({
                name: bullTarget.agent.name,
                role: bullTarget.agent.role,
                text: bullRebuttalText,
                phase: 'rebuttal',
            });
            debateContext += `\n\n【${bullTarget.agent.name} 反驳】\n${bullRebuttalText}\n`;
        }

        return { transcript: debateTranscript, context: debateContext, skipped: false };
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

        // 0) 并行开场：所有参与者同时发言，减少等待时间
        const parallelOpening = this.settings.parallel_opening !== false;
        let openingResults = null;
        if (parallelOpening) {
            this.logger.info('开场：并行立场陈述');
            openingResults = await this._runParallelOpening({
                participants,
                chairAgent,
                contextSeed: context,
                imagePaths,
                llmTimeoutMs,
                llmRetries,
            });
            const { transcript: openingTranscript, contextAdditions } = this._aggregateOpeningResults(openingResults);
            transcript.push(...openingTranscript);
            context += contextAdditions;
            turn = participants.length;

            // 对抗性辩论（可选）
            const enableAdversarialDebate = this.settings.adversarial_debate === true;
            if (enableAdversarialDebate && openingResults) {
                const debateResult = await this._runAdversarialDebate({
                    openingResults,
                    chairAgent,
                    imagePaths,
                    llmTimeoutMs,
                    llmRetries,
                    maxDebateRounds: this.settings.adversarial_debate_rounds ?? 1,
                });
                if (!debateResult.skipped) {
                    transcript.push(...debateResult.transcript);
                    context += debateResult.context;
                    turn += debateResult.transcript.length;
                }
            }
        } else {
            // 串行开场（兼容旧模式）
            this.logger.info('开场：串行立场陈述');
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
                const { text } = await this._speakWithToolLoop({
                    turn,
                    agent,
                    contextText: turnContext,
                    imagePaths,
                    callOptions: { retries: llmRetries, timeoutMs: llmTimeoutMs },
                });

                const auditResult = await this._auditTurn({ turn, agent, text });
                const { filteredText, isFiltered } = this._applyAudit(text, auditResult);
                transcript.push({
                    name: agent.name,
                    role: agent.role,
                    text: filteredText,
                    audited: !!auditResult,
                    filtered: isFiltered,
                });
                this._emitEvent('agent-speak', {
                    phase: 'opening',
                    turn,
                    name: agent.name,
                    role: agent.role,
                    text: filteredText,
                    audited: !!auditResult,
                    filtered: isFiltered,
                });
                if (!isFiltered) {
                    context += `\n\n【${agent.name}】\n${filteredText}\n`;
                    this._extractStructuredInfo(filteredText, agent.name, { turn });
                }
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
            const { text: chairText } = await this._speakWithToolLoop({
                turn,
                agent: chairAgent,
                contextText: chairContext,
                imagePaths,
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
            this._emitEvent('agent-speak', {
                phase: 'chair',
                turn,
                name: chairAgent.name,
                role: chairAgent.role,
                text: chairFilteredText,
                audited: !!chairAuditResult,
                filtered: chairIsFiltered,
            });
            if (!chairIsFiltered) {
                context += `\n\n【${chairAgent.name}】\n${chairFilteredText}\n`;
                this._extractStructuredInfo(chairFilteredText, chairAgent.name, { turn });
            }

            const parsed = this._extractJsonObject(chairText);
            lastChairJson = parsed;

            // RR 校验：如果是 ENTER 信号，自动计算并校验盈亏比
            if (parsed?.signal === 'ENTER') {
                const rrResult = this._validateRR(parsed);
                if (!rrResult.valid && !rrResult.skipped) {
                    this.logger.warn(`[RR校验] ${rrResult.reason}`);
                    if (rrResult.suggestion) {
                        this.logger.warn(`[RR校验] 建议入场价: ${rrResult.suggestion.adjustedEntry}`);
                    }
                    // 将校验结果注入上下文，供后续 Agent（如 Risk）参考
                    context += `\n\n[系统校验] 盈亏比不合格：${rrResult.reason}。RR=${rrResult.rr}，最低要求=${rrResult.minRR}\n`;
                } else if (rrResult.valid) {
                    this.logger.info(`[RR校验] 通过，RR=${rrResult.rr}`);
                }
            }

            consensus = Boolean(parsed?.consensus);
            if (parsed && !chairIsFiltered) {
                this._emitEvent('decision', {
                    stage: consensus ? 'final' : 'draft',
                    turn,
                    speaker: chairAgent.name,
                    json: parsed,
                });
            }
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
            const { text: nextText } = await this._speakWithToolLoop({
                turn,
                agent: nextAgent,
                contextText: nextTurnContext,
                imagePaths,
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
            this._emitEvent('agent-speak', {
                phase: 'discussion',
                turn,
                name: nextAgent.name,
                role: nextAgent.role,
                text: nextFilteredText,
                audited: !!nextAuditResult,
                filtered: nextIsFiltered,
            });
            if (!nextIsFiltered) {
                context += `\n\n【${nextAgent.name}】\n${nextFilteredText}\n`;
                this._extractStructuredInfo(nextFilteredText, nextAgent.name, { turn });
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
            const { text: chairText } = await this._speakWithToolLoop({
                turn: turn + 1,
                agent: chairAgent,
                contextText: chairContext,
                imagePaths,
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
            this._emitEvent('agent-speak', {
                phase: 'finalize',
                turn: turn + 1,
                name: chairAgent.name,
                role: chairAgent.role,
                text: finalFilteredText,
                audited: !!finalAuditResult,
                filtered: finalIsFiltered,
            });
            if (!finalIsFiltered) {
                context += `\n\n【${chairAgent.name}】\n${finalFilteredText}\n`;
            }

            const parsed = this._extractJsonObject(chairText);
            if (parsed && !finalIsFiltered) {
                this._emitEvent('decision', {
                    stage: 'final',
                    turn: turn + 1,
                    speaker: chairAgent.name,
                    json: parsed,
                });
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
            const { text } = await this._speakWithToolLoop({
                turn: Math.min(turn + 1, maxTurns),
                agent: summaryAgent,
                contextText: summaryContext,
                imagePaths,
                callOptions: { retries: llmRetries, timeoutMs: llmTimeoutMs },
            });
            transcript.push({ name: summaryAgent.name, role: summaryAgent.role, text });
            this._emitEvent('agent-speak', {
                phase: 'summary',
                turn: Math.min(turn + 1, maxTurns),
                name: summaryAgent.name,
                role: summaryAgent.role,
                text,
                audited: false,
                filtered: false,
            });
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
