# 本地源码部署（Docker）

::: info 面向开发者
本页面说明如何使用 `--local` 参数将本地源码部署到 Docker 环境，适用于开发调试、PR 验证、VM 测试等场景。普通用户请参考[快速开始](/guide/getting-started)。
:::

## 前置条件

- Docker 已安装且正在运行
- Docker Compose v2（`docker compose`）可用
- curl、git 已安装（git 在 `--local` 模式下非必需）

## 使用方式

### Linux / macOS

```bash
./install.sh --local <源码路径> [--dir <安装目录>] [-y]
```

### Windows (PowerShell)

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1 -Local <源码路径> [-Dir <安装目录>] [-Yes]
```

### 参数说明

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--local` / `-Local` | 本地源码目录路径 | 无（使用 git clone） |
| `--dir` / `-Dir` | 目标安装目录 | `./arkanis` |
| `-y` / `-Yes` | 非交互模式，全部使用默认值 | 关闭 |

## 典型场景

### 1. 开发机上部署到本地 Docker

在项目根目录下执行，将当前代码部署到 `./deploy-test`：

```bash
./install.sh --local . --dir ./deploy-test
```

### 2. 部署到 OrbStack / 远程 VM

假设你在 macOS 上开发，想把代码部署到 OrbStack 中的 Linux VM：

```bash
# 1. 将源码复制到 VM（以 OrbStack 为例，VM 名为 arkanis）
scp -r . arkanis@orb:/home/arkanis/src

# 2. SSH 进入 VM
ssh arkanis@orb

# 3. 使用 --local 从复制的源码安装
./src/install.sh --local ./src --dir /opt/arkanis
```

或者，如果 VM 可以直接访问宿主机的文件系统（OrbStack 默认挂载 `/Users`）：

```bash
ssh arkanis@orb
/Users/<你的用户名>/path/to/arkanis/install.sh \
  --local /Users/<你的用户名>/path/to/arkanis \
  --dir /opt/arkanis
```

### 3. 非交互模式（CI/脚本化）

跳过所有交互提示，使用默认配置：

```bash
./install.sh --local /path/to/source --dir /opt/arkanis -y
```

## 工作原理

`--local` 模式下，安装脚本的行为与标准安装完全一致，区别仅在于**获取源码**的方式：

| 步骤 | 标准模式 | `--local` 模式 |
|------|----------|----------------|
| 获取源码 | `git clone --depth 1` | 复制本地目录（rsync 优先，回退 cp） |
| 排除内容 | N/A | `.git`、`node_modules`、`data`、`.env`、`outputs` |
| 后续流程 | 生成 .env → 搜索栈 → compose up | 完全相同 |

复制时会自动排除以下目录/文件，确保目标环境干净：
- `.git` — 不需要版本历史
- `node_modules` — 容器内重新安装
- `data` — 运行时数据由 Docker volume 管理
- `.env` — 从 `.env.example` 重新生成
- `outputs` — 运行时产出

## 常见问题

### 修改代码后如何重新部署？

重新运行安装命令即可。脚本会提示目标目录已存在，确认覆盖后重新构建：

```bash
./install.sh --local . --dir ./deploy-test
# 提示：目录已存在: ./deploy-test
# 输入 y 确认覆盖
```

如果只想重新构建容器而不重新复制源码：

```bash
cd ./deploy-test
docker compose up -d --build
```

### 端口被占用？

编辑目标目录中的 `.env`，修改 `ARKANIS_PORT`：

```bash
# 在目标安装目录中
sed -i 's/^ARKANIS_PORT=.*/ARKANIS_PORT=9090/' .env
docker compose up -d
```

### 健康检查超时？

查看容器日志排查问题：

```bash
docker compose logs arkanis
```
