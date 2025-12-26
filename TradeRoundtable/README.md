# TradeRoundtable

一个“圆桌会议式”的交易分析后端脚手架：  
从本仓库现有 JS 数据/图表能力获取 15m/1h K 线截图 + 外部网页截图（如 Coinglass 清算地图），再按配置驱动的多 Agent 顺序调用不同 Provider，最终输出决策与会议纪要。

## 约束

- 本目录为独立实现，不修改仓库现有 `src/`、`scripts/` 等库代码（仅复用其能力）。
- 不需要前端；输出为 `logs/` 与 `outputs/` 文件。
- 不在仓库内硬编码任何密钥；统一通过环境变量注入。

## 快速开始

1) 配置 Provider 与 Agent：
- `TradeRoundtable/config/providers.json`
- `TradeRoundtable/config/agents.json`

2) 准备环境变量（示例，按你的 Provider 配置调整）：

```powershell
$env:DIDL_API_KEY="..."
```

新闻收集默认走「SearXNG + Firecrawl」（本地 HTTP 服务），地址在 `TradeRoundtable/config/agents.json` 的 `news_pipeline_settings` 中可改：
- SearXNG：默认 `http://localhost:8080`
- Firecrawl：默认 `http://localhost:3002`

3) 运行：

```powershell
node TradeRoundtable/main.js --symbol BTCUSDT --bars 250
```

如果只想跳过新闻收集：

```powershell
node TradeRoundtable/main.js --symbol BTCUSDT --bars 250 --skip-news
```

指定交易所/市场类型（ccxt，多交易所）：

```powershell
node TradeRoundtable/main.js --symbol BTCUSDT --exchange okx --market-type swap --exchange-fallbacks binance,bybit
```

如果你本机没有 PostgreSQL（或连接慢），建议直接走交易所数据源：

```powershell
node TradeRoundtable/main.js --symbol BTCUSDT --bars 250 --data-source exchange
```

输出：
- `TradeRoundtable/outputs/<sessionId>/charts/*.png`
- `TradeRoundtable/outputs/<sessionId>/decision.json`
- `TradeRoundtable/logs/<sessionId>.log`
- `TradeRoundtable/outputs/<sessionId>/news_briefing.md`（如未跳过新闻收集）

说明：
- `charts/liquidation.png` 会默认提高截图分辨率，并尽量裁剪到主要图表区域，方便模型读取价格轴与结构。

## 常见问题

- 数据库/补全：沿用仓库现有 `KlinesRepository` 行为（数据不足会自动从交易所补全并入库）。
- 外部网页截图：默认抓 `https://www.coinglass.com/zh/liquidation-levels`，如遇风控可改 `--liquidation-url` 或调大等待时间 `--page-wait-ms`。
- 卡住/一直等：现在对 DB/交易所/截图/LLM 都加了超时与重试；同时可打开 `TradeRoundtable/logs/<sessionId>.log` 看实时进度。
