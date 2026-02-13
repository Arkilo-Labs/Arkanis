import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import bodyParser from 'body-parser';
import chokidar from 'chokidar';
import { config as dotenvConfig } from 'dotenv';
import PromptManager from '../src/vlm/promptManager.js';
import {
    buildBinanceUrl,
    buildDecisionMessageHtml,
    buildTradingViewUrl,
    TelegramClient,
} from '../src/services/telegram/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

dotenvConfig({ path: join(PROJECT_ROOT, '.env') });

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
    },
});

app.use(cors());
app.use(bodyParser.json());

app.use('/outputs', express.static(join(PROJECT_ROOT, 'outputs')));
app.use('/verify-test', express.static(join(PROJECT_ROOT, 'web_verify_test')));

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

app.post('/api/run-script', (req, res) => {
    const script = String(req.body?.script || '').trim();
    const args = Array.isArray(req.body?.args) ? req.body.args.filter((a) => typeof a === 'string') : [];

    if (!['main', 'backtest'].includes(script)) {
        return res.status(400).json({ error: 'Invalid script name' });
    }

    const scriptPath = join(PROJECT_ROOT, 'scripts', `${script}.js`);
    const cmdArgs = [scriptPath, ...args];

    console.log(`Spawning: node ${cmdArgs.join(' ')}`);

    try {
        const child = spawn(process.execPath, cmdArgs, {
            cwd: PROJECT_ROOT,
            env: { ...process.env, FORCE_COLOR: '1' },
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        const pid = child.pid;
        if (pid) activeProcesses.set(pid, child);

        child.stdout.on('data', (data) => {
            const str = data.toString();
            io.emit('log', { type: 'stdout', data: str });
        });

        child.stderr.on('data', (data) => {
            const str = data.toString();
            io.emit('log', { type: 'stderr', data: str });
        });

        child.on('close', (code) => {
            io.emit('process-exit', { code, pid });
            if (pid) activeProcesses.delete(pid);
        });

        child.on('error', (err) => {
            io.emit('log', { type: 'error', data: `Failed to start process: ${err.message}` });
        });

        res.json({ pid });
    } catch (error) {
        res.status(500).json({ error: error?.message || String(error) });
    }
});

app.get('/api/prompts', (_req, res) => {
    try {
        res.json(PromptManager.listPrompts());
    } catch (error) {
        res.status(500).json({ error: error?.message || String(error) });
    }
});

app.get('/api/chart-data/:sessionId', (req, res) => {
    try {
        const sessionId = String(req.params.sessionId || '').trim();
        const data = sessionChartData.get(sessionId);
        if (!data) return res.status(404).json({ error: 'Chart data not found' });
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error?.message || String(error) });
    }
});

app.post('/api/chart-data', (req, res) => {
    try {
        const sessionId = String(req.body?.sessionId || '').trim();
        const data = req.body?.data;

        if (!sessionId || data === undefined) {
            return res.status(400).json({ error: 'Missing sessionId or data' });
        }

        sessionChartData.set(sessionId, data);

        // 5分钟后清理数据
        setTimeout(() => {
            sessionChartData.delete(sessionId);
        }, 5 * 60 * 1000);

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error?.message || String(error) });
    }
});

const ALLOWED_CONFIG_KEYS = [
    'PORT',
    'DB_HOST',
    'DB_PORT',
    'DB_USER',
    'DB_PASSWORD',
    'DB_ADMIN_DATABASE',
    'DB_CORE_DATABASE',
    'DB_MARKET_DATABASE',
    'DB_DATABASE',
    'DB_POOL_MIN',
    'DB_POOL_MAX',
    'PROMPT_NAME',
    'CHART_WIDTH',
    'CHART_HEIGHT',
    'CHART_VOLUME_PANE_HEIGHT',
    'CHART_MACD_PANE_HEIGHT',
    'CHART_TREND_STRENGTH_PANE_HEIGHT',
    'LOG_LEVEL',
    'DEFAULT_SYMBOL',
    'DEFAULT_TIMEFRAME',
    'DEFAULT_BARS',
    'MARKET_EXCHANGE',
    'MARKET_MARKET_TYPE',
    'MARKET_EXCHANGE_FALLBACKS',
    'MARKET_ASSET_CLASS',
    'MARKET_VENUE',
    'CCXT_ENABLE_RATE_LIMIT',
    'CCXT_TIMEOUT_MS',
    'CCXT_SANDBOX',
    'BINANCE_MARKET',
    'ALLOW_NO_AUTH',
    'ARKANIS_DATA_DIR',
    'SECRETS_ENC_KEY',
    'ENABLE_SHARE',
];

