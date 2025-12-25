import { KlinesRepository, TIMEFRAME_MINUTES } from '../../src/data/index.js';
import { getExchangeClient, TIMEFRAME_TO_INTERVAL } from '../../src/data/exchangeClient.js';
import { withTimeout, withRetries } from './runtime.js';

function calcStartMs({ timeframe, barsCount, endTime }) {
    const minutes = TIMEFRAME_MINUTES[timeframe];
    if (!minutes) throw new Error(`不支持 timeframe: ${timeframe}`);
    const end = endTime ? new Date(endTime) : new Date();
    const padBars = 20;
    return end.getTime() - (barsCount + padBars) * minutes * 60 * 1000;
}

async function loadFromExchange(
    { symbol, timeframe, barsCount, endTime },
    { timeoutMs, logger, exchangeId = null, marketType = null, exchangeFallbacks = [] },
) {
    const interval = TIMEFRAME_TO_INTERVAL[timeframe];
    if (!interval) throw new Error(`不支持 interval: ${timeframe}`);
    const startMs = calcStartMs({ timeframe, barsCount, endTime });
    const endMs = endTime ? new Date(endTime).getTime() : null;
    const client = getExchangeClient({
        exchangeId: exchangeId || undefined,
        marketType: marketType || undefined,
        fallbackExchangeIds: exchangeFallbacks,
        logger,
    });

    const rawBars = await withTimeout(
        client.fetchKlines({ symbol, interval, startMs, endMs, limit: 1000 }),
        timeoutMs,
        `交易所K线(${symbol} ${timeframe})`,
    );
    const bars = rawBars.map((r) => r.toBar());
    if (bars.length > barsCount) return bars.slice(-barsCount);
    if (bars.length < barsCount) logger?.warn(`交易所K线不足：${bars.length}/${barsCount}`);
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

export async function loadBars(
    { symbol, timeframe, barsCount, endTime },
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
                { symbol, timeframe, barsCount, endTime },
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
