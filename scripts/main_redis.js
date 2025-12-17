#!/usr/bin/env node
/**
 * Redis -> VLM 决策桥
 *
 * 订阅 sign_git 发布的 protobuf 信号，跑一轮 VLM 判断是否入场，再把结果（protobuf）发布到 decision channel。
 */

import crypto from 'crypto';
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import Redis from 'ioredis';

import { defaultConfig } from '../src/config/index.js';
import { KlinesRepository, closePool, TIMEFRAME_MINUTES, aggregateBarsByFactor, formatMinutesAsTimeframe } from '../src/data/index.js';
import { ChartBuilder, ChartInput } from '../src/chart/index.js';
import { VLMClient, ENHANCED_USER_PROMPT_TEMPLATE } from '../src/vlm/index.js';
import logger from '../src/utils/logger.js';
import { decodeSignalFromSignGit, encodeVlmDecision } from '../src/bridge/proto.js';
import { loadBridgeConfig } from '../src/bridge/redis_config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

class SignalWorkQueue {
    constructor({ mode = 'latest_per_symbol', maxPending = 200 } = {}) {
        this.mode = mode;
        this.maxPending = maxPending;

        this._items = [];
        this._keys = [];
        this._latestByKey = new Map();

        this._waiters = [];
        this._closed = false;

        this.dropped = 0;
        this.enqueued = 0;
        this.dequeued = 0;
    }

    configure({ mode, maxPending } = {}) {
        if (mode) this.mode = mode;
        if (Number.isFinite(Number(maxPending)) && Number(maxPending) > 0) {
            this.maxPending = Number(maxPending);
        }
    }

    close() {
        this._closed = true;
        while (this._waiters.length) {
            const w = this._waiters.shift();
            w(null);
        }
    }

    size() {
        if (this.mode === 'all') return this._items.length;
        return this._latestByKey.size;
    }

    enqueue(signal) {
        if (this._closed) return false;

        if (this.mode === 'all') {
            if (this._items.length >= this.maxPending) {
                this._items.shift();
                this.dropped++;
            }
            this._items.push(signal);
        } else {
            const key = `${signal.symbol || ''}|${signal.timeframe || ''}`;
            if (!this._latestByKey.has(key)) {
                if (this._latestByKey.size >= this.maxPending) {
                    while (this._keys.length) {
                        const oldest = this._keys.shift();
                        if (this._latestByKey.delete(oldest)) {
                            this.dropped++;
                            break;
                        }
                    }
                }
                this._keys.push(key);
            }
            this._latestByKey.set(key, signal);
        }

        this.enqueued++;
        const waiter = this._waiters.shift();
        if (waiter) waiter(true);
        return true;
    }

    async take() {
        if (this._closed) return null;

        const next = this._dequeueNow();
        if (next) return next;

        await new Promise((resolve) => this._waiters.push(resolve));
        if (this._closed) return null;
        return this._dequeueNow();
    }

    _dequeueNow() {
        if (this.mode === 'all') {
            const item = this._items.shift();
            if (!item) return null;
            this.dequeued++;
            return item;
        }

        while (this._keys.length) {
            const key = this._keys.shift();
            const item = this._latestByKey.get(key);
            if (!item) continue;
            this._latestByKey.delete(key);
            this.dequeued++;
            return item;
        }

        return null;
    }
}

function resolveAuxTimeframe(baseTimeframe, auxTimeframe) {
    if (auxTimeframe) {
        if (!TIMEFRAME_MINUTES[auxTimeframe]) {
            throw new Error(`不支持的辅助 timeframe: ${auxTimeframe}`);
        }
        if (TIMEFRAME_MINUTES[auxTimeframe] === TIMEFRAME_MINUTES[baseTimeframe]) {
            throw new Error('辅助 timeframe 不能与主 timeframe 相同');
        }
        return auxTimeframe;
    }

    const baseMinutes = TIMEFRAME_MINUTES[baseTimeframe];
    const targetMinutes = baseMinutes * 4;

    for (const [tf, minutes] of Object.entries(TIMEFRAME_MINUTES)) {
        if (minutes === targetMinutes) return tf;
    }

    throw new Error(`无法找到 ${targetMinutes} 分钟对应的 timeframe`);
}

function buildAuto4xAux({ baseTimeframe, baseBars }) {
    const baseMinutes = TIMEFRAME_MINUTES[baseTimeframe];
    if (!baseMinutes) throw new Error(`不支持的主 timeframe: ${baseTimeframe}`);

    const targetMinutes = baseMinutes * 4;
    const auxTimeframe = formatMinutesAsTimeframe(targetMinutes, TIMEFRAME_MINUTES);
    const auxBars = aggregateBarsByFactor(baseBars, 4, { align: 'end' });

    return { auxTimeframe, auxBars };
}

