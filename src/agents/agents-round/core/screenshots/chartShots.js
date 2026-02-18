import { join } from 'path';
import { ChartBuilder, ChartInput } from '../../../../core/chart/index.js';
import { withRetries, withTimeout } from '../runtime/runtime.js';

export async function renderChartPng({ outputDir, symbol, timeframe, bars, waitMs }) {
    const builder = new ChartBuilder();
    const input = new ChartInput({ bars, symbol, timeframe });
    const path = join(outputDir, `${symbol}_${timeframe}.png`);
    await withRetries(
        async ({ attempt }) => {
            const label = `图表渲染(${symbol} ${timeframe})`;
            const timeoutMs = 90000;
            if (attempt > 1) {
                // 第二次一般是 chromium/渲染偶发问题，重试即可
            }
            return withTimeout(builder.buildAndExport(input, path, { waitMs }), timeoutMs, label);
        },
        { retries: 1, baseDelayMs: 1200 },
    );
    return path;
}
