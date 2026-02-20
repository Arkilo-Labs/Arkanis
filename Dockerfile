# ── Stage 1: 构建前端 ───────────────────────────────────────────────────────
FROM node:20-slim AS builder

RUN npm install -g pnpm@9

WORKDIR /app

# 先复制 workspace 清单，充分利用层缓存
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY src/apps/web/package.json ./src/apps/web/
COPY src/apps/server/package.json ./src/apps/server/

RUN pnpm install --frozen-lockfile

# 复制源码并构建 React 前端
COPY . .
RUN pnpm -C src/apps/web build

# ── Stage 2: 生产运行时 ─────────────────────────────────────────────────────
FROM node:20-slim AS runner

# Chromium 供 Puppeteer 渲图使用
RUN apt-get update && apt-get install -y \
    chromium \
    gosu \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    CHART_PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production \
    PORT=3000 \
    ARKANIS_DATA_DIR=/data

WORKDIR /app

# 从 builder 阶段复制所需产物
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src/apps/server/node_modules ./src/apps/server/node_modules
COPY --from=builder /app/src/apps/web/dist ./src/apps/web/dist

# 复制运行时需要的源码（不含 web 源码，只保留 server/core/agents/resources）
COPY src/apps/server ./src/apps/server
COPY src/core ./src/core
COPY src/agents ./src/agents
COPY src/cli ./src/cli
COPY src/resources ./src/resources
COPY src/index.js ./src/

COPY ai-providers.default.json ./
COPY docker-entrypoint.sh /usr/local/bin/arkanis-entrypoint

RUN groupadd --gid 1001 appgroup \
    && useradd --uid 1001 --gid appgroup --shell /bin/sh --create-home appuser \
    && mkdir -p /data /app/outputs \
    && chown -R appuser:appgroup /app /data \
    && chmod +x /usr/local/bin/arkanis-entrypoint

VOLUME ["/data", "/app/outputs"]

EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/arkanis-entrypoint"]

CMD ["node", "src/apps/server/index.mjs"]
