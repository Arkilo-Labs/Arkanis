#!/usr/bin/env node
/**
 * Telegram Bot (Redis decision -> TG)
 *
 * 订阅 vlm_trade_js 发布的 VLM 决策（protobuf），把入场计划发到 TG 频道。
 */

import TelegramBot from 'node-telegram-bot-api';
import Redis from 'ioredis';
import { config as dotenvConfig } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import logger from '../src/utils/logger.js';
import { decodeVlmDecision } from '../src/bridge/proto.js';
import { loadBridgeConfig } from '../src/bridge/redis_config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenvConfig({ path: join(__dirname, '..', '.env') });

function escapeHtml(text) {
    return String(text)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}

function fmtNum(v, digits = 4) {
    if (v === null || v === undefined) return '-';
    const n = Number(v);
    if (!Number.isFinite(n) || n === 0) return '-';
    return n.toFixed(digits);
}

function fmtPct(v, digits = 1) {
    const n = Number(v);
    if (!Number.isFinite(n)) return '-';
    return `${(n * 100).toFixed(digits)}%`;
}

function extractEntryPriceText(decision) {
    try {
        const raw = JSON.parse(decision.raw_decision_json || '{}');
        const ep = raw.entry_price;
        if (ep === 'market') return '市价';
        if (typeof ep === 'number') return fmtNum(ep, 6);
    } catch {
        // ignore
    }
    if (decision.entry_price && Number(decision.entry_price) !== 0) return fmtNum(decision.entry_price, 6);
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

function buildTradingViewUrl(symbol, timeframe) {
    const tvSymbol = `BINANCE:${String(symbol || '').trim()}`;
    const interval = buildTradingViewInterval(timeframe);
    const url = new URL('https://tradingview.com/chart/');
    url.searchParams.set('symbol', tvSymbol);
    if (interval) url.searchParams.set('interval', interval);
    return url.toString();
}

function buildBinanceUrl(symbol, { market = 'futures' } = {}) {
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

function buildMessageHtml(decision) {
    const enter = Boolean(decision.enter);
    const dir = (decision.direction || '').toUpperCase();
    const symbol = decision.symbol || '-';
    const tf = decision.timeframe || '-';

    const entryText = extractEntryPriceText(decision);
    const slText = decision.stop_loss_price ? fmtNum(decision.stop_loss_price, 6) : '-';
    const tpText = decision.take_profit_price ? fmtNum(decision.take_profit_price, 6) : '-';

    const header = `<b>${escapeHtml(`【VLM 入场计划】${symbol} (${tf})`)}</b>`;

    const infoLines = [];
    infoLines.push(`入场   ${enter ? '是' : '否'}`);
    if (enter) {
        infoLines.push(`方向   ${dir || '-'}`);
        infoLines.push(`仓位   ${fmtPct(decision.position_size)}`);
        infoLines.push(`杠杆   ${decision.leverage || 1}x`);
        infoLines.push(`置信度 ${fmtPct(decision.confidence)}`);
        infoLines.push(`入场价 ${entryText}`);
        infoLines.push(`止损   ${slText}`);
        infoLines.push(`止盈   ${tpText}`);
    }

    const mainInfo = `<pre>${escapeHtml(infoLines.join('\n'))}</pre>`;

    const reason = decision.reason ? `\n\n<b>理由</b>:\n${escapeHtml(decision.reason)}` : '';

    const ts = decision.received_timestamp_ms ? new Date(Number(decision.received_timestamp_ms)) : new Date();
    const tsText = `${ts.toISOString().replace('T', ' ').slice(0, 19)} UTC`;
    const footer = `\n\n<i>${escapeHtml(`${tsText} · 来源: redis_bridge`)}</i>`;

    return `${header}\n${mainInfo}${reason}${footer}`;
}

async function main() {
    const token = (process.env.TG_BOT_TOKEN || '').trim();
    const chatId = (process.env.TG_CHAT_ID || '').trim();
    if (!token) throw new Error('缺少环境变量 TG_BOT_TOKEN');
    if (!chatId) throw new Error('缺少环境变量 TG_CHAT_ID');

    const redisUrl = (process.env.REDIS_URL || 'redis://localhost:6379/0').trim();

    const redisSub = new Redis(redisUrl, { lazyConnect: false, enableReadyCheck: true, maxRetriesPerRequest: null, });
    const redisPub = new Redis(redisUrl, { lazyConnect: false, enableReadyCheck: true, maxRetriesPerRequest: null, });

    const bot = new TelegramBot(token, { polling: false });

    const cfg = await loadBridgeConfig(redisPub);
    const decisionChannel = (process.env.REDIS_DECISION_CHANNEL || cfg.channels.decision).trim();

    logger.info(`Redis URL: ${redisUrl}`);
    logger.info(`订阅 Decision Channel: ${decisionChannel}`);
    logger.info(`TG Chat: ${chatId}`);

    await redisSub.subscribe(decisionChannel);

    redisSub.on('messageBuffer', async (_channelBuf, messageBuf) => {
        try {
            const latestCfg = await loadBridgeConfig(redisPub);
            const decision = await decodeVlmDecision(messageBuf);
            await redisPub.set('vlmbridge:last_decision_json', JSON.stringify(decision));

            if (!decision.enter && !latestCfg.telegram.sendNonEnter) return;

            const binanceMarket = (process.env.BINANCE_MARKET || '').trim().toLowerCase();
            const market = binanceMarket === 'spot' ? 'spot' : 'futures';

            const tvUrl = buildTradingViewUrl(decision.symbol, decision.timeframe);
            const binanceUrl = buildBinanceUrl(decision.symbol, { market });

            const reply_markup = {
                inline_keyboard: [[
                    { text: '查看TradingView图表', url: tvUrl },
                    { text: '打开币安行情', url: binanceUrl },
                ]],
            };

            const text = buildMessageHtml(decision);
            await bot.sendMessage(chatId, text, {
                parse_mode: 'HTML',
                reply_markup,
                disable_web_page_preview: true,
            });
        } catch (e) {
            logger.error(`[TG 发送失败] ${e.message}`);
        }
    });

    process.on('SIGINT', async () => {
        logger.info('收到 SIGINT，准备退出...');
        try { await redisSub.quit(); } catch { }
        try { await redisPub.quit(); } catch { }
        process.exit(0);
    });
}

main().catch((e) => {
    logger.error(`[启动失败] ${e.message}`);
    process.exit(1);
});
