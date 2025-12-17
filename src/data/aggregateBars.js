import { Bar } from './models.js';

/**
 * 将分钟数格式化为 timeframe 文本。
 * - 若映射表里存在对应的 key，优先返回该 key（例如 60 -> 1h）
 * - 否则回退为 `${minutes}m`（例如 20 -> 20m）
 */
export function formatMinutesAsTimeframe(minutes, timeframeMinutesMap) {
    const m = Number(minutes);
    if (!Number.isFinite(m) || m <= 0) throw new Error(`minutes 非法: ${minutes}`);

    if (timeframeMinutesMap) {
        for (const [tf, tfMinutes] of Object.entries(timeframeMinutesMap)) {
            if (tfMinutes === m) return tf;
        }
    }
    return `${m}m`;
}

/**
 * 将已按 baseTimeframe 对齐的 K 线按固定倍数聚合（例如 5m * 4 => 20m）。
 * 说明：这是“聚合/降采样”，不会补齐缺口；并且只使用完整分组的已收盘 K 线。
 */
export function aggregateBarsByFactor(bars, factor, { align = 'end' } = {}) {
    if (!Array.isArray(bars)) throw new Error('bars 必须是数组');
    if (!Number.isInteger(factor) || factor < 2) throw new Error(`factor 非法: ${factor}`);
    if (align !== 'end' && align !== 'start') throw new Error(`align 非法: ${align}`);

    const total = Math.floor(bars.length / factor) * factor;
    if (total <= 0) return [];

    const startIndex = align === 'end' ? bars.length - total : 0;
    const slice = bars.slice(startIndex, startIndex + total);

    const out = [];
    for (let i = 0; i < slice.length; i += factor) {
        const chunk = slice.slice(i, i + factor);
        if (chunk.length < factor) break;

        const open = chunk[0].open;
        const close = chunk[chunk.length - 1].close;

        let high = -Infinity;
        let low = Infinity;
        let volume = 0;
        for (const b of chunk) {
            if (b.high > high) high = b.high;
            if (b.low < low) low = b.low;
            volume += b.volume;
        }

        out.push(
            new Bar({
                ts: chunk[0].ts,
                open,
                high,
                low,
                close,
                volume,
            })
        );
    }

    return out;
}
