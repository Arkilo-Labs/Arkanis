import { join } from 'path';
import { ensureDir } from '../runtime/fsUtils.js';
import { screenshotPage } from '../screenshots/liquidationShot.js';

function isHttpUrl(raw) {
    try {
        const u = new URL(String(raw || '').trim());
        return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
        return false;
    }
}

function safeNumber(x, { min, max, fallback } = {}) {
    const n = Number(x);
    if (!Number.isFinite(n)) return fallback;
    if (min != null && n < min) return min;
    if (max != null && n > max) return max;
    return n;
}

function safeTruncate(text, maxChars) {
    const s = String(text || '');
    const max = Math.max(0, Number(maxChars) || 0);
    if (!max || s.length <= max) return s;
    return s.slice(0, max);
}

function defaultShotFileName({ agentName, turn, index }) {
    const a = String(agentName || 'agent').replace(/[^\w.-]+/g, '_').slice(0, 64);
    const t = String(Number(turn) || 0).padStart(2, '0');
    const i = String(Number(index) || 0).padStart(2, '0');
    return `shot_${t}_${a}_${i}.png`;
}

/**
 * 工具调用缓存管理器
 * 用于避免重复调用相同参数的工具
 */
class ToolCache {
    constructor({ ttlMs = 5 * 60 * 1000, maxSize = 100 } = {}) {
        this.cache = new Map();
        this.ttlMs = ttlMs;
        this.maxSize = maxSize;
    }

    _generateKey(toolName, args) {
        const sortedArgs = JSON.stringify(args, Object.keys(args || {}).sort());
        return `${toolName}:${sortedArgs}`;
    }

    get(toolName, args) {
        const key = this._generateKey(toolName, args);
        const entry = this.cache.get(key);
        if (!entry) return null;

        if (Date.now() - entry.timestamp > this.ttlMs) {
            this.cache.delete(key);
            return null;
        }

        entry.hits++;
        return entry.result;
    }

    set(toolName, args, result) {
        // 清理过期条目
        if (this.cache.size >= this.maxSize) {
            this._evictOldest();
        }

        const key = this._generateKey(toolName, args);
        this.cache.set(key, {
            result,
            timestamp: Date.now(),
            hits: 0,
        });
    }

    _evictOldest() {
        let oldestKey = null;
        let oldestTime = Infinity;

        for (const [key, entry] of this.cache) {
            if (entry.timestamp < oldestTime) {
                oldestTime = entry.timestamp;
                oldestKey = key;
            }
        }

        if (oldestKey) {
            this.cache.delete(oldestKey);
        }
    }

    getStats() {
        let totalHits = 0;
        let validEntries = 0;
        const now = Date.now();

        for (const entry of this.cache.values()) {
            if (now - entry.timestamp <= this.ttlMs) {
                validEntries++;
                totalHits += entry.hits;
            }
        }

        return {
            size: this.cache.size,
            validEntries,
            totalHits,
        };
    }

    clear() {
        this.cache.clear();
    }
}

export class Toolbox {
    constructor({ searxngClient = null, firecrawlClient = null, mcpClient = null, outputDir = null, logger = null, cacheOptions = {} } = {}) {
        this.searxngClient = searxngClient;
        this.firecrawlClient = firecrawlClient;
        this.mcpClient = mcpClient;
        this.outputDir = outputDir;
        this.logger = logger;
        this.cache = new ToolCache(cacheOptions);
    }

