import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import chokidar from 'chokidar';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { config as dotenvConfig } from 'dotenv';

import PromptManager from '../../core/vlm/promptManager.js';
import {
    buildBinanceUrl,
    buildDecisionMessageHtml,
    buildTradingViewUrl,
    TelegramClient,
} from '../../core/services/telegram/index.js';

import { registerHttpMiddleware } from './middleware/http.js';
import { registerChartDataRoutes } from './routes/chartData.js';
import { registerConfigRoutes } from './routes/config.js';
import { registerPromptRoutes } from './routes/prompts.js';
import { registerProviderRoutes } from './routes/providers.js';
import { registerScriptRoutes } from './routes/script.js';
import { registerTelegramRoutes } from './routes/telegram.js';

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

registerHttpMiddleware({ app, projectRoot: PROJECT_ROOT });

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
registerTelegramRoutes({
    app,
    TelegramClient,
    buildTradingViewUrl,
    buildBinanceUrl,
    buildDecisionMessageHtml,
});

function setupConfigWatcher({ io, projectRoot }) {
    const envPath = join(projectRoot, '.env');
    const bridgeConfigPath = join(projectRoot, 'bridge.config.json');
    const providersPath = join(projectRoot, 'ai-providers.json');

    const watcher = chokidar.watch([envPath, bridgeConfigPath, providersPath], {
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
