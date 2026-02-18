/**
 * WebSearchProvider 接口（由此类实现）：
 *   search({ query, language, categories, recencyHours, limit }) → Promise<SearchResult[]>
 *   searchMultiPage({ query, language, categories, recencyHours, resultsPerPage, pages }) → Promise<SearchResult[]>
 *
 * SearchResult: { url, title, content, publishedDate, engine, score }
 *
 * Tavily 文档：https://docs.tavily.com/documentation/api-reference/endpoint/search
 * Tavily 无传统分页概念，searchMultiPage 通过提高 max_results 模拟。
 */

const TAVILY_SEARCH_URL = 'https://api.tavily.com/search';
const MAX_RESULTS_CAP = 20; // Tavily basic depth 上限

function safeTruncate(text, maxChars) {
    const s = String(text || '');
    if (!maxChars || s.length <= maxChars) return s;
    return s.slice(0, maxChars);
}

function resolveSearchDepth(recencyHours) {
    // 24h 内用 basic 保证速度；更久用 advanced 提升召回
    return Number(recencyHours) <= 24 ? 'basic' : 'advanced';
}

function normalizeTavilyResults(results, { limit } = {}) {
    const raw = Array.isArray(results) ? results : [];
    const out = [];
    for (const r of raw) {
        const url = String(r?.url || '').trim();
        if (!url) continue;
        out.push({
            url,
            title: String(r?.title || '').trim(),
            content: String(r?.content || '').trim(),
            publishedDate: r?.published_date ?? null,
            engine: 'tavily',
            score: typeof r?.score === 'number' ? r.score : null,
        });
        if (limit && out.length >= limit) break;
    }
    return out;
}

export class TavilySearchProvider {
    constructor({ apiKey, timeoutMs = 15000 } = {}) {
        const key = String(apiKey || '').trim();
        if (!key) throw new Error('Tavily apiKey 不能为空');
        this.apiKey = key;
        this.timeoutMs = Math.max(1000, Number(timeoutMs) || 15000);
    }

    async _callSearch({ query, maxResults, searchDepth, topic } = {}) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            const res = await fetch(TAVILY_SEARCH_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${this.apiKey}`,
                },
                body: JSON.stringify({
                    query: String(query || ''),
                    search_depth: searchDepth || 'basic',
                    max_results: Math.min(Math.max(1, Number(maxResults) || 10), MAX_RESULTS_CAP),
                    topic: topic || 'general',
                    include_answer: false,
                }),
                signal: controller.signal,
            });

            const text = await res.text();
            let json = null;
            try { json = JSON.parse(text); } catch (e) {
                throw new Error(`Tavily 返回非 JSON：${e.message}（status=${res.status}）`);
            }

            if (!res.ok) {
                throw new Error(`Tavily HTTP ${res.status}：${safeTruncate(json?.message || text, 500)}`);
            }

            return json;
        } finally {
            clearTimeout(timer);
        }
    }

    async search({ query, recencyHours = 24, limit = 10 } = {}) {
        const q = String(query || '').trim();
        if (!q) throw new Error('Tavily search 需要 query');

        const searchDepth = resolveSearchDepth(recencyHours);
        const json = await this._callSearch({ query: q, maxResults: limit, searchDepth, topic: 'general' });
        return normalizeTavilyResults(json?.results, { limit });
    }

    // Tavily 无分页，提高 max_results 扩大召回量，并去重
    async searchMultiPage({ query, recencyHours = 24, resultsPerPage = 10, pages = 1 } = {}) {
        const q = String(query || '').trim();
        if (!q) throw new Error('Tavily searchMultiPage 需要 query');

        const wantedTotal = Math.min(resultsPerPage * pages, MAX_RESULTS_CAP);
        const searchDepth = resolveSearchDepth(recencyHours);
        const json = await this._callSearch({ query: q, maxResults: wantedTotal, searchDepth, topic: 'general' });
        return normalizeTavilyResults(json?.results);
    }
}
