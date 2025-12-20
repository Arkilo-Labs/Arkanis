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
import TelegramBot from 'node-telegram-bot-api';
import { config as dotenvConfig } from 'dotenv';
import PromptManager from '../src/vlm/promptManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

dotenvConfig({ path: join(PROJECT_ROOT, '.env') });

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(bodyParser.json());

// Serve static files from 'outputs' directory
app.use('/outputs', express.static(join(PROJECT_ROOT, 'outputs')));

// Store active processes and session data
const activeProcesses = new Map();
const sessionChartData = new Map();

io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });

    socket.on('kill-process', (pid) => {
        if (activeProcesses.has(pid)) {
            const child = activeProcesses.get(pid);
            child.kill();
            activeProcesses.delete(pid);
            socket.emit('process-killed', pid);
            console.log(`Killed process ${pid}`);
        }
    });
});

app.post('/api/run-script', (req, res) => {
    const { script, args } = req.body;
    if (!['main', 'backtest'].includes(script)) {
        return res.status(400).json({ error: 'Invalid script name' });
    }

    const scriptPath = join(PROJECT_ROOT, 'scripts', `${script}.js`);
    const cmdArgs = [scriptPath, ...(args || [])];

    console.log(`Spawning: node ${cmdArgs.join(' ')}`);

    try {
        const child = spawn(process.execPath, cmdArgs, {
            cwd: PROJECT_ROOT,
            env: { ...process.env, FORCE_COLOR: '1' },
            stdio: ['ignore', 'pipe', 'pipe']
        });

        const pid = child.pid;
        if (pid) {
            activeProcesses.set(pid, child);
        }

        // Stream logs
        child.stdout.on('data', (data) => {
            const str = data.toString();
            console.log(`[STDOUT] ${str.substring(0, 100)}`);
            io.emit('log', { type: 'stdout', data: str });
        });

        child.stderr.on('data', (data) => {
            const str = data.toString();
            console.log(`[STDERR] ${str}`);
            io.emit('log', { type: 'stderr', data: str });
        });

        child.on('close', (code) => {
            console.log(`Process exited with code ${code}`);
            io.emit('process-exit', { code, pid });
            if (pid) activeProcesses.delete(pid);
        });

        child.on('error', (err) => {
            console.error('Failed to start process.', err);
            io.emit('log', { type: 'error', data: `Failed to start process: ${err.message}` });
        });

        res.json({ pid });
    } catch (error) {
        console.error('Spawn error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/prompts', (req, res) => {
    try {
        const prompts = PromptManager.listPrompts();
        res.json(prompts);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 获取图表数据
app.get('/api/chart-data/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const data = sessionChartData.get(sessionId);
        
        if (!data) {
            return res.status(404).json({ error: 'Chart data not found' });
        }
        
        res.json(data);
    } catch (error) {
        console.error('Get chart data error:', error);
        res.status(500).json({ error: error.message });
    }
});

// 保存图表数据（由脚本调用）
app.post('/api/chart-data', async (req, res) => {
    try {
        const { sessionId, data } = req.body;
        
        if (!sessionId || !data) {
            return res.status(400).json({ error: 'Missing sessionId or data' });
        }
        
        sessionChartData.set(sessionId, data);
        
        // 5分钟后清理数据
        setTimeout(() => {
            sessionChartData.delete(sessionId);
        }, 5 * 60 * 1000);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Save chart data error:', error);
        res.status(500).json({ error: error.message });
    }
});

// 允许修改的配置项白名单
const ALLOWED_CONFIG_KEYS = [
    'DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_DATABASE', 'DB_POOL_MIN', 'DB_POOL_MAX',
    'PROMPT_NAME',
    'CHART_WIDTH', 'CHART_HEIGHT', 'CHART_VOLUME_PANE_HEIGHT',
    'LOG_LEVEL',
    'DEFAULT_SYMBOL', 'DEFAULT_TIMEFRAME', 'DEFAULT_BARS'
];

// 配置项分组和描述
const CONFIG_SCHEMA = {
    database: {
        label: 'PostgreSQL 数据库',
        items: ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_DATABASE', 'DB_POOL_MIN', 'DB_POOL_MAX']
    },
    vlm: {
        label: 'VLM 配置',
        items: ['PROMPT_NAME']
    },
    chart: {
        label: '图表配置',
        items: ['CHART_WIDTH', 'CHART_HEIGHT', 'CHART_VOLUME_PANE_HEIGHT']
    },
    log: {
        label: '日志配置',
        items: ['LOG_LEVEL']
    },
    defaults: {
        label: '默认参数',
        items: ['DEFAULT_SYMBOL', 'DEFAULT_TIMEFRAME', 'DEFAULT_BARS']
    }
};

// 解析 .env 文件
function parseEnvFile(content) {
    const config = {};
    const lines = content.split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        // 跳过注释和空行
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

// 生成 .env 文件内容
function generateEnvContent(config) {
    const lines = ['// VLM Trade JS 环境变量配置', ''];

    for (const [groupKey, group] of Object.entries(CONFIG_SCHEMA)) {
        lines.push(`// ${group.label}`);
        for (const key of group.items) {
            if (config[key] !== undefined) {
                lines.push(`${key}=${config[key]}`);
            }
        }
        lines.push('');
    }

    return lines.join('\n');
}

// 读取配置
app.get('/api/config', async (req, res) => {
    try {
        const envPath = join(PROJECT_ROOT, '.env');
        const content = await readFile(envPath, 'utf-8');
        const config = parseEnvFile(content);
        res.json({ config, schema: CONFIG_SCHEMA });
    } catch (error) {
        console.error('Read config error:', error);
        res.status(500).json({ error: error.message });
    }
});

// 保存配置
app.post('/api/config', async (req, res) => {
    try {
        const { config } = req.body;
        if (!config || typeof config !== 'object') {
            return res.status(400).json({ error: 'Invalid config' });
        }

        // 过滤只保留允许的配置项
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
        console.error('Save config error:', error);
        res.status(500).json({ error: error.message });
    }
});

// AI Provider 管理
const PROVIDERS_FILE = join(PROJECT_ROOT, 'ai-providers.json');

function generateProviderId() {
    return `provider_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

async function readProviders() {
    try {
        if (!existsSync(PROVIDERS_FILE)) {
            return await initDefaultProvider();
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

async function initDefaultProvider() {
    const data = {
        providers: [],
        version: 1
    };

    await writeProviders(data);
    return data;
}

function validateProvider(provider) {
    const required = ['name', 'baseUrl', 'modelName', 'apiKey'];
    for (const field of required) {
        if (!provider[field] || provider[field].trim() === '') {
            return { valid: false, error: `字段 ${field} 为必填项` };
        }
    }

    if (provider.thinkingMode && !['enabled', 'disabled', 'none'].includes(provider.thinkingMode)) {
        return { valid: false, error: 'thinkingMode 必须是 enabled/disabled/none' };
    }

    return { valid: true };
}

// API: 获取所有 Provider
app.get('/api/ai-providers', async (req, res) => {
    try {
        const data = await readProviders();
        res.json(data.providers);
    } catch (error) {
        console.error('获取 Provider 列表失败:', error);
        res.status(500).json({ error: error.message });
    }
});

// API: 新增 Provider
app.post('/api/ai-providers', async (req, res) => {
    try {
        const provider = req.body;

        const validation = validateProvider(provider);
        if (!validation.valid) {
            return res.status(400).json({ error: validation.error });
        }

        const data = await readProviders();

        provider.id = generateProviderId();
        provider.isActive = provider.isActive || false;

        if (provider.isActive) {
            data.providers.forEach(p => p.isActive = false);
        }

        data.providers.push(provider);

        const success = await writeProviders(data);
        if (success) {
            io.emit('providers-updated');
            res.json(provider);
        } else {
            res.status(500).json({ error: '保存失败' });
        }
    } catch (error) {
        console.error('创建 Provider 失败:', error);
        res.status(500).json({ error: error.message });
    }
});

// API: 更新 Provider
app.put('/api/ai-providers/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;

        const validation = validateProvider(updates);
        if (!validation.valid) {
            return res.status(400).json({ error: validation.error });
        }

        const data = await readProviders();
        const index = data.providers.findIndex(p => p.id === id);

        if (index === -1) {
            return res.status(404).json({ error: 'Provider 不存在' });
        }

        if (updates.isActive) {
            data.providers.forEach(p => p.isActive = false);
        }

        data.providers[index] = { ...data.providers[index], ...updates, id };

        const success = await writeProviders(data);
        if (success) {
            io.emit('providers-updated');
            res.json(data.providers[index]);
        } else {
            res.status(500).json({ error: '保存失败' });
        }
    } catch (error) {
        console.error('更新 Provider 失败:', error);
        res.status(500).json({ error: error.message });
    }
});

// API: 删除 Provider
app.delete('/api/ai-providers/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const data = await readProviders();

        const index = data.providers.findIndex(p => p.id === id);
        if (index === -1) {
            return res.status(404).json({ error: 'Provider 不存在' });
        }

        const isActive = data.providers[index].isActive;
        data.providers.splice(index, 1);

        if (isActive && data.providers.length > 0) {
            data.providers[0].isActive = true;
        }

        const success = await writeProviders(data);
        if (success) {
            io.emit('providers-updated');
            res.json({ success: true });
        } else {
            res.status(500).json({ error: '保存失败' });
        }
    } catch (error) {
        console.error('删除 Provider 失败:', error);
        res.status(500).json({ error: error.message });
    }
});

// API: 激活 Provider
app.post('/api/ai-providers/:id/activate', async (req, res) => {
    try {
        const { id } = req.params;
        const data = await readProviders();

        const provider = data.providers.find(p => p.id === id);
        if (!provider) {
            return res.status(404).json({ error: 'Provider 不存在' });
        }

        data.providers.forEach(p => p.isActive = false);
        provider.isActive = true;

        const success = await writeProviders(data);
        if (success) {
            io.emit('providers-updated');
            res.json(provider);
        } else {
            res.status(500).json({ error: '保存失败' });
        }
    } catch (error) {
        console.error('激活 Provider 失败:', error);
        res.status(500).json({ error: error.message });
    }
});

// 配置文件热重载
function setupConfigWatcher() {
    const envPath = join(PROJECT_ROOT, '.env');
    const bridgeConfigPath = join(PROJECT_ROOT, 'bridge.config.json');
    const providersPath = PROVIDERS_FILE;

    const watcher = chokidar.watch([envPath, bridgeConfigPath, providersPath], {
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: {
            stabilityThreshold: 300,
            pollInterval: 100
        }
    });

    watcher.on('change', (path) => {
        const filename = path.split(/[/\\]/).pop();
        console.log(`[Config Hot Reload] 检测到配置文件变更: ${filename}`);

        io.emit('config-reload', {
            file: filename,
            timestamp: Date.now()
        });
    });

    watcher.on('error', (error) => {
        console.error(`[Config Watcher] Error: ${error.message}`);
    });

    return watcher;
}

// Telegram 消息发送
function escapeHtml(text) {
    return String(text)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}

function fmtNum(v, digits = 4) {
    if (v === null || v === undefined) return '-';
    const n = Number(v);
    if (!Number.isFinite(n) || n === 0) return '-';
    return n.toFixed(digits);
}

function fmtPct(v, digits = 1) {
    const n = Number(v);
    if (!Number.isFinite(n)) return '-';
    return `${(n * 100).toFixed(digits)}%`;
}

function extractEntryPriceText(decision) {
    const ep = decision.entry_price;
    if (ep === 'market') return '市价';
    if (typeof ep === 'number') return fmtNum(ep, 6);
    if (decision.entry_price && Number(decision.entry_price) !== 0) return fmtNum(decision.entry_price, 6);
    return '-';
}

function buildTradingViewInterval(timeframe) {
    const tf = String(timeframe || '').trim().toLowerCase();
    const m = tf.match(/^([0-9]+)([mhdw])$/);
    if (!m) return null;

    const value = Number(m[1]);
    const unit = m[2];
    if (!Number.isFinite(value) || value <= 0) return null;

    if (unit === 'm') return String(value);
    if (unit === 'h') return String(value * 60);
    if (unit === 'd') return 'D';
    if (unit === 'w') return 'W';
    return null;
}

function buildTradingViewUrl(symbol, timeframe) {
    const tvSymbol = `BINANCE:${String(symbol || '').trim()}`;
    const interval = buildTradingViewInterval(timeframe);
    const url = new URL('https://tradingview.com/chart/');
    url.searchParams.set('symbol', tvSymbol);
    if (interval) url.searchParams.set('interval', interval);
    return url.toString();
}

function buildBinanceUrl(symbol, { market = 'futures' } = {}) {
    const s = String(symbol || '').trim().toUpperCase();
    const quotes = ['USDT', 'USDC', 'BUSD', 'TUSD', 'FDUSD', 'BTC', 'ETH', 'BNB', 'TRY', 'EUR'];

    if (market === 'spot') {
        let formatted = s;
        for (const q of quotes) {
            if (s.endsWith(q) && s.length > q.length) {
                formatted = `${s.slice(0, -q.length)}_${q}`;
                break;
            }
        }
        return `https://www.binance.com/zh-CN/trade/${formatted}?type=spot`;
    }

    return `https://www.binance.com/zh-CN/futures/${s}?type=perpetual`;
}

function buildMessageHtml(decision) {
    const enter = Boolean(decision.enter);
    const dir = (decision.direction || '').toUpperCase();
    const symbol = decision.symbol || '-';
    const tf = decision.timeframe || '-';

    const entryText = extractEntryPriceText(decision);
    const slText = decision.stop_loss_price ? fmtNum(decision.stop_loss_price, 6) : '-';
    const tpText = decision.take_profit_price ? fmtNum(decision.take_profit_price, 6) : '-';

    const header = `<b>${escapeHtml(`【VLM 入场计划】${symbol} (${tf})`)}</b>`;

    const infoLines = [];
    infoLines.push(`入场   ${enter ? '是' : '否'}`);
    if (enter) {
        infoLines.push(`方向   ${dir || '-'}`);
        infoLines.push(`仓位   ${fmtPct(decision.position_size)}`);
        infoLines.push(`杠杆   ${decision.leverage || 1}x`);
        infoLines.push(`置信度 ${fmtPct(decision.confidence)}`);
        infoLines.push(`入场价 ${entryText}`);
        infoLines.push(`止损   ${slText}`);
        infoLines.push(`止盈   ${tpText}`);
    }

    const mainInfo = `<pre>${escapeHtml(infoLines.join('\n'))}</pre>`;

    const reason = decision.reason ? `\n\n<b>理由</b>:\n${escapeHtml(decision.reason)}` : '';

    const ts = new Date();
    const tsText = `${ts.toISOString().replace('T', ' ').slice(0, 19)} UTC`;
    const footer = `\n\n<i>${escapeHtml(`${tsText} · 来源: web_auto_run`)}</i>`;

    return `${header}\n${mainInfo}${reason}${footer}`;
}

let telegramBot = null;

function getTelegramBot() {
    if (!telegramBot) {
        const token = (process.env.TG_BOT_TOKEN || '').trim();
        if (!token) {
            throw new Error('缺少环境变量 TG_BOT_TOKEN');
        }
        telegramBot = new TelegramBot(token, { polling: false });
    }
    return telegramBot;
}

app.post('/api/send-telegram', async (req, res) => {
    try {
        const { decision } = req.body;

        if (!decision || typeof decision !== 'object') {
            return res.status(400).json({ error: '无效的 decision 数据' });
        }

        const chatId = (process.env.TG_CHAT_ID || '').trim();
        if (!chatId) {
            return res.status(500).json({ error: '缺少环境变量 TG_CHAT_ID' });
        }

        const bot = getTelegramBot();

        const binanceMarket = (process.env.BINANCE_MARKET || '').trim().toLowerCase();
        const market = binanceMarket === 'spot' ? 'spot' : 'futures';

        const tvUrl = buildTradingViewUrl(decision.symbol, decision.timeframe);
        const binanceUrl = buildBinanceUrl(decision.symbol, { market });

        const reply_markup = {
            inline_keyboard: [[
                { text: '查看TradingView图表', url: tvUrl },
                { text: '打开币安行情', url: binanceUrl },
            ]],
        };

        const text = buildMessageHtml(decision);
        await bot.sendMessage(chatId, text, {
            parse_mode: 'HTML',
            reply_markup,
            disable_web_page_preview: true,
        });

        res.json({ success: true });
    } catch (error) {
        console.error('发送 Telegram 消息失败:', error);
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    setupConfigWatcher();
    console.log('[Config Hot Reload] 配置文件监听已启动');
});
