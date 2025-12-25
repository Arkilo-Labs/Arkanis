#!/usr/bin/env node
import { Command } from 'commander';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { ensureDir, writeText } from './core/fsUtils.js';
import { loadAgentsConfig, loadMcpConfig, loadProvidersConfig } from './core/configLoader.js';
import { PromptStore } from './core/promptStore.js';
import { SessionLogger } from './core/logger.js';
import { McpClient } from './core/mcpClient.js';
import { buildAgents, buildSubagents } from './core/agentFactory.js';
import { Roundtable } from './core/roundtable.js';
import { loadBars } from './core/marketData.js';
import { renderChartPng } from './core/chartShots.js';
import { screenshotPage } from './core/liquidationShot.js';
import { computeMacd, computeRsi } from './core/indicators.js';
import { fetchOrderbook, summarizeOrderbook } from './core/orderbook.js';
import { withRetries, withTimeout } from './core/runtime.js';
import { SearxngClient } from './core/searxngClient.js';
import { FirecrawlClient } from './core/firecrawlClient.js';
import { runNewsPipeline } from './core/newsPipeline.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function newSessionId() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}_${pad(d.getUTCHours())}${pad(
        d.getUTCMinutes(),
    )}${pad(d.getUTCSeconds())}`;
}

async function main() {
    const program = new Command();
    program
        .name('trade-roundtable')
        .option('--symbol <symbol>', '交易对', 'BTCUSDT')
        .option('--exchange <id>', '交易所（ccxt exchangeId）', process.env.MARKET_EXCHANGE || 'binance')
        .option(
            '--market-type <type>',
            '市场类型：spot|future|swap（兼容 futures）',
            process.env.MARKET_MARKET_TYPE || process.env.BINANCE_MARKET || 'futures',
        )
        .option(
            '--exchange-fallbacks <list>',
            '失败切换交易所（逗号分隔 ccxt exchangeId）',
            process.env.MARKET_EXCHANGE_FALLBACKS || '',
        )
        .option(
            '--asset-class <type>',
            '资产类型：crypto|stock|forex|commodity（默认自动检测）',
            '',
        )
        .option('--bars <n>', 'K线数量', (v) => parseInt(v, 10), 250)
        .option('--primary <tf>', '主周期', '15m')
        .option('--aux <tf>', '辅助周期', '1h')
        .option('--config-dir <dir>', '配置目录', join(__dirname, 'config'))
        .option('--prompts-dir <dir>', 'Prompt目录', join(__dirname, 'prompts'))
        .option('--output-dir <dir>', '输出目录', join(__dirname, 'outputs'))
        .option('--page-wait-ms <n>', '外部网页等待(ms)', (v) => parseInt(v, 10), 5000)
        .option('--chart-wait-ms <n>', '图表渲染等待(ms)', (v) => parseInt(v, 10), 600)
        .option('--liquidation-url <url>', '清算地图页面', 'https://www.coinglass.com/zh/liquidation-levels')
        .option('--skip-llm', '跳过模型调用（只产出数据和截图）')
        .option('--skip-news', '跳过新闻收集（SearXNG + Firecrawl）')
        .option('--skip-liquidation', '跳过清算地图截图')
        .option('--skip-mcp', '跳过 MCP 工具调用')
        .option('--mcp-verbose', '打印 MCP 的 stderr 原始输出（默认只打印错误）')
        .option('--mcp-silent', '完全静默 MCP stderr（不打印任何 MCP 输出）')
        .option('--mcp-diagnose', '只做 MCP 诊断（tools/list + 试调用），不跑圆桌')
        .option('--mcp-diagnose-server <name>', 'MCP 诊断的 server 名称（默认取配置第一个）', '')
        .option('--data-source <mode>', 'K线数据源：auto|db|exchange', 'auto')
        .option('--db-timeout-ms <n>', 'DB 超时(ms)', (v) => parseInt(v, 10), 6000)
        .option('--exchange-timeout-ms <n>', '交易所超时(ms)', (v) => parseInt(v, 10), 25000)
        .parse();

    const opts = program.opts();
    const exchangeFallbacks = String(opts.exchangeFallbacks || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    const sessionId = newSessionId();
    const sessionOut = join(opts.outputDir, sessionId);
    const chartsDir = join(sessionOut, 'charts');
    const logPath = join(__dirname, 'logs', `${sessionId}.log`);
    ensureDir(sessionOut);
    ensureDir(chartsDir);

    const logger = new SessionLogger({ logPath });

    const providers = loadProvidersConfig(opts.configDir);
    const agentsConfig = loadAgentsConfig(opts.configDir);
    const mcpConfig = loadMcpConfig(opts.configDir);
    const promptStore = new PromptStore({ promptsDir: opts.promptsDir });

    const mcpStderrMode = opts.mcpSilent ? 'silent' : opts.mcpVerbose ? 'verbose' : 'quiet';
    const mcpClient = new McpClient({ serversConfig: mcpConfig, logger, stderrMode: mcpStderrMode });
    try {
        logger.info(`Session: ${sessionId}`);
        logger.info(`Symbol: ${opts.symbol}`);
        logger.info(`Timeframes: ${opts.primary} + ${opts.aux}`);
        logger.info(
            `Market: exchange=${opts.exchange} marketType=${opts.marketType}${exchangeFallbacks.length ? ` fallbacks=${exchangeFallbacks.join(',')}` : ''}${opts.assetClass ? ` assetClass=${opts.assetClass}` : ''}`,
        );
        if (opts.skipMcp) logger.info('MCP: 已跳过 (--skip-mcp)');

        if (opts.mcpDiagnose) {
            if (opts.skipMcp) {
                logger.error('MCP 诊断需要关闭 --skip-mcp');
                return;
            }

            const configuredServers = Object.keys(mcpConfig?.mcpServers ?? {});
            const serverName = String(opts.mcpDiagnoseServer || '').trim() || configuredServers[0];
            if (!serverName) {
                logger.error('未配置任何 MCP server（config/mcp_config.json）');
                return;
            }
            logger.info(`MCP 诊断：server=${serverName}`);

            try {
                const tools = await mcpClient.call(serverName, 'tools/list', {});
                writeText(join(sessionOut, 'mcp_tools.json'), JSON.stringify(tools, null, 2));
                logger.info(`已输出：${join(sessionOut, 'mcp_tools.json')}`);
            } catch (e) {
                logger.error(`tools/list 失败：${e.message}`);
                return;
            }

            // 如果 agents.json 有配置 MCP 工具，挑一个同 server 的做试调用；否则仅 tools/list
            const anyTool = (agentsConfig.agents ?? [])
                .flatMap((a) => a.tools ?? [])
                .find((x) => x.type === 'mcp' && x.server === serverName);
            if (!anyTool) {
                logger.warn('agents.json 未配置该 server 的 MCP 工具，跳过试调用（仅输出 tools/list）');
                return;
            }

            try {
                const res = await mcpClient.call(serverName, anyTool.call.method, anyTool.call.params ?? {});
                writeText(join(sessionOut, 'mcp_call_result.json'), JSON.stringify(res, null, 2));
                logger.info(`已输出：${join(sessionOut, 'mcp_call_result.json')}`);
            } catch (e) {
                logger.error(`试调用失败：${e.message}`);
            }
            return;
        }

        logger.info('加载市场数据');
        const [primaryBars, auxBars] = await Promise.all([
            loadBars(
                { symbol: opts.symbol, timeframe: opts.primary, barsCount: opts.bars, assetClass: opts.assetClass || undefined },
                {
                    logger,
                    prefer: opts.dataSource,
                    dbTimeoutMs: opts.dbTimeoutMs,
                    exchangeTimeoutMs: opts.exchangeTimeoutMs,
                    exchangeId: opts.exchange,
                    marketType: opts.marketType,
                    exchangeFallbacks,
                },
            ),
            loadBars(
                { symbol: opts.symbol, timeframe: opts.aux, barsCount: opts.bars, assetClass: opts.assetClass || undefined },
                {
                    logger,
                    prefer: opts.dataSource,
                    dbTimeoutMs: opts.dbTimeoutMs,
                    exchangeTimeoutMs: opts.exchangeTimeoutMs,
                    exchangeId: opts.exchange,
                    marketType: opts.marketType,
                    exchangeFallbacks,
                },
            ),
        ]);

        logger.info(`K线数量：${opts.primary}=${primaryBars.length}，${opts.aux}=${auxBars.length}`);

        const primaryCloses = primaryBars.map((b) => b.close);
        const auxCloses = auxBars.map((b) => b.close);
        const primaryRsi = computeRsi(primaryCloses, 14);
        const auxRsi = computeRsi(auxCloses, 14);
        const primaryMacd = computeMacd(primaryCloses, 12, 26, 9);
        const auxMacd = computeMacd(auxCloses, 12, 26, 9);

        let orderbookSummary = null;
        try {
            const ob = await withTimeout(
                withRetries(
                    () =>
                        fetchOrderbook({
                            exchangeId: opts.exchange,
                            marketType: opts.marketType,
                            symbol: opts.symbol,
                            limit: 200,
                            logger,
                        }),
                    { retries: 1, baseDelayMs: 1200 },
                ),
                30000,
                '挂单薄',
            );
            orderbookSummary = summarizeOrderbook({
                orderbook: ob,
                referencePrice: primaryBars[primaryBars.length - 1]?.close,
            });
        } catch (e) {
            logger.warn(`[挂单薄失败] ${e.message}`);
        }

        logger.info('生成图表截图');
        const [primaryPng, auxPng] = await Promise.all([
            renderChartPng({
                outputDir: chartsDir,
                symbol: opts.symbol,
                timeframe: opts.primary,
                bars: primaryBars,
                waitMs: opts.chartWaitMs,
            }),
            renderChartPng({
                outputDir: chartsDir,
                symbol: opts.symbol,
                timeframe: opts.aux,
                bars: auxBars,
                waitMs: opts.chartWaitMs,
            }),
        ]);

        logger.info(`图表已保存：${primaryPng}`);
        logger.info(`图表已保存：${auxPng}`);

        let liquidationPng = null;
        if (!opts.skipLiquidation) {
            logger.info('抓取清算地图截图');
            try {
                liquidationPng = await screenshotPage({
                    url: opts.liquidationUrl,
                    outputDir: chartsDir,
                    fileName: 'liquidation.png',
                    waitMs: opts.pageWaitMs,
                    fullPage: false,
                });
                logger.info(`清算地图已保存：${liquidationPng}`);
            } catch (e) {
                logger.warn(`[清算地图失败] ${e.message}`);
            }
        }

        if (opts.skipLlm) {
            const outJson = join(sessionOut, 'snapshot.json');
            writeText(
                outJson,
                JSON.stringify(
                    {
                        sessionId,
                        symbol: opts.symbol,
                        primary: opts.primary,
                        aux: opts.aux,
                        charts: { primaryPng, auxPng, liquidationPng },
                        indicators: { primaryRsi, auxRsi, primaryMacd, auxMacd },
                        orderbookSummary,
                    },
                    null,
                    2,
                ),
            );
            logger.info(`已输出：${outJson}`);
            logger.info('已跳过模型调用 (--skip-llm)');
            return;
        }

        let newsBriefing = null;
        if (!opts.skipNews && agentsConfig.news_pipeline_settings?.enabled) {
            try {
                const subagents = buildSubagents({ agentsConfig, providersConfig: providers, promptStore, logger });
                const collectorName = agentsConfig.news_pipeline_settings?.collector_agent;
                const collector = subagents.find((a) => a.name === collectorName);
                if (!collector) {
                    throw new Error(`未找到 news_pipeline_settings.collector_agent 对应的 subagent：${collectorName}`);
                }

                const searxngCfg = agentsConfig.news_pipeline_settings?.searxng ?? {};
                const firecrawlCfg = agentsConfig.news_pipeline_settings?.firecrawl ?? {};
                const firecrawlApiKeyEnv = String(firecrawlCfg.api_key_env || '').trim();
                const firecrawlApiKey = firecrawlApiKeyEnv ? String(process.env[firecrawlApiKeyEnv] || '').trim() : '';

                const searxngClient = new SearxngClient({
                    baseUrl: searxngCfg.base_url,
                    timeoutMs: searxngCfg.timeout_ms,
                    dockerFallbackContainer: searxngCfg.docker_fallback_container,
                    logger,
                });
                const firecrawlClient = new FirecrawlClient({
                    baseUrl: firecrawlCfg.base_url,
                    timeoutMs: firecrawlCfg.timeout_ms,
                    apiKey: firecrawlApiKey,
                });

                logger.info('新闻收集：SearXNG + Firecrawl');
                newsBriefing = await runNewsPipeline({
                    collectorAgent: collector,
                    searxngClient,
                    firecrawlClient,
                    symbol: opts.symbol,
                    assetClass: opts.assetClass || undefined,
                    settings: agentsConfig.news_pipeline_settings,
                    logger,
                });

                writeText(join(sessionOut, 'news_briefing.md'), newsBriefing.briefingMarkdown);
                writeText(join(sessionOut, 'news_meta.json'), JSON.stringify(newsBriefing, null, 2));
                logger.info(`新闻简报已保存：${join(sessionOut, 'news_briefing.md')}`);
            } catch (e) {
                logger.warn(`[新闻收集失败] ${e.message}`);
            }
        } else {
            logger.info('新闻收集：已跳过（--skip-news 或配置关闭）');
        }

        const agents = buildAgents({ agentsConfig, providersConfig: providers, promptStore, logger });
        const roundtable = new Roundtable({
            agents,
            settings: agentsConfig.roundtable_settings,
            mcpClient: opts.skipMcp ? { call: async () => null, stopAll: async () => { } } : mcpClient,
            logger,
        });

        const contextSeed = [
            `# 输入快照`,
            `- symbol: ${opts.symbol}`,
            `- primary: ${opts.primary}`,
            `- aux: ${opts.aux}`,
            `- bars: ${opts.bars}`,
            ``,
            `# 新闻简报（SearXNG + Firecrawl）`,
            newsBriefing?.briefingMarkdown ? newsBriefing.briefingMarkdown : '（新闻收集失败或被跳过）',
            ``,
            `# 硬数据（文本）`,
            `- primary_rsi14: ${primaryRsi == null ? 'null' : primaryRsi.toFixed(2)}`,
            `- aux_rsi14: ${auxRsi == null ? 'null' : auxRsi.toFixed(2)}`,
            `- primary_macd(12,26,9): ${primaryMacd ? `${primaryMacd.macd.toFixed(4)}, signal=${primaryMacd.signal.toFixed(4)}, hist=${primaryMacd.hist.toFixed(4)}` : 'null'}`,
            `- aux_macd(12,26,9): ${auxMacd ? `${auxMacd.macd.toFixed(4)}, signal=${auxMacd.signal.toFixed(4)}, hist=${auxMacd.hist.toFixed(4)}` : 'null'}`,
            ``,
            `# 挂单薄（摘要）`,
            orderbookSummary ? JSON.stringify(orderbookSummary, null, 2) : 'null',
            ``,
            `- charts:`,
            `  - ${primaryPng}`,
            `  - ${auxPng}`,
            liquidationPng ? `  - ${liquidationPng}` : `  - (liquidation skipped/failed)`,
        ].join('\n');

        const { transcript, context } = await roundtable.run({
            contextSeed,
            imagePaths: [primaryPng, auxPng, ...(liquidationPng ? [liquidationPng] : [])],
        });

        const decisionText = transcript.find((t) => t.name === agentsConfig.roundtable_settings.final_agent)?.text ?? '';
        const outJson = join(sessionOut, 'decision.json');
        const outTxt = join(sessionOut, 'transcript.txt');

        writeText(outTxt, transcript.map((t) => `【${t.name}｜${t.role}】\n${t.text}\n`).join('\n'));
        writeText(outJson, JSON.stringify({ sessionId, decision: decisionText, transcript }, null, 2));

        logger.info(`已输出：${outJson}`);
        logger.info(`已输出：${outTxt}`);
        logger.info('结束');

        // 保存截断后的上下文，便于回放
        writeText(join(sessionOut, 'context_tail.txt'), context);
    } finally {
        await mcpClient.stopAll();
    }
}

main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
