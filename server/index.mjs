import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { readFile, writeFile } from 'fs/promises';
import bodyParser from 'body-parser';
import chokidar from 'chokidar';
import PromptManager from '../src/vlm/promptManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

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
    'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_MODEL', 'OPENAI_MAX_TOKENS', 'OPENAI_TEMPERATURE', 'OPENAI_TIMEOUT', 'OPENAI_ENABLE_THINKING',
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
    openai: {
        label: 'OpenAI API',
        items: ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_MODEL', 'OPENAI_MAX_TOKENS', 'OPENAI_TEMPERATURE', 'OPENAI_TIMEOUT', 'OPENAI_ENABLE_THINKING', 'PROMPT_NAME']
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

// 配置文件热重载
function setupConfigWatcher() {
    const envPath = join(PROJECT_ROOT, '.env');
    const bridgeConfigPath = join(PROJECT_ROOT, 'bridge.config.json');

    const watcher = chokidar.watch([envPath, bridgeConfigPath], {
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

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    setupConfigWatcher();
    console.log('[Config Hot Reload] 配置文件监听已启动');
});
