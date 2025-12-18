#!/usr/bin/env node
/**
 * VLM 回测脚本
 *
 * 对指定时间范围内的每根 K 线进行 VLM 分析，记录进场点、出场点、止盈止损等信息。
 *
 * 用法:
 *   node scripts/backtest.js --symbol BTCUSDT --timeframe 5m --start-time "2024-12-01" --end-time "2024-12-13" --workers 4
 */

import { Command } from 'commander';
import { writeFileSync, mkdirSync, existsSync, unlinkSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';

import { config, defaultConfig } from '../src/config/index.js';
import {
    KlinesRepository,
    closePool,
    TIMEFRAME_MINUTES,
    aggregateBarsToHigherTimeframe,
    formatMinutesAsTimeframe,
} from '../src/data/index.js';
import { ChartBuilder, ChartInput } from '../src/chart/index.js';
import { VLMClient } from '../src/vlm/index.js';
import logger from '../src/utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * 解析时间字符串
 */
function parseTime(value) {
    if (/^\d+$/.test(value)) {
        let ts = parseInt(value, 10);
        if (ts > 1e12) ts = ts / 1000;
        return new Date(ts * 1000);
    }

    const formats = [
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/,
        /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
        /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/,
        /^\d{4}-\d{2}-\d{2}$/,
    ];

    for (const regex of formats) {
        if (regex.test(value)) {
            return new Date(value.replace(' ', 'T') + 'Z');
        }
    }

    throw new Error(`无法解析时间: ${value}`);
}

/**
 * 解析辅助周期
 */
function resolveAuxTimeframe(baseTimeframe, auxTimeframe) {
    if (auxTimeframe) {
        if (!TIMEFRAME_MINUTES[auxTimeframe]) {
            throw new Error(`不支持的辅助 timeframe: ${auxTimeframe}`);
        }
        return auxTimeframe;
    }

    const baseMinutes = TIMEFRAME_MINUTES[baseTimeframe];
    const targetMinutes = baseMinutes * 4;

    for (const [tf, minutes] of Object.entries(TIMEFRAME_MINUTES)) {
        if (minutes === targetMinutes) {
            return tf;
        }
    }

    throw new Error(`无法找到 ${targetMinutes} 分钟对应的 timeframe`);
}

function buildAuto4xAuxLabel(baseTimeframe) {
    const baseMinutes = TIMEFRAME_MINUTES[baseTimeframe];
    if (!baseMinutes) throw new Error(`不支持的主 timeframe: ${baseTimeframe}`);
    return formatMinutesAsTimeframe(baseMinutes * 4, TIMEFRAME_MINUTES);
}

/**
 * 带并发限制的 VLM 分析
 */
async function analyzeWithVlm(sem, task, client, chartsDir, maxRetries = 3) {
    await sem.acquire();

    const startTime = Date.now();
    let lastError = null;
    let tmpPrimaryPath = null;
    let tmpAuxPath = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            // 写入临时文件
            tmpPrimaryPath = join(chartsDir || tmpdir(), `vlm_bt_${task.barIndex}_primary_${Date.now()}.png`);
            writeFileSync(tmpPrimaryPath, task.primaryImageBuffer);

            if (task.auxImageBuffer) {
                tmpAuxPath = join(chartsDir || tmpdir(), `vlm_bt_${task.barIndex}_aux_${Date.now()}.png`);
                writeFileSync(tmpAuxPath, task.auxImageBuffer);
            }

            let decision;
            if (task.auxImageBuffer && task.auxTimeframe) {
                decision = await client.analyzeChartPair({
                    primaryImagePath: tmpPrimaryPath,
                    auxImagePath: tmpAuxPath,
                    primaryTimeframe: task.primaryTimeframe,
                    auxTimeframe: task.auxTimeframe,
                });
            } else {
                decision = await client.analyzeChart(tmpPrimaryPath);
            }

            const analysisTimeMs = Date.now() - startTime;

            logger.info(
                `[${task.barIndex}] ${task.timestamp.toISOString()} - enter=${decision.enter}, dir=${decision.direction}, time=${analysisTimeMs}ms`
            );

            return {
                barIndex: task.barIndex,
                timestamp: task.timestamp,
                barData: task.barData,
                decision: decision.toDict(),
                analysisTimeMs,
            };
        } catch (e) {
            lastError = e;
            if (attempt < maxRetries - 1) {
                logger.warn(`[${task.barIndex}] 第 ${attempt + 1} 次尝试失败: ${e.message}, 重试中...`);
                await new Promise((r) => setTimeout(r, 1000));
            }
        } finally {
            // 清理临时文件
            if (tmpPrimaryPath && existsSync(tmpPrimaryPath)) {
                try { unlinkSync(tmpPrimaryPath); } catch { }
            }
            if (tmpAuxPath && existsSync(tmpAuxPath)) {
                try { unlinkSync(tmpAuxPath); } catch { }
            }
            sem.release();
        }
    }

    const analysisTimeMs = Date.now() - startTime;
    logger.error(`[${task.barIndex}] VLM 分析失败 (重试 ${maxRetries} 次): ${lastError?.message}`);

    return {
        barIndex: task.barIndex,
        timestamp: task.timestamp,
        barData: task.barData,
        error: lastError?.message,
        analysisTimeMs,
    };
}

