import { KlinesRepository, TIMEFRAME_MINUTES } from '../../src/data/index.js';
import { getMarketDataClient, detectAssetClass } from '../../src/data/marketDataClient.js';
import { TIMEFRAME_TO_INTERVAL } from '../../src/data/exchangeClient.js';
import { withTimeout, withRetries } from './runtime.js';

// Yahoo Finance 支持的时间周期
const YAHOO_INTERVALS = ['1m', '2m', '5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M'];

function calcStartMs({ timeframe, barsCount, endTime }) {
    const minutes = TIMEFRAME_MINUTES[timeframe];
    if (!minutes) throw new Error(`不支持 timeframe: ${timeframe}`);
    const end = endTime ? new Date(endTime) : new Date();
    const padBars = 20;
    return end.getTime() - (barsCount + padBars) * minutes * 60 * 1000;
}

async function loadFromExchange(
    { symbol, timeframe, barsCount, endTime, assetClass },
    { timeoutMs, logger, exchangeId = null, marketType = null, exchangeFallbacks = [] },
) {
    // 自动检测资产类型
    const resolvedAssetClass = assetClass || detectAssetClass(symbol);
    const isYahoo = ['stock', 'forex', 'commodity', 'index'].includes(resolvedAssetClass);

    // 验证时间周期
    const interval = isYahoo
        ? (YAHOO_INTERVALS.includes(timeframe) ? timeframe : null)
        : TIMEFRAME_TO_INTERVAL[timeframe];

    if (!interval) {
        throw new Error(`不支持 interval: ${timeframe}（资产类型: ${resolvedAssetClass}）`);
    }

    const startMs = calcStartMs({ timeframe, barsCount, endTime });
    const endMs = endTime ? new Date(endTime).getTime() : null;

    const client = getMarketDataClient({
        symbol,
        assetClass: resolvedAssetClass,
        exchangeId: exchangeId || undefined,
        marketType: marketType || undefined,
        fallbackExchangeIds: exchangeFallbacks,
        logger,
    });

    const dataSourceName = isYahoo ? 'Yahoo Finance' : '交易所';
    logger?.info?.(`加载K线: ${symbol} (${resolvedAssetClass}) -> ${dataSourceName}`);

    const rawBars = await withTimeout(
        client.fetchKlines({ symbol, interval, startMs, endMs, limit: 1000 }),
        timeoutMs,
        `${dataSourceName}K线(${symbol} ${timeframe})`,
    );

    const bars = rawBars.map((r) => r.toBar());
    if (bars.length > barsCount) return bars.slice(-barsCount);
    if (bars.length < barsCount) logger?.warn(`${dataSourceName}K线不足：${bars.length}/${barsCount}`);
    return bars;
}

async function loadFromDb({ symbol, timeframe, barsCount, endTime }, { timeoutMs }) {
    const repo = new KlinesRepository();
    return withTimeout(
        repo.getBars({
            symbol,
            timeframe,
            limit: barsCount,
            endTime: endTime || undefined,
            forceUpdate: true,
        }),
        timeoutMs,
        `数据库K线(${symbol} ${timeframe})`,
    );
}

/**
 * 加载 K 线数据
 *
 * @param {Object} params
 * @param {string} params.symbol 交易对/标的
 * @param {string} params.timeframe 时间周期
 * @param {number} params.barsCount K 线数量
 * @param {Date|string} [params.endTime] 结束时间
 * @param {string} [params.assetClass] 资产类型：crypto|stock|forex|commodity
 * @param {Object} options
 */
export async function loadBars(
    { symbol, timeframe, barsCount, endTime, assetClass },
    {
        logger,
        dbTimeoutMs = 6000,
        exchangeTimeoutMs = 25000,
        prefer = 'auto',
        exchangeId = null,
        marketType = null,
        exchangeFallbacks = [],
    } = {},
) {
    // 自动检测资产类型
    const resolvedAssetClass = assetClass || detectAssetClass(symbol);
    const isYahoo = ['stock', 'forex', 'commodity', 'index'].includes(resolvedAssetClass);

    // Yahoo 数据源不走 DB
    if (isYahoo) {
        return withRetries(
            async ({ attempt }) => {
                if (attempt > 1) logger?.warn(`Yahoo 读取重试：${symbol} ${timeframe} 第 ${attempt} 次`);
                return loadFromExchange(
                    { symbol, timeframe, barsCount, endTime, assetClass: resolvedAssetClass },
                    { timeoutMs: exchangeTimeoutMs, logger },
                );
            },
            {
                retries: 2,
                baseDelayMs: 1200,
                onRetry: ({ delay, error }) => logger?.warn(`Yahoo 读取失败：${error.message}，${delay}ms 后重试`),
            },
        );
    }

    // Crypto: 尝试 DB -> 交易所
    const preferMode = String(prefer || 'auto').toLowerCase();
    const tryDb = preferMode === 'auto' || preferMode === 'db';
    const tryEx = preferMode === 'auto' || preferMode === 'exchange';

    if (tryDb) {
        try {
            const bars = await withRetries(
                async ({ attempt }) => {
                    if (attempt > 1) logger?.warn(`数据库读取重试：${symbol} ${timeframe} 第 ${attempt} 次`);
                    return loadFromDb({ symbol, timeframe, barsCount, endTime }, { timeoutMs: dbTimeoutMs });
                },
                {
                    retries: 1,
                    baseDelayMs: 900,
                    onRetry: ({ delay, error }) => logger?.warn(`数据库读取失败：${error.message}，${delay}ms 后重试`),
                },
            );
            return bars;
        } catch (e) {
            logger?.warn(`数据库不可用，降级到交易所：${e.message}`);
        }
    }

    if (!tryEx) {
        throw new Error('数据源被配置为仅 DB，但 DB 不可用');
    }

    return withRetries(
        async ({ attempt }) => {
            if (attempt > 1) logger?.warn(`交易所读取重试：${symbol} ${timeframe} 第 ${attempt} 次`);
            return loadFromExchange(
                { symbol, timeframe, barsCount, endTime, assetClass: resolvedAssetClass },
                {
                    timeoutMs: exchangeTimeoutMs,
                    logger,
                    exchangeId,
                    marketType,
                    exchangeFallbacks,
                },
            );
        },
        {
            retries: 2,
            baseDelayMs: 1200,
            onRetry: ({ delay, error }) => logger?.warn(`交易所读取失败：${error.message}，${delay}ms 后重试`),
        },
    );
}
