#!/usr/bin/env node
/**
 * VLM 交易决策主脚本
 *
 * 从 PostgreSQL 获取 K 线数据，渲染图表，调用 VLM API 分析，生成带标注的决策图表。
 *
 * 用法:
 *   node scripts/main.js --symbol BTCUSDT --timeframe 5m --bars 200
 *   node scripts/main.js --symbol BTCUSDT --timeframe 1h --bars 200 --enable-4x-chart
 */

import { Command } from 'commander';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { config, defaultConfig } from '../src/config/index.js';
import {
    KlinesRepository,
    closePool,
    TIMEFRAME_MINUTES,
    aggregateBarsByFactor,
    formatMinutesAsTimeframe,
} from '../src/data/index.js';
import { ChartBuilder, ChartInput } from '../src/chart/index.js';
import { VLMClient, ENHANCED_USER_PROMPT_TEMPLATE, drawInstructionToOverlay } from '../src/vlm/index.js';
import logger from '../src/utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * 解析时间字符串
 */
function parseTime(value) {
    const formats = [
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/,
        /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
        /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/,
        /^\d{4}-\d{2}-\d{2}$/,
    ];

    // 时间戳
    if (/^\d+$/.test(value)) {
        let ts = parseInt(value, 10);
        if (ts > 1e12) ts = ts / 1000;
        return new Date(ts * 1000);
    }

    // 日期时间
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
        if (TIMEFRAME_MINUTES[auxTimeframe] === TIMEFRAME_MINUTES[baseTimeframe]) {
            throw new Error(`辅助 timeframe 不能与主 timeframe 相同`);
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

function buildAuto4xAux({ baseTimeframe, baseBars }) {
    const baseMinutes = TIMEFRAME_MINUTES[baseTimeframe];
    if (!baseMinutes) throw new Error(`不支持的主 timeframe: ${baseTimeframe}`);

    const targetMinutes = baseMinutes * 4;
    const auxTimeframe = formatMinutesAsTimeframe(targetMinutes, TIMEFRAME_MINUTES);
    const auxBars = aggregateBarsByFactor(baseBars, 4, { align: 'end' });
    return { auxTimeframe, auxBars };
}

async function main() {
    const program = new Command();

    program
        .name('vlm-trade')
        .description('VLM 交易决策主脚本')
        .option('--symbol <symbol>', '交易对', defaultConfig.symbol)
        .option('--timeframe <tf>', '时间周期', defaultConfig.timeframe)
        .option('--bars <n>', 'K线数量', (v) => parseInt(v, 10), defaultConfig.bars)
        .option('--start-time <time>', '开始时间')
        .option('--end-time <time>', '结束时间')
        .option('--future-bars <n>', '未来K线数量', (v) => parseInt(v, 10))
        .option('--output-dir <dir>', '输出目录', './outputs')
        .option('--wait <ms>', '等待渲染时间(ms)', (v) => parseInt(v, 10), 500)
        .option('--skip-vlm', '跳过 VLM 调用')
        .option('--enable-4x-chart', '启用 4 倍辅助周期图')
        .option('--aux-timeframe <tf>', '辅助周期')
        .parse();

    const opts = program.opts();
    const outputDir = opts.outputDir;

    mkdirSync(outputDir, { recursive: true });

    const futureBars = opts.futureBars ?? Math.max(Math.floor(opts.bars / 10), 1);
    const startTime = opts.startTime ? parseTime(opts.startTime) : null;
    const endTime = opts.endTime ? parseTime(opts.endTime) : null;

    logger.info(`[配置] 交易对: ${opts.symbol}`);
    logger.info(`[配置] 时间周期: ${opts.timeframe}`);
    logger.info(`[配置] K线数量: ${opts.bars}`);
    logger.info(`[配置] 4 倍辅助图: ${opts.enable4xChart ? '启用' : '关闭'}`);
    if (startTime) logger.info(`[配置] 开始时间: ${startTime.toISOString()}`);
    if (endTime) logger.info(`[配置] 结束时间: ${endTime.toISOString()}`);
    logger.info(`[配置] 输出目录: ${outputDir}`);

    try {
        const repo = new KlinesRepository();
        const builder = new ChartBuilder();

        // 获取 K 线数据
        logger.info('\n[步骤1] 从数据库获取 K 线数据...');

        let bars;
        if (startTime && endTime) {
            bars = await repo.getBarsByRange({
                symbol: opts.symbol,
                timeframe: opts.timeframe,
                startTime,
                endTime,
            });
        } else if (endTime) {
            bars = await repo.getBars({
                symbol: opts.symbol,
                timeframe: opts.timeframe,
                endTime,
                limit: opts.bars,
            });
        } else {
            bars = await repo.getBars({
                symbol: opts.symbol,
                timeframe: opts.timeframe,
                limit: opts.bars,
            });
        }

        if (!bars.length) {
            logger.error(`[错误] 未找到 ${opts.symbol} 的数据`);
            return 1;
        }

        logger.info(`[成功] 获取到 ${bars.length} 条 K 线`);
        logger.info(`       时间范围: ${bars[0].ts.toISOString()} ~ ${bars[bars.length - 1].ts.toISOString()}`);
        logger.info(`       价格范围: ${Math.min(...bars.map((b) => b.low)).toFixed(2)} ~ ${Math.max(...bars.map((b) => b.high)).toFixed(2)}`);

        // 构建基础图表
        logger.info('\n[步骤2] 渲染基础图表...');
        const chartInput = new ChartInput({
            bars,
            symbol: opts.symbol,
            timeframe: opts.timeframe,
        });

        const basePng = join(outputDir, `${opts.symbol}_${opts.timeframe}_base.png`);
        await builder.buildAndExport(chartInput, basePng, { waitMs: opts.wait });
        logger.info(`[成功] 基础图表已保存: ${basePng}`);

        // 辅助图表
        let auxTimeframe = null;
        let auxPng = null;

        if (opts.enable4xChart) {
            try {
                let auxBars;
                if (opts.auxTimeframe) {
                    auxTimeframe = resolveAuxTimeframe(opts.timeframe, opts.auxTimeframe);
                    logger.info(`[信息] 辅助周期: ${auxTimeframe} (主周期: ${opts.timeframe})`);

                    const tfMinutes = TIMEFRAME_MINUTES[opts.timeframe];
                    const auxMinutes = TIMEFRAME_MINUTES[auxTimeframe];

                    const primaryEnd = new Date(bars[bars.length - 1].ts.getTime() + tfMinutes * 60 * 1000);
                    const auxFetchStart = new Date(bars[0].ts.getTime() - auxMinutes * opts.bars * 60 * 1000);

                    auxBars = await repo.getBarsByRange({
                        symbol: opts.symbol,
                        timeframe: auxTimeframe,
                        startTime: auxFetchStart,
                        endTime: primaryEnd,
                    });
                } else {
                    const auto = buildAuto4xAux({ baseTimeframe: opts.timeframe, baseBars: bars });
                    auxTimeframe = auto.auxTimeframe;
                    auxBars = auto.auxBars;
                    logger.info(`[信息] 辅助周期(自动聚合): ${auxTimeframe} (主周期: ${opts.timeframe})`);
                }

                if (auxBars.length >= 10) {
                    const auxInput = new ChartInput({
                        bars: opts.auxTimeframe ? auxBars.slice(-opts.bars) : auxBars,
                        symbol: opts.symbol,
                        timeframe: auxTimeframe,
                    });
                    auxPng = join(outputDir, `${opts.symbol}_${auxTimeframe}_aux.png`);
                    await builder.buildAndExport(auxInput, auxPng, { waitMs: opts.wait });
                    logger.info(`[成功] 辅助图表已保存: ${auxPng}`);
                } else {
                    logger.warn(`[警告] 辅助图跳过：历史数据不足 (${auxTimeframe})`);
                    auxTimeframe = null;
                }
            } catch (e) {
                logger.warn(`[警告] ${e.message}`);
                auxTimeframe = null;
            }
        }

        // 跳过 VLM
        if (opts.skipVlm) {
            logger.info('\n[跳过] VLM 调用已跳过 (--skip-vlm)');
            return 0;
        }

        // 调用 VLM API
        logger.info('\n[步骤3] 调用 VLM API...');
        const client = new VLMClient();
        logger.info(`       Base URL: ${client.baseUrl}`);
        logger.info(`       Model: ${client.model}`);

        const priceMin = Math.min(...bars.map((b) => b.low));
        const priceMax = Math.max(...bars.map((b) => b.high));
        const currentPrice = bars[bars.length - 1].close;

        const enhancedPrompt = ENHANCED_USER_PROMPT_TEMPLATE
            .replace('{symbol}', opts.symbol)
            .replace('{timeframe}', opts.timeframe)
            .replace('{barsCount}', String(bars.length))
            .replace('{maxBarIndex}', String(bars.length - 1))
            .replace('{priceMin}', priceMin.toFixed(2))
            .replace('{priceMax}', priceMax.toFixed(2))
            .replace('{currentPrice}', currentPrice.toFixed(2));

        logger.info('[信息] 使用增强 Prompt (含图表上下文)');
        logger.info('[信息] 等待响应...\n');

        let decision;
        if (auxPng && auxTimeframe) {
            decision = await client.analyzeChartPair({
                primaryImagePath: basePng,
                auxImagePath: auxPng,
                primaryTimeframe: opts.timeframe,
                auxTimeframe,
                primaryUserPrompt: enhancedPrompt,
            });
        } else {
            decision = await client.analyzeChart(basePng, { userPrompt: enhancedPrompt });
        }

        logger.info('='.repeat(60));
        logger.info('VLM 决策结果:');
        logger.info('='.repeat(60));
        logger.info(`入场: ${decision.enter}`);
        if (decision.enter) {
            logger.info(`方向: ${decision.direction}`);
            logger.info(`仓位: ${(decision.positionSize * 100).toFixed(1)}%`);
            logger.info(`杠杆: ${decision.leverage}x`);
            logger.info(`置信度: ${(decision.confidence * 100).toFixed(1)}%`);
            logger.info(`入场价: ${decision.entryPrice}`);
            logger.info(`止损: ${decision.stopLossPrice}`);
            logger.info(`止盈: ${decision.takeProfitPrice}`);
        }
        logger.info(`理由: ${decision.reason}`);
        logger.info(`画图指令数: ${decision.drawInstructions.length}`);

        // 保存决策 JSON
        const outputJson = join(outputDir, 'vlm_decision.json');
        writeFileSync(outputJson, JSON.stringify(decision.toDict(), null, 2), 'utf-8');
        logger.info(`\n[成功] 决策已保存: ${outputJson}`);

        // 生成带标注的图片
        if (decision.drawInstructions.length) {
            logger.info('\n[步骤4] 生成带 VLM 标注的图片...');

            const overlays = [];
            for (const instr of decision.drawInstructions) {
                try {
                    const overlay = drawInstructionToOverlay(instr, bars);
                    overlays.push(overlay);
                } catch (e) {
                    logger.warn(`       [警告] 跳过无效指令: ${e.message}`);
                }
            }

            const annotatedInput = new ChartInput({
                bars,
                symbol: opts.symbol,
                timeframe: opts.timeframe,
                overlays,
            });

            const decisionPng = join(outputDir, `${opts.symbol}_${opts.timeframe}_with_vlm_decision.png`);
            let imgBuffer = await builder.buildAndExport(annotatedInput, decisionPng, { waitMs: opts.wait });

            // 添加文本标注
            imgBuffer = await builder.addTextAnnotations(imgBuffer);
            writeFileSync(decisionPng, imgBuffer);

            logger.info(`[成功] 带 VLM 标注图片已保存: ${decisionPng}`);
        }

        return 0;
    } catch (e) {
        logger.error(`[错误] ${e.message}`);
        logger.error(e.stack);
        return 1;
    } finally {
        await closePool();
    }
}

main().then((code) => process.exit(code));
