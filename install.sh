#!/usr/bin/env bash
set -euo pipefail

# ── 常量 ─────────────────────────────────────────────────────────────────────

REPO_URL="https://github.com/your-org/arkanis.git"
DEFAULT_INSTALL_DIR="./arkanis"
DEFAULT_PORT=8082
HEALTH_TIMEOUT=180   # 等待 server 健康的最大秒数
HEALTH_INTERVAL=5

# ── 工具函数 ──────────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

info()    { echo -e "${CYAN}[INFO]${RESET} $*"; }
success() { echo -e "${GREEN}[OK]${RESET}   $*"; }
warn()    { echo -e "${YELLOW}[WARN]${RESET} $*"; }
die()     { echo -e "${RED}[ERR]${RESET}  $*" >&2; exit 1; }

need_cmd() {
    command -v "$1" >/dev/null 2>&1 || die "未找到命令: $1"
}

random_hex() {
    local bytes="${1:-32}"
    if command -v openssl >/dev/null 2>&1; then
        openssl rand -hex "$bytes"
        return
    fi
    if command -v python3 >/dev/null 2>&1; then
        python3 -c "import secrets; print(secrets.token_hex($bytes))"
        return
    fi
    if command -v node >/dev/null 2>&1; then
        node -e "console.log(require('crypto').randomBytes($bytes).toString('hex'))"
        return
    fi
    die "无法生成随机值：需要 openssl、python3 或 node 之一"
}

update_env_kv() {
    local key="$1" value="$2" file="$3"
    local tmp
    tmp="$(mktemp)"
    trap 'rm -f "$tmp"' RETURN
    if grep -qE "^${key}=" "$file" 2>/dev/null; then
        awk -v k="$key" -v v="$value" \
            '$0 ~ ("^" k "=") { print k "=" v; next } { print }' \
            "$file" >"$tmp"
    else
        cat "$file" >"$tmp"
        printf "\n%s=%s\n" "$key" "$value" >>"$tmp"
    fi
    mv "$tmp" "$file"
}

compose() {
    if docker compose version >/dev/null 2>&1; then
        docker compose "$@"
        return
    fi
    if command -v docker-compose >/dev/null 2>&1; then
        docker-compose "$@"
        return
    fi
    die "未找到 docker compose（需要 Docker Compose v2 或 docker-compose v1）"
}

# ── 参数解析 ──────────────────────────────────────────────────────────────────

LOCAL_SRC=""
INSTALL_DIR=""
YES=false

usage() {
    cat <<USAGE
用法：
  ./install.sh [选项]

选项：
  --local <path>   从本地目录复制项目（测试用，跳过 git clone）
  --dir   <path>   安装目录（默认：$DEFAULT_INSTALL_DIR）
  -y, --yes        非交互模式，全部使用默认值
  -h, --help       显示此帮助

示例：
  ./install.sh
  ./install.sh --dir /opt/arkanis -y
  ./install.sh --local /path/to/local/arkanis --dir /opt/arkanis
USAGE
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --local)
            [[ -n "${2:-}" ]] || die "--local 需要一个路径参数"
            LOCAL_SRC="$2"; shift 2 ;;
        --dir)
            [[ -n "${2:-}" ]] || die "--dir 需要一个路径参数"
            INSTALL_DIR="$2"; shift 2 ;;
        -y|--yes)
            YES=true; shift ;;
        -h|--help)
            usage; exit 0 ;;
        *)
            die "未知参数: $1（使用 --help 查看帮助）" ;;
    esac
done

[[ -z "$INSTALL_DIR" ]] && INSTALL_DIR="$DEFAULT_INSTALL_DIR"

# ── 前置检查 ──────────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}Arkanis 安装向导${RESET}"
echo "────────────────────────────────────────"
echo ""

need_cmd docker

if ! docker info >/dev/null 2>&1; then
    die "Docker daemon 未运行，请先启动 Docker"
fi

if ! docker compose version >/dev/null 2>&1 && ! command -v docker-compose >/dev/null 2>&1; then
    die "未找到 docker compose，请安装 Docker Compose v2"
fi

if [[ -z "$LOCAL_SRC" ]]; then
    need_cmd git
fi

need_cmd curl

success "前置检查通过"

# ── 获取代码 ──────────────────────────────────────────────────────────────────

echo ""
info "目标安装目录: $INSTALL_DIR"

if [[ -d "$INSTALL_DIR" ]]; then
    warn "目录已存在: $INSTALL_DIR"
    if [[ "$YES" == false ]]; then
        read -rp "是否继续并覆盖？[y/N] " _confirm
        [[ "$_confirm" =~ ^[yY]$ ]] || { info "已取消"; exit 0; }
    fi
fi

