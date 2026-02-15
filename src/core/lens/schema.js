/**
 * Lens 决策 JSON Schema
 * 使用 Zod 进行验证
 */

import { z } from 'zod';

/**
 * 交易方向
 */
export const Direction = {
    LONG: 'long',
    SHORT: 'short',
};

/**
 * 画图指令类型
 */
export const DrawInstructionType = {
    HORIZONTAL_LINE: 'horizontal_line',
    TREND_LINE: 'trend_line',
    PARALLEL_CHANNEL: 'parallel_channel',
    RAY_LINE: 'ray_line',
    POLYLINE: 'polyline',
    MARKER: 'marker',
    LABEL: 'label',
    VERTICAL_SPAN: 'vertical_span',
};

/**
 * 锚点坐标 Schema
 */
export const AnchorPointSchema = z.object({
    bar_index: z.number().int().optional().nullable(),
    timestamp: z.string().datetime().optional().nullable(),
    price: z.number().optional().nullable(),
    // Lens 坐标策略：0~1000 归一化（左上角(0,0) → 右下角(1000,1000)）
    // 使用 coerce 自动修正超出范围的值
    x_norm: z.coerce.number().transform(val => Math.max(0, Math.min(1000, val))).optional().nullable(),
    y_norm: z.coerce.number().transform(val => Math.max(0, Math.min(1000, val))).optional().nullable(),
});

/**
 * 画图指令 Schema
 */
export const DrawInstructionSchema = z.object({
    type: z.enum([
        'horizontal_line',
        'trend_line',
        'parallel_channel',
        'ray_line',
        'polyline',
        'marker',
        'label',
        'vertical_span',
    ]),
    mode: z.enum(['value', 'normalized']).default('normalized'),

    // 起止锚点
    from: AnchorPointSchema.optional().nullable(),
    to: AnchorPointSchema.optional().nullable(),

    // 多点折线专用
    points: z.array(AnchorPointSchema).optional().nullable(),

    // 水平线专用
    price: z.number().optional().nullable(),
    y_norm: z.coerce.number().transform(val => Math.max(0, Math.min(1000, val))).optional().nullable(),

    // 平行通道专用
    channel_width: z.number().optional().nullable(),

    // 标记/标签位置
    position: AnchorPointSchema.optional().nullable(),
    shape: z.string().optional().nullable(),
    marker_position: z.string().optional().nullable(),

    // 垂直区间专用
    start_x_norm: z.coerce.number().transform(val => Math.max(0, Math.min(1000, val))).optional().nullable(),
    end_x_norm: z.coerce.number().transform(val => Math.max(0, Math.min(1000, val))).optional().nullable(),
    start_bar_index: z.number().int().optional().nullable(),
    end_bar_index: z.number().int().optional().nullable(),

    // 通用样式
    color: z.string().default('#ffffff'),
    text: z.string().optional().nullable(),
    width: z.number().int().default(2),
});

/**
 * 指标倾向（尽量结构化，但允许一定自由度）
 */
const IndicatorBiasSchema = z.preprocess((val) => {
    if (val === null || val === undefined) return 'neutral';
    const raw = String(val).trim().toLowerCase();
    if (!raw) return 'neutral';

    if (['bullish', 'long', 'buy', '看多', '多', '偏多', '多头'].includes(raw)) return 'bullish';
    if (['bearish', 'short', 'sell', '看空', '空', '偏空', '空头'].includes(raw)) return 'bearish';
    if (['neutral', 'none', 'wait', 'hold', '中性', '观望'].includes(raw)) return 'neutral';
    return raw;
}, z.string());

const TrendStrengthLevelSchema = z.preprocess((val) => {
    if (val === null || val === undefined) return 'average';
    const raw = String(val).trim().toLowerCase();
    if (!raw) return 'average';

    if (['below_average', 'below', 'weak', 'low', '低于平均', '偏弱', '弱'].includes(raw)) return 'below_average';
    if (['above_average', 'above', 'strong', 'high', '高于平均', '偏强', '强'].includes(raw)) return 'above_average';
    if (['average', 'mid', 'normal', '中等', '平均', '一般'].includes(raw)) return 'average';
    return raw;
}, z.string());

export const IndicatorViewsSchema = z
    .object({
        bollinger: z
            .object({
                bias: IndicatorBiasSchema.default('neutral'),
                note: z.string().optional().nullable().default(''),
            })
            .default({ bias: 'neutral', note: '' }),
        macd: z
            .object({
                bias: IndicatorBiasSchema.default('neutral'),
                note: z.string().optional().nullable().default(''),
            })
            .default({ bias: 'neutral', note: '' }),
        trend_strength: z
            .object({
                level: TrendStrengthLevelSchema.default('average'),
                bias: IndicatorBiasSchema.optional().nullable().default('neutral'),
                note: z.string().optional().nullable().default(''),
            })
            .default({ level: 'average', bias: 'neutral', note: '' }),
    })
    .default({
        bollinger: { bias: 'neutral', note: '' },
        macd: { bias: 'neutral', note: '' },
        trend_strength: { level: 'average', bias: 'neutral', note: '' },
    });

/**
 * Lens 决策 Schema
 */
