/**
 * WebFetchProvider 接口（由此类实现）：
 *   scrapeToMarkdown({ url }) → Promise<{ markdown: string, metadata: object|null }>
 */

function normalizeBaseUrl(baseUrl) {
    const raw = String(baseUrl || '').trim();
    if (!raw) throw new Error('Firecrawl base_url 不能为空');
    return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

function safeTruncate(text, maxChars) {
    const s = String(text || '');
    if (!maxChars || s.length <= maxChars) return s;
    return s.slice(0, maxChars);
}

export class FirecrawlFetchProvider {
    constructor({ baseUrl, timeoutMs = 30000, apiKey = null } = {}) {
        this.baseUrl = normalizeBaseUrl(baseUrl);
        this.timeoutMs = Math.max(1000, Number(timeoutMs) || 30000);
        this.apiKey = String(apiKey || '').trim() || null;
    }

    async scrapeToMarkdown({ url }) {
        const targetUrl = String(url || '').trim();
        if (!targetUrl) throw new Error('Firecrawl scrape 需要 url');

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            const headers = { 'Content-Type': 'application/json' };
            if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

            const res = await fetch(`${this.baseUrl}/v1/scrape`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ url: targetUrl, formats: ['markdown'] }),
                signal: controller.signal,
            });

            const text = await res.text();
            let json = null;
            try { json = JSON.parse(text); } catch (e) {
                throw new Error(`Firecrawl 返回非 JSON：${e.message}（status=${res.status}）`);
            }

            if (!res.ok) {
                throw new Error(`Firecrawl HTTP ${res.status}：${safeTruncate(json?.error || text, 500)}`);
            }
            if (!json?.success) {
                throw new Error(`Firecrawl 失败：${safeTruncate(json?.error || 'unknown', 500)}`);
            }

            return {
                markdown: String(json?.data?.markdown || '').trim(),
                metadata: json?.data?.metadata ?? null,
            };
        } finally {
            clearTimeout(timer);
        }
    }
}
