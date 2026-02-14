# Arkanis（arkanis.dev）内部开发手册

面向内部开发者的工作说明文档，用于快速上手本仓库的“VLM 交易决策实验环境”，以及后续把它演进为 Arkanis SaaS 后端底座时的落点与扩展方式。

如果你要做 SaaS 化（多租户/登录/订阅/审计/任务系统等），先读 `docs/arkanis-saas-backend-plan.md`，本 README 只抽取关键信息并补齐“怎么跑、怎么改、怎么扩”。

## 1. 项目定位（现状 vs 目标）

### 现状：可跑的实验环境

- **脚本驱动**：`src/cli/vlm/main.js` / `src/cli/vlm/backtest.js` 负责拉 K 线、渲图、调用 VLM、产出结果。
- **数据底座**：PostgreSQL 双库（`arkanis_core` + `arkanis_market_data`）已落地，迁移体系已落地。
- **开发控制台**：`src/apps/server/` + `src/apps/web/` 提供“运行脚本 / 日志推送 / 配置编辑 / Provider 管理 / Telegram 推送”等能力。

### 目标：Arkanis SaaS 后端底座

面向商业化的硬性要求（多租户、安全、可审计、可扩展、可回滚迁移、数据分层、可运维）在 `docs/arkanis-saas-backend-plan.md` 里有完整说明。本仓库当前已经把**数据库拆分 + 迁移体系 + Core 预留表结构 + 最小 auth 会话**落在代码里，后续演进围绕这些骨架扩展，而不是推翻重写。

## 2. 快速开始（本地）

### 2.1 依赖与前置条件

- Node.js `>= 18`
- pnpm（建议启用 corepack）
- PostgreSQL `>= 14`（本地或容器均可）

推荐用 Docker 部署 PostgreSQL（仓库提供 `docker-compose.yml`）：

```bash
docker compose up -d postgres
```

如果你的机器上已安装并运行了本地 PostgreSQL，注意端口冲突：要么先停掉本地服务，要么把 `.env` 的 `DB_PORT` 改成其他端口。

可选：项目中后期会用到的 **SearXNG + Firecrawl**（用于联网检索 + 抓取原文）已做成独立“一键栈”，默认不启动、不影响本仓库的简单验证：

```bash
# macOS / Linux
bash ./deploy/searxng-firecrawl/stack.sh up

# Windows PowerShell
powershell -ExecutionPolicy Bypass -File .\\deploy\\searxng-firecrawl\\stack.ps1 up
```

安装依赖：

```bash
pnpm install
```

本仓库是一个多项目（workspace）结构：根目录 + `src/apps/server/` + `src/apps/web/` + `src/apps/web_console/` + `docs/` 都各自有 `package.json`。
正常情况下只需要在根目录执行一次 `pnpm install`，就会把这些子项目的依赖一起装好；不要只在某个子目录里单独 `npm install`，否则很容易出现“能跑一部分、另一部分缺包”的情况。

如果安装后看到 `Ignored build scripts: puppeteer, sharp`，执行一次：

```bash
pnpm rebuild puppeteer sharp
```

### 2.2 配置环境变量

复制 `.env.example` 为 `.env`：

```bash
# macOS / Linux
cp .env.example .env

# Windows PowerShell
Copy-Item .env.example .env
```

### 2.3 初始化数据库（首次必做）

项目默认使用两个 PostgreSQL 数据库：

- `arkanis_core`：核心业务（用户/组织/会话/订阅骨架等）
- `arkanis_market_data`：市场数据（K 线等）

执行一次：

```bash
pnpm db:setup
```

如果你用的是 Docker 版 PostgreSQL，想“清空重来”（仅本地/测试）：

```bash
docker compose down -v
docker compose up -d postgres
pnpm db:setup
```

### 2.4 一句话验证：跑一次主脚本

```bash
# 只渲图（跳过 VLM 调用）
pnpm main -- --symbol BTCUSDT --timeframe 5m --bars 200 --skip-vlm

# 完整 VLM 分析
pnpm main -- --symbol BTCUSDT --timeframe 5m --bars 200
```

