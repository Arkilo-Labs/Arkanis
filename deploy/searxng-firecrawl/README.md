# SearXNG + Firecrawl（独立一键栈）

这个目录是一个“可拷走复用”的独立部署栈：不依赖仓库根目录的 `docker-compose.yml`，用到时再启动即可。

## 端口（默认）

- SearXNG：`http://localhost:8080`
- Firecrawl：`http://localhost:3002`

两者默认都只绑定到 `127.0.0.1`，避免在服务器上误暴露；如需对外提供服务，请自行放到反代后面并加鉴权。

## 一键启动

macOS / Linux：

```bash
bash ./deploy/searxng-firecrawl/stack.sh up
```

Windows PowerShell：

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\searxng-firecrawl\stack.ps1 up
```

首次启动会：

- 生成 `deploy/searxng-firecrawl/.env`
- 自动填充 `BULL_AUTH_KEY`
- 如果 `searxng/settings.yml` 还是占位 `ultrasecretkey`，会自动替换为随机值

## 如果拉取镜像报 denied（GHCR）

你刚遇到的报错属于这一类（例如：`ghcr.io/... denied`）。本栈默认用的 Firecrawl 官方镜像是 Public，正常不需要登录；如果依旧 denied，优先按顺序试：

```bash
docker logout ghcr.io
```

再重试一键启动。如果你确实需要登录（例如公司策略要求），再执行：

```bash
docker login ghcr.io
```

建议用 GitHub classic token，并勾选 `read:packages`。

如果你所在网络环境无法访问 GHCR，可以在 `deploy/searxng-firecrawl/.env` 覆盖镜像地址（公司内部镜像仓库/自建 registry 均可）：

```bash
FIRECRAWL_IMAGE=你的镜像仓库/firecrawl:tag
PLAYWRIGHT_IMAGE=你的镜像仓库/playwright-service:tag
NUQ_POSTGRES_IMAGE=你的镜像仓库/nuq-postgres:tag
```

## 停止

```bash
bash ./deploy/searxng-firecrawl/stack.sh down
```

## 与本项目代码对齐

本项目 `TradeRoundtable` 默认读取：

- SearXNG：`http://localhost:8080`
- Firecrawl：`http://localhost:3002`

因此保持默认端口时，通常不需要改配置即可直接启用新闻管线。
