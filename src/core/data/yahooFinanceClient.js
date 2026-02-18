/**
 * Yahoo Finance 数据客户端
 *
 * 提供与 ExchangeClient 一致的接口，支持股票、外汇、贵金属等资产类型。
 * 通过 yahoo-finance2 获取历史 K 线数据。
 */

import YahooFinance from 'yahoo-finance2';
import { marketDataConfig } from '../config/index.js';
import { RawBar } from './models.js';

// 创建 yahoo-finance2 实例
const yahooFinance = new YahooFinance();

// Symbol 映射：通用格式 -> Yahoo 格式
const SYMBOL_MAP = {
    // 贵金属
    XAUUSD: 'GC=F',    // 黄金期货
    XAGUSD: 'SI=F',    // 白银期货
    XPTUSD: 'PL=F',    // 铂金期货
    XPDUSD: 'PA=F',    // 钯金期货

    // 原油
    WTIUSD: 'CL=F',    // WTI 原油期货
    BRENTUSD: 'BZ=F',  // 布伦特原油期货
};

// 外汇货币对后缀
const FOREX_PAIRS = ['EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD', 'CNY', 'HKD'];

// 时间周期映射：通用格式 -> Yahoo 格式
const INTERVAL_MAP = {
    '1m': '1m',
    '2m': '2m',
    '5m': '5m',
    '15m': '15m',
    '30m': '30m',
    '1h': '1h',
    '4h': '1h',  // Yahoo 不支持 4h，用 1h 聚合
    '1d': '1d',
    '1w': '1wk',
    '1M': '1mo',
};

/**
 * 规范化 symbol 到 Yahoo Finance 格式
 */
function normalizeToYahooSymbol(inputSymbol) {
    const raw = String(inputSymbol || '').trim().toUpperCase();
    if (!raw) throw new Error('symbol 不能为空');

    // 直接映射表
    if (SYMBOL_MAP[raw]) {
        return SYMBOL_MAP[raw];
    }

    // 外汇对检测（如 EURUSD -> EURUSD=X）
    for (const currency of FOREX_PAIRS) {
        if (raw.startsWith(currency) && raw.endsWith('USD') && raw.length === 6) {
            return `${raw}=X`;
        }
        if (raw.startsWith('USD') && raw.endsWith(currency) && raw.length === 6) {
            return `${raw}=X`;
        }
    }

    // A 股检测（6 位纯数字）
    if (/^\d{6}$/.test(raw)) {
        // 6 开头是上交所，0/3 开头是深交所
        if (raw.startsWith('6')) {
            return `${raw}.SS`;
        }
        return `${raw}.SZ`;
    }

    // 港股检测（4-5 位数字）
    if (/^\d{4,5}$/.test(raw)) {
        return `${raw.padStart(4, '0')}.HK`;
    }

    // 默认：直接使用（美股等）
    return raw;
}

/**
 * 从 Yahoo symbol 反推原始 symbol
 */
function yahooSymbolToOriginal(yahooSymbol) {
    const s = String(yahooSymbol || '').trim();

    // 反向查找映射表
    for (const [orig, yahoo] of Object.entries(SYMBOL_MAP)) {
        if (yahoo === s) return orig;
    }

    // 去掉后缀
    return s.replace(/=X$/, '').replace(/\.(SS|SZ|HK)$/, '');
}

export class YahooFinanceClient {
    constructor({
        assetClass = 'stock',
        timeoutMs = 20000,
        logger = null,
    } = {}) {
        this.assetClass = String(assetClass || 'stock').trim().toLowerCase();
        this.timeoutMs = timeoutMs;
        this.logger = logger;
        this.exchangeId = 'yahoo';
    }

    async fetchKlines({ symbol, interval, startMs, endMs = null, limit = 1000 }) {
        const { bars } = await this.fetchKlinesWithMeta({ symbol, interval, startMs, endMs, limit });
        return bars;
    }