/**
 * 简单的信号量实现
 */
class Semaphore {
    constructor(max) {
        this.max = max;
        this.current = 0;
        this.queue = [];
    }

    async acquire() {
        if (this.current < this.max) {
            this.current++;
            return;
        }
        await new Promise((resolve) => this.queue.push(resolve));
    }

    release() {
        this.current--;
        if (this.queue.length > 0) {
            this.current++;
            const next = this.queue.shift();
            next();
        }
    }
}

async function main() {
    const program = new Command();

    program
        .name('vlm-backtest')
        .description('VLM 回测脚本')
        .requiredOption('--start-time <time>', '回测开始时间')
        .option('--symbol <symbol>', '交易对', defaultConfig.symbol)
        .option('--timeframe <tf>', '时间周期', defaultConfig.timeframe)
        .option('--bars <n>', '每次分析的历史K线数量', (v) => parseInt(v, 10), defaultConfig.bars)
        .option('--end-time <time>', '回测结束时间')
        .option('--workers <n>', 'VLM 并发请求数', (v) => parseInt(v, 10), 4)
        .option('--output-dir <dir>', '输出根目录', './outputs/backtest')
        .option('--wait <ms>', '图表渲染等待时间(ms)', (v) => parseInt(v, 10), 500)
        .option('--save-charts', '保存每根K线的图表截图')
        .option('--enable-4x-chart', '启用 4 倍辅助周期图')
        .option('--aux-timeframe <tf>', '辅助周期')
        .parse();

    const opts = program.opts();

    // 创建输出目录
    const runId = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outputDir = join(opts.outputDir, runId);
    mkdirSync(outputDir, { recursive: true });

    const chartsDir = opts.saveCharts ? join(outputDir, 'charts') : null;
    if (chartsDir) mkdirSync(chartsDir, { recursive: true });

    const runStartedAt = new Date();

    logger.info('='.repeat(60));
    logger.info('VLM 回测启动');
    logger.info('='.repeat(60));
    logger.info(`交易对: ${opts.symbol}`);
    logger.info(`时间周期: ${opts.timeframe}`);
    logger.info(`历史 K 线数量: ${opts.bars}`);
    logger.info(`开始时间: ${opts.startTime}`);
    logger.info(`结束时间: ${opts.endTime || '最新'}`);
    logger.info(`VLM 并发数: ${opts.workers}`);
    logger.info(`4 倍辅助图: ${opts.enable4xChart ? '启用' : '关闭'}`);
    logger.info(`输出目录: ${outputDir}`);
    logger.info('='.repeat(60));

    try {
        const repo = new KlinesRepository();
        const builder = new ChartBuilder();
        const client = new VLMClient();

        const startTime = parseTime(opts.startTime);
        const endTime = opts.endTime ? parseTime(opts.endTime) : new Date();

        let auxTimeframe = null;
        let useAggregatedAux = false;
        if (opts.enable4xChart) {
            try {
                if (opts.auxTimeframe) {
                    auxTimeframe = resolveAuxTimeframe(opts.timeframe, opts.auxTimeframe);
                    logger.info(`辅助周期: ${auxTimeframe} (主周期: ${opts.timeframe})`);
                } else {
                    auxTimeframe = buildAuto4xAuxLabel(opts.timeframe);
                    useAggregatedAux = true;
                    logger.info(`辅助周期(自动聚合): ${auxTimeframe} (主周期: ${opts.timeframe})`);
                }
            } catch (e) {
                logger.warn(`[警告] ${e.message}，将回退为单图回测`);
            }
        }

        // 计算数据范围
        const tfMinutes = TIMEFRAME_MINUTES[opts.timeframe] || 60;
        const lookbackBars = useAggregatedAux ? opts.bars * 4 + 12 : opts.bars;
        const lookbackDelta = lookbackBars * tfMinutes * 60 * 1000;
        const dataStartTime = new Date(startTime.getTime() - lookbackDelta);

        logger.info('[步骤1] 获取 K 线数据...');
        logger.info(`        数据范围: ${dataStartTime.toISOString()} ~ ${endTime.toISOString()}`);

        const allBars = await repo.getBarsByRange({
            symbol: opts.symbol,
            timeframe: opts.timeframe,
            startTime: dataStartTime,
            endTime,
        });

        if (!allBars.length) {
            logger.error('未获取到任何 K 线数据');
            return 1;
        }

        logger.info(`[成功] 获取到 ${allBars.length} 条 K 线`);
        logger.info(`       时间范围: ${allBars[0].ts.toISOString()} ~ ${allBars[allBars.length - 1].ts.toISOString()}`);

        // 辅助周期数据
        let auxBars = null;
        if (auxTimeframe && !useAggregatedAux) {
            const auxMinutes = TIMEFRAME_MINUTES[auxTimeframe];
            const auxDataStart = new Date(dataStartTime.getTime() - auxMinutes * opts.bars * 60 * 1000);

            auxBars = await repo.getBarsByRange({
                symbol: opts.symbol,
                timeframe: auxTimeframe,
                startTime: auxDataStart,
                endTime,
            });

            if (auxBars && auxBars.length >= 10) {
                logger.info(`[成功] 获取到 ${auxBars.length} 条辅助 K 线 (${auxTimeframe})`);
            } else {
                logger.warn(`[警告] 辅助周期 ${auxTimeframe} 数据不足，回退为单图回测`);
                auxTimeframe = null;
                auxBars = null;
            }
        }

        // 找出回测范围内的 K 线索引
        const backtestIndices = [];
        for (let i = 0; i < allBars.length; i++) {
            const barTs = allBars[i].ts;
            if (barTs >= startTime && barTs <= endTime) {
                backtestIndices.push(i);
            }
        }

        if (!backtestIndices.length) {
            logger.error('回测范围内没有 K 线数据');
            return 1;
        }

        logger.info(`[步骤2] 渲染图表并准备 VLM 任务 (${backtestIndices.length} 根 K 线)...`);

        // 准备任务
        const tasks = [];
        let auxPtr = 0;
        const baseTfMinutes = TIMEFRAME_MINUTES[opts.timeframe] || 60;
        const auxTfMinutes = auxTimeframe ? TIMEFRAME_MINUTES[auxTimeframe] : null;

        for (const idx of backtestIndices) {
            const targetBar = allBars[idx];
            const barData = {
                open: targetBar.open,
                high: targetBar.high,
                low: targetBar.low,
                close: targetBar.close,
                volume: targetBar.volume,
            };

            // 历史数据范围
            const histStart = Math.max(0, idx - opts.bars + 1);
            const histBars = allBars.slice(histStart, idx + 1);

            if (histBars.length < 10) {
                logger.warn(`[${idx}] 跳过：历史数据不足`);
                continue;
            }

            // 渲染主图
            const chartInput = new ChartInput({
                bars: histBars,
                symbol: opts.symbol,
                timeframe: opts.timeframe,
            });

            const primaryImgBuffer = await builder.buildAndExport(
                chartInput,
                join(chartsDir || tmpdir(), `temp_${idx}.png`),
                { waitMs: opts.wait }
            );

            // 渲染辅助图
            let auxImgBuffer = null;
            if (useAggregatedAux && auxTimeframe) {
                const baseMinutes = TIMEFRAME_MINUTES[opts.timeframe];
                if (!baseMinutes) {
                    throw new Error(`不支持的主 timeframe: ${opts.timeframe}`);
                }

                const auxBaseStart = Math.max(0, idx - (opts.bars * 4 + 12) + 1);
                const auxBaseBars = allBars.slice(auxBaseStart, idx + 1);
                const aggregated = aggregateBarsToHigherTimeframe(auxBaseBars, baseMinutes, 4, { requireFullBucket: true });
                const auxHistBars = aggregated.slice(-opts.bars);

                if (auxHistBars.length >= 10) {
                    const auxInput = new ChartInput({
                        bars: auxHistBars,
                        symbol: opts.symbol,
                        timeframe: auxTimeframe,
                    });

                    auxImgBuffer = await builder.buildAndExport(
                        auxInput,
                        join(chartsDir || tmpdir(), `temp_aux_${idx}.png`),
                        { waitMs: opts.wait }
                    );
                }
            } else if (auxTimeframe && auxBars) {
                const baseTs = targetBar.ts;
                const baseEnd = new Date(baseTs.getTime() + baseTfMinutes * 60 * 1000);

                // 找到已收盘的辅助周期 K 线
                while (auxPtr < auxBars.length) {
                    const auxBarEnd = new Date(auxBars[auxPtr].ts.getTime() + auxTfMinutes * 60 * 1000);
                    if (auxBarEnd <= baseEnd) {
                        auxPtr++;
                    } else {
                        break;
                    }
                }
                const auxIdx = auxPtr - 1;

                if (auxIdx >= 0) {
                    const auxHistStart = Math.max(0, auxIdx - opts.bars + 1);
                    const auxHistBars = auxBars.slice(auxHistStart, auxIdx + 1);

                    if (auxHistBars.length >= 10) {
                        const auxInput = new ChartInput({
                            bars: auxHistBars,
                            symbol: opts.symbol,
                            timeframe: auxTimeframe,
                        });

                        auxImgBuffer = await builder.buildAndExport(
                            auxInput,
                            join(chartsDir || tmpdir(), `temp_aux_${idx}.png`),
                            { waitMs: opts.wait }
                        );
                    }
                }
            }

            // 保存截图
            if (chartsDir) {
                const chartBase = `bar_${idx}_${targetBar.ts.toISOString().replace(/[:.]/g, '-')}`;
                writeFileSync(join(chartsDir, `${chartBase}_${opts.timeframe}.png`), primaryImgBuffer);
                if (auxImgBuffer && auxTimeframe) {
                    writeFileSync(join(chartsDir, `${chartBase}_${auxTimeframe}.png`), auxImgBuffer);
                }
            }

            tasks.push({
                barIndex: idx,
                timestamp: targetBar.ts,
                barData,
                primaryTimeframe: opts.timeframe,
                primaryImageBuffer: primaryImgBuffer,
                auxTimeframe,
                auxImageBuffer: auxImgBuffer,
            });

            logger.debug(`[${idx}/${backtestIndices[backtestIndices.length - 1]}] 图表已渲染: ${targetBar.ts.toISOString()}`);
        }

        if (!tasks.length) {
            logger.error('没有有效的回测任务');
            return 1;
        }

        logger.info(`[步骤3] 并发发送 VLM 请求 (${tasks.length} 个任务)...`);

        // 并发调用 VLM
        const sem = new Semaphore(opts.workers);
        const results = await Promise.all(tasks.map((task) => analyzeWithVlm(sem, task, client, chartsDir)));

        const runCompletedAt = new Date();
        const totalDuration = (runCompletedAt.getTime() - runStartedAt.getTime()) / 1000;

        // 统计
        const successCount = results.filter((r) => r.decision).length;
        const errorCount = results.filter((r) => r.error).length;
        const enterCount = results.filter((r) => r.decision?.enter).length;

        logger.info('='.repeat(60));
        logger.info('回测完成');
        logger.info('='.repeat(60));
        logger.info(`分析成功: ${successCount}`);
        logger.info(`分析失败: ${errorCount}`);
        logger.info(`入场信号: ${enterCount}`);
        logger.info(`总耗时: ${totalDuration.toFixed(1)}s`);
        if (results.length) {
            logger.info(`平均每根: ${(totalDuration / results.length).toFixed(1)}s`);
        }

        // 输出数据
        const outputData = {
            metadata: {
                symbol: opts.symbol,
                timeframe: opts.timeframe,
                aux_timeframe: auxTimeframe,
                start_time: startTime.toISOString(),
                end_time: endTime.toISOString(),
                bars_per_chart: opts.bars,
                total_bars_analyzed: results.length,
                success_count: successCount,
                error_count: errorCount,
                enter_signal_count: enterCount,
                workers: opts.workers,
                run_started_at: runStartedAt.toISOString(),
                run_completed_at: runCompletedAt.toISOString(),
                total_duration_seconds: totalDuration,
            },
            results: results.map((r) => ({
                bar_index: r.barIndex,
                timestamp: r.timestamp.toISOString(),
                open: r.barData.open,
                high: r.barData.high,
                low: r.barData.low,
                close: r.barData.close,
                volume: r.barData.volume,
                analysis_time_ms: r.analysisTimeMs,
                vlm_decision: r.decision || null,
                error: r.error || null,
            })),
        };

        const outputFile = join(outputDir, 'backtest_results.json');
        writeFileSync(outputFile, JSON.stringify(outputData, null, 2), 'utf-8');
        logger.info(`[保存] 结果已写入: ${outputFile}`);

        return 0;
    } catch (e) {
        logger.error(`回测执行失败: ${e.message}`);
        logger.error(e.stack);
        return 1;
    } finally {
        await closePool();
    }
}

main().then((code) => process.exit(code));