输出默认在 `outputs/`。

### 2.5 启动控制台（server + web）

```bash
# 终端 A：启动 server（默认 3000）
pnpm dev:server

# 终端 B：启动 web（Vite dev server）
pnpm dev:web
```

Web 通过 Socket.IO 订阅日志；server 负责派生脚本进程并转发 stdout/stderr。

提示：`pnpm dev:console` 现在等价于 `pnpm dev:web`（兼容旧命令）。

`src/apps/web_console/` 仅保留为静态原型参考（不接入 `src/apps/server/`，不具备真实安全性）。如需查看原型：

- 直接打开 `src/apps/web_console/index.html`
- 或执行：`pnpm -C src/apps/web_console dev`

Windows PowerShell 里不要用 `&&`，请用两行命令或用 `;` 分隔。

如果安装依赖时看到 `Ignored build scripts: esbuild`，执行一次 `pnpm rebuild --pending`。

### 2.6 常见安装/启动问题

- `Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'express' imported from src/apps/server/index.mjs`  
  说明依赖未正确安装。回到根目录执行 `pnpm install`；如果你只想补装 server，也可以跑 `pnpm -C src/apps/server install`。

- `ERR_PNPM_META_FETCH_FAIL` / `getaddrinfo ENOTFOUND registry.npmjs.org`  
  这是网络/DNS 无法访问 npm 官方源导致的，包自然就“缺”。请先确认能访问 npm 源；在受限网络环境可以切换镜像源：  
  - `pnpm config set registry https://registry.npmmirror.com`  
  - `npm config set registry https://registry.npmmirror.com`

- `ERR_PNPM_OUTDATED_LOCKFILE` / `frozen-lockfile`  
  通常发生在 CI 或你显式启用了 frozen lockfile。需要更新锁文件时用：`pnpm install --no-frozen-lockfile`。

## 3. 运行方式清单（按场景）

### 3.1 纯命令行：单次分析（main）

常用：

```bash
# 指定时间范围（UTC 解析，支持 YYYY-MM-DD / YYYY-MM-DD HH:mm 等）
pnpm main -- --symbol BTCUSDT --timeframe 1h --start-time "2024-12-01" --end-time "2024-12-13"

# 启用 4 倍辅助周期图（默认主周期 * 4，也可手动指定 --aux-timeframe）
pnpm main -- --symbol BTCUSDT --timeframe 1h --bars 200 --enable-4x-chart

# 跳过 PNG 导出（只跑逻辑/调试用）
pnpm main -- --skip-png --skip-vlm
```

`src/cli/vlm/main.js` 参数一览：

| 参数 | 说明 | 默认值 |
|---|---|---|
| `--symbol <symbol>` | 交易对 | `.env DEFAULT_SYMBOL` / `BTCUSDT` |
| `--timeframe <tf>` | 周期（见 `TIMEFRAME_MINUTES`） | `.env DEFAULT_TIMEFRAME` / `5m` |
| `--bars <n>` | K 线数量 | `.env DEFAULT_BARS` / `200` |
| `--start-time <time>` | 开始时间（可选） | - |
| `--end-time <time>` | 结束时间（可选） | - |
| `--future-bars <n>` | 未来 K 线数量（用于图表右侧留白/参考） | `bars/10`（最少 1） |
| `--output-dir <dir>` | 输出目录 | `./outputs` |
| `--wait <ms>` | Puppeteer 渲染等待 | `500` |
| `--skip-vlm` | 跳过 VLM 调用 | `false` |
| `--skip-png` | 跳过 PNG 导出 | `false` |
| `--enable-4x-chart` | 启用 4 倍辅助图 | `false` |
| `--aux-timeframe <tf>` | 指定辅助周期 | 自动 / 手动 |
| `--session-id <id>` | 把图表数据 POST 回 server（供 web 渲染） | - |

### 3.2 纯命令行：回测（backtest）

