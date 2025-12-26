import { getExchangeClient } from '../../src/data/exchangeClient.js';
import { detectAssetClass } from '../../src/data/marketDataClient.js';

const BINANCE_DEPTH_LIMITS = {
    spot: [5, 10, 20, 50, 100, 500, 1000, 5000],
    futures: [5, 10, 20, 50, 100, 500, 1000],
};

function normalizeBaseUrlForMarket(market) {
    const m = String(market || '').trim().toLowerCase();
    if (m === 'spot') return 'https://api.binance.com';
    return 'https://fapi.binance.com';
}

function depthPathForMarket(market) {
    const m = String(market || '').trim().toLowerCase();
    if (m === 'spot') return '/api/v3/depth';
    return '/fapi/v1/depth';
}

function toNumber(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function normalizeBinanceDepthLimit({ limit, marketType }) {
    const requested = Number(limit);
    const market = String(marketType || '').trim().toLowerCase() === 'spot' ? 'spot' : 'futures';
    const allowed = BINANCE_DEPTH_LIMITS[market];

    if (!Number.isFinite(requested) || requested <= 0) {
        return { limit: 100, adjusted: true, reason: 'invalid' };
    }

    if (allowed.includes(requested)) {
        return { limit: requested, adjusted: false, reason: null };
    }

    // Binance 不接受任意整数：取不超过请求值的最大合法档位，避免放大请求。
    const candidates = allowed.filter((x) => x <= requested);
    const normalized = candidates.length ? candidates[candidates.length - 1] : allowed[0];
    return { limit: normalized, adjusted: true, reason: 'not_supported' };
}

export async function fetchBinanceOrderbook({ symbol, limit = 1000, market = 'futures' }) {
    const { limit: normalizedLimit } = normalizeBinanceDepthLimit({ limit, marketType: market });
    const baseUrl = normalizeBaseUrlForMarket(market);
    const path = depthPathForMarket(market);
    const url = `${baseUrl}${path}?symbol=${encodeURIComponent(symbol)}&limit=${encodeURIComponent(normalizedLimit)}`;

    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Binance depth 请求失败：HTTP ${res.status}${text ? `，响应：${text}` : ''}`);
    }

    const data = await res.json();
    const bids = Array.isArray(data?.bids) ? data.bids : [];
    const asks = Array.isArray(data?.asks) ? data.asks : [];

    return {
        lastUpdateId: data?.lastUpdateId ?? null,
        bids: bids.map(([p, q]) => ({ price: toNumber(p), qty: toNumber(q) })).filter((x) => x.price && x.qty),
        asks: asks.map(([p, q]) => ({ price: toNumber(p), qty: toNumber(q) })).filter((x) => x.price && x.qty),
    };
}

export async function fetchOrderbook({
    exchangeId = 'binance',
    marketType = 'futures',
    symbol,
    limit = 100,
    fallbackToBinanceRest = true,
    logger = null,
    assetClass = null,
}) {
    // 非crypto资产无挂单薄
    const resolvedAssetClass = assetClass || detectAssetClass(symbol);
    if (['stock', 'forex', 'commodity', 'index'].includes(resolvedAssetClass)) {
        logger?.info?.(`跳过挂单薄：${symbol} 属于 ${resolvedAssetClass}，不支持交易所挂单薄`);
        return null;
    }

    const exchange = String(exchangeId || '').trim().toLowerCase();
    const { limit: effectiveLimit, adjusted } =
        exchange === 'binance' ? normalizeBinanceDepthLimit({ limit, marketType }) : { limit, adjusted: false };
    if (adjusted) {
        logger?.info?.(`挂单薄 depth limit 调整：${exchangeId} ${symbol} ${limit} -> ${effectiveLimit}`);
    }

    try {
        const client = getExchangeClient({ exchangeId, marketType, logger });
        const ob = await client.fetchOrderbook({ symbol, limit: effectiveLimit });
        return {
            lastUpdateId: null,
            bids: ob.bids,
            asks: ob.asks,
            meta: { exchangeId: ob.exchangeId, symbol: ob.symbol, tsMs: ob.tsMs },
        };
    } catch (e) {
        const msg = String(e?.message || '');
        logger?.warn?.(`ccxt 挂单薄失败：${exchangeId} ${symbol} -> ${msg}`);
        if (fallbackToBinanceRest && exchange === 'binance') {
            const ob = await fetchBinanceOrderbook({
                symbol,
                limit: Math.min(effectiveLimit, 1000),
                market: marketType,
            });
            return { ...ob, meta: { exchangeId: 'binance', symbol } };
        }
        throw e;
    }
}

export function summarizeOrderbook({ orderbook, referencePrice, bands = [0.001, 0.002, 0.005] }) {
    if (!orderbook || !referencePrice) return null;
    const px = Number(referencePrice);
    if (!Number.isFinite(px) || px <= 0) return null;

    const sumNotionalWithin = (side, band) => {
        const threshold = side === 'bids' ? px * (1 - band) : px * (1 + band);
        const levels = orderbook[side] ?? [];
        let notional = 0;
        for (const lvl of levels) {
            if (side === 'bids' && lvl.price < threshold) break;
            if (side === 'asks' && lvl.price > threshold) break;
            notional += lvl.price * lvl.qty;
        }
        return notional;
    };

    const top = {
        bid: orderbook.bids?.[0] ?? null,
        ask: orderbook.asks?.[0] ?? null,
    };

    const bandSummary = {};
    for (const b of bands) {
        bandSummary[String(b)] = {
            bids_notional: sumNotionalWithin('bids', b),
            asks_notional: sumNotionalWithin('asks', b),
        };
    }

    return { top, bandSummary };
}
