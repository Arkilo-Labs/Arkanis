# VLM Trade JS

VLM 交易决策实验环境的 JavaScript/Node.js 重构版本。

## 快速开始

### 安装依赖

```bash
pnpm install
```

如果安装后看到 `Ignored build scripts: puppeteer, sharp` 的提示，执行一次：

```bash
pnpm rebuild puppeteer sharp
```

### 配置环境变量

复制 `.env.example` 为 `.env` 并填入实际配置：

```bash
cp .env.example .env
```

### 初始化数据库（首次必做）

项目默认使用两个 PostgreSQL 数据库：

- `arkilo_core`：核心业务（用户/组织/订阅等）
- `arkilo_market_data`：市场数据（K 线等）

执行一次：

```bash
pnpm db:setup
```

### 运行主脚本

```bash
# 生成基础 K 线图 (跳过 VLM 调用)
node scripts/main.js --symbol BTCUSDT --timeframe 5m --bars 200 --skip-vlm

# 完整 VLM 分析
node scripts/main.js --symbol BTCUSDT --timeframe 5m --bars 200

# 启用 4 倍辅助周期图
node scripts/main.js --symbol BTCUSDT --timeframe 1h --bars 200 --enable-4x-chart
```

### 运行回测脚本

```bash
node scripts/backtest.js --symbol BTCUSDT --timeframe 1h --start-time "2024-12-01" --end-time "2024-12-13" --workers 4
```

## 项目结构

```
vlm_trade_js/
├── package.json
├── .env.example
├── src/
│   ├── config/          # 配置模块
│   ├── data/            # 数据层 (PostgreSQL/币安)
│   ├── chart/           # 图表层 (Puppeteer + lightweight-charts)
│   ├── vlm/             # VLM 层 (OpenAI Vision API)
│   └── backtest/        # 回测层
├── scripts/
│   ├── main.js          # 主脚本
│   └── backtest.js      # 回测脚本
└── outputs/             # 输出目录
```

## 命令行参数

### main.js

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--symbol` | 交易对 | BTCUSDT |
| `--timeframe` | 时间周期 | 5m |
| `--bars` | K 线数量 | 200 |
| `--output-dir` | 输出目录 | ./outputs |
| `--skip-vlm` | 跳过 VLM 调用 | false |
| `--enable-4x-chart` | 启用辅助图 | false |
| `--aux-timeframe` | 自定义辅助周期 | 自动 |

### backtest.js

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--start-time` | 开始时间 (必填) | - |
| `--end-time` | 结束时间 | 最新 |
| `--workers` | 并发数 | 4 |
| `--save-charts` | 保存图表 | false |

## 技术栈

- **运行时**: Node.js >= 18
- **包管理**: pnpm
- **HTTP**: axios
- **PostgreSQL**: pg
- **图表渲染**: Puppeteer + lightweight-charts
- **Schema**: Zod
- **命令行**: commander
