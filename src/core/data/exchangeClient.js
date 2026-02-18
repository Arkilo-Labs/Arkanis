/**
 * 交易所/市场数据客户端（Crypto 优先）
 *
 * 目标：
 * - 用 ccxt 支持多交易所 + 失败切换
 * - 保持对外 API 尽量稳定（供 KlinesRepository / TradeRoundtable 复用）
 * - 为后续股票/外汇接入留扩展点（assetClass / venue / meta）
 */

import ccxt from 'ccxt';
import { marketDataConfig } from '../config/index.js';
import { RawBar } from './models.js';

export const TIMEFRAME_TO_INTERVAL = {
    '1m': '1m',
    '3m': '3m',
    '5m': '5m',
    '15m': '15m',
    '30m': '30m',
    '1h': '1h',
    '2h': '2h',
    '4h': '4h',
    '6h': '6h',
    '8h': '8h',
    '12h': '12h',
    '1d': '1d',
};

const COMMON_QUOTES = ['USDT', 'USDC', 'USD', 'BUSD', 'BTC', 'ETH', 'EUR', 'JPY', 'GBP', 'AUD', 'CAD', 'CHF'];

function normalizeExchangeId(exchangeId) {
    const id = String(exchangeId || '').trim().toLowerCase();
    if (!id) throw new Error('exchangeId 不能为空');
    return id;
}

function normalizeAssetClass(assetClass) {
    const v = String(assetClass || '').trim().toLowerCase();
    return v || 'crypto';
}

function normalizeMarketTypeForCcxt({ exchangeId, marketType }) {
    const t = String(marketType || '').trim().toLowerCase();
    if (!t) return undefined;
    if (t === 'spot') return 'spot';
    if (t === 'swap' || t === 'perp' || t === 'perpetual') return 'swap';

    if (t === 'futures' || t === 'future') {
        if (exchangeId === 'bybit') return 'swap';
        if (exchangeId === 'okx') return 'swap';
        return 'future';
    }

    return t;
}

export function splitCompactSymbolToCcxtSymbol(compactSymbol) {
    const raw = String(compactSymbol || '').trim().toUpperCase();
    if (!raw) return null;
    if (raw.includes('/')) return raw;

    for (const quote of COMMON_QUOTES) {
        if (raw.length <= quote.length) continue;
        if (!raw.endsWith(quote)) continue;
        const base = raw.slice(0, -quote.length);
        if (!base) continue;
        return `${base}/${quote}`;
    }

    return null;
}

function getCcxtExchangeClass(exchangeId) {
    const ExClass = ccxt?.[exchangeId];
    if (!ExClass) {
        const known = Array.isArray(ccxt?.exchanges) ? ccxt.exchanges.slice(0, 20).join(', ') : '';
        throw new Error(`不支持的 ccxt exchangeId: ${exchangeId}${known ? `（示例：${known}...）` : ''}`);
    }
    return ExClass;
}

function getEnvString(key) {
    const v = process.env[key];
    return v == null ? null : String(v);
}

function buildCcxtCredentialsFromEnv(exchangeId) {
    const prefix = String(exchangeId || '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    return {
        apiKey: getEnvString(`${prefix}_API_KEY`) || getEnvString('CCXT_API_KEY'),
        secret: getEnvString(`${prefix}_SECRET`) || getEnvString('CCXT_SECRET'),
        password: getEnvString(`${prefix}_PASSWORD`) || getEnvString('CCXT_PASSWORD'),
        uid: getEnvString(`${prefix}_UID`) || getEnvString('CCXT_UID'),
    };
}