const CONFIG_SCHEMA = {
    server: {
        label: '服务配置',
        items: ['PORT'],
    },
    database: {
        label: 'PostgreSQL 数据库',
        items: [
            'DB_HOST',
            'DB_PORT',
            'DB_USER',
            'DB_PASSWORD',
            'DB_ADMIN_DATABASE',
            'DB_CORE_DATABASE',
            'DB_MARKET_DATABASE',
            'DB_DATABASE',
            'DB_POOL_MIN',
            'DB_POOL_MAX',
        ],
    },
    vlm: {
        label: 'VLM 配置',
        items: ['PROMPT_NAME'],
    },
    chart: {
        label: '图表配置',
        items: ['CHART_WIDTH', 'CHART_HEIGHT', 'CHART_VOLUME_PANE_HEIGHT'],
    },
    log: {
        label: '日志配置',
        items: ['LOG_LEVEL'],
    },
    defaults: {
        label: '默认参数',
        items: [
            'DEFAULT_SYMBOL',
            'DEFAULT_TIMEFRAME',
            'DEFAULT_BARS',
            'MARKET_EXCHANGE',
            'MARKET_MARKET_TYPE',
            'MARKET_EXCHANGE_FALLBACKS',
            'MARKET_ASSET_CLASS',
            'MARKET_VENUE',
            'CCXT_ENABLE_RATE_LIMIT',
            'CCXT_TIMEOUT_MS',
            'CCXT_SANDBOX',
            'BINANCE_MARKET',
        ],
    },
    opensource: {
        label: '开源部署预留',
        items: ['ALLOW_NO_AUTH', 'ARKANIS_DATA_DIR', 'SECRETS_ENC_KEY', 'ENABLE_SHARE'],
    },
};

function parseEnvFile(content) {
    const config = {};
    const lines = content.split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#')) continue;
        const eqIndex = trimmed.indexOf('=');
        if (eqIndex > 0) {
            const key = trimmed.substring(0, eqIndex).trim();
            const value = trimmed.substring(eqIndex + 1).trim();
            if (ALLOWED_CONFIG_KEYS.includes(key)) {
                config[key] = value;
            }
        }
    }
    return config;
}

function generateEnvContent(config) {
    const lines = ['# Arkanis 环境变量配置', ''];
    for (const group of Object.values(CONFIG_SCHEMA)) {
        lines.push(`# ${group.label}`);
        for (const key of group.items) {
            if (config[key] !== undefined) {
                lines.push(`${key}=${config[key]}`);
            }
        }
        lines.push('');
    }
    return lines.join('\n');
}

app.get('/api/config', async (_req, res) => {
    try {
        const envPath = join(PROJECT_ROOT, '.env');
        if (!existsSync(envPath)) {
            return res.json({ config: {}, schema: CONFIG_SCHEMA });
        }
        const content = await readFile(envPath, 'utf-8');
        const config = parseEnvFile(content);
        res.json({ config, schema: CONFIG_SCHEMA });
    } catch (error) {
        res.status(500).json({ error: error?.message || String(error) });
    }
});

app.post('/api/config', async (req, res) => {
    try {
        const config = req.body?.config;
        if (!config || typeof config !== 'object') {
            return res.status(400).json({ error: 'Invalid config' });
        }

        const filteredConfig = {};
        for (const key of ALLOWED_CONFIG_KEYS) {
            if (config[key] !== undefined) {
                filteredConfig[key] = config[key];
            }
        }

        const envPath = join(PROJECT_ROOT, '.env');
        const content = generateEnvContent(filteredConfig);
        await writeFile(envPath, content, 'utf-8');
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error?.message || String(error) });
    }
});

const PROVIDERS_FILE = join(PROJECT_ROOT, 'ai-providers.json');

