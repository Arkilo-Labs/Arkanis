/**
 * WebFetchProvider 接口（由此类实现）：
 *   scrapeToMarkdown({ url }) → Promise<{ markdown: string, metadata: object|null }>
 *
 * Jina Reader 文档：https://jina.ai/reader/
 * 请求 GET https://r.jina.ai/{targetUrl}，Accept: application/json
 * 响应：{ code, status, data: { title, description, url, content, ... } }
 */

const JINA_DEFAULT_BASE_URL = 'https://r.jina.ai';

function normalizeBaseUrl(baseUrl) {
    const raw = String(baseUrl || JINA_DEFAULT_BASE_URL).trim();
    return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

function safeTruncate(text, maxChars) {
    const s = String(text || '');
    if (!maxChars || s.length <= maxChars) return s;
    return s.slice(0, maxChars);
}

export class JinaFetchProvider {
    constructor({ apiKey = null, baseUrl = JINA_DEFAULT_BASE_URL, timeoutMs = 30000 } = {}) {
        this.apiKey = String(apiKey || '').trim() || null;
        this.baseUrl = normalizeBaseUrl(baseUrl);
        this.timeoutMs = Math.max(1000, Number(timeoutMs) || 30000);
    }

    async scrapeToMarkdown({ url }) {
        const targetUrl = String(url || '').trim();
        if (!targetUrl) throw new Error('Jina scrape 需要 url');

        // Jina Reader: GET {baseUrl}/{encodedUrl}
        const requestUrl = `${this.baseUrl}/${encodeURIComponent(targetUrl)}`;

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            const headers = {
                Accept: 'application/json',
                'X-Return-Format': 'markdown',
            };
            if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

            const res = await fetch(requestUrl, {
                method: 'GET',
                headers,
                signal: controller.signal,
            });

            const text = await res.text();
            let json = null;
            try { json = JSON.parse(text); } catch (e) {
                throw new Error(`Jina 返回非 JSON：${e.message}（status=${res.status}）`);
            }

            if (!res.ok) {
                throw new Error(`Jina HTTP ${res.status}：${safeTruncate(json?.message || text, 500)}`);
            }

            const data = json?.data ?? {};
            const markdown = String(data.content || '').trim();
            const metadata = {
                title: data.title ?? null,
                description: data.description ?? null,
                url: data.url ?? targetUrl,
                statusCode: res.status,
            };

            return { markdown, metadata };
        } finally {
            clearTimeout(timer);
        }
    }
}
