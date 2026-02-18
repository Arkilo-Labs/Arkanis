/**
 * K 线数据仓储（内存实现）
 * 按 symbol+timeframe 分别缓存，直接以请求周期粒度从交易所拉取，无重采样
 */

import { marketDataConfig } from '../config/index.js';
import { Bar } from './models.js';
import { getExchangeClient, TIMEFRAME_TO_INTERVAL } from './exchangeClient.js';
import logger from '../utils/logger.js';

export const TIMEFRAME_MINUTES = {
    '1m': 1,
    '3m': 3,
    '5m': 5,
    '15m': 15,
    '30m': 30,
    '1h': 60,
    '2h': 120,
    '4h': 240,
    '6h': 360,
    '8h': 480,
    '12h': 720,
    '1d': 1440,
};

// 每个 symbol+timeframe 最多缓存的 K 线条数
const MAX_WINDOW = 2000;

/**
 * K 线内存仓储
 */
export class KlinesRepository {
    /**
     * @param {Object} options
     * @param {boolean} [options.autoFill]
     * @param {string} [options.assetClass]
     * @param {string} [options.exchangeId]
     * @param {string} [options.marketType]
     * @param {string} [options.venue]
     * @param {string|string[]} [options.exchangeFallbacks]
     */
    constructor({
        autoFill = true,
        assetClass = null,
        exchangeId = null,
        marketType = null,
        venue = null,
        exchangeFallbacks = null,
    } = {}) {
        this.cfg = marketDataConfig;
        this.autoFill = autoFill;
        this.assetClass = String(assetClass ?? this.cfg.assetClass ?? 'crypto').trim().toLowerCase();
        this.exchange = String(exchangeId ?? this.cfg.exchange ?? 'binance').trim().toLowerCase();
        this.marketType = String(marketType ?? this.cfg.marketType ?? 'futures').trim().toLowerCase();
        this.venue = String(venue ?? this.cfg.venue ?? '').trim();
        this.exchangeFallbacks = Array.isArray(exchangeFallbacks)
            ? exchangeFallbacks.map((s) => String(s).trim()).filter(Boolean)
            : String(exchangeFallbacks ?? this.cfg.exchangeFallbacks ?? '')
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean);