```bash
pnpm backtest -- --symbol BTCUSDT --timeframe 1h --start-time "2024-12-01" --end-time "2024-12-13" --workers 4

# 保存每根 K 线的图表截图（IO/体积会很大，谨慎开）
pnpm backtest -- --start-time "2024-12-01" --end-time "2024-12-03" --save-charts
```

`src/cli/vlm/backtest.js` 参数一览：

| 参数 | 说明 | 默认值 |
|---|---|---|
| `--start-time <time>` | 回测开始时间（必填） | - |
| `--end-time <time>` | 回测结束时间 | 最新 |
| `--symbol <symbol>` | 交易对 | `.env DEFAULT_SYMBOL` / `BTCUSDT` |
| `--timeframe <tf>` | 周期 | `.env DEFAULT_TIMEFRAME` / `5m` |
| `--bars <n>` | 每次分析使用的历史 K 线数量 | `.env DEFAULT_BARS` / `200` |
| `--workers <n>` | VLM 并发 | `4` |
| `--output-dir <dir>` | 输出根目录 | `./outputs/backtest` |
| `--wait <ms>` | Puppeteer 渲染等待 | `500` |
| `--save-charts` | 保存图表截图 | `false` |
| `--enable-4x-chart` | 启用 4 倍辅助图 | `false` |
| `--aux-timeframe <tf>` | 指定辅助周期 | 自动 / 手动 |

结果输出为 `backtest_results.json`（按 runId 分目录）。

### 3.3 Web 控制台：运行脚本 + 看日志 + 改配置

server 暴露了这些能力（见 `src/apps/server/index.mjs`）：

- 运行脚本：`POST /api/run-script`（支持 `main` / `backtest`）
- 日志推送：Socket.IO 广播事件 `log` / `process-exit`
- Prompt 列表：`GET /api/prompts`（来自 `src/resources/prompts/vlm/`）
- 配置读取/写入：`GET /api/config` / `POST /api/config`（白名单写 `.env`）
- Provider 管理：`/api/ai-providers`（读写 `ai-providers.json`，支持激活）
- Telegram 推送：`POST /api/send-telegram`
- Auth（最小可用）：`/api/auth/register`、`/api/auth/login`、`/api/auth/me`、`/api/auth/logout`

#### 3.3.1 API 速用（不依赖前端）

以 `http://localhost:3000` 为例（按需改 `PORT`）：

```bash
# 运行 main 脚本（args 会原样透传给 src/cli/vlm/main.js）
curl -X POST http://localhost:3000/api/run-script \
  -H "Content-Type: application/json" \
  -d "{\"script\":\"main\",\"args\":[\"--symbol\",\"BTCUSDT\",\"--timeframe\",\"5m\",\"--bars\",\"200\"]}"

# 注册并拿到 session token（后续用 Bearer 传回）
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"dev@local\",\"password\":\"devpass123\",\"displayName\":\"dev\"}"

# 当前用户
curl http://localhost:3000/api/auth/me -H "Authorization: Bearer <token>"
```

PowerShell 也可用 `Invoke-RestMethod`：

```powershell
Invoke-RestMethod -Method Post http://localhost:3000/api/run-script `
  -ContentType "application/json" `
  -Body '{"script":"main","args":["--symbol","BTCUSDT","--timeframe","5m","--bars","200"]}'
```

注意：当前 server 会在启动时加载一次 `.env`，之后只做“文件变更通知”（`config-reload`），**不会自动把 `.env` 变更重载进 `process.env`**。因此：

- 你在 Web UI 保存了 `.env` 后，要让 server 派生的新脚本进程拿到新值，通常需要**重启 server**。
- 直接命令行运行 `pnpm main` / `pnpm backtest` 时，每次启动新进程会重新读取 `.env`（更符合直觉）。

### 3.4 Run Tab：定时分析 + Telegram 通知

Run Tab 的交互说明见 `docs/RUN_TAB_GUIDE.md`。最小配置：

- `.env` 里配置 `TG_BOT_TOKEN`、`TG_CHAT_ID`
- 启动 `pnpm dev:server`、`pnpm dev:web`
- 在 Run Tab 开启定时运行，并打开 Telegram 通知开关