function generateProviderId() {
    return `provider_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

async function readProviders() {
    try {
        if (!existsSync(PROVIDERS_FILE)) {
            const data = { providers: [], version: 1 };
            await writeProviders(data);
            return data;
        }
        const content = await readFile(PROVIDERS_FILE, 'utf-8');
        return JSON.parse(content);
    } catch (error) {
        console.error('读取 Provider 文件失败:', error);
        return { providers: [], version: 1 };
    }
}

async function writeProviders(data) {
    try {
        await writeFile(PROVIDERS_FILE, JSON.stringify(data, null, 2), 'utf-8');
        return true;
    } catch (error) {
        console.error('写入 Provider 文件失败:', error);
        return false;
    }
}

function validateProvider(provider) {
    const required = ['name', 'baseUrl', 'modelName', 'apiKey'];
    for (const field of required) {
        if (!provider?.[field] || String(provider[field]).trim() === '') {
            return { valid: false, error: `字段 ${field} 为必填项` };
        }
    }
    if (provider.thinkingMode && !['enabled', 'disabled', 'none'].includes(provider.thinkingMode)) {
        return { valid: false, error: 'thinkingMode 必须是 enabled/disabled/none' };
    }
    return { valid: true };
}

app.get('/api/ai-providers', async (_req, res) => {
    try {
        const data = await readProviders();
        res.json(data.providers);
    } catch (error) {
        res.status(500).json({ error: error?.message || String(error) });
    }
});

app.post('/api/ai-providers', async (req, res) => {
    try {
        const provider = req.body || {};
        const validation = validateProvider(provider);
        if (!validation.valid) {
            return res.status(400).json({ error: validation.error });
        }

        const data = await readProviders();
        provider.id = generateProviderId();
        provider.isActive = provider.isActive || false;

        if (provider.isActive) {
            data.providers.forEach((p) => (p.isActive = false));
        }
        data.providers.push(provider);

        const success = await writeProviders(data);
        if (!success) return res.status(500).json({ error: '保存失败' });

        io.emit('providers-updated');
        res.json(provider);
    } catch (error) {
        res.status(500).json({ error: error?.message || String(error) });
    }
});

app.put('/api/ai-providers/:id', async (req, res) => {
    try {
        const id = String(req.params.id || '').trim();
        const updates = req.body || {};

        const validation = validateProvider(updates);
        if (!validation.valid) {
            return res.status(400).json({ error: validation.error });
        }

        const data = await readProviders();
        const index = data.providers.findIndex((p) => p.id === id);
        if (index === -1) {
            return res.status(404).json({ error: 'Provider 不存在' });
        }

        if (updates.isActive) {
            data.providers.forEach((p) => (p.isActive = false));
        }

        data.providers[index] = { ...data.providers[index], ...updates, id };

        const success = await writeProviders(data);
        if (!success) return res.status(500).json({ error: '保存失败' });

        io.emit('providers-updated');
        res.json(data.providers[index]);
    } catch (error) {
        res.status(500).json({ error: error?.message || String(error) });
    }
});

app.delete('/api/ai-providers/:id', async (req, res) => {
    try {
        const id = String(req.params.id || '').trim();
        const data = await readProviders();
        const index = data.providers.findIndex((p) => p.id === id);
        if (index === -1) {
            return res.status(404).json({ error: 'Provider 不存在' });
        }

        data.providers.splice(index, 1);

        const success = await writeProviders(data);
        if (!success) return res.status(500).json({ error: '保存失败' });

        io.emit('providers-updated');
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error?.message || String(error) });
    }
});

app.post('/api/ai-providers/:id/activate', async (req, res) => {
    try {
        const id = String(req.params.id || '').trim();
        const data = await readProviders();
        const provider = data.providers.find((p) => p.id === id);
        if (!provider) return res.status(404).json({ error: 'Provider 不存在' });

        data.providers.forEach((p) => (p.isActive = false));
        provider.isActive = true;

        const success = await writeProviders(data);
        if (!success) return res.status(500).json({ error: '保存失败' });

        io.emit('providers-updated');
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error?.message || String(error) });
    }
});

function setupConfigWatcher() {
    const envPath = join(PROJECT_ROOT, '.env');
    const bridgeConfigPath = join(PROJECT_ROOT, 'bridge.config.json');
    const providersPath = PROVIDERS_FILE;

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

let telegramClient = null;

function getTelegramClient() {
    if (telegramClient) return telegramClient;
    telegramClient = new TelegramClient({
        token: process.env.TG_BOT_TOKEN,
        chatId: process.env.TG_CHAT_ID,
    });
    return telegramClient;
}

app.post('/api/send-telegram', async (req, res) => {
    try {
        const decision = req.body?.decision;
        if (!decision || typeof decision !== 'object') {
            return res.status(400).json({ error: '无效的 decision 数据' });
        }

        const telegram = getTelegramClient();

        const binanceMarket = String(process.env.BINANCE_MARKET || '').trim().toLowerCase();
        const market = binanceMarket === 'spot' ? 'spot' : 'futures';

        const tvUrl = buildTradingViewUrl(decision.symbol, decision.timeframe);
        const binanceUrl = buildBinanceUrl(decision.symbol, { market });

        const reply_markup = {
            inline_keyboard: [
                [
                    { text: '查看TradingView图表', url: tvUrl },
                    { text: '打开币安行情', url: binanceUrl },
                ],
            ],
        };

        const text = buildDecisionMessageHtml(decision, { source: 'web_auto_run' });
        await telegram.sendHtmlMessage(text, { replyMarkup: reply_markup });

        res.json({ success: true });
    } catch (error) {
        console.error('发送 Telegram 消息失败:', error);
        res.status(500).json({ error: error?.message || String(error) });
    }
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    setupConfigWatcher();
    console.log('[Config Hot Reload] 配置文件监听已启动');
});