if [[ -n "$LOCAL_SRC" ]]; then
    info "从本地路径复制: $LOCAL_SRC"
    [[ -d "$LOCAL_SRC" ]] || die "本地路径不存在: $LOCAL_SRC"

    mkdir -p "$INSTALL_DIR"

    # rsync 优先，回退到 cp
    if command -v rsync >/dev/null 2>&1; then
        rsync -a \
            --exclude='.git' \
            --exclude='node_modules' \
            --exclude='data' \
            --exclude='.env' \
            --exclude='outputs' \
            "$LOCAL_SRC/" "$INSTALL_DIR/"
    else
        # cp 方案：先整体复制再删除不需要的
        cp -r "$LOCAL_SRC/." "$INSTALL_DIR/"
        rm -rf \
            "$INSTALL_DIR/.git" \
            "$INSTALL_DIR/node_modules" \
            "$INSTALL_DIR/data" \
            "$INSTALL_DIR/.env" \
            "$INSTALL_DIR/outputs" 2>/dev/null || true
    fi
    success "本地复制完成"
else
    info "从远端克隆: $REPO_URL"
    git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
    success "克隆完成"
fi

# ── 准备 .env ─────────────────────────────────────────────────────────────────

cd "$INSTALL_DIR"

ENV_FILE=".env"
ENV_EXAMPLE=".env.example"

if [[ ! -f "$ENV_FILE" ]]; then
    [[ -f "$ENV_EXAMPLE" ]] || die "缺少 .env.example，仓库可能不完整"
    cp "$ENV_EXAMPLE" "$ENV_FILE"
    info "已从 .env.example 生成 .env"
else
    info ".env 已存在，跳过生成"
fi

# 自动填入随机加密 key（若为空）
CURRENT_ENC_KEY="$(grep -E '^SECRETS_ENC_KEY=' "$ENV_FILE" | cut -d'=' -f2 | tr -d ' ' || true)"
if [[ -z "$CURRENT_ENC_KEY" ]]; then
    NEW_ENC_KEY="$(random_hex 32)"
    update_env_kv "SECRETS_ENC_KEY" "$NEW_ENC_KEY" "$ENV_FILE"
    info "已生成 SECRETS_ENC_KEY"
fi

# ── 选择搜索栈 ────────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}搜索栈配置${RESET}"
echo "────────────────────────────────────────"
echo "  圆桌新闻管线依赖本地搜索服务，或外置的 Tavily / Jina API Key。"
echo "  Lens 分析不依赖任何搜索服务。"
echo ""
echo "  0) 跳过（稍后手动配置外置 Tavily / Jina）"
echo "  1) 部署 SearXNG + Firecrawl（推荐，功能完整）"
echo "  2) 仅部署 SearXNG（轻量，仅搜索，抓取需另配 Jina）"
echo ""

SEARCH_CHOICE=""
if [[ "$YES" == true ]]; then
    SEARCH_CHOICE="0"
    info "非交互模式：跳过搜索栈部署（选 0）"
else
    while true; do
        read -rp "请选择 [0-2]（默认 0）: " SEARCH_CHOICE
        SEARCH_CHOICE="${SEARCH_CHOICE:-0}"
        [[ "$SEARCH_CHOICE" =~ ^[0-2]$ ]] && break
        warn "请输入 0、1 或 2"
    done
fi

SEARCH_STACK_INSTALLED=false
SEARXNG_URL="http://localhost:8080"
FIRECRAWL_URL="http://localhost:3002"
AGENTS_JSON="src/agents/agents-round/config/agents.json"

deploy_search_stack() {
    local stack_script="deploy/searxng-firecrawl/stack.sh"
    [[ -f "$stack_script" ]] || die "未找到搜索栈脚本: $stack_script"
    bash "$stack_script" up
}

# 更新 agents.json 中的 search/fetch provider 设置
update_agents_provider() {
    local search_provider="$1" fetch_provider="$2"
    [[ -f "$AGENTS_JSON" ]] || { warn "未找到 $AGENTS_JSON，跳过 provider 写入"; return; }

    if command -v node >/dev/null 2>&1; then
        node -e "
const fs=require('fs'),f='$AGENTS_JSON';
const d=JSON.parse(fs.readFileSync(f,'utf-8'));
const s=d.news_pipeline_settings||(d.news_pipeline_settings={});
s.search_provider='$search_provider';
s.fetch_provider='$fetch_provider';
fs.writeFileSync(f,JSON.stringify(d,null,2)+'\n');
"
    elif command -v python3 >/dev/null 2>&1; then
        python3 -c "
import json
f='$AGENTS_JSON'
with open(f) as r: d=json.load(r)
s=d.setdefault('news_pipeline_settings',{})
s['search_provider']='$search_provider'
s['fetch_provider']='$fetch_provider'
with open(f,'w') as w: json.dump(d,w,indent=2,ensure_ascii=False); w.write('\n')
"
    else
        # 兜底：sed 文本替换（仅在 node/python3 均不可用时）
        local tmp
        tmp="$(mktemp)"
        trap 'rm -f "$tmp"' RETURN
        sed \
            -e "s/\"search_provider\":[[:space:]]*\"[^\"]*\"/\"search_provider\": \"$search_provider\"/" \
            -e "s/\"fetch_provider\":[[:space:]]*\"[^\"]*\"/\"fetch_provider\": \"$fetch_provider\"/" \
            "$AGENTS_JSON" >"$tmp"
        mv "$tmp" "$AGENTS_JSON"
    fi
    info "已将 agents.json provider 设为：search=$search_provider, fetch=$fetch_provider"
}

