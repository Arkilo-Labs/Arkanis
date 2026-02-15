/**
 * 交易后续模拟 (止盈/止损触发)
 */

import { Direction } from '../lens/schema.js';

/**
 * 退出原因
 */
export const ExitReason = {
    TAKE_PROFIT: 'take_profit',
    STOP_LOSS: 'stop_loss',
    TIMEOUT: 'timeout',
    NO_FUTURE: 'no_future',
    INVALID: 'invalid',
};

/**
 * 交易结果
 */
export class TradeOutcome {
    constructor({
        direction,
        entryTime,
        entryPrice,
        stopLoss,
        takeProfit,
        exitTime,
        exitPrice,
        exitReason,
        barsHeld,
        pnl,
        pnlPct,
        risk,
        reward,
        rr,
    }) {
        this.direction = direction;
        this.entryTime = entryTime;
        this.entryPrice = entryPrice;
        this.stopLoss = stopLoss;
        this.takeProfit = takeProfit;
        this.exitTime = exitTime;
        this.exitPrice = exitPrice;
        this.exitReason = exitReason;
        this.barsHeld = barsHeld;
        this.pnl = pnl;
        this.pnlPct = pnlPct;
        this.risk = risk;
        this.reward = reward;
        this.rr = rr;
    }

    toDict() {
        return {
            direction: this.direction,
            entry_time: this.entryTime?.toISOString(),
            entry_price: this.entryPrice,
            stop_loss: this.stopLoss,
            take_profit: this.takeProfit,
            exit_time: this.exitTime?.toISOString(),
            exit_price: this.exitPrice,
            exit_reason: this.exitReason,
            bars_held: this.barsHeld,
            pnl: this.pnl,
            pnl_pct: this.pnlPct,
            risk: this.risk,
            reward: this.reward,
            rr: this.rr,
        };
    }
}

/**
 * 检查交易设置是否有效
 */
function isValidSetup(direction, entry, sl, tp) {
    if (direction === Direction.LONG) {
        return sl < entry && entry < tp;
    }
    return tp < entry && entry < sl;
}

/**
 * 模拟交易
 * @param {Object} params
 * @param {import('../data/models.js').Bar[]} params.bars K线数据
 * @param {number} params.entryIndex 入场K线索引
 * @param {number} params.entryPrice 入场价格
 * @param {number} params.stopLoss 止损价格
 * @param {number} params.takeProfit 止盈价格
 * @param {string} params.direction 交易方向
 * @param {number} params.maxHoldBars 最大持仓K线数
 * @returns {[TradeOutcome, number]} [结果, 退出索引]
 */
