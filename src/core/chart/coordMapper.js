/**
 * 坐标映射器
 * 提供业务坐标和归一化坐标之间的互转
 */

/**
 * 坐标映射器
 */
export class CoordMapper {
    /**
     * @param {Object} params
     * @param {import('../data/models.js').Bar[]} params.bars K 线数据
     * @param {number} params.width 图表宽度 (像素)
     * @param {number} params.height 图表高度 (像素)
     * @param {number} [params.paddingRatio] 价格轴上下留白比例
     */
    constructor({ bars, width, height, paddingRatio = 0.05 }) {
        if (!bars || !bars.length) {
            throw new Error('bars 数据为空');
        }

        this.bars = bars;
        this.width = width;
        this.height = height;
        this.paddingRatio = paddingRatio;

        // 计算时间范围
        this.startTime = new Date(bars[0].ts);
        this.endTime = new Date(bars[bars.length - 1].ts);
        this._timeRangeSeconds = (this.endTime.getTime() - this.startTime.getTime()) / 1000;

        // 计算价格范围 (带留白)
        const rawMin = Math.min(...bars.map((bar) => bar.low));
        const rawMax = Math.max(...bars.map((bar) => bar.high));
        const priceRange = rawMax - rawMin;
        const padding = priceRange * paddingRatio;

        this.minPrice = rawMin - padding;
        this.maxPrice = rawMax + padding;
        this._priceRange = this.maxPrice - this.minPrice;
    }

    /**
     * 业务坐标 -> 归一化坐标 (0~1)
     * @param {Date} ts 时间戳
     * @param {number} price 价格
     * @returns {[number, number]} [xNorm, yNorm]
     */
    valueToNormalized(ts, price) {
        const timestamp = ts instanceof Date ? ts : new Date(ts);

        // X 轴：时间线性映射
        let xNorm;
        if (this._timeRangeSeconds > 0) {
            xNorm = (timestamp.getTime() - this.startTime.getTime()) / 1000 / this._timeRangeSeconds;
        } else {
            xNorm = 0.5;
        }

        // Y 轴：价格线性映射
        let yNorm;
        if (this._priceRange > 0) {
            yNorm = (price - this.minPrice) / this._priceRange;
        } else {
            yNorm = 0.5;
        }

        return [Math.max(0, Math.min(1, xNorm)), Math.max(0, Math.min(1, yNorm))];
    }

    /**
     * 归一化坐标 -> 业务坐标
     * Lens 使用图像坐标系: yNorm=0 对应顶部(高价), yNorm=1 对应底部(低价)
     * @param {number} xNorm 归一化 X 坐标 (0~1)
     * @param {number} yNorm 归一化 Y 坐标 (0~1)
     * @returns {[Date, number]} [timestamp, price]
     */
    normalizedToValue(xNorm, yNorm) {
        // X 轴：反向映射到时间
        const seconds = xNorm * this._timeRangeSeconds;
        const ts = new Date(this.startTime.getTime() + seconds * 1000);

        // Y 轴：反向映射到价格 (反转 yNorm, 因为 Lens 用图像坐标系)
        // yNorm=0 -> maxPrice, yNorm=1 -> minPrice
        const price = this.maxPrice - yNorm * this._priceRange;

        return [ts, price];
    }

    /**
     * K 线索引 -> 时间戳
     * @param {number} barIndex K 线索引 (0-based)
     * @returns {Date | null}
     */
    barIndexToTime(barIndex) {
        if (barIndex >= 0 && barIndex < this.bars.length) {
            return new Date(this.bars[barIndex].ts);
        }
        return null;
    }

    /**
     * 时间戳 -> K 线索引
     * @param {Date} ts 时间戳
     * @returns {number}
     */
    timeToBarIndex(ts) {
        if (!this.bars.length) return 0;

        const timestamp = ts instanceof Date ? ts : new Date(ts);
        const target = timestamp.getTime();

        // 二分查找
        let left = 0;
        let right = this.bars.length - 1;

        while (left < right) {
            const mid = Math.floor((left + right) / 2);
            const midTs = new Date(this.bars[mid].ts).getTime();

            if (midTs < target) {
                left = mid + 1;
            } else {
                right = mid;
            }
        }

        // 检查左右哪个更接近
        if (left > 0) {
            const leftDiff = Math.abs(new Date(this.bars[left].ts).getTime() - target);
            const rightDiff = Math.abs(new Date(this.bars[left - 1].ts).getTime() - target);
            if (rightDiff < leftDiff) {
                return left - 1;
            }
        }

        return left;
    }

    /**
     * 获取指定时间的收盘价
     * @param {Date} ts 时间戳
     * @returns {number | null}
     */
    getPriceAt(ts) {
        const idx = this.timeToBarIndex(ts);
        if (idx >= 0 && idx < this.bars.length) {
            return this.bars[idx].close;
        }
        return null;
    }
}

export default CoordMapper;
