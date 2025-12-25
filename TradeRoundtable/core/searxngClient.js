import { spawn } from 'child_process';

function normalizeBaseUrl(baseUrl) {
    const raw = String(baseUrl || '').trim();
    if (!raw) throw new Error('SearXNG base_url 不能为空');
    return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

function safeTruncate(text, maxChars) {
    const s = String(text || '');
    if (!maxChars || s.length <= maxChars) return s;
    return s.slice(0, maxChars);
}

function toTimeRange(hours) {
    const h = Number(hours);
    if (!Number.isFinite(h) || h <= 0) return null;
    if (h <= 24) return 'day';
    if (h <= 24 * 7) return 'week';
    if (h <= 24 * 31) return 'month';
    return 'year';
}

async function execFileCapture(command, args, { timeoutMs, label } = {}) {
    const t = Math.max(1, Number(timeoutMs) || 0);
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        let killed = false;

        const timer = setTimeout(() => {
            killed = true;
            try {
                child.kill();
            } catch {
                // ignore
            }
            reject(new Error(`${label || command} 超时（${t}ms）`));
        }, t);

        child.stdout.on('data', (b) => (stdout += String(b || '')));
        child.stderr.on('data', (b) => (stderr += String(b || '')));

        child.on('error', (e) => {
            clearTimeout(timer);
            reject(e);
        });

        child.on('close', (code) => {
            clearTimeout(timer);
            if (killed) return;
            if (code !== 0) {
                reject(new Error(`${label || command} 失败（code=${code}）：${safeTruncate(stderr, 800)}`));
                return;
            }
            resolve({ stdout, stderr });
        });
    });
}

export class SearxngClient {
    constructor({ baseUrl, timeoutMs = 15000, dockerFallbackContainer = 'searxng', logger = null } = {}) {
        this.baseUrl = normalizeBaseUrl(baseUrl);
        this.timeoutMs = Math.max(1000, Number(timeoutMs) || 15000);
        this.dockerFallbackContainer = String(dockerFallbackContainer || '').trim() || null;
        this.logger = logger;
    }

    _buildSearchUrl({ query, language, categories, timeRange, pageno } = {}) {
        const url = new URL(`${this.baseUrl}/search`);
        url.searchParams.set('q', String(query || ''));
        url.searchParams.set('format', 'json');
        if (language) url.searchParams.set('language', String(language));
        if (categories) url.searchParams.set('categories', String(categories));
        if (timeRange) url.searchParams.set('time_range', String(timeRange));
        if (pageno) url.searchParams.set('pageno', String(pageno));
        return url.toString();
    }

    _normalizeResults(payload, { limit } = {}) {
        const rawResults = Array.isArray(payload?.results) ? payload.results : [];
        const out = [];
        for (const r of rawResults) {
            const url = String(r?.url || '').trim();
            if (!url) continue;
            out.push({
                url,
                title: String(r?.title || '').trim(),
                content: String(r?.content || '').trim(),
                publishedDate: r?.publishedDate ?? r?.pubdate ?? null,
                engine: String(r?.engine || '').trim(),
                score: typeof r?.score === 'number' ? r.score : null,
            });
            if (limit && out.length >= limit) break;
        }
        return out;
    }

    async _searchViaHttp({ query, language, categories, recencyHours, limit } = {}) {
        const timeRange = toTimeRange(recencyHours);
        const url = this._buildSearchUrl({ query, language, categories, timeRange, pageno: 1 });

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            const res = await fetch(url, {
                method: 'GET',
                headers: { Accept: 'application/json' },
                signal: controller.signal,
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json();
            return this._normalizeResults(json, { limit });
        } finally {
            clearTimeout(timer);
        }
    }

    async _searchViaDocker({ query, language, categories, recencyHours, limit } = {}) {
        if (!this.dockerFallbackContainer) throw new Error('SearXNG docker_fallback_container 未配置');
        const timeRange = toTimeRange(recencyHours);
        const url = this._buildSearchUrl({ query, language, categories, timeRange, pageno: 1 });

        const { stdout } = await execFileCapture(
            'docker',
            ['exec', this.dockerFallbackContainer, 'wget', '-qO-', url],
            { timeoutMs: this.timeoutMs, label: `SearXNG(docker:${this.dockerFallbackContainer})` },
        );

        let json;
        try {
            json = JSON.parse(stdout);
        } catch (e) {
            throw new Error(`SearXNG 返回非 JSON：${e.message}`);
        }
        return this._normalizeResults(json, { limit });
    }

    async search({ query, language, categories = 'general', recencyHours = 24, limit = 10 } = {}) {
        const q = String(query || '').trim();
        if (!q) throw new Error('SearXNG search 需要 query');

        try {
            return await this._searchViaHttp({ query: q, language, categories, recencyHours, limit });
        } catch (e) {
            if (!this.dockerFallbackContainer) throw e;
            this.logger?.warn?.(`[SearXNG] HTTP 调用失败，改用 docker exec：${e.message}`);
            return this._searchViaDocker({ query: q, language, categories, recencyHours, limit });
        }
    }
}

