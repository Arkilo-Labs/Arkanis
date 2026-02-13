import { join } from 'path';
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';

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

export function registerConfigRoutes({ app, projectRoot }) {
    app.get('/api/config', async (_req, res) => {
        try {
            const envPath = join(projectRoot, '.env');
            if (!existsSync(envPath)) {
                return res.json({ config: {}, schema: CONFIG_SCHEMA });
            }
            const content = await readFile(envPath, 'utf-8');
            const config = parseEnvFile(content);
            return res.json({ config, schema: CONFIG_SCHEMA });
        } catch (error) {
            return res.status(500).json({ error: error?.message || String(error) });
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

            const envPath = join(projectRoot, '.env');
            const content = generateEnvContent(filteredConfig);
            await writeFile(envPath, content, 'utf-8');
            return res.json({ success: true });
        } catch (error) {
            return res.status(500).json({ error: error?.message || String(error) });
        }
    });
}