    async runCalls({ calls, agentName, turn } = {}) {
        const toolResults = [];
        const imagePaths = [];

        const list = Array.isArray(calls) ? calls : [];
        for (let i = 0; i < list.length; i++) {
            const call = list[i] ?? {};
            const name = String(call.name || '').trim();
            const args = call.args ?? {};

            // 检查缓存（截图工具不缓存，因为页面可能变化）
            const cacheable = name !== 'browser.screenshot';
            if (cacheable) {
                const cached = this.cache.get(name, args);
                if (cached) {
                    this.logger?.info?.(`[Toolbox] 缓存命中: ${name}`);
                    toolResults.push({ ...cached, fromCache: true });
                    if (cached.image_path) {
                        imagePaths.push(cached.image_path);
                    }
                    continue;
                }
            }

            try {
                if (name === 'searxng.search') {
                    if (!this.searxngClient) throw new Error('SearXNG 未配置/未注入');
                    const query = String(args.query || '').trim();
                    const language = args.language ? String(args.language) : undefined;
                    const categories = args.categories ? String(args.categories) : 'general';
                    const recencyHours = safeNumber(args.recency_hours ?? args.recencyHours, { min: 1, max: 24 * 365, fallback: 24 });
                    const limit = safeNumber(args.limit, { min: 1, max: 50, fallback: 10 });
                    const pages = safeNumber(args.pages, { min: 1, max: 5, fallback: 1 });
                    const resultsPerPage = safeNumber(args.results_per_page ?? args.resultsPerPage, { min: 1, max: 25, fallback: limit });

                    const result =
                        pages > 1
                            ? await this.searxngClient.searchMultiPage({
                                query,
                                language,
                                categories,
                                recencyHours,
                                resultsPerPage,
                                pages,
                            })
                            : await this.searxngClient.search({ query, language, categories, recencyHours, limit });

                    const toolResult = {
                        tool: name,
                        ok: true,
                        query,
                        language: language ?? null,
                        categories,
                        recency_hours: recencyHours,
                        result,
                    };
                    toolResults.push(toolResult);
                    this.cache.set(name, args, toolResult);
                    continue;
                }

                if (name === 'firecrawl.scrape') {
                    if (!this.firecrawlClient) throw new Error('Firecrawl 未配置/未注入');
                    const url = String(args.url || '').trim();
                    if (!isHttpUrl(url)) throw new Error('firecrawl.scrape 仅允许 http/https url');
                    const maxChars = safeNumber(args.max_markdown_chars ?? args.maxMarkdownChars, {
                        min: 200,
                        max: 30000,
                        fallback: 8000,
                    });
                    const { markdown, metadata } = await this.firecrawlClient.scrapeToMarkdown({ url });
                    const toolResult = {
                        tool: name,
                        ok: true,
                        url,
                        markdown: safeTruncate(markdown, maxChars),
                        metadata: metadata ?? null,
                    };
                    toolResults.push(toolResult);
                    this.cache.set(name, args, toolResult);
                    continue;
                }

                if (name === 'browser.screenshot') {
                    const url = String(args.url || '').trim();
                    if (!isHttpUrl(url)) throw new Error('browser.screenshot 仅允许 http/https url');
                    if (!this.outputDir) throw new Error('截图 outputDir 未配置/未注入');

                    const shotDir = join(this.outputDir, 'tool_shots');
                    ensureDir(shotDir);

                    const fileName = String(args.file_name || args.fileName || '').trim() || defaultShotFileName({ agentName, turn, index: i + 1 });
                    const waitMs = safeNumber(args.wait_ms ?? args.waitMs, { min: 0, max: 30000, fallback: 5000 });
                    const fullPage = Boolean(args.full_page ?? args.fullPage ?? false);
                    const preferChartClip = args.prefer_chart_clip ?? args.preferChartClip ?? true;
                    const deviceScaleFactor = safeNumber(args.device_scale_factor ?? args.deviceScaleFactor, { min: 1, max: 3, fallback: 2 });
                    const clipPadding = safeNumber(args.clip_padding ?? args.clipPadding, { min: 0, max: 120, fallback: 32 });

                    const viewport = args.viewport
                        ? {
                            width: safeNumber(args.viewport.width, { min: 800, max: 4096, fallback: 2560 }),
                            height: safeNumber(args.viewport.height, { min: 600, max: 2160, fallback: 1440 }),
                            deviceScaleFactor,
                        }
                        : undefined;

                    const outPath = await screenshotPage({
                        url,
                        outputDir: shotDir,
                        fileName,
                        waitMs,
                        viewport,
                        fullPage,
                        preferChartClip: Boolean(preferChartClip),
                        deviceScaleFactor,
                        clipPadding,
                    });

                    toolResults.push({ tool: name, ok: true, url, image_path: outPath });
                    imagePaths.push(outPath);
                    continue;
                }

                if (name === 'mcp.call') {
                    if (!this.mcpClient) throw new Error('MCP 未配置/未注入');
                    const server = String(args.server || '').trim();
                    const method = String(args.method || '').trim();
                    const params = args.params ?? {};
                    if (!server) throw new Error('mcp.call 需要 server');
                    if (!method) throw new Error('mcp.call 需要 method');
                    const result = await this.mcpClient.call(server, method, params);
                    const toolResult = { tool: name, ok: true, server, method, params, result };
                    toolResults.push(toolResult);
                    this.cache.set(name, args, toolResult);
                    continue;
                }

                if (name === 'orderbook.depth') {
                    // 动态导入 orderbook 模块
                    const { fetchOrderbook, summarizeOrderbook } = await import('../market/orderbook.js');

                    const symbol = String(args.symbol || '').trim();
                    if (!symbol) throw new Error('orderbook.depth 需要 symbol');

                    const rangePercent = safeNumber(args.range_percent ?? args.rangePercent, {
                        min: 0.1, max: 5, fallback: 1
                    });
                    const exchange = String(args.exchange || 'binance').trim();
                    const marketType = String(args.market_type || args.marketType || 'futures').trim();

                    const ob = await fetchOrderbook({
                        exchangeId: exchange,
                        marketType,
                        symbol,
                        limit: 200,
                        logger: this.logger,
                    });

                    const referencePrice = safeNumber(args.reference_price ?? args.referencePrice, { fallback: null });
                    const summary = summarizeOrderbook({
                        orderbook: ob,
                        referencePrice,
                        rangePercent,
                    });

                    const bidTotal = summary?.bidTotal ?? 0;
                    const askTotal = summary?.askTotal ?? 0;
                    const estimatedNormalTotal = (bidTotal + askTotal) * 2;
                    const isLowLiquidity = bidTotal < estimatedNormalTotal * 0.25;
                    const liquidityRatio = estimatedNormalTotal > 0
                        ? parseFloat(((bidTotal + askTotal) / estimatedNormalTotal).toFixed(2))
                        : 1;

                    const toolResult = {
                        tool: name,
                        ok: true,
                        symbol,
                        exchange,
                        market_type: marketType,
                        range_percent: rangePercent,
                        summary,
                        is_low_liquidity: isLowLiquidity,
                        liquidity_ratio: liquidityRatio,
                        note: isLowLiquidity ? '检测到低流动性，假突破概率上升' : '流动性正常',
                    };
                    toolResults.push(toolResult);
                    this.cache.set(name, args, toolResult);
                    continue;
                }

                throw new Error(`未知工具：${name}`);
            } catch (e) {
                const msg = String(e?.message || e);
                this.logger?.warn?.(`[Toolbox] ${agentName || 'agent'} 调用失败：${name}：${msg}`);
                toolResults.push({ tool: name || '(missing)', ok: false, error: msg, args });
            }
        }

        return { toolResults, imagePaths };
    }
}