export function simulateTrade({
    bars,
    entryIndex,
    entryPrice,
    stopLoss,
    takeProfit,
    direction,
    maxHoldBars,
}) {
    if (!bars.length || entryIndex < 0 || entryIndex >= bars.length) {
        throw new Error('entryIndex 越界或 bars 为空');
    }

    const entryTime = new Date(bars[entryIndex].ts);

    // 无效设置检查
    if (stopLoss == null || takeProfit == null) {
        const outcome = new TradeOutcome({
            direction,
            entryTime,
            entryPrice,
            stopLoss: stopLoss ?? 0,
            takeProfit: takeProfit ?? 0,
            exitTime: entryTime,
            exitPrice: entryPrice,
            exitReason: ExitReason.INVALID,
            barsHeld: 0,
            pnl: 0,
            pnlPct: 0,
            risk: 0,
            reward: 0,
            rr: null,
        });
        return [outcome, entryIndex];
    }

    if (!isValidSetup(direction, entryPrice, stopLoss, takeProfit)) {
        const outcome = new TradeOutcome({
            direction,
            entryTime,
            entryPrice,
            stopLoss,
            takeProfit,
            exitTime: entryTime,
            exitPrice: entryPrice,
            exitReason: ExitReason.INVALID,
            barsHeld: 0,
            pnl: 0,
            pnlPct: 0,
            risk: Math.abs(entryPrice - stopLoss),
            reward: Math.abs(takeProfit - entryPrice),
            rr: null,
        });
        return [outcome, entryIndex];
    }

    // 计算风报比
    const risk = Math.abs(entryPrice - stopLoss);
    const reward = Math.abs(takeProfit - entryPrice);
    const rr = risk > 0 ? reward / risk : null;

    const lastIndex = Math.min(bars.length - 1, entryIndex + Math.max(0, maxHoldBars));
    let exitIndex = lastIndex;
    let exitPrice = bars[lastIndex].close;
    let exitTime = new Date(bars[lastIndex].ts);
    let exitReason = ExitReason.TIMEOUT;

    // 逐根检查触发
    for (let i = entryIndex; i <= lastIndex; i++) {
        const bar = bars[i];
        const { open: o, high: h, low: l } = bar;

        if (direction === Direction.LONG) {
            if (o <= stopLoss) {
                exitIndex = i;
                exitPrice = o;
                exitTime = new Date(bar.ts);
                exitReason = ExitReason.STOP_LOSS;
                break;
            }
            if (o >= takeProfit) {
                exitIndex = i;
                exitPrice = o;
                exitTime = new Date(bar.ts);
                exitReason = ExitReason.TAKE_PROFIT;
                break;
            }
            const hitStop = l <= stopLoss;
            const hitTp = h >= takeProfit;
            if (hitStop && hitTp) {
                exitIndex = i;
                exitPrice = stopLoss;
                exitTime = new Date(bar.ts);
                exitReason = ExitReason.STOP_LOSS;
                break;
            }
            if (hitStop) {
                exitIndex = i;
                exitPrice = stopLoss;
                exitTime = new Date(bar.ts);
                exitReason = ExitReason.STOP_LOSS;
                break;
            }
            if (hitTp) {
                exitIndex = i;
                exitPrice = takeProfit;
                exitTime = new Date(bar.ts);
                exitReason = ExitReason.TAKE_PROFIT;
                break;
            }
        } else {
            if (o >= stopLoss) {
                exitIndex = i;
                exitPrice = o;
                exitTime = new Date(bar.ts);
                exitReason = ExitReason.STOP_LOSS;
                break;
            }
            if (o <= takeProfit) {
                exitIndex = i;
                exitPrice = o;
                exitTime = new Date(bar.ts);
                exitReason = ExitReason.TAKE_PROFIT;
                break;
            }
            const hitStop = h >= stopLoss;
            const hitTp = l <= takeProfit;
            if (hitStop && hitTp) {
                exitIndex = i;
                exitPrice = stopLoss;
                exitTime = new Date(bar.ts);
                exitReason = ExitReason.STOP_LOSS;
                break;
            }
            if (hitStop) {
                exitIndex = i;
                exitPrice = stopLoss;
                exitTime = new Date(bar.ts);
                exitReason = ExitReason.STOP_LOSS;
                break;
            }
            if (hitTp) {
                exitIndex = i;
                exitPrice = takeProfit;
                exitTime = new Date(bar.ts);
                exitReason = ExitReason.TAKE_PROFIT;
                break;
            }
        }
    }

    const pnl =
        direction === Direction.LONG ? exitPrice - entryPrice : entryPrice - exitPrice;
    const pnlPct = entryPrice ? pnl / entryPrice : 0;
    const barsHeld = Math.max(0, exitIndex - entryIndex);

    const outcome = new TradeOutcome({
        direction,
        entryTime,
        entryPrice,
        stopLoss,
        takeProfit,
        exitTime,
        exitPrice,
        exitReason,
        barsHeld,
        pnl,
        pnlPct,
        risk,
        reward,
        rr,
    });

    return [outcome, exitIndex];
}

export default { ExitReason, TradeOutcome, simulateTrade };
