#!/usr/bin/env node
import { Command } from 'commander';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { ensureDir, writeText } from '../../agents/agents-team/core/fsUtils.js';
import { loadAgentsConfig, loadMcpConfig, loadProvidersConfig } from '../../agents/agents-team/core/configLoader.js';
import { PromptStore } from '../../agents/agents-team/core/promptStore.js';
import { SessionLogger } from '../../agents/agents-team/core/logger.js';
import { McpClient } from '../../agents/agents-team/core/mcpClient.js';
import { buildAgents, buildSubagents } from '../../agents/agents-team/core/agentFactory.js';
import { Roundtable } from '../../agents/agents-team/core/roundtable.js';
import { loadBars } from '../../agents/agents-team/core/marketData.js';
import { renderChartPng } from '../../agents/agents-team/core/chartShots.js';
import { screenshotPage } from '../../agents/agents-team/core/liquidationShot.js';
import { computeMacd, computeRsi } from '../../agents/agents-team/core/indicators.js';
import { fetchOrderbook, summarizeOrderbook } from '../../agents/agents-team/core/orderbook.js';
import { withRetries, withTimeout } from '../../agents/agents-team/core/runtime.js';
import { SearxngClient } from '../../agents/agents-team/core/searxngClient.js';
import { FirecrawlClient } from '../../agents/agents-team/core/firecrawlClient.js';
import { runNewsPipeline } from '../../agents/agents-team/core/newsPipeline.js';
import { Toolbox } from '../../agents/agents-team/core/toolbox.js';
import { DecisionHistory } from '../../agents/agents-team/core/decisionHistory.js';
import { closeExchangeClient } from '../../core/data/exchangeClient.js';
import { closePools as closePgPools } from '../../core/data/pgClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function normalizeArgv(argv) {
    if (argv.length >= 3 && argv[2] === '--') return [...argv.slice(0, 2), ...argv.slice(3)];
    return argv;
}

function newSessionId() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}_${pad(
        d.getUTCHours(),
    )}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

function extractBaseCoin(symbol) {
    const base = String(symbol || '')
        .trim()
        .toUpperCase();
    const quoteAssets = ['USDT', 'USDC', 'BUSD', 'DAI', 'TUSD', 'FDUSD', 'USDD'];
    for (const quote of quoteAssets) {
        if (base.endsWith(quote) && base.length > quote.length) {
            return base.slice(0, -quote.length);
        }
    }
    return base;
}

function dumpActiveHandles(logger) {
    const handles =
        typeof process._getActiveHandles === 'function' ? process._getActiveHandles() : [];
    const requests =
        typeof process._getActiveRequests === 'function' ? process._getActiveRequests() : [];

    const fmt = (x) => {
        const name = x?.constructor?.name || typeof x;
        const details = [];
        if (x?.hasOwnProperty?.('fd')) details.push(`fd=${x.fd}`);
        if (x?.hasOwnProperty?.('pid')) details.push(`pid=${x.pid}`);
        if (name === 'Socket') {
            const ra = x?.remoteAddress ? String(x.remoteAddress) : '';
            const rp = x?.remotePort ? String(x.remotePort) : '';
            const la = x?.localAddress ? String(x.localAddress) : '';
            const lp = x?.localPort ? String(x.localPort) : '';
            const remote = ra && rp ? `${ra}:${rp}` : ra || '';
            const local = la && lp ? `${la}:${lp}` : la || '';
            if (remote) details.push(`remote=${remote}`);
            if (local) details.push(`local=${local}`);
        }
        return details.length ? `${name}(${details.join(',')})` : name;
    };

    logger.warn(`[退出诊断] active_handles=${handles.length} active_requests=${requests.length}`);
    const list = handles.slice(0, 20).map(fmt).join(', ');
    if (list) logger.warn(`[退出诊断] handles: ${list}${handles.length > 20 ? ' ...' : ''}`);
}

