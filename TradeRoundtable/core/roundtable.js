export class Roundtable {
    constructor({ agents, settings, mcpClient, logger }) {
        this.agents = agents;
        this.settings = settings;
        this.mcpClient = mcpClient;
        this.logger = logger;
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

    _buildTurnContext({ baseContext, round, maxRounds, agent, lastTurn, selfLastTurn, debateRules }) {
        const parts = [];

        parts.push(`# 回合信息\n- round: ${round}/${maxRounds}\n- speaker: ${agent.name} (${agent.role})`);

        if (debateRules) {
            parts.push(`# 交锋规则（必须遵守）\n${debateRules}`);
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
        const summary = summaryName ? byName.get(summaryName) : null;
        const final = finalName ? byName.get(finalName) : null;

        const others = this.agents.filter((a) => a !== summary);
        const participants = others.filter((a) => a !== final);
        const finalAgent = final ?? null;

        // 固定：每轮主席最后发言
        const ordered = participants.slice();
        ordered.sort((x, y) => (x.order ?? 0) - (y.order ?? 0));
        if (finalAgent) ordered.push(finalAgent);

        return { orderedPerRound: ordered, summaryAgent: summary, finalAgent };
    }

    async run({ contextSeed, imagePaths }) {
        const transcript = [];
        let context = contextSeed ?? '';
        const maxRounds = this.settings.max_rounds ?? 3;
        const llmTimeoutMs = this.settings.llm_timeout_ms ?? 60000;
        const llmRetries = this.settings.llm_retries ?? 1;
        const debateRules =
            this.settings.debate_rules ??
            [
                '- 必须指出至少 1 条你不同意/质疑的点（引用“上一位发言”或上下文的原话）。',
                '- 你的反驳必须给出可验证条件：什么情况下对方成立/你成立。',
                '- 不要复述别人说过的话；只补充新信息、反证或更严格的条件。',
            ].join('\n');

        const { orderedPerRound, summaryAgent, finalAgent } = this._splitAgents();
        if (!finalAgent) {
            throw new Error('roundtable_settings.final_agent 未配置或不存在');
        }

        let consensus = false;

        for (let round = 1; round <= maxRounds; round++) {
            this.logger.info(`Round ${round}/${maxRounds} 开始`);

            for (const agent of orderedPerRound) {
                const lastTurn = transcript.length ? transcript[transcript.length - 1] : null;
                const selfLastTurn = this._findLastTurn(transcript, (t) => t?.name === agent.name);
                const baseContext = this._truncateContext(context);
                const isFirstSpeaker = agent.name === orderedPerRound[0].name;
                const turnContext = this._buildTurnContext({
                    baseContext,
                    round,
                    maxRounds,
                    agent,
                    lastTurn,
                    selfLastTurn,
                    debateRules: isFirstSpeaker && round === 1 ? null : debateRules,
                });

                this.logger.info(`发言：${agent.name} (${agent.role})`);
                const toolResults = await this._runTools(agent.tools);
                const text = await agent.speak({
                    contextText: turnContext,
                    imagePaths,
                    toolResults,
                    callOptions: { retries: llmRetries, timeoutMs: llmTimeoutMs },
                });

                transcript.push({ name: agent.name, role: agent.role, text });
                context += `\n\n【${agent.name}】\n${text}\n`;

                if (agent === finalAgent) {
                    const parsed = this._extractJsonObject(text);
                    consensus = Boolean(parsed?.consensus);
                    if (consensus) {
                        this.logger.info('主席判定已达成一致：提前结束讨论');
                    } else {
                        this.logger.info('主席判定尚未一致：进入下一轮讨论');
                    }
                }
            }

            if (consensus) break;
        }

        if (summaryAgent) {
            const baseContext = this._truncateContext(context);
            const summaryContext = [
                `# 总结任务`,
                `- 讨论轮数上限: ${maxRounds}`,
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
}
