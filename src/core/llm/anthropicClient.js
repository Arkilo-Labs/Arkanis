import { normalizeBaseUrl, resolveApiKey, imageToBase64WithMime } from './clientUtils.js';

const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MAX_TOKENS = 8192;

export class AnthropicClient {
    constructor({ providerId, baseUrl, apiKeyEnv, model, temperature, maxTokens, supportsVision }) {
        this.providerId = String(providerId || '').trim();
        this.baseUrl = normalizeBaseUrl(baseUrl);
        this.apiKeyEnv = String(apiKeyEnv || '').trim();
        this.model = model;
        this.temperature = temperature;
        this.maxTokens = maxTokens;
        this.supportsVision = supportsVision;
    }

    async chat({ systemPrompt, userText, imagePaths = [] }) {
        if (imagePaths.length && !this.supportsVision) {
            throw new Error(`当前 Provider 不支持图片：model=${this.model}`);
        }

        const apiKey = await resolveApiKey({ providerId: this.providerId, apiKeyEnv: this.apiKeyEnv });
        const url = `${this.baseUrl}/v1/messages`;

        const userContent = [];
        if (userText) userContent.push({ type: 'text', text: userText });
        for (const imagePath of imagePaths) {
            const { base64, mimeType } = imageToBase64WithMime(imagePath);
            userContent.push({
                type: 'image',
                source: { type: 'base64', media_type: mimeType, data: base64 },
            });
        }

        const body = {
            model: this.model,
            messages: [{ role: 'user', content: userContent.length ? userContent : userText }],
            // max_tokens 是 Anthropic API 的必填字段
            max_tokens: typeof this.maxTokens === 'number' ? this.maxTokens : DEFAULT_MAX_TOKENS,
        };

        if (systemPrompt) body.system = systemPrompt;
        if (typeof this.temperature === 'number') body.temperature = this.temperature;

        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'x-api-key': apiKey,
                'anthropic-version': ANTHROPIC_VERSION,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });

        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`Provider 请求失败：HTTP ${res.status} ${res.statusText}${text ? `，响应：${text}` : ''}`);
        }

        const data = await res.json();
        const content = data?.content?.find((c) => c.type === 'text')?.text;
        if (!content) throw new Error('Provider 响应缺少 content[].text');
        return content;
    }
}