async function closeUndiciDispatcher(logger) {
    try {
        const undici = await import('undici');
        const dispatcher = undici?.getGlobalDispatcher?.();
        if (dispatcher && typeof dispatcher.close === 'function') {
            await dispatcher.close();
            logger.info('[退出清理] undici dispatcher 已关闭');
        }
    } catch {
        // 没有 undici 或版本不支持时忽略
    }
}

function scheduleForcedExit({ logger, timeoutMs }) {
    const t = Math.max(0, Number(timeoutMs) || 0);
    if (t <= 0) return;

    const timer = setTimeout(() => {
        const code = Number.isInteger(process.exitCode) ? process.exitCode : 0;
        dumpActiveHandles(logger);
        logger.warn(`[退出诊断] ${t}ms 后仍未退出，强制结束进程（exitCode=${code}）`);
        process.exit(code);
    }, t);
    timer.unref?.();
}

async function main() {
    const program = new Command();
    program
        .name('trade-roundtable')
        .option('--symbol <symbol>', '交易对', 'BTCUSDT')
        .option(
            '--exchange <id>',
            '交易所（ccxt exchangeId）',
            process.env.MARKET_EXCHANGE || 'binance',
        )
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
        .option('--asset-class <type>', '资产类型：crypto|stock|forex|commodity（默认自动检测）', '')
        .option('--bars <n>', 'K线数量', (v) => parseInt(v, 10), 250)
        .option('--primary <tf>', '主周期', '15m')
        .option('--aux <tf>', '辅助周期', '1h')
        .option('--config-dir <dir>', '配置目录', join(__dirname, '../../agents/agents-team/config'))
        .option('--prompts-dir <dir>', 'Prompt目录', join(__dirname, '../../resources/prompts/agents-team'))
        .option('--output-dir <dir>', '输出目录', './outputs/roundtable')
        .option('--page-wait-ms <n>', '外部网页等待(ms)', (v) => parseInt(v, 10), 5000)
        .option('--chart-wait-ms <n>', '图表渲染等待(ms)', (v) => parseInt(v, 10), 600)
        .option(
            '--liquidation-url <url>',
            '清算地图页面',
            'https://www.coinglass.com/zh/liquidation-levels',
        )
        .option('--skip-llm', '跳过模型调用（只产出数据和截图）')
        .option('--skip-news', '跳过新闻收集（SearXNG + Firecrawl）')
        .option('--skip-liquidation', '跳过清算地图截图')
        .option('--skip-mcp', '跳过 MCP 工具调用')
        .option('--exit-timeout-ms <n>', '结束后强制退出超时(ms)，0=禁用', (v) => parseInt(v, 10), 2500)
        .option('--dump-active-handles', '输出阻塞退出的活跃句柄（用于诊断）')
        .option('--mcp-verbose', '打印 MCP 的 stderr 原始输出（默认只打印错误）')
        .option('--mcp-silent', '完全静默 MCP stderr（不打印任何 MCP 输出）')
        .option('--mcp-diagnose', '只做 MCP 诊断（tools/list + 试调用），不跑圆桌')
        .option('--mcp-diagnose-server <name>', 'MCP 诊断的 server 名称（默认取配置第一个）', '')
        .option('--data-source <mode>', 'K线数据源：auto|db|exchange', 'auto')
        .option('--db-timeout-ms <n>', 'DB 超时(ms)', (v) => parseInt(v, 10), 6000)
        .option('--exchange-timeout-ms <n>', '交易所超时(ms)', (v) => parseInt(v, 10), 25000)
        .parse(normalizeArgv(process.argv));

    const opts = program.opts();
    const exchangeFallbacks = String(opts.exchangeFallbacks || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    const sessionId = newSessionId();
    const sessionOut = join(opts.outputDir, sessionId);
    const chartsDir = join(sessionOut, 'charts');
    const logPath = join(sessionOut, 'session.log');
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
        logger.info(`Output: ${sessionOut}`);
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
                const res = await mcpClient.call(
                    serverName,
                    anyTool.call.method,
                    anyTool.call.params ?? {},
                );
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
                {
                    symbol: opts.symbol,
                    timeframe: opts.primary,
                    barsCount: opts.bars,
                    assetClass: opts.assetClass || undefined,
                },
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
                {
                    symbol: opts.symbol,
                    timeframe: opts.aux,
                    barsCount: opts.bars,
                    assetClass: opts.assetClass || undefined,
                },
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
                    // 清算图表通常在 canvas，放大分辨率并裁剪最大 canvas，模型更容易读价格轴与结构
                    preferChartClip: true,
                    deviceScaleFactor: 2,
                    clipPadding: 48,
                });
                logger.info(`清算地图已保存：${liquidationPng}`);
            } catch (e) {
                logger.warn(`[清算地图失败] ${e.message}`);
            }
        }

        const baseCoin = extractBaseCoin(opts.symbol);

        if (opts.skipLlm) {
            const outJson = join(sessionOut, 'snapshot.json');
            writeText(
                outJson,
                JSON.stringify(
                    {
                        sessionId,
                        symbol: opts.symbol,
                        base_coin: baseCoin,
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
        let searxngClient = null;
        let firecrawlClient = null;
        const newsToolSettings = agentsConfig.news_pipeline_settings ?? null;
        if (newsToolSettings) {
            try {
                const searxngCfg = newsToolSettings?.searxng ?? {};
                const firecrawlCfg = newsToolSettings?.firecrawl ?? {};
                const firecrawlApiKeyEnv = String(firecrawlCfg.api_key_env || '').trim();
                const firecrawlApiKey = firecrawlApiKeyEnv
                    ? String(process.env[firecrawlApiKeyEnv] || '').trim()
                    : '';

                searxngClient = new SearxngClient({
                    baseUrl: searxngCfg.base_url,
                    timeoutMs: searxngCfg.timeout_ms,
                    dockerFallbackContainer: searxngCfg.docker_fallback_container,
                    logger,
                });
                firecrawlClient = new FirecrawlClient({
                    baseUrl: firecrawlCfg.base_url,
                    timeoutMs: firecrawlCfg.timeout_ms,
                    apiKey: firecrawlApiKey,
                });
            } catch (e) {
                logger.warn(`[工具初始化失败] SearXNG/Firecrawl：${e.message}`);
                searxngClient = null;
                firecrawlClient = null;
            }
        }

        if (!opts.skipNews && agentsConfig.news_pipeline_settings?.enabled) {
            try {
                const subagents = buildSubagents({
                    agentsConfig,
                    providersConfig: providers,
                    promptStore,
                    logger,
                });
                const collectorName = agentsConfig.news_pipeline_settings?.collector_agent;
                const collector = subagents.find((a) => a.name === collectorName);
                if (!collector) {
                    throw new Error(
                        `未找到 news_pipeline_settings.collector_agent 对应的 subagent：${collectorName}`,
                    );
                }

                if (!searxngClient || !firecrawlClient) {
                    throw new Error('SearXNG/Firecrawl 未就绪（请检查 news_pipeline_settings 与服务端）');
                }

                logger.info('新闻收集：SearXNG + Firecrawl');
                newsBriefing = await runNewsPipeline({
                    collectorAgent: collector,
                    searxngClient,
                    firecrawlClient,
                    symbol: opts.symbol,
                    assetClass: opts.assetClass || undefined,
                    settings: newsToolSettings,
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

        let auditorAgent = null;
        const auditSettings = agentsConfig.roundtable_settings?.audit_settings;
        if (auditSettings?.enabled && auditSettings?.auditor_agent) {
            const subagents = buildSubagents({
                agentsConfig,
                providersConfig: providers,
                promptStore,
                logger,
            });
            auditorAgent = subagents.find((a) => a.name === auditSettings.auditor_agent);
            if (!auditorAgent) {
                logger.warn(`未找到配置的审计 Agent: ${auditSettings.auditor_agent}，审计功能已禁用`);
            } else {
                logger.info(`审计 Agent 已启用: ${auditorAgent.name}`);
            }
        }

        const toolbox = new Toolbox({
            searxngClient,
            firecrawlClient,
            mcpClient: opts.skipMcp ? null : mcpClient,
            outputDir: sessionOut,
            logger,
        });

        const roundtable = new Roundtable({
            agents,
            settings: agentsConfig.roundtable_settings,
            mcpClient: opts.skipMcp ? { call: async () => null, stopAll: async () => {} } : mcpClient,
            logger,
            auditorAgent,
            toolbox,
        });

        const contextSeed = [
            `# 输入快照`,
            `- symbol: ${opts.symbol}`,
            `- base_coin: ${baseCoin}`,
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

        let decisionText = '';
        for (let i = transcript.length - 1; i >= 0; i--) {
            if (transcript[i]?.name === agentsConfig.roundtable_settings.final_agent) {
                decisionText = transcript[i]?.text ?? '';
                break;
            }
        }
        const outJson = join(sessionOut, 'decision.json');
        const outTxt = join(sessionOut, 'transcript.txt');

        writeText(outTxt, transcript.map((t) => `【${t.name}｜${t.role}】\n${t.text}\n`).join('\n'));
        writeText(outJson, JSON.stringify({ sessionId, decision: decisionText, transcript }, null, 2));

        logger.info(`已输出：${outJson}`);
        logger.info(`已输出：${outTxt}`);

        // 记录历史决策
        const historyDir = join(opts.outputDir, 'history');
        const decisionHistory = new DecisionHistory({ historyDir });

        // 提取决策 JSON
        let decisionJson = null;
        try {
            const jsonMatch = decisionText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                decisionJson = JSON.parse(jsonMatch[0]);
            }
        } catch {
            // 解析失败时忽略
        }

        // 提取各 Agent 的贡献
        const agentContributions = {};
        for (const t of transcript) {
            if (t.name && t.text) {
                const dirMatch = t.text.match(/看多|做多|LONG|看空|做空|SHORT|观望|等待|WAIT/i);
                const confMatch = t.text.match(/置信度[：:]\s*([\d.]+)/);
                if (dirMatch) {
                    let direction = 'WAIT';
                    if (/看多|做多|LONG/i.test(dirMatch[0])) direction = 'LONG';
                    else if (/看空|做空|SHORT/i.test(dirMatch[0])) direction = 'SHORT';
                    agentContributions[t.name] = {
                        direction,
                        confidence: confMatch ? parseFloat(confMatch[1]) : null,
                    };
                }
            }
        }

        decisionHistory.addRecord({
            sessionId,
            symbol: opts.symbol,
            timeframe: opts.primary,
            decision: decisionJson,
            agentContributions,
            beliefState: roundtable.beliefTracker?.toJSON() ?? null,
            structuredContext: roundtable.structuredContext?.toJSON() ?? null,
        });
        logger.info(`历史决策已记录：${historyDir}`);

        // 生成历史统计报告
        const historyReport = decisionHistory.generateReport();
        writeText(join(sessionOut, 'history_stats.md'), historyReport);
        logger.info(`历史统计已保存：${join(sessionOut, 'history_stats.md')}`);

        const auditReport = roundtable.generateAuditReport(sessionId);
        if (auditReport) {
            writeText(join(sessionOut, 'audit_report.json'), JSON.stringify(auditReport, null, 2));
            const auditSummary = roundtable.generateAuditSummaryMarkdown(auditReport);
            writeText(join(sessionOut, 'audit_summary.md'), auditSummary);
            logger.info(`审计报告已保存：${join(sessionOut, 'audit_report.json')}`);
            logger.info(`审计摘要已保存：${join(sessionOut, 'audit_summary.md')}`);
        }

        logger.info('结束');

        // 保存截断后的上下文，便于回放
        writeText(join(sessionOut, 'context_tail.txt'), context);
    } finally {
        await mcpClient.stopAll();
        await closePgPools();
        await closeExchangeClient();
        await closeUndiciDispatcher(logger);

        if (opts.dumpActiveHandles) dumpActiveHandles(logger);
        scheduleForcedExit({ logger, timeoutMs: opts.exitTimeoutMs });
    }
}

main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
