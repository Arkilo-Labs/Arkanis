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

/**
 * 从主周期聚合成更大周期（例如 base=5m, factor=4 => 20m）。
 * - 以目标周期自然时间桶对齐（bucket = floor(ts/tfMs) * tfMs）
 * - 默认只保留“完整桶”（每桶必须包含 factor 根连续主周期 K 线）
 */
export function aggregateBarsToHigherTimeframe(bars, baseMinutes, factor, { requireFullBucket = true } = {}) {
    if (!Array.isArray(bars)) throw new Error('bars 必须是数组');
    if (!Number.isInteger(baseMinutes) || baseMinutes <= 0) throw new Error(`baseMinutes 非法: ${baseMinutes}`);
    if (!Number.isInteger(factor) || factor < 2) throw new Error(`factor 非法: ${factor}`);

    const baseMs = baseMinutes * 60 * 1000;
    const targetMinutes = baseMinutes * factor;
    const tfMs = targetMinutes * 60 * 1000;

    if (!bars.length) return [];

    const groups = new Map();
    for (const bar of bars) {
        const ts = bar.ts instanceof Date ? bar.ts : new Date(bar.ts);
        const tsMs = ts.getTime();
        const bucket = Math.floor(tsMs / tfMs) * tfMs;
        if (!groups.has(bucket)) groups.set(bucket, []);
        groups.get(bucket).push(bar);
    }

    const sortedBuckets = Array.from(groups.keys()).sort((a, b) => a - b);
    const out = [];

    for (const bucketTs of sortedBuckets) {
        const chunk = groups.get(bucketTs);
        if (!chunk?.length) continue;

        if (requireFullBucket) {
            if (chunk.length !== factor) continue;
            let ok = true;
            for (let i = 1; i < chunk.length; i++) {
                const prevTs = (chunk[i - 1].ts instanceof Date ? chunk[i - 1].ts : new Date(chunk[i - 1].ts)).getTime();
                const curTs = (chunk[i].ts instanceof Date ? chunk[i].ts : new Date(chunk[i].ts)).getTime();
                if (curTs - prevTs !== baseMs) {
                    ok = false;
                    break;
                }
            }
            if (!ok) continue;
        }

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
                ts: new Date(bucketTs),
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
