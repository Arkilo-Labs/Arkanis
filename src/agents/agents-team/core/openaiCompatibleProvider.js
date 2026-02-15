import { readFileSync } from 'fs';

function normalizeBaseUrl(baseUrl) {
    return String(baseUrl || '').replace(/\/+$/, '');
}

function getApiKeyFromEnv(envName) {
    const value = String(process.env[envName] || '').trim();
    if (!value) {
        throw new Error(`缺少环境变量 ${envName}（用于 Provider API Key）`);
    }
    return value;
}

function toDataUrl(imagePath) {
    const buf = readFileSync(imagePath);
    const base64 = buf.toString('base64');
    return `data:image/png;base64,${base64}`;
}

export class OpenAICompatibleProvider {
    constructor({ baseUrl, apiKeyEnv, model, temperature, maxTokens, supportsVision }) {
        this.baseUrl = normalizeBaseUrl(baseUrl);
        this.apiKeyEnv = apiKeyEnv;
        this.model = model;
        this.temperature = temperature;
        this.maxTokens = maxTokens;
        this.supportsVision = supportsVision;
    }

    async chat({ systemPrompt, userText, imagePaths = [] }) {
        if (imagePaths.length && !this.supportsVision) {
            throw new Error(`当前 Provider 不支持图片：model=${this.model}`);
        }

        const apiKey = getApiKeyFromEnv(this.apiKeyEnv);
        const url = `${this.baseUrl}/v1/chat/completions`;

        const userContent = [];
        if (userText) userContent.push({ type: 'text', text: userText });
        for (const imagePath of imagePaths) {
            userContent.push({
                type: 'image_url',
                image_url: { url: toDataUrl(imagePath) },
            });
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
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });

        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`Provider 请求失败：HTTP ${res.status} ${res.statusText}${text ? `，响应：${text}` : ''}`);
        }

        const data = await res.json();
        const content = data?.choices?.[0]?.message?.content;
        if (!content) {
            throw new Error('Provider 响应缺少 message.content');
        }
        return content;
    }
}

