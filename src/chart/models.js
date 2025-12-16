/**
 * 图表数据模型
 */

/**
 * 锚点模式
 */
export const AnchorMode = {
    VALUE: 'value', // 基于业务坐标 (bar_index/timestamp, price)
    NORMALIZED: 'normalized', // 基于归一化坐标 (0~1)
};

/**
 * 标注类型
 */
export const OverlayType = {
    HORIZONTAL_LINE: 'horizontal_line',
    TREND_LINE: 'trend_line',
    PARALLEL_CHANNEL: 'parallel_channel',
    RAY_LINE: 'ray_line',
    MARKER: 'marker',
    LABEL: 'label',
    VERTICAL_SPAN: 'vertical_span',
};

/**
 * 标记形状
 */
export const MarkerShape = {
    ARROW_UP: 'arrow_up',
    ARROW_DOWN: 'arrow_down',
    CIRCLE: 'circle',
    SQUARE: 'square',
};

/**
 * 标记位置
 */
export const MarkerPosition = {
    ABOVE: 'above_bar',
    BELOW: 'below_bar',
    INSIDE: 'inside_bar',
};

/**
 * 基于业务坐标的锚点
 */
export class ValueAnchor {
    /**
     * @param {Object} params
     * @param {number} [params.barIndex] K 线索引
     * @param {Date} [params.timestamp] 时间戳
     * @param {number} params.price 价格
     */
    constructor({ barIndex = null, timestamp = null, price = 0 }) {
        this.barIndex = barIndex;
        this.timestamp = timestamp;
        this.price = price;
    }
}

/**
 * 基于归一化坐标的锚点 (0~1)
 */
export class NormalizedAnchor {
    /**
     * @param {Object} params
     * @param {number} params.x 横轴 0~1
     * @param {number} params.y 纵轴 0~1
     */
    constructor({ x = 0, y = 0 }) {
        this.x = x;
        this.y = y;
    }
}

/**
 * 图表标注对象
 */
export class OverlayObject {
    /**
     * @param {Object} params
     * @param {string} params.type 标注类型
     * @param {string} [params.mode] 锚点模式
     * @param {string} [params.color] 颜色
     * @param {string} [params.text] 文本
     * @param {number} [params.width] 线宽
     * @param {number} [params.price] 水平线价格
     * @param {number} [params.yNorm] 归一化 Y 坐标
     * @param {Object} [params.start] 起点
     * @param {Object} [params.end] 终点
     * @param {number} [params.channelWidth] 通道宽度
     * @param {string} [params.shape] 标记形状
     * @param {string} [params.position] 标记位置
     * @param {Date} [params.startTime] 垂直区间开始时间
     * @param {Date} [params.endTime] 垂直区间结束时间
     * @param {number} [params.startXNorm] 垂直区间开始 X 归一化坐标
     * @param {number} [params.endXNorm] 垂直区间结束 X 归一化坐标
     * @param {number} [params.startBarIndex] 开始 bar 索引
     * @param {number} [params.endBarIndex] 结束 bar 索引
     */
    constructor({
        type,
        mode = AnchorMode.NORMALIZED,
        color = '#ffffff',
        text = null,
        width = 2,
        price = null,
        yNorm = null,
        start = null,
        end = null,
        channelWidth = null,
        shape = MarkerShape.ARROW_UP,
        position = MarkerPosition.BELOW,
        startTime = null,
        endTime = null,
        startXNorm = null,
        endXNorm = null,
        startBarIndex = null,
        endBarIndex = null,
    }) {
        this.type = type;
        this.mode = mode;
        this.color = color;
        this.text = text;
        this.width = width;
        this.price = price;
        this.yNorm = yNorm;
        this.start = start;
        this.end = end;
        this.channelWidth = channelWidth;
        this.shape = shape;
        this.position = position;
        this.startTime = startTime;
        this.endTime = endTime;
        this.startXNorm = startXNorm;
        this.endXNorm = endXNorm;
        this.startBarIndex = startBarIndex;
        this.endBarIndex = endBarIndex;
    }

    toDict() {
        return {
            type: this.type,
            mode: this.mode,
            color: this.color,
            text: this.text,
            price: this.price,
        };
    }
}

/**
 * 图表输入数据
 */
export class ChartInput {
    /**
     * @param {Object} params
     * @param {import('../data/models.js').Bar[]} params.bars K 线数据
     * @param {string} params.symbol 交易对
     * @param {string} params.timeframe 时间周期
     * @param {string} [params.title] 图表标题
     * @param {OverlayObject[]} [params.overlays] 标注对象列表
     */
    constructor({ bars, symbol, timeframe, title = null, overlays = [] }) {
        this.bars = bars;
        this.symbol = symbol;
        this.timeframe = timeframe;
        this.title = title;
        this.overlays = overlays;
    }

    get minPrice() {
        if (!this.bars.length) return 0;
        return Math.min(...this.bars.map((bar) => bar.low));
    }

    get maxPrice() {
        if (!this.bars.length) return 0;
        return Math.max(...this.bars.map((bar) => bar.high));
    }

    get startTime() {
        return this.bars.length ? this.bars[0].ts : null;
    }

    get endTime() {
        return this.bars.length ? this.bars[this.bars.length - 1].ts : null;
    }
}

export default {
    AnchorMode,
    OverlayType,
    MarkerShape,
    MarkerPosition,
    ValueAnchor,
    NormalizedAnchor,
    OverlayObject,
    ChartInput,
};
