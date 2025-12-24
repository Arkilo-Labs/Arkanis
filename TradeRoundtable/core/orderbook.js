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

export async function fetchBinanceOrderbook({ symbol, limit = 1000, market = 'futures' }) {
    const baseUrl = normalizeBaseUrlForMarket(market);
    const path = depthPathForMarket(market);
    const url = `${baseUrl}${path}?symbol=${encodeURIComponent(symbol)}&limit=${encodeURIComponent(limit)}`;

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
