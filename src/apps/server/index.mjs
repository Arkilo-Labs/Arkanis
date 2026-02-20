import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import chokidar from 'chokidar';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { config as dotenvConfig } from 'dotenv';

import PromptManager from '../../core/lens/promptManager.js';
import {
    buildBinanceUrl,
    buildDecisionMessageHtml,
    buildTradingViewUrl,
    TelegramClient,
} from '../../core/services/telegram/index.js';

import { registerAuthMiddleware } from './middleware/auth.js';
import { registerHttpMiddleware, registerSpaFallback, registerStaticMiddleware } from './middleware/http.js';
import { registerChartDataRoutes } from './routes/chartData.js';
import { registerConfigRoutes } from './routes/config.js';
import { registerPromptRoutes } from './routes/prompts.js';
import { registerProviderRoutes } from './routes/providers.js';
import { registerProviderSecretRoutes } from './routes/providerSecrets.js';
import { registerProviderConfigRoutes } from './routes/providerConfig.js';
import { registerWebToolsRoutes } from './routes/webTools.js';
import { registerScriptRoutes } from './routes/script.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerSetupRoutes } from './routes/setup.js';
import { registerTelegramRoutes } from './routes/telegram.js';
import { registerRoundtableRoutes } from './routes/roundtable.js';
import { initAuthService } from './services/authService.js';
import { resolveDataDir } from '../../core/utils/dataDir.js';
import { SOCKET_EVENTS } from './socket/events.js';
import { registerSocketHandlers } from './socket/registerSocketHandlers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..', '..', '..');

dotenvConfig({ path: join(PROJECT_ROOT, '.env') });

function resolveCorsOrigin() {
    const raw = (process.env.CORS_ORIGINS || process.env.SOCKET_CORS_ORIGINS || '').trim();
    if (raw === '*') return '*';
    if (!raw) return [/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

const corsOrigin = resolveCorsOrigin();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: corsOrigin,
        methods: ['GET', 'POST'],
    },
});

registerHttpMiddleware({ app, corsOrigin });

let authService = null;
try {
    authService = await initAuthService({ projectRoot: PROJECT_ROOT });
} catch (error) {
    console.error(error?.message || String(error));
    process.exit(1);
}

registerAuthMiddleware({ app, io, authService });
registerStaticMiddleware({ app, projectRoot: PROJECT_ROOT });

const activeProcesses = new Map();
const sessionChartData = new Map();

registerSocketHandlers({ io, activeProcesses });

registerScriptRoutes({ app, io, projectRoot: PROJECT_ROOT, activeProcesses });
registerRoundtableRoutes({ app, io, projectRoot: PROJECT_ROOT, activeProcesses });
registerPromptRoutes({ app, PromptManager });
registerChartDataRoutes({ app, sessionChartData });
registerConfigRoutes({ app, projectRoot: PROJECT_ROOT });
registerProviderRoutes({ app, io, projectRoot: PROJECT_ROOT });
registerProviderSecretRoutes({ app, io, projectRoot: PROJECT_ROOT });
registerProviderConfigRoutes({ app, io, projectRoot: PROJECT_ROOT });
registerWebToolsRoutes({ app, io, projectRoot: PROJECT_ROOT });
registerAuthRoutes({ app, authService });
registerSetupRoutes({ app, authService });
registerTelegramRoutes({
    app,
    TelegramClient,
    buildTradingViewUrl,
    buildBinanceUrl,
    buildDecisionMessageHtml,
});

// SPA fallback 必须在所有 API 路由之后注册
registerSpaFallback({ app, projectRoot: PROJECT_ROOT });

function setupConfigWatcher({ io, projectRoot }) {
    const envPath = join(projectRoot, '.env');
    const dataDir = resolveDataDir({ projectRoot });
    const providersPath = join(dataDir, 'ai-providers.json');
    const secretsPath = join(dataDir, 'secrets.json');
    const providerConfigPath = join(dataDir, 'provider-config.json');

    const watcher = chokidar.watch([envPath, providersPath, secretsPath, providerConfigPath], {
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: {
            stabilityThreshold: 300,
            pollInterval: 100,
        },
    });

    watcher.on('change', (path) => {
        const filename = String(path).split(/[/\\]/).pop();
        console.log(`[Config Hot Reload] 检测到配置文件变更: ${filename}`);
        io.emit(SOCKET_EVENTS.CONFIG_RELOAD, { file: filename, timestamp: Date.now() });
    });

    watcher.on('error', (error) => {
        console.error(`[Config Watcher] Error: ${error.message}`);
    });

    return watcher;
}

if (authService.allowNoAuth) {
    console.warn('[Security Warning] ALLOW_NO_AUTH is enabled — authentication is disabled. Do NOT use in production.');
}

const PORT = process.env.PORT || 3000;
const BIND_IP = process.env.BIND_IP || '127.0.0.1';
httpServer.listen(PORT, BIND_IP, () => {
    console.log(`Server running on http://${BIND_IP}:${PORT}`);
    setupConfigWatcher({ io, projectRoot: PROJECT_ROOT });
    console.log('[Config Hot Reload] 配置文件监听已启动');
});
