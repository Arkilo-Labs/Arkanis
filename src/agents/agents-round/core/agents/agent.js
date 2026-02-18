import { withRetries, withTimeout } from '../runtime/runtime.js';

export class Agent {
    constructor({ name, role, order, systemPrompt, provider, canSeeImages, tools, logger }) {
        this.name = name;
        this.role = role;
        this.order = order;
        this.systemPrompt = systemPrompt;
        this.provider = provider;
        this.canSeeImages = Boolean(canSeeImages);
        this.tools = tools ?? [];
        this.logger = logger;
    }

    async speak({ contextText, imagePaths = [], toolResults = [], callOptions = {} }) {
        const merged = [
            toolResults.length ? `# 外部工具数据\n${toolResults.map((t) => JSON.stringify(t, null, 2)).join('\n\n')}` : '',
            contextText?.trim() ? `# 输入\n${contextText.trim()}` : '',
        ].filter(Boolean).join('\n\n');

        const usedImages = this.canSeeImages ? imagePaths : [];
        const { retries = 1, timeoutMs = 60000 } = callOptions;

        const text = await withRetries(
            async ({ attempt }) => {
                if (attempt > 1) this.logger.warn(`[重试] ${this.name} 第 ${attempt} 次调用`);
                return withTimeout(
                    this.provider.chat({
                        systemPrompt: this.systemPrompt,
                        userText: merged,
                        imagePaths: usedImages,
                    }),
                    timeoutMs,
                    `LLM(${this.name})`,
                );
            },
            {
                retries,
                baseDelayMs: 1200,
                label: `LLM(${this.name})`,
                onRetry: ({ delay, error }) => this.logger.warn(`[LLM失败] ${this.name}：${error.message}，${delay}ms 后重试`),
            },
        );

        return String(text).trim();
    }
}