function buildPrompt({ symbol, timeframe, bars, signal }) {
    const priceMin = Math.min(...bars.map((b) => b.low));
    const priceMax = Math.max(...bars.map((b) => b.high));
    const currentPrice = bars[bars.length - 1].close;

    const base = ENHANCED_USER_PROMPT_TEMPLATE
        .replace('{symbol}', symbol)
        .replace('{timeframe}', timeframe)
        .replace('{barsCount}', String(bars.length))
        .replace('{maxBarIndex}', String(bars.length - 1))
        .replace('{priceMin}', priceMin.toFixed(6))
        .replace('{priceMax}', priceMax.toFixed(6))
        .replace('{currentPrice}', currentPrice.toFixed(6));

    const signalHint = `\n\n# 来自 sign_git 的信号（仅供参考）\n${JSON.stringify(signal, null, 2)}\n\n要求：\n- 最终是否入场以图表结构为准，信号只作为触发器/提醒\n- 若入场，必须给出 entry/SL/TP/leverage/position_size\n`;

    return base + signalHint;
}

async function handleSignal({ signal, cfg, repo, builder, client, redisPub, outputDir }) {
    const symbol = signal.symbol || cfg.vlm.symbol || defaultConfig.symbol;
    const timeframe = (signal.timeframe || cfg.vlm.timeframe || defaultConfig.timeframe).trim();
    const barsCount = Number(cfg.vlm.bars || defaultConfig.bars);
    const waitMs = Number(cfg.vlm.waitMs ?? 500);

    const endTime = signal.timestamp_ms ? new Date(Number(signal.timestamp_ms)) : null;

    const bars = await repo.getBars({
        symbol,
        timeframe,
        endTime: endTime || undefined,
        limit: barsCount,
    });

    if (!bars.length) {
        throw new Error(`未找到 ${symbol} ${timeframe} 的数据`);
    }

    const chartInput = new ChartInput({ bars, symbol, timeframe });
    const basePng = join(outputDir, `${symbol}_${timeframe}_redis_base.png`);
    await builder.buildAndExport(chartInput, basePng, { waitMs });

    let decision;
    const userPrompt = buildPrompt({ symbol, timeframe, bars, signal });

    const enable4x = Boolean(cfg.vlm.enable4xChart);
    if (enable4x) {
        try {
            let auxTimeframe = null;
            let auxBars = null;

            if (cfg.vlm.auxTimeframe) {
                auxTimeframe = resolveAuxTimeframe(timeframe, cfg.vlm.auxTimeframe);
                auxBars = await repo.getBars({
                    symbol,
                    timeframe: auxTimeframe,
                    endTime: endTime || undefined,
                    limit: barsCount,
                });
            } else {
                const auto = buildAuto4xAux({ baseTimeframe: timeframe, baseBars: bars });
                auxTimeframe = auto.auxTimeframe;
                auxBars = auto.auxBars;
            }

            if (auxBars && auxBars.length >= 10) {
                const auxInput = new ChartInput({ bars: auxBars, symbol, timeframe: auxTimeframe });
                const auxPng = join(outputDir, `${symbol}_${auxTimeframe}_redis_aux.png`);
                await builder.buildAndExport(auxInput, auxPng, { waitMs });

                if (cfg.vlm.skipVlm) {
                    decision = null;
                } else {
                    decision = await client.analyzeChartPair({
                        primaryImagePath: basePng,
                        auxImagePath: auxPng,
                        primaryTimeframe: timeframe,
                        auxTimeframe,
                        primaryUserPrompt: userPrompt,
                    });
                }
            } else {
                logger.warn(`[警告] 辅助图跳过：历史数据不足 (${auxTimeframe})`);
            }
        } catch (e) {
            logger.warn(`[警告] 辅助图启用失败：${e.message}`);
        }
    }

    if (!decision) {
        if (cfg.vlm.skipVlm) {
            throw new Error('已开启 skipVlm，但未提供决策注入逻辑（当前不支持假决策）');
        }
        decision = await client.analyzeChart(basePng, { userPrompt });
    }

    const eventId = crypto.randomUUID();
    const payload = {
        event_id: eventId,
        source: 'vlm_trade_js',
        signal_event_id: signal.event_id || '',
        symbol,
        timeframe,
        received_timestamp_ms: Date.now(),
        enter: Boolean(decision.enter),
        direction: decision.direction || '',
        position_size: Number(decision.positionSize || 0),
        leverage: Number(decision.leverage || 1),
        confidence: Number(decision.confidence || 0),
        entry_price: typeof decision.entryPrice === 'number' ? decision.entryPrice : 0,
        stop_loss_price: Number(decision.stopLossPrice || 0),
        take_profit_price: Number(decision.takeProfitPrice || 0),
        reason: decision.reason || '',
        raw_decision_json: JSON.stringify(decision.toDict()),
        signal_json: JSON.stringify(signal),
    };

    const encoded = await encodeVlmDecision(payload);
    await redisPub.publish(cfg.channels.decision, encoded);

    try {
        await redisPub.set('vlmbridge:last_decision_b64', encoded.toString('hex'));
        await redisPub.set('vlmbridge:last_decision_json', JSON.stringify(payload));
    } catch {
        // 忽略
    }

    logger.info(`已发布 VLM 决策: enter=${payload.enter}, ${symbol} ${timeframe}`);
}