    async fetchKlinesWithMeta({ symbol, interval, startMs, endMs = null, limit = 1000 }) {
        const yahooSymbol = normalizeToYahooSymbol(symbol);
        const yahooInterval = INTERVAL_MAP[interval];
        if (!yahooInterval) {
            throw new Error(`不支持的时间周期: ${interval}（Yahoo 支持: ${Object.keys(INTERVAL_MAP).join(', ')}）`);
        }

        const now = Date.now();
        const sinceStart = Number(startMs);
        if (!Number.isFinite(sinceStart) || sinceStart <= 0) {
            throw new Error(`startMs 非法: ${startMs}`);
        }

        const period1 = new Date(sinceStart);
        const period2 = endMs ? new Date(Number(endMs)) : new Date(now);

        this.logger?.info?.(`Yahoo Finance 请求: ${yahooSymbol} ${yahooInterval} ${period1.toISOString()} ~ ${period2.toISOString()}`);

        let result;
        try {
            result = await yahooFinance.chart(yahooSymbol, {
                period1,
                period2,
                interval: yahooInterval,
            });
        } catch (e) {
            throw new Error(`Yahoo Finance API 失败 (${yahooSymbol}): ${e.message}`);
        }

        const quotes = result?.quotes;
        if (!Array.isArray(quotes) || quotes.length === 0) {
            this.logger?.warn?.(`Yahoo Finance 返回空数据: ${yahooSymbol}`);
            return { bars: [], sourceExchangeId: 'yahoo', resolvedSymbol: yahooSymbol };
        }

        const allBars = [];
        for (const q of quotes) {
            const tsMs = q.date ? new Date(q.date).getTime() : null;
            if (!Number.isFinite(tsMs)) continue;
            if (q.open == null || q.high == null || q.low == null || q.close == null) continue;

            allBars.push(
                new RawBar({
                    tsMs,
                    open: Number(q.open),
                    high: Number(q.high),
                    low: Number(q.low),
                    close: Number(q.close),
                    volume: Number(q.volume || 0),
                }),
            );
        }

        // 处理 4h 聚合（Yahoo 不原生支持 4h）
        let finalBars = allBars;
        if (interval === '4h' && yahooInterval === '1h') {
            finalBars = this._aggregate1hTo4h(allBars);
        }

        // 限制数量
        if (finalBars.length > limit) {
            finalBars = finalBars.slice(-limit);
        }

        this.logger?.info?.(`Yahoo Finance 获取: ${yahooSymbol} ${interval} ${finalBars.length}条`);
        return { bars: finalBars, sourceExchangeId: 'yahoo', resolvedSymbol: yahooSymbol };
    }

    /**
     * 聚合 1 小时 K 线到 4 小时
     */
    _aggregate1hTo4h(bars) {
        if (bars.length < 4) return bars;

        const result = [];
        for (let i = 0; i < bars.length; i += 4) {
            const chunk = bars.slice(i, i + 4);
            if (chunk.length < 4) break;

            result.push(
                new RawBar({
                    tsMs: chunk[0].tsMs,
                    open: chunk[0].open,
                    high: Math.max(...chunk.map((b) => b.high)),
                    low: Math.min(...chunk.map((b) => b.low)),
                    close: chunk[chunk.length - 1].close,
                    volume: chunk.reduce((sum, b) => sum + b.volume, 0),
                }),
            );
        }
        return result;
    }

    async close() {
        // Yahoo client 无需清理资源
    }
}

// 缓存实例
let yahooClientCache = new Map();

function cacheKeyOf({ assetClass }) {
    return `yahoo:${String(assetClass || 'stock').toLowerCase()}`;
}

/**
 * 获取 Yahoo Finance 客户端（带缓存）
 */
export function getYahooFinanceClient(options = {}) {
    const cfg = marketDataConfig?.yahoo || {};
    const assetClass = options.assetClass || 'stock';
    const logger = options.logger || null;

    const key = cacheKeyOf({ assetClass });
    if (yahooClientCache.has(key)) {
        return yahooClientCache.get(key);
    }

    const client = new YahooFinanceClient({
        assetClass,
        timeoutMs: cfg.timeoutMs ?? 20000,
        logger,
    });

    yahooClientCache.set(key, client);
    return client;
}

export async function closeYahooFinanceClient() {
    const cache = yahooClientCache;
    yahooClientCache = new Map();
    await Promise.allSettled(Array.from(cache.values()).map((c) => c.close?.()));
}

// Symbol 转换工具导出
export { normalizeToYahooSymbol, yahooSymbolToOriginal };

export default {
    YahooFinanceClient,
    getYahooFinanceClient,
    closeYahooFinanceClient,
    normalizeToYahooSymbol,
    yahooSymbolToOriginal,
};
