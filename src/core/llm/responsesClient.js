import { normalizeBaseUrl, resolveApiKey, imageToDataUrl } from './clientUtils.js';

// output_text 是顶层快捷字段；严格实现可能只有 output 数组，且 message 未必在 [0]
function extractOutputText(data) {
    if (data?.output_text) return data.output_text;
    if (!Array.isArray(data?.output)) return null;
    for (const item of data.output) {
        if (!Array.isArray(item?.content)) continue;
        for (const block of item.content) {
            if (block.type === 'output_text' && block.text) return block.text;
        }
    }
    return null;
}

export class ResponsesClient {
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
        const url = `${this.baseUrl}/v1/responses`;

        // 有图片时 input 必须是消息数组
        let input;
        if (imagePaths.length) {
            const content = [];
            if (userText) content.push({ type: 'input_text', text: userText });
            for (const imagePath of imagePaths) {
                content.push({ type: 'input_image', image_url: imageToDataUrl(imagePath), detail: 'auto' });
            }
            input = [{ type: 'message', role: 'user', content }];
        } else {
            input = userText || '';
        }

        const body = { model: this.model, input };
        if (systemPrompt) body.instructions = systemPrompt;
        if (typeof this.temperature === 'number') body.temperature = this.temperature;
        if (typeof this.maxTokens === 'number') body.max_output_tokens = this.maxTokens;

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
        const content = extractOutputText(data);
        if (!content) throw new Error('Provider 响应缺少 output_text');
        return content;
    }
}