### 3.5 静态原型：`src/apps/surface/` 与 `src/apps/web_console/`

这两个目录目前是**静态页面原型**（不走 `src/apps/server/`、不连数据库），用于产品展示/交互草图：

- `src/apps/surface/`：Arkanis 落地页/产品介绍的静态页面（品牌与文案方向参考）。
- `src/apps/web_console/`：Console/订阅管理的静态原型（包含激活码、管理页等 UI 形态）。

运行方式（任选其一）：

- 直接用浏览器打开 `src/apps/surface/index.html` 或 `src/apps/web_console/index.html`
- 或用任意静态服务器起一个目录（方便相对路径与缓存行为更接近线上）

重要说明（避免误用）：

- `src/apps/web_console/` 内可能包含演示用硬编码与模拟数据，仅用于原型展示，**不具备真实安全性**。

## 4. 配置与密钥（务必认真对待）

### 4.1 `.env`（项目级配置）

以 `.env.example` 为准，主要包括：

- 数据库：`DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_*_DATABASE`
- 市场数据：`MARKET_EXCHANGE`、`MARKET_MARKET_TYPE`、`MARKET_EXCHANGE_FALLBACKS`（兼容旧的 `BINANCE_MARKET`）
- Prompt：`PROMPT_NAME`（对应 `src/resources/prompts/vlm/<name>.md`）
- 图表：`CHART_*`
- 日志：`LOG_LEVEL`
- Telegram：`TG_BOT_TOKEN`、`TG_CHAT_ID`
- 脚本与 server：`PORT`（server 端口）、`SERVER_URL`（脚本回传图表数据时使用）

### 4.2 `ai-providers.json`（VLM Provider 列表）

VLM 的“模型/网关/Key”等不放在 `.env`，而是由 `ai-providers.json` 管理，并支持“多 Provider + 激活”。

- 读取位置：`src/core/services/providerService.js`
- 激活 Provider：`VLMClient.fromActiveProvider()` 会选中 `isActive=true` 的那一条
- 维护方式：建议通过 Web UI 的 Provider 管理页面；也可手动编辑（谨慎）

强约束：

- **不要把真实 Key、网关地址、内部域名提交到仓库**（即使是内部项目也会被备份/镜像/转存）。
- 如果发现历史提交里存在 Key，按“泄露”处理：立即轮换，补齐 `.gitignore` 与扫描流程。

### 4.3 Prompt（策略输出的“契约”）

- 目录：`src/resources/prompts/vlm/`
- 选择：`.env PROMPT_NAME=<name>` → 使用 `src/resources/prompts/vlm/<name>.md`
- 约束：VLM 输出会走 schema 校验（`src/core/vlm/schema.js`），Prompt 变更要保持可解析与可校验。

## 5. 数据库：双库拆分与迁移

### 5.1 两个数据库

- `arkanis_core`：用户、组织、会话、订阅等（商业化骨架）
- `arkanis_market_data`：市场数据（目前主存 `klines_1m`，应用侧重采样生成任意周期）

### 5.2 迁移命令

```bash
# 创建数据库 + 执行两套迁移（首次）
pnpm db:setup

# 仅迁移 core
pnpm db:migrate:core

# 仅迁移 market_data
pnpm db:migrate:market
```

迁移目录：`migrations/core/`、`migrations/market_data/`（工具：`node-pg-migrate`）。

## 6. 架构与数据流（读代码前先看这个）

```
            ┌───────────────┐
            │  web (Vue3)   │
            │  控制台/RunTab │
            └───────┬───────┘
                    │ Socket.IO(log/config-reload/providers-updated)
                    ▼
            ┌───────────────┐        ┌──────────────────────┐
            │ server (Express)│ spawn │ src/cli/vlm/main/backtest │
            │ /api/run-script │──────▶│ 渲图 + VLM + 产出结果 │
            └───────┬────────┘        └───────────┬──────────┘
                    │                              │
                    │                              │ query/insert
                    ▼                              ▼
          ┌─────────────────┐            ┌────────────────────┐
          │ arkanis_core     │            │ arkanis_market_data  │
          │ users/orgs/...  │            │ instruments/klines_1m│
          └─────────────────┘            └────────────────────┘
```

