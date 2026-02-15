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
import { registerHttpMiddleware, registerStaticMiddleware } from './middleware/http.js';
import { registerChartDataRoutes } from './routes/chartData.js';
import { registerConfigRoutes } from './routes/config.js';
import { registerPromptRoutes } from './routes/prompts.js';
import { registerProviderRoutes } from './routes/providers.js';
import { registerProviderSecretRoutes } from './routes/providerSecrets.js';
import { registerProviderConfigRoutes } from './routes/providerConfig.js';
import { registerScriptRoutes } from './routes/script.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerSetupRoutes } from './routes/setup.js';
import { registerTelegramRoutes } from './routes/telegram.js';
import { initAuthService } from './services/authService.js';
import { resolveDataDir } from '../../core/utils/dataDir.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..', '..', '..');

dotenvConfig({ path: join(PROJECT_ROOT, '.env') });

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
    },
});

registerHttpMiddleware({ app });

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

io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });

    socket.on('kill-process', (pid) => {
        if (!activeProcesses.has(pid)) return;
        const child = activeProcesses.get(pid);
        try {
            child.kill();
        } catch {
            // 忽略
        }
        activeProcesses.delete(pid);
        socket.emit('process-killed', pid);
    });
});

registerScriptRoutes({ app, io, projectRoot: PROJECT_ROOT, activeProcesses });
registerPromptRoutes({ app, PromptManager });
registerChartDataRoutes({ app, sessionChartData });
registerConfigRoutes({ app, projectRoot: PROJECT_ROOT });
registerProviderRoutes({ app, io, projectRoot: PROJECT_ROOT });
registerProviderSecretRoutes({ app, io, projectRoot: PROJECT_ROOT });
registerProviderConfigRoutes({ app, io, projectRoot: PROJECT_ROOT });
registerAuthRoutes({ app, authService });
registerSetupRoutes({ app, authService });
registerTelegramRoutes({
    app,
    TelegramClient,
    buildTradingViewUrl,
    buildBinanceUrl,
    buildDecisionMessageHtml,
});

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
        io.emit('config-reload', { file: filename, timestamp: Date.now() });
    });

    watcher.on('error', (error) => {
        console.error(`[Config Watcher] Error: ${error.message}`);
    });

    return watcher;
}

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    setupConfigWatcher({ io, projectRoot: PROJECT_ROOT });
    console.log('[Config Hot Reload] 配置文件监听已启动');
});
