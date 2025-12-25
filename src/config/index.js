/**
 * VLM Trade 配置模块
 * 从环境变量加载配置，提供默认值
 */

import { config as dotenvConfig } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 尝试从项目根目录加载 .env
const envPath = join(__dirname, '..', '..', '.env');
if (existsSync(envPath)) {
    dotenvConfig({ path: envPath });
}

/**
 * 从环境变量获取值，支持默认值
 * @param {string} key 环境变量名
 * @param {*} defaultValue 默认值
 * @returns {string}
 */
function getEnv(key, defaultValue = '') {
    return process.env[key] ?? defaultValue;
}

/**
 * 从环境变量获取整数
 */
function getEnvInt(key, defaultValue = 0) {
    const val = process.env[key];
    return val ? parseInt(val, 10) : defaultValue;
}

/**
 * 从环境变量获取浮点数
 */
function getEnvFloat(key, defaultValue = 0) {
    const val = process.env[key];
    return val ? parseFloat(val) : defaultValue;
}

/**
 * 从环境变量获取布尔值
 */
function getEnvBool(key, defaultValue = false) {
    const val = process.env[key];
    if (!val) return defaultValue;
    return ['1', 'true', 'yes', 'y'].includes(val.toLowerCase().trim());
}

/**
 * 数据库配置
 */
function buildPostgresDsn({ host, port, user, password, database }) {
    const u = encodeURIComponent(String(user ?? ''));
    const p = encodeURIComponent(String(password ?? ''));
    const db = encodeURIComponent(String(database ?? ''));
    return `postgresql://${u}:${p}@${host}:${port}/${db}`;
}

export const databaseConfig = {
    host: getEnv('DB_HOST', 'localhost'),
    port: getEnvInt('DB_PORT', 5432),
    user: getEnv('DB_USER', 'postgres'),
    password: getEnv('DB_PASSWORD', 'skeet'),

    adminDatabase: getEnv('DB_ADMIN_DATABASE', 'postgres'),
    coreDatabase: getEnv('DB_CORE_DATABASE', 'arkilo_core'),
    marketDatabase: getEnv('DB_MARKET_DATABASE', getEnv('DB_DATABASE', 'arkilo_market_data')),

    minPoolSize: getEnvInt('DB_POOL_MIN', 2),
    maxPoolSize: getEnvInt('DB_POOL_MAX', 10),

    get adminDsn() {
        return buildPostgresDsn({
            host: this.host,
            port: this.port,
            user: this.user,
            password: this.password,
            database: this.adminDatabase,
        });
    },

    get coreDsn() {
        return buildPostgresDsn({
            host: this.host,
            port: this.port,
            user: this.user,
            password: this.password,
            database: this.coreDatabase,
        });
    },

    get marketDsn() {
        return buildPostgresDsn({
            host: this.host,
            port: this.port,
            user: this.user,
            password: this.password,
            database: this.marketDatabase,
        });
    },
};

/**
 * 图表渲染配置
 */
export const chartConfig = {
    width: getEnvInt('CHART_WIDTH', 1280),
    height: getEnvInt('CHART_HEIGHT', 720),
    volumePaneHeight: getEnvFloat('CHART_VOLUME_PANE_HEIGHT', 0.2),
    macdPaneHeight: getEnvFloat('CHART_MACD_PANE_HEIGHT', 0.15),
    trendStrengthPaneHeight: getEnvFloat('CHART_TREND_STRENGTH_PANE_HEIGHT', 0.15),
};

/**
 * VLM 配置（仅保留 Prompt 名称，其他配置使用 AI Provider）
 */
export const vlmConfig = {
    promptName: getEnv('PROMPT_NAME', 'default'),
};

/**
 * 市场数据表配置
 */
export const marketDataConfig = {
    assetClass: getEnv('MARKET_ASSET_CLASS', 'crypto'),
    exchange: getEnv('MARKET_EXCHANGE', 'binance'),
    marketType: getEnv('MARKET_MARKET_TYPE', getEnv('BINANCE_MARKET', 'futures')),
    venue: getEnv('MARKET_VENUE', ''),
    exchangeFallbacks: getEnv('MARKET_EXCHANGE_FALLBACKS', ''),
    ccxt: {
        enableRateLimit: getEnvBool('CCXT_ENABLE_RATE_LIMIT', true),
        timeoutMs: getEnvInt('CCXT_TIMEOUT_MS', 20000),
        sandbox: getEnvBool('CCXT_SANDBOX', false),
    },
    yahoo: {
        timeoutMs: getEnvInt('YAHOO_TIMEOUT_MS', 20000),
    },
    instrumentsTable: getEnv('MARKET_INSTRUMENTS_TABLE', 'instruments'),
    klines1mTable: getEnv('MARKET_KLINES_1M_TABLE', 'klines_1m'),
};

/**
 * 默认参数
 */
export const defaultConfig = {
    symbol: getEnv('DEFAULT_SYMBOL', 'BTCUSDT'),
    timeframe: getEnv('DEFAULT_TIMEFRAME', '5m'),
    bars: getEnvInt('DEFAULT_BARS', 200),
};

/**
 * 完整配置导出
 */
export const config = {
    db: databaseConfig,
    chart: chartConfig,
    vlm: vlmConfig,
    marketData: marketDataConfig,
    default: defaultConfig,
};

export default config;
