# 快速开始

## 前置条件

- 已安装 [Docker](https://docs.docker.com/get-docker/) 并确保 Docker 正在运行
- Docker Compose v2（`docker compose`）可用

## 安装

### Linux / macOS

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/your-org/arkanis/main/install.sh)
```

### Windows (PowerShell)

```powershell
irm https://raw.githubusercontent.com/your-org/arkanis/main/install.ps1 -OutFile install.ps1
powershell -ExecutionPolicy Bypass -File install.ps1
```

安装脚本会自动完成以下步骤：

1. 克隆仓库到本地
2. 生成 `.env` 配置文件
3. 选择搜索栈（可选）
4. 构建并启动 Docker 容器

## 初始化

安装完成后，终端会输出管理员初始化 URL（仅首次有效）：

```
http://localhost:8082/_setup/<token>
```

在浏览器中打开该链接，完成管理员账户创建。

## 配置 AI 模型

登录 Web 控制台后，进入「系统设置」：

1. **添加 Provider** — 填入你使用的 AI 服务商（如 OpenAI、Anthropic 等）的 API Key
2. **配置模型** — 选择用于 Lens 分析和圆桌讨论的模型

## 搜索栈（可选）

圆桌的新闻管线需要搜索服务支持。安装时可以选择：

| 选项 | 说明 |
|------|------|
| SearXNG + Firecrawl | 推荐，功能完整（本地搜索 + 网页抓取） |
| 仅 SearXNG | 新闻搜索，无网页抓取 |
| 仅 Firecrawl | 含内嵌 SearXNG |
| 跳过 | 稍后在设置中配置 Tavily / Jina API Key |

> Lens 视觉分析不依赖搜索栈，跳过后仍可正常使用。

## 常用操作

### 停止服务

```bash
cd arkanis && docker compose down
```

### 重新启动

```bash
cd arkanis && docker compose up -d
```

### 查看日志

```bash
cd arkanis && docker compose logs -f arkanis
```

### 修改端口

编辑安装目录中的 `.env`，修改 `ARKANIS_PORT` 后重启：

```bash
docker compose up -d
```