case "$SEARCH_CHOICE" in
    1)
        info "部署 SearXNG + Firecrawl..."
        deploy_search_stack
        SEARCH_STACK_INSTALLED=true
        update_agents_provider "searxng" "firecrawl"
        success "搜索栈部署完成"
        ;;
    2)
        info "仅部署 SearXNG..."
        local_compose_file="deploy/searxng-firecrawl/compose.yml"
        [[ -f "$local_compose_file" ]] || die "未找到: $local_compose_file"

        # 确保 searxng 子栈的 .env 就绪（复用 stack.sh 的 ensure_env 逻辑）
        local_stack_script="deploy/searxng-firecrawl/stack.sh"
        # 只初始化环境，不启动全量服务
        bash "$local_stack_script" up 2>/dev/null || true
        compose -f "$local_compose_file" stop firecrawl-api playwright-service rabbitmq nuq-postgres 2>/dev/null || true
        compose -f "$local_compose_file" up -d redis searxng
        SEARCH_STACK_INSTALLED=true
        FIRECRAWL_URL=""
        update_agents_provider "searxng" "jina"
        success "SearXNG 部署完成"
        ;;
    0|*)
        info "跳过搜索栈部署"
        ;;
esac

# 将搜索服务地址写入 .env（仅在已部署时）
if [[ "$SEARCH_STACK_INSTALLED" == true ]]; then
    update_env_kv "SEARXNG_URL" "$SEARXNG_URL" "$ENV_FILE"
    [[ -n "$FIRECRAWL_URL" ]] && update_env_kv "FIRECRAWL_URL" "$FIRECRAWL_URL" "$ENV_FILE"
fi

# ── 构建并启动主栈 ────────────────────────────────────────────────────────────

echo ""
info "构建并启动 Arkanis..."
compose up -d --build

# ── 等待 server 健康 ──────────────────────────────────────────────────────────

echo ""
info "等待 server 就绪（最多 ${HEALTH_TIMEOUT}s）..."

PORT_FOR_CHECK="$(grep -E '^ARKANIS_PORT=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d'=' -f2 | tr -d '[:space:]' || true)"
PORT_FOR_CHECK="${PORT_FOR_CHECK:-$DEFAULT_PORT}"
ELAPSED=0
until curl -so /dev/null -w '%{http_code}' "http://localhost:${PORT_FOR_CHECK}/api/auth/me" 2>/dev/null | grep -qE '^[2-4]'; do
    if [[ "$ELAPSED" -ge "$HEALTH_TIMEOUT" ]]; then
        warn "server 启动超时，请手动检查："
        warn "  docker compose logs arkanis"
        break
    fi
    printf "."
    sleep "$HEALTH_INTERVAL"
    ELAPSED=$(( ELAPSED + HEALTH_INTERVAL ))
done
echo ""

# ── 读取 setup token ──────────────────────────────────────────────────────────

SETUP_TOKEN=""
SETUP_TOKEN="$(compose logs arkanis 2>&1 | grep -oE '_setup/[^[:space:]]+' | tail -1 | sed 's|_setup/||' || true)"

HOST_IP="localhost"

# ── 输出安装结果 ──────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}────────────────────────────────────────${RESET}"
echo -e "${GREEN}${BOLD}安装完成！${RESET}"
echo -e "${BOLD}────────────────────────────────────────${RESET}"
echo ""
echo -e "  访问地址: ${CYAN}http://${HOST_IP}:${PORT_FOR_CHECK}${RESET}"
echo ""

if [[ -n "$SETUP_TOKEN" ]]; then
    echo -e "  ${BOLD}管理员初始化 URL（仅首次有效）：${RESET}"
    echo -e "  ${CYAN}http://${HOST_IP}:${PORT_FOR_CHECK}/_setup/${SETUP_TOKEN}${RESET}"
else
    echo -e "  ${YELLOW}未能自动获取 setup token，请运行以下命令查看：${RESET}"
    echo -e "    docker compose logs arkanis | grep _setup"
fi

echo ""

if [[ "$SEARCH_STACK_INSTALLED" == false ]]; then
    echo -e "${YELLOW}${BOLD}注意：您未部署本地搜索栈。${RESET}"
    echo -e "  圆桌新闻管线目前不可用。"
    echo -e "  完成管理员配置后，请在「系统设置」中填入以下 API Key 之一："
    echo -e "    - Tavily（https://app.tavily.com）→ TAVILY_API_KEY"
    echo -e "    - Jina  （https://jina.ai）        → JINA_API_KEY"
    echo -e "  Lens 分析功能不受影响，可正常使用。"
    echo ""
fi

echo -e "${BOLD}────────────────────────────────────────${RESET}"
echo ""
