# 本地安装（非 Docker）

::: warning 面向开发者/高级用户
本页面提供在宿主机直接运行 Arkanis 的方式，适用于无法使用 Docker 的环境或需要更快迭代的开发机。
生产环境仍建议优先使用 Docker 部署，以避免 Chromium/系统依赖差异导致的渲图问题。
:::

## 前置条件

- Node.js >= 18（建议 20）
- pnpm（建议 9+）
- git（可选：如果你需要拉取仓库）

## 获取代码

如果你还没有仓库：

```bash
git clone https://github.com/your-org/arkanis.git
cd arkanis
```

如果你已经在项目目录内，可跳过本步骤。

## 安装依赖

在项目根目录执行：

```bash
pnpm install
```

> 说明：项目依赖 `puppeteer`/`sharp`/`better-sqlite3`，首次安装可能耗时较长（会下载 Chromium 或编译原生模块）。

## 准备配置（.env）

复制示例配置并按需修改：

### Linux / macOS

```bash
cp .env.example .env
```

非 Docker 运行时，建议至少补齐两项：

1. 设置 `PORT`（注意这不是 `ARKANIS_PORT`）
2. 设置 `SECRETS_ENC_KEY`（用于 secrets 加密存储，建议随机长字符串）

你可以直接编辑 `.env`，在末尾追加：

```
PORT=8082
SECRETS_ENC_KEY=<随机长字符串>
```

生成随机值时，优先用 Node（跨平台）：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Windows (PowerShell)

```powershell
Copy-Item .env.example .env
```

然后用文本编辑器打开 `.env`，补齐 `PORT` 与 `SECRETS_ENC_KEY`（可用上面的 Node 命令生成）。

## 启动方式 A：构建前端，由 Server 提供静态文件（推荐）

这种方式只需要一个端口（默认 `8082`）：

```bash
pnpm -C src/apps/web build
pnpm -C src/apps/server start
```

然后访问：

- `http://localhost:8082`

首次启动时，终端会输出初始化入口（仅首次有效）：

```
/_setup/<token>
```

## 启动方式 B：前后端分离（开发调试）

如果你希望 Web 控制台热更新：

```bash
# 终端 1：启动后端（API + Socket）
pnpm -C src/apps/server start

# 终端 2：启动前端开发服务器（默认 5173）
pnpm -C src/apps/web dev
```

访问前端：

- `http://localhost:5173`

默认情况下后端允许 `localhost/127.0.0.1` 的跨域来源；如果你用局域网 IP 访问，需要在 `.env` 中设置 `CORS_ORIGINS`。

## 搜索栈（圆桌新闻管线）

在非 Docker 环境下，推荐走外置 API：

- Tavily：在控制台或环境变量中配置 `TAVILY_API_KEY`
- Jina：在控制台或环境变量中配置 `JINA_API_KEY`

如果你仍然可以使用 Docker（只是不想把主服务放在容器里），也可以单独用 `deploy/searxng-firecrawl/stack.sh` 启动搜索栈。

## 常见问题

### 浏览器渲图失败（Puppeteer）

不同系统的 Chromium 依赖不一致。优先检查 `.env.example` 里提供的 Puppeteer 配置项，例如：

- `CHART_PUPPETEER_CHANNEL=chrome`（macOS 可优先尝试）
- `CHART_PUPPETEER_EXECUTABLE_PATH=...`（显式指定 Chrome 路径）

### 数据目录不可写

服务会把管理员信息、secrets 等写入 `ARKANIS_DATA_DIR`（默认 `./data`）。如果你希望换位置，可在 `.env` 中设置：

```
ARKANIS_DATA_DIR=/absolute/path/to/data
```