export const LensDecisionSchema = z.object({
    enter: z.boolean().default(false),
    direction: z
        .preprocess((val) => {
            if (val === null || val === '' || val === 'none' || val === 'null' || val === 'neutral') return null;
            if (typeof val === 'string') {
                const v = val.toLowerCase().trim();
                if (['long', 'buy', '多'].includes(v)) return 'long';
                if (['short', 'sell', '空'].includes(v)) return 'short';
                if (['neutral', 'none', 'wait', 'hold'].includes(v)) return null;
            }
            return val;
        }, z.enum(['long', 'short']).nullable().optional())
        .nullable()
        .optional(),
    position_size: z.number().min(0).max(1).default(0),
    leverage: z
        .preprocess((val) => {
            if (val === null || val === '' || val === 'none' || val === 'null') return null;
            if (typeof val === 'number' && val <= 0) return null;
            return val;
        }, z.number().nullable().optional())
        .nullable()
        .optional()
        .default(1),
    confidence: z.number().min(0).max(1).default(0),
    entry_price: z
        .preprocess((val) => {
            if (val === null || val === '' || val === 'none' || val === 'null') return null;
            if (val === 'market') return 'market';
            if (typeof val === 'number') return val;
            const num = parseFloat(val);
            return isNaN(num) ? null : num;
        }, z.union([z.literal('market'), z.number()]).nullable().optional())
        .nullable()
        .optional(),
    stop_loss_price: z.number().nullable().optional(),
    take_profit_price: z.number().nullable().optional(),
    reason: z.string().default(''),
    indicator_views: IndicatorViewsSchema.optional().default({
        bollinger: { bias: 'neutral', note: '' },
        macd: { bias: 'neutral', note: '' },
        trend_strength: { level: 'average', bias: 'neutral', note: '' },
    }),
    draw_instructions: z.array(DrawInstructionSchema).default([]),
});

/**
 * Lens 决策类
 */
export class LensDecision {
    constructor(data) {
        this.enter = data.enter ?? false;
        this.direction = data.direction ?? null;
        this.positionSize = data.position_size ?? 0;
        this.leverage = data.leverage ?? 1;
        this.confidence = data.confidence ?? 0;
        this.entryPrice = data.entry_price ?? null;
        this.stopLossPrice = data.stop_loss_price ?? null;
        this.takeProfitPrice = data.take_profit_price ?? null;
        this.reason = data.reason ?? '';
        this.indicatorViews = data.indicator_views ?? {
            bollinger: { bias: 'neutral', note: '' },
            macd: { bias: 'neutral', note: '' },
            trend_strength: { level: 'average', bias: 'neutral', note: '' },
        };
        this.drawInstructions = (data.draw_instructions ?? []).map((d) => new DrawInstruction(d));
    }

    toDict() {
        return {
            enter: this.enter,
            direction: this.direction,
            position_size: this.positionSize,
            leverage: this.leverage,
            confidence: this.confidence,
            entry_price: this.entryPrice,
            stop_loss_price: this.stopLossPrice,
            take_profit_price: this.takeProfitPrice,
            reason: this.reason,
            indicator_views: this.indicatorViews,
            draw_instructions: this.drawInstructions.map((d) => d.toDict()),
        };
    }

    /**
     * 从 JSON 字符串解析
     * @param {string} jsonStr JSON 字符串
     * @returns {LensDecision}
     */
    static fromJson(jsonStr) {
        const data = JSON.parse(jsonStr);
        const validated = LensDecisionSchema.parse(data);
        return new LensDecision(validated);
    }
}

/**
 * 画图指令类
 */
export class DrawInstruction {
    constructor(data) {
        this.type = data.type;
        this.mode = data.mode ?? 'normalized';
        this.start = data.from ?? null;
        this.end = data.to ?? null;
        this.points = data.points ?? null;
        this.price = data.price ?? null;
        this.yNorm = data.y_norm ?? null;
        this.channelWidth = data.channel_width ?? null;
        this.position = data.position ?? null;
        this.shape = data.shape ?? null;
        this.markerPosition = data.marker_position ?? null;
        this.startXNorm = data.start_x_norm ?? null;
        this.endXNorm = data.end_x_norm ?? null;
        this.startBarIndex = data.start_bar_index ?? null;
        this.endBarIndex = data.end_bar_index ?? null;
        this.color = data.color ?? '#ffffff';
        this.text = data.text ?? null;
        this.width = data.width ?? 2;
    }

    toDict() {
        return {
            type: this.type,
            mode: this.mode,
            from: this.start,
            to: this.end,
            points: this.points,
            price: this.price,
            y_norm: this.yNorm,
            channel_width: this.channelWidth,
            position: this.position,
            shape: this.shape,
            marker_position: this.markerPosition,
            start_x_norm: this.startXNorm,
            end_x_norm: this.endXNorm,
            start_bar_index: this.startBarIndex,
            end_bar_index: this.endBarIndex,
            color: this.color,
            text: this.text,
            width: this.width,
        };
    }
}

export default {
    Direction,
    DrawInstructionType,
    LensDecision,
    DrawInstruction,
    LensDecisionSchema,
    DrawInstructionSchema,
    AnchorPointSchema,
    IndicatorViewsSchema,
};