function safeJoinCsv(input) {
    return String(input || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
}

function normalizeSymbolInput(symbol) {
    const s = String(symbol || '').trim();
    if (!s) throw new Error('symbol 不能为空');
    return s.toUpperCase();
}

export class ExchangeClient {
    constructor({
        exchangeId,
        assetClass = 'crypto',
        marketType = undefined,
        timeoutMs = 20000,
        enableRateLimit = true,
        sandbox = false,
        logger = null,
        ccxtOptions = {},
    }) {
        this.exchangeId = normalizeExchangeId(exchangeId);
        this.assetClass = normalizeAssetClass(assetClass);
        this.marketType = marketType ? String(marketType).trim().toLowerCase() : undefined;
        this.timeoutMs = timeoutMs;
        this.enableRateLimit = enableRateLimit;
        this.sandbox = sandbox;
        this.logger = logger;

        const ExClass = getCcxtExchangeClass(this.exchangeId);
        const credentials = buildCcxtCredentialsFromEnv(this.exchangeId);
        const defaultType = normalizeMarketTypeForCcxt({ exchangeId: this.exchangeId, marketType: this.marketType });

        const opts = {
            enableRateLimit: Boolean(enableRateLimit),
            timeout: Number(timeoutMs),
            ...credentials,
            options: {
                ...(defaultType ? { defaultType } : {}),
                ...(ccxtOptions?.options || {}),
            },
            ...ccxtOptions,
        };

        this.exchange = new ExClass(opts);

        if (sandbox && typeof this.exchange.setSandboxMode === 'function') {
            this.exchange.setSandboxMode(true);
        }

        this._ready = null;
    }

    async _ensureReady() {
        if (this._ready) return this._ready;
        this._ready = (async () => {
            if (!this.exchange.has?.fetchOHLCV) {
                throw new Error(`交易所不支持 fetchOHLCV：${this.exchangeId}`);
            }
            await this.exchange.loadMarkets();
        })();
        return this._ready;
    }

    async _resolveCcxtSymbol(inputSymbol) {
        const normalized = normalizeSymbolInput(inputSymbol);
        if (normalized.includes('/')) return normalized;

        await this._ensureReady();
        const byId = this.exchange?.marketsById?.[normalized];
        if (byId?.symbol) return String(byId.symbol).toUpperCase();

        const inferred = splitCompactSymbolToCcxtSymbol(normalized);
        if (inferred) return inferred;

        return normalized;
    }

    async fetchKlines({ symbol, interval, startMs, endMs = null, limit = 1000 }) {
        const { bars } = await this.fetchKlinesWithMeta({ symbol, interval, startMs, endMs, limit });
        return bars;
    }

    async fetchKlinesWithMeta({ symbol, interval, startMs, endMs = null, limit = 1000 }) {
        const tf = String(interval || '').trim();
        if (!TIMEFRAME_TO_INTERVAL[tf]) {
            throw new Error(`不支持的时间周期: ${tf}`);
        }

        const sinceStart = Number(startMs);
        if (!Number.isFinite(sinceStart) || sinceStart <= 0) {
            throw new Error(`startMs 非法: ${startMs}`);
        }

        const resolvedSymbol = await this._resolveCcxtSymbol(symbol);
        const resolvedLimit = Math.min(Math.max(Number(limit) || 1000, 1), 1000);
        const maxLoops = 1000;

        const allBars = [];
        let currentSince = sinceStart;

        for (let i = 0; i < maxLoops; i += 1) {
            await this._ensureReady();
            const ohlcv = await this.exchange.fetchOHLCV(resolvedSymbol, tf, currentSince, resolvedLimit);
            if (!Array.isArray(ohlcv) || ohlcv.length === 0) break;

            const lastTsMs = Number(ohlcv[ohlcv.length - 1]?.[0]);
            if (!Number.isFinite(lastTsMs)) {
                throw new Error(`OHLCV 返回格式异常：${this.exchangeId} ${resolvedSymbol} ${tf}`);
            }

            for (const k of ohlcv) {
                const tsMs = Number(k?.[0]);
                if (!Number.isFinite(tsMs)) continue;
                if (endMs != null && tsMs > Number(endMs)) continue;
                allBars.push(
                    new RawBar({
                        tsMs,
                        open: Number(k?.[1]),
                        high: Number(k?.[2]),
                        low: Number(k?.[3]),
                        close: Number(k?.[4]),
                        volume: Number(k?.[5]),
                    }),
                );
            }

            if (ohlcv.length < resolvedLimit) break;
            if (endMs != null && lastTsMs >= Number(endMs)) break;

            const nextSince = lastTsMs + 1;
            if (nextSince <= currentSince) break;
            currentSince = nextSince;
        }

        this.logger?.info?.(`ccxt 拉取K线：exchange=${this.exchangeId} symbol=${symbol} -> ${resolvedSymbol} tf=${tf} ${allBars.length}条`);
        return { bars: allBars, sourceExchangeId: this.exchangeId, resolvedSymbol };
    }

    async fetchOrderbook({ symbol, limit = 100 }) {
        await this._ensureReady();
        if (!this.exchange.has?.fetchOrderBook) {
            throw new Error(`交易所不支持 fetchOrderBook：${this.exchangeId}`);
        }

        const resolvedSymbol = await this._resolveCcxtSymbol(symbol);
        const res = await this.exchange.fetchOrderBook(resolvedSymbol, Number(limit) || 100);
        const bids = Array.isArray(res?.bids) ? res.bids : [];
        const asks = Array.isArray(res?.asks) ? res.asks : [];

        const toLvls = (lvls) =>
            lvls
                .map(([p, q]) => ({ price: Number(p), qty: Number(q) }))
                .filter((x) => Number.isFinite(x.price) && x.price > 0 && Number.isFinite(x.qty) && x.qty > 0);

        return {
            exchangeId: this.exchangeId,
            symbol: resolvedSymbol,
            tsMs: Number.isFinite(res?.timestamp) ? res.timestamp : null,
            bids: toLvls(bids),
            asks: toLvls(asks),
        };
    }

    async close() {
        const ex = this.exchange;
        this.exchange = null;
        this._ready = null;
        if (ex && typeof ex.close === 'function') {
            await ex.close();
        }
    }
}

class FailoverExchangeClient {
    constructor({ clients, logger = null }) {
        this.clients = Array.isArray(clients) ? clients : [];
        this.logger = logger;
    }

    async fetchKlines(params) {
        const { bars } = await this.fetchKlinesWithMeta(params);
        return bars;
    }

    async fetchKlinesWithMeta(params) {
        const errors = [];
        for (const c of this.clients) {
            try {
                return await c.fetchKlinesWithMeta(params);
            } catch (e) {
                errors.push(`[${c.exchangeId}] ${e.message}`);
                this.logger?.warn?.(`交易所失败切换：${c.exchangeId} -> ${e.message}`);
            }
        }
        throw new Error(`所有交易所都不可用：${errors.join(' | ')}`);
    }

    async fetchOrderbook(params) {
        const errors = [];
        for (const c of this.clients) {
            try {
                return await c.fetchOrderbook(params);
            } catch (e) {
                errors.push(`[${c.exchangeId}] ${e.message}`);
                this.logger?.warn?.(`挂单薄失败切换：${c.exchangeId} -> ${e.message}`);
            }
        }
        throw new Error(`所有交易所挂单薄都不可用：${errors.join(' | ')}`);
    }

    async close() {
        await Promise.allSettled(this.clients.map((c) => c.close()));
        this.clients = [];
    }
}

let exchangeClientCache = new Map();

function cacheKeyOf({ assetClass, exchangeId, marketType, fallbackExchangeIds }) {
    const fallbacks = Array.isArray(fallbackExchangeIds) ? fallbackExchangeIds : [];
    return JSON.stringify({
        assetClass: normalizeAssetClass(assetClass),
        exchangeId: normalizeExchangeId(exchangeId),
        marketType: String(marketType || '').trim().toLowerCase(),
        fallbackExchangeIds: fallbacks.map((x) => String(x).trim().toLowerCase()).filter(Boolean),
    });
}

function buildClientList({ exchangeId, assetClass, marketType, fallbackExchangeIds, logger }) {
    const primary = normalizeExchangeId(exchangeId);
    const fallbacks = Array.isArray(fallbackExchangeIds) ? fallbackExchangeIds : [];
    const ids = [primary, ...fallbacks.map((x) => String(x).trim().toLowerCase()).filter(Boolean)].filter(Boolean);
    const uniqueIds = Array.from(new Set(ids));

    const cfg = marketDataConfig?.ccxt || {};
    return uniqueIds.map(
        (id) =>
            new ExchangeClient({
                exchangeId: id,
                assetClass,
                marketType,
                timeoutMs: cfg.timeoutMs ?? 20000,
                enableRateLimit: cfg.enableRateLimit ?? true,
                sandbox: cfg.sandbox ?? false,
                logger,
            }),
    );
}

/**
 * 获取全局交易所客户端（支持 failover）
 *
 * @param {Object} [options]
 * @param {string} [options.exchangeId]
 * @param {string} [options.assetClass]
 * @param {string} [options.marketType]
 * @param {string[]} [options.fallbackExchangeIds]
 * @param {Object} [options.logger]
 * @returns {ExchangeClient|FailoverExchangeClient}
 */
export function getExchangeClient(options = {}) {
    const cfg = marketDataConfig || {};
    const assetClass = options.assetClass || cfg.assetClass || 'crypto';
    const exchangeId = options.exchangeId || cfg.exchange || 'binance';
    const marketType = options.marketType || cfg.marketType || 'futures';
    const fallbackExchangeIds =
        options.fallbackExchangeIds ||
        safeJoinCsv(cfg.exchangeFallbacks).map((x) => x.trim().toLowerCase());
    const logger = options.logger || null;

    const key = cacheKeyOf({ assetClass, exchangeId, marketType, fallbackExchangeIds });
    if (exchangeClientCache.has(key)) {
        return exchangeClientCache.get(key);
    }

    const clients = buildClientList({ exchangeId, assetClass, marketType, fallbackExchangeIds, logger });
    const client = clients.length <= 1 ? clients[0] : new FailoverExchangeClient({ clients, logger });
    exchangeClientCache.set(key, client);
    return client;
}

export async function closeExchangeClient() {
    const cache = exchangeClientCache;
    exchangeClientCache = new Map();
    await Promise.allSettled(Array.from(cache.values()).map((c) => c.close?.()));
}

export default {
    ExchangeClient,
    getExchangeClient,
    closeExchangeClient,
    TIMEFRAME_TO_INTERVAL,
    splitCompactSymbolToCcxtSymbol,
};