        // Map<"exchange:market:SYMBOL:timeframe", Bar[]>
        this._cache = new Map();
        // 避免同一 key 并发重复拉取
        this._pending = new Map();
    }

    _cacheKey(symbol, timeframe) {
        return `${this.exchange}:${this.marketType}:${String(symbol).trim().toUpperCase()}:${timeframe}`;
    }

    /**
     * 获取 K 线数据
     * @param {Object} params
     * @param {string} params.symbol
     * @param {string} params.timeframe
     * @param {Date} [params.endTime]
     * @param {number} [params.limit]
     * @param {boolean} [params.forceUpdate]
     * @returns {Promise<Bar[]>}
     */
    async getBars({ symbol, timeframe, endTime = null, limit = 200, forceUpdate = false }) {
        if (!TIMEFRAME_MINUTES[timeframe]) {
            throw new Error(`不支持的 timeframe: ${timeframe}，可选: ${Object.keys(TIMEFRAME_MINUTES).join(', ')}`);
        }

        const tfMinutes = TIMEFRAME_MINUTES[timeframe];
        const actualEndTime = endTime ? new Date(endTime) : new Date();
        const requiredStart = new Date(actualEndTime.getTime() - limit * tfMinutes * 60 * 1000);
        const key = this._cacheKey(symbol, timeframe);

        if (forceUpdate && !endTime && this.autoFill) {
            await this._ensureFilled(symbol, timeframe, requiredStart, actualEndTime);
        }

        let cached = this._getCached(key, requiredStart, actualEndTime);

        if (cached.length < limit && this.autoFill) {
            logger.info(`${symbol} ${timeframe} 数据不足: ${cached.length}/${limit}，尝试从交易所补全`);
            await this._ensureFilled(symbol, timeframe, requiredStart, actualEndTime);
            cached = this._getCached(key, requiredStart, actualEndTime);
        }

        return cached.length > limit ? cached.slice(-limit) : cached;
    }

    /**
     * 按时间范围获取 K 线数据
     * @param {Object} params
     * @param {string} params.symbol
     * @param {string} params.timeframe
     * @param {Date} params.startTime
     * @param {Date} params.endTime
     * @returns {Promise<Bar[]>}
     */
    async getBarsByRange({ symbol, timeframe, startTime, endTime }) {
        if (!TIMEFRAME_MINUTES[timeframe]) {
            throw new Error(`不支持的 timeframe: ${timeframe}`);
        }

        const key = this._cacheKey(symbol, timeframe);
        let cached = this._getCached(key, startTime, endTime);

        if (!cached.length && this.autoFill) {
            logger.info(`${symbol} ${timeframe} 时间范围内无数据，尝试从交易所补全`);
            await this._ensureFilled(symbol, timeframe, startTime, endTime);
            cached = this._getCached(key, startTime, endTime);
        }

        return cached;
    }

    /**
     * 返回当前缓存中的 symbol 列表
     * @returns {string[]}
     */
    getAvailableSymbols() {
        const prefix = `${this.exchange}:${this.marketType}:`;
        const symbols = new Set();
        for (const key of this._cache.keys()) {
            if (key.startsWith(prefix)) {
                const rest = key.slice(prefix.length);
                // 格式：SYMBOL:timeframe，取最后一个冒号之前的部分
                const lastColon = rest.lastIndexOf(':');
                symbols.add(lastColon > 0 ? rest.slice(0, lastColon) : rest);
            }
        }
        return Array.from(symbols);
    }

    /**
     * 从缓存中按时间范围过滤
     * @private
     */
    _getCached(key, startTime, endTime) {
        const bars = this._cache.get(key) ?? [];
        const startMs = startTime instanceof Date ? startTime.getTime() : Number(startTime);
        const endMs = endTime instanceof Date ? endTime.getTime() : Number(endTime);
        return bars.filter((b) => {
            const ts = b.ts instanceof Date ? b.ts.getTime() : Number(b.ts);
            return ts >= startMs && ts <= endMs;
        });
    }

    /**
     * 确保数据存在，没有则从交易所拉取
     * @private
     */
    async _ensureFilled(symbol, timeframe, startTime, endTime) {
        const key = this._cacheKey(symbol, timeframe);
        if (this._pending.has(key)) {
            await this._pending.get(key);
            return;
        }
        const task = this._fetchFromExchange(symbol, timeframe, startTime, endTime);
        this._pending.set(key, task);
        try {
            await task;
        } finally {
            this._pending.delete(key);
        }
    }

    /**
     * 从交易所按原始 timeframe 拉取并写入缓存
     * @private
     */
    async _fetchFromExchange(symbol, timeframe, startTime, endTime) {
        try {
            const client = getExchangeClient({
                assetClass: this.assetClass,
                exchangeId: this.exchange,
                marketType: this.marketType,
                fallbackExchangeIds: this.exchangeFallbacks,
                logger,
            });

            const interval = TIMEFRAME_TO_INTERVAL[timeframe] ?? '1m';

            const { bars, sourceExchangeId } = await client.fetchKlinesWithMeta({
                symbol,
                interval,
                startMs: startTime.getTime(),
                endMs: endTime.getTime(),
            });

            if (bars.length) {
                this._mergeIntoCache(symbol, timeframe, bars);
                logger.info(`从 ${sourceExchangeId || this.exchange} 拉取 ${symbol} ${timeframe} ${bars.length} 条 K 线`);
            }
        } catch (error) {
            logger.error(`从交易所拉取数据失败 (${symbol} ${timeframe}): ${error.message}`);
        }
    }

    /**
     * 将新数据合并到缓存，去重并保持滑动窗口大小
     * @private
     * @param {string} symbol
     * @param {string} timeframe
     * @param {Array} bars - 来自交易所的 RawBar-like 对象（含 tsMs, open, high, low, close, volume）
     */
    _mergeIntoCache(symbol, timeframe, bars) {
        const key = this._cacheKey(symbol, timeframe);
        const existing = this._cache.get(key) ?? [];

        const byTs = new Map(existing.map((b) => [b.ts.getTime(), b]));

        for (const bar of bars) {
            const ts = bar.tsMs ?? (bar.ts instanceof Date ? bar.ts.getTime() : Number(bar.ts));
            if (!Number.isFinite(ts)) continue;
            byTs.set(ts, new Bar({
                ts: new Date(ts),
                open: bar.open,
                high: bar.high,
                low: bar.low,
                close: bar.close,
                volume: bar.volume,
            }));
        }

        const sorted = Array.from(byTs.values()).sort((a, b) => a.ts.getTime() - b.ts.getTime());
        this._cache.set(key, sorted.length > MAX_WINDOW ? sorted.slice(-MAX_WINDOW) : sorted);
    }
}

export default KlinesRepository;