async function main() {
    const redisUrl = (process.env.REDIS_URL || 'redis://localhost:6379/0').trim();

    const redisSub = new Redis(redisUrl, { lazyConnect: false, enableReadyCheck: true, maxRetriesPerRequest: null, });
    const redisPub = new Redis(redisUrl, { lazyConnect: false, enableReadyCheck: true, maxRetriesPerRequest: null, });

    const repo = new KlinesRepository();
    const builder = new ChartBuilder();
    const client = new VLMClient();

    const outputDir = join(PROJECT_ROOT, 'outputs', 'redis_bridge');
    mkdirSync(outputDir, { recursive: true });

    const initialCfg = await loadBridgeConfig(redisPub);
    const queue = new SignalWorkQueue({
        mode: initialCfg.queue?.mode || 'latest_per_symbol',
        maxPending: initialCfg.queue?.maxPending ?? 200,
    });

    const desiredConcurrency = Number(process.env.BRIDGE_QUEUE_CONCURRENCY || initialCfg.queue?.concurrency || 1);
    let workerCount = 0;

    async function workerLoop(workerId) {
        while (true) {
            const signal = await queue.take();
            if (!signal) return;

            try {
                const cfg = await loadBridgeConfig(redisPub);
                queue.configure({ mode: cfg.queue?.mode, maxPending: cfg.queue?.maxPending });

                await redisPub.set('vlmbridge:last_signal_json', JSON.stringify(signal));
                await handleSignal({ signal, cfg, repo, builder, client, redisPub, outputDir });
            } catch (e) {
                logger.error(`[处理失败][worker=${workerId}] ${e.message}`);
                logger.error(e.stack);
            }
        }
    }

    for (let i = 0; i < Math.max(1, desiredConcurrency); i++) {
        workerCount++;
        workerLoop(workerCount).catch((e) => logger.error(`[worker 启动失败] ${e.message}`));
    }

    redisSub.on('error', (e) => logger.error(`[Redis] ${e.message}`));
    redisPub.on('error', (e) => logger.error(`[Redis] ${e.message}`));

    const signalChannel = (process.env.REDIS_SIGNAL_CHANNEL || initialCfg.channels.signal).trim();

    logger.info(`Redis URL: ${redisUrl}`);
    logger.info(`订阅 Channel: ${signalChannel}`);
    logger.info(`发布 Decision Channel: ${initialCfg.channels.decision}`);

    await redisSub.subscribe(signalChannel);

    redisSub.on('messageBuffer', (_channelBuf, messageBuf) => {
        void (async () => {
            const cfg = await loadBridgeConfig(redisPub);
            queue.configure({ mode: cfg.queue?.mode, maxPending: cfg.queue?.maxPending });

            const signal = await decodeSignalFromSignGit(messageBuf);
            const ok = queue.enqueue(signal);
            if (!ok) {
                logger.warn('[队列] 已关闭，忽略信号');
                return;
            }
            const sz = queue.size();
            if (queue.dropped > 0 && queue.dropped % 50 === 0) {
                logger.warn(`[队列] 已丢弃 ${queue.dropped} 条（mode=${queue.mode}, maxPending=${queue.maxPending}, size=${sz}）`);
            }
        })().catch((e) => {
            logger.error(`[解码/入队失败] ${e.message}`);
        });
    });

    process.on('SIGINT', async () => {
        logger.info('收到 SIGINT，准备退出...');
        queue.close();
        try { await redisSub.quit(); } catch { }
        try { await redisPub.quit(); } catch { }
        await closePool();
        process.exit(0);
    });
}

main().catch(async (e) => {
    logger.error(`[启动失败] ${e.message}`);
    logger.error(e.stack);
    await closePool();
    process.exit(1);
});
