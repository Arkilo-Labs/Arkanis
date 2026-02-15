import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { resolveDataDir } from '../../../core/utils/dataDir.js';
import { readSecrets } from '../../../core/services/secretsStore.js';

function normalizeBaseUrl(baseUrl) {
    let base = String(baseUrl || '').trim();
    base = base.replace(/\/+$/, '');
    if (base.toLowerCase().endsWith('/v1')) base = base.slice(0, -3);
    return base.replace(/\/+$/, '');
}

function getApiKeyFromEnv(envName) {
    const name = String(envName || '').trim();
    if (!name) return null;
    const value = String(process.env[name] || '').trim();
    return value || null;
}

function toDataUrl(imagePath) {
    const buf = readFileSync(imagePath);
    const base64 = buf.toString('base64');
    return `data:image/png;base64,${base64}`;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..', '..', '..', '..');
const DATA_DIR = resolveDataDir({ projectRoot: PROJECT_ROOT });

let secretsCache = null;
let secretsCacheTime = 0;

async function readSecretsCached() {
    const now = Date.now();
    if (secretsCache && now - secretsCacheTime < 3000) return secretsCache;
    const secrets = await readSecrets({ dataDir: DATA_DIR, encKey: process.env.SECRETS_ENC_KEY || '' });
    secretsCache = secrets;
    secretsCacheTime = now;
    return secrets;
}

export class OpenAICompatibleProvider {
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

        const envKey = getApiKeyFromEnv(this.apiKeyEnv);
        const secrets = envKey ? null : await readSecretsCached();
        const secretKey = secrets?.providers?.[this.providerId]?.apiKey;
        const apiKey = envKey || (typeof secretKey === 'string' ? secretKey.trim() : '');
        if (!apiKey) {
            if (this.apiKeyEnv) {
                throw new Error(
                    `Provider 未配置密钥: ${this.providerId}（请在 Web 控制台「模型」页设置密钥，或设置环境变量 ${this.apiKeyEnv}）`,
                );
            }
            throw new Error(`Provider 未配置密钥: ${this.providerId}（请在 Web 控制台「模型」页设置密钥）`);
        }
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
