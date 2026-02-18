import { normalizeBaseUrl, resolveApiKey, imageToDataUrl } from './clientUtils.js';

export class ChatCompletionsClient {
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
        const url = `${this.baseUrl}/v1/chat/completions`;

        const userContent = [];
        if (userText) userContent.push({ type: 'text', text: userText });
        for (const imagePath of imagePaths) {
            userContent.push({ type: 'image_url', image_url: { url: imageToDataUrl(imagePath) } });
        }

        const body = {
            model: this.model,
            messages: [
                ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
                { role: 'user', content: userContent.length ? userContent : userText },
            ],
        };

        if (typeof this.temperature === 'number') body.temperature = this.temperature;
        if (typeof this.maxTokens === 'number') body.max_tokens = this.maxTokens;

        const res = await fetch(url, {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`Provider 请求失败：HTTP ${res.status} ${res.statusText}${text ? `，响应：${text}` : ''}`);
        }

        const data = await res.json();
        const content = data?.choices?.[0]?.message?.content;
        if (!content) throw new Error('Provider 响应缺少 message.content');
        return content;
    }
}
