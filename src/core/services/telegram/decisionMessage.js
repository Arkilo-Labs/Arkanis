/**
 * Telegram 决策消息格式化
 */

function escapeHtml(text) {
    return String(text)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}

function fmtNum(value, digits = 4) {
    if (value === null || value === undefined) return '-';
    const n = Number(value);
    if (!Number.isFinite(n) || n === 0) return '-';
    return n.toFixed(digits);
}

function fmtPct(value, digits = 1) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '-';
    return `${(n * 100).toFixed(digits)}%`;
}

function safeJsonParse(text) {
    if (!text) return null;
    try {
        const parsed = JSON.parse(text);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
}

function extractEntryPriceText(decision) {
    const raw = safeJsonParse(decision?.raw_decision_json);
    const ep = raw?.entry_price ?? decision?.entry_price;

    if (ep === 'market') return '市价';
    if (typeof ep === 'number') return fmtNum(ep, 6);
    if (ep && Number(ep) !== 0) return fmtNum(ep, 6);
    return '-';
}

function buildTradingViewInterval(timeframe) {
    const tf = String(timeframe || '').trim().toLowerCase();
    const m = tf.match(/^([0-9]+)([mhdw])$/);
    if (!m) return null;

    const value = Number(m[1]);
    const unit = m[2];
    if (!Number.isFinite(value) || value <= 0) return null;

    if (unit === 'm') return String(value);
    if (unit === 'h') return String(value * 60);
    if (unit === 'd') return 'D';
    if (unit === 'w') return 'W';
    return null;
}

export function buildTradingViewUrl(symbol, timeframe) {
    const tvSymbol = `BINANCE:${String(symbol || '').trim()}`;
    const interval = buildTradingViewInterval(timeframe);
    const url = new URL('https://tradingview.com/chart/');
    url.searchParams.set('symbol', tvSymbol);
    if (interval) url.searchParams.set('interval', interval);
    return url.toString();
}

export function buildBinanceUrl(symbol, { market = 'futures' } = {}) {
    const s = String(symbol || '').trim().toUpperCase();
    const quotes = ['USDT', 'USDC', 'BUSD', 'TUSD', 'FDUSD', 'BTC', 'ETH', 'BNB', 'TRY', 'EUR'];

    if (market === 'spot') {
        let formatted = s;
        for (const q of quotes) {
            if (s.endsWith(q) && s.length > q.length) {
                formatted = `${s.slice(0, -q.length)}_${q}`;
                break;
            }
        }
        return `https://www.binance.com/zh-CN/trade/${formatted}?type=spot`;
    }

    return `https://www.binance.com/zh-CN/futures/${s}?type=perpetual`;
}

function fmtIndicatorViews(decision) {
    const views =
        (decision && typeof decision === 'object' && decision.indicator_views && typeof decision.indicator_views === 'object'
            ? decision.indicator_views
            : null) ??
        safeJsonParse(decision?.raw_decision_json)?.indicator_views;

    if (!views || typeof views !== 'object') return [];

    const boll = views.bollinger?.bias || '-';
    const macd = views.macd?.bias || '-';
    const strengthLevel = views.trend_strength?.level || '-';
    const strengthBias = views.trend_strength?.bias || '-';

    return [
        `BOLL   ${String(boll)}`,
        `MACD   ${String(macd)}`,
        `ADX    ${String(strengthLevel)} / ${String(strengthBias)}`,
    ];
}

export function buildDecisionMessageHtml(decision, { source = 'unknown' } = {}) {
    const enter = Boolean(decision?.enter);
    const dir = (decision?.direction || '').toUpperCase();
    const symbol = decision?.symbol || '-';
    const tf = decision?.timeframe || '-';

    const entryText = extractEntryPriceText(decision);
    const slText = decision?.stop_loss_price ? fmtNum(decision.stop_loss_price, 6) : '-';
    const tpText = decision?.take_profit_price ? fmtNum(decision.take_profit_price, 6) : '-';

    const header = `<b>${escapeHtml(`【Lens 入场计划】${symbol} (${tf})`)}</b>`;

    const infoLines = [];
    infoLines.push(`入场   ${enter ? '是' : '否'}`);
    if (enter) {
        infoLines.push(`方向   ${dir || '-'}`);
        infoLines.push(`仓位   ${fmtPct(decision?.position_size)}`);
        infoLines.push(`杠杆   ${decision?.leverage || 1}x`);
        infoLines.push(`置信度 ${fmtPct(decision?.confidence)}`);
        infoLines.push(`入场价 ${entryText}`);
        infoLines.push(`止损   ${slText}`);
        infoLines.push(`止盈   ${tpText}`);
    }
    infoLines.push(...fmtIndicatorViews(decision));

    const mainInfo = `<pre>${escapeHtml(infoLines.join('\n'))}</pre>`;
    const reason = decision?.reason ? `\n\n<b>理由</b>:\n${escapeHtml(decision.reason)}` : '';

    const ts = decision?.received_timestamp_ms ? new Date(Number(decision.received_timestamp_ms)) : new Date();
    const tsText = `${ts.toISOString().replace('T', ' ').slice(0, 19)} UTC`;
    const footer = `\n\n<i>${escapeHtml(`${tsText} · 来源: ${source}`)}</i>`;

    return `${header}\n${mainInfo}${reason}${footer}`;
}
