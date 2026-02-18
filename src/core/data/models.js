/**
 * K 线数据模型
 */

/**
 * K 线数据类
 */
export class Bar {
    /**
     * @param {Object} params
     * @param {Date} params.ts K线开始时间
     * @param {number} params.open 开盘价
     * @param {number} params.high 最高价
     * @param {number} params.low 最低价
     * @param {number} params.close 收盘价
     * @param {number} params.volume 成交量
     */
    constructor({ ts, open, high, low, close, volume }) {
        this.ts = ts;
        this.open = open;
        this.high = high;
        this.low = low;
        this.close = close;
        this.volume = volume;
    }

    /**
     * 转换为 lightweight-charts 需要的格式
     * @returns {Object}
     */
    toDict() {
        // 确保时间是 UTC
        const timestamp = this.ts instanceof Date ? this.ts : new Date(this.ts);
        return {
            time: Math.floor(timestamp.getTime() / 1000),
            open: this.open,
            high: this.high,
            low: this.low,
            close: this.close,
            volume: this.volume,
        };
    }

    /**
     * 转换为包含 Date 对象的格式
     */
    toChartData() {
        return {
            time: this.ts,
            open: this.open,
            high: this.high,
            low: this.low,
            close: this.close,
            volume: this.volume,
        };
    }
}

/**
 * 原始 K 线数据 (用于重采样)
 */
export class RawBar {
    /**
     * @param {Object} params
     * @param {number} params.tsMs 毫秒时间戳
     * @param {number} params.open 开盘价
     * @param {number} params.high 最高价
     * @param {number} params.low 最低价
     * @param {number} params.close 收盘价
     * @param {number} params.volume 成交量
     */
    constructor({ tsMs, open, high, low, close, volume }) {
        this.tsMs = tsMs;
        this.open = open;
        this.high = high;
        this.low = low;
        this.close = close;
        this.volume = volume;
    }

    /**
     * 转换为标准 Bar
     * @returns {Bar}
     */
    toBar() {
        return new Bar({
            ts: new Date(this.tsMs),
            open: this.open,
            high: this.high,
            low: this.low,
            close: this.close,
            volume: this.volume,
        });
    }
}

export default { Bar, RawBar };