关键实现入口：

- 数据：`src/core/data/klinesRepository.js`（不足时从交易所补全并落库）
- 渲图：`src/core/chart/chartBuilder.js`（Puppeteer + `src/core/chart/template.html`）
- VLM：`src/core/vlm/`（Provider、Prompt、schema、overlay 转换）
- 控制台后端：`src/apps/server/index.mjs`

## 7. 如何拓展（面向后续团队的“落点清单”）

### 7.1 把现有脚本演进成 Worker

现状脚本是“可复用的最小原型”。SaaS 化后建议拆分：

- API Server：认证/账单/数据查询/任务创建
- Worker：队列消费（回测、批量分析、数据采集、VLM 调用）

对应路线与注意事项见 `docs/arkanis-saas-backend-plan.md`（任务系统、幂等、进度、可取消、重试、配额）。

### 7.2 新交易所 / 新市场

落点：`src/core/data/exchangeClient.js`（ccxt + failover）

- 先把“拉 1m 原始 K 线”的接口对齐
- 保持 `instruments(exchange, market, symbol)` 的唯一键不变（便于多来源扩展）
- 需要更强的“多资产类别”扩展时，优先在 `instruments.asset_class/venue/metadata` 上做增量演进（见 `migrations/market_data/002_instruments_extensibility.cjs`）
- 使用与环境变量说明：`docs/MARKET_DATA_CCXT.md`

### 7.3 新图表能力（交互式图表 / 指标 / 标注）

- 现状：后端用 Puppeteer 截图生成 PNG；Web 主要显示输出与日志。
- 目标：前端用 `lightweight-charts` 直接渲染（可交互、低成本、利于扩展）。
- 参考文档：`docs/lightweight-charts-integration.md`（注意按现状代码校准后再实施）。

### 7.4 SaaS 业务功能扩展（不要跳过骨架）

落点与原则：

- 多租户：优先以 `organization_id` 贯穿核心业务表与 API；规模起来再考虑 RLS
- Auth：所有 token 只存 hash（现状已采用），统一撤销与过期策略
- Billing：`subscriptions` / `billing_customers` 先保持 provider-agnostic（Stripe/加密货币都能接）
- 审计与可观测：日志结构化、request id、user/org 维度打点，别等上线再补

### 7.5 让 `src/apps/web_console/` 变成“真实 Console”的落点（建议路线）

`src/apps/web_console/` 当前是纯静态原型。要产品化，建议不要在原型上堆逻辑，而是把它当作“UI 参考”，按现有后端骨架落地：

- 前端：优先复用 `src/apps/web/`（Vue3）技术栈，或单独建 Console 应用但沿用同一套 API 契约与鉴权方式。
- 鉴权：复用 `src/apps/server/index.mjs` 已有的最小 auth（后续再升级 refresh/access 双 token、RBAC 等）。
- 订阅：对齐 `arkanis_core` 的 `billing_customers`、`subscriptions` 设计（provider-agnostic），不要把 Stripe/加密货币逻辑硬编码进 UI。
- 激活码：若继续保留“激活码”发放模式，应落库并审计（而不是前端本地 state/localStorage）。

## 8. 开发与自检

```bash
pnpm lint
pnpm format
pnpm test
```

## 9. 常见问题（高频坑位）

- Postgres 权限不足导致 `pnpm db:setup` 创建库失败：确认 `DB_USER` 有 `CREATE DATABASE` 权限。
- Puppeteer/Sharp 安装异常：优先跑 `pnpm rebuild puppeteer sharp`，再检查系统依赖与代理环境。
- macOS 上 `Failed to launch the browser process!`（尤其伴随 crashpad / crash info 日志）：优先设置 `CHART_PUPPETEER_CHANNEL=chrome` 使用系统 Chrome，其次清理 `~/.cache/puppeteer` 后重试。
- Web 改了 `.env` 但脚本仍用旧配置：如上所述，重启 `pnpm server` 再试。
