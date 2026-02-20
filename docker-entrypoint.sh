#!/usr/bin/env sh
set -eu

APP_USER="${APP_USER:-appuser}"
APP_GROUP="${APP_GROUP:-appgroup}"

ensure_writable_dir() {
  dir="$1"
  mkdir -p "$dir"

  if [ "$(id -u)" -ne 0 ]; then
    return 0
  fi

  if gosu "$APP_USER:$APP_GROUP" sh -c "test -w '$dir'" 2>/dev/null; then
    return 0
  fi

  chown -R "$APP_USER:$APP_GROUP" "$dir"

  if ! gosu "$APP_USER:$APP_GROUP" sh -c "test -w '$dir'" 2>/dev/null; then
    echo "[ERR] 目录不可写: $dir" >&2
    ls -ld "$dir" >&2 || true
    exit 1
  fi
}

DATA_DIR="${ARKANIS_DATA_DIR:-/data}"
ensure_writable_dir "$DATA_DIR"
ensure_writable_dir "/app/outputs"

if [ "$(id -u)" -eq 0 ]; then
  exec gosu "$APP_USER:$APP_GROUP" "$@"
fi

exec "$@"
