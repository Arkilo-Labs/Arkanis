#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"
ENV_EXAMPLE_FILE="$SCRIPT_DIR/.env.example"
SEARXNG_SETTINGS_FILE="$SCRIPT_DIR/searxng/settings.yml"

die() {
  echo "错误：$*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "未找到命令：$1"
}

random_hex() {
  local bytes="${1:-32}"
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$bytes"
    return 0
  fi
  if command -v python3 >/dev/null 2>&1; then
    python3 - <<PY
import secrets
print(secrets.token_hex($bytes))
PY
    return 0
  fi
  if command -v node >/dev/null 2>&1; then
    node -e "console.log(require('crypto').randomBytes($bytes).toString('hex'))"
    return 0
  fi
  die "无法生成随机值：缺少 openssl/python3/node 之一"
}

update_env_kv() {
  local key="$1"
  local value="$2"
  local file="$3"

  local tmp
  tmp="$(mktemp)"
  if grep -qE "^${key}=" "$file"; then
    awk -v k="$key" -v v="$value" '
      BEGIN { updated=0 }
      $0 ~ ("^" k "=") { print k "=" v; updated=1; next }
      { print }
      END { if (updated==0) print k "=" v }
    ' "$file" >"$tmp"
  else
    cat "$file" >"$tmp"
    printf "\n%s=%s\n" "$key" "$value" >>"$tmp"
  fi
  mv "$tmp" "$file"
}

update_settings_yml() {
  local searxng_port="$1"
  local secret_key="$2" # 为空则不改 secret_key
  local file="$3"

  local tmp
  tmp="$(mktemp)"
  awk -v port="$searxng_port" -v secret="$secret_key" '
    /^[[:space:]]*secret_key:[[:space:]]*/ {
      if (secret != "") { print "  secret_key: \"" secret "\""; next }
    }
    /^[[:space:]]*base_url:[[:space:]]*/ { print "  base_url: \"http://localhost:" port "/\""; next }
    { print }
  ' "$file" >"$tmp"
  mv "$tmp" "$file"
}

ensure_env() {
  if [[ ! -f "$ENV_FILE" ]]; then
    [[ -f "$ENV_EXAMPLE_FILE" ]] || die "缺少文件：$ENV_EXAMPLE_FILE"
    cp "$ENV_EXAMPLE_FILE" "$ENV_FILE"
  fi

  # shellcheck disable=SC1090
  set -a
  source "$ENV_FILE"
  set +a

  local bull="${BULL_AUTH_KEY:-}"
  if [[ -z "$bull" || "$bull" == "CHANGEME" ]]; then
    bull="$(random_hex 32)"
    update_env_kv "BULL_AUTH_KEY" "$bull" "$ENV_FILE"
  fi

  local port="${SEARXNG_PORT:-8080}"
  if [[ ! "$port" =~ ^[0-9]+$ ]]; then
    die "SEARXNG_PORT 不是合法端口：$port"
  fi

  local new_secret=""
  if grep -q 'secret_key:[[:space:]]*\"ultrasecretkey\"' "$SEARXNG_SETTINGS_FILE" 2>/dev/null; then
    new_secret="$(random_hex 32)"
  fi
  update_settings_yml "$port" "$new_secret" "$SEARXNG_SETTINGS_FILE"
}

cmd="${1:-}"
shift || true

need_cmd docker

ghcr_auth_help() {
  cat >&2 <<'TXT'
提示：镜像拉取被拒绝（denied）时，常见原因是本机 GHCR 凭据异常或网络/镜像源受限。
说明：本栈默认使用的 Firecrawl 官方镜像是 Public（正常不需要登录）。

优先尝试：
  docker logout ghcr.io
  # 再重试 stack.sh up

如果你确实需要登录（例如公司策略要求），建议用 GitHub classic token 并勾选 read:packages：
  docker login ghcr.io

如果你无法访问 GHCR，可以在 deploy/searxng-firecrawl/.env 里覆盖镜像地址（公司镜像仓库/自建 registry 均可），例如：
  FIRECRAWL_IMAGE=你的镜像仓库/firecrawl:tag
  PLAYWRIGHT_IMAGE=你的镜像仓库/playwright-service:tag
  NUQ_POSTGRES_IMAGE=你的镜像仓库/nuq-postgres:tag
TXT
}

compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
    return 0
  fi
  if command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
    return 0
  fi
  die "未找到 docker compose（需要 Docker Compose v2 或 docker-compose v1）"
}

case "$cmd" in
  up)
    ensure_env
    cd "$SCRIPT_DIR"
    if ! compose -f compose.yml pull; then
      ghcr_auth_help
      exit 1
    fi
    compose -f compose.yml up -d "$@"
    ;;
  down)
    cd "$SCRIPT_DIR"
    compose -f compose.yml down "$@"
    ;;
  restart)
    cd "$SCRIPT_DIR"
    compose -f compose.yml restart "$@"
    ;;
  ps)
    cd "$SCRIPT_DIR"
    compose -f compose.yml ps "$@"
    ;;
  logs)
    cd "$SCRIPT_DIR"
    compose -f compose.yml logs -f --tail=200 "$@"
    ;;
  pull)
    cd "$SCRIPT_DIR"
    if ! compose -f compose.yml pull "$@"; then
      ghcr_auth_help
      exit 1
    fi
    ;;
  *)
    cat >&2 <<'USAGE'
用法：
  ./deploy/searxng-firecrawl/stack.sh up        # 一键启动（自动生成 .env 与密钥）
  ./deploy/searxng-firecrawl/stack.sh down      # 停止并清理容器（保留数据卷）
  ./deploy/searxng-firecrawl/stack.sh logs      # 追踪日志
  ./deploy/searxng-firecrawl/stack.sh ps        # 查看状态
  ./deploy/searxng-firecrawl/stack.sh pull      # 拉取镜像
USAGE
    exit 2
    ;;
esac
