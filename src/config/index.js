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
export const databaseConfig = {
    host: getEnv('DB_HOST', 'localhost'),
    port: getEnvInt('DB_PORT', 5432),
    user: getEnv('DB_USER', 'postgres'),
    password: getEnv('DB_PASSWORD', 'skeet'),
    database: getEnv('DB_DATABASE', 'market_signals'),
    minPoolSize: getEnvInt('DB_POOL_MIN', 2),
    maxPoolSize: getEnvInt('DB_POOL_MAX', 10),

    get dsn() {
        return `postgresql://${this.user}:${this.password}@${this.host}:${this.port}/${this.database}`;
    },
};

/**
 * 图表渲染配置
 */
export const chartConfig = {
    width: getEnvInt('CHART_WIDTH', 1280),
    height: getEnvInt('CHART_HEIGHT', 720),
    volumePaneHeight: getEnvFloat('CHART_VOLUME_PANE_HEIGHT', 0.2),
};

/**
 * OpenAI API 配置
 */
export const openaiConfig = {
    apiKey: getEnv('OPENAI_API_KEY', ''),
    baseUrl: getEnv('OPENAI_BASE_URL', 'https://api.ohmygpt.com'),
    model: getEnv('OPENAI_MODEL', 'ark-doubao-seed-1.6-flash-250715'),
    maxTokens: getEnvInt('OPENAI_MAX_TOKENS', 8192),
    temperature: getEnvFloat('OPENAI_TEMPERATURE', 0.2),
    timeout: getEnvFloat('OPENAI_TIMEOUT', 240),
    enableThinking: getEnvBool('OPENAI_ENABLE_THINKING', true),
};

/**
 * 市场数据表配置
 */
export const marketDataConfig = {
    tableName: getEnv('MARKET_DATA_TABLE', 'market_data'),
    symbolCol: 'symbol',
    timeCol: 'kline_start_time',
    openCol: 'open_price',
    highCol: 'high_price',
    lowCol: 'low_price',
    closeCol: 'close_price',
    volumeCol: 'volume',
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
    openai: openaiConfig,
    marketData: marketDataConfig,
    default: defaultConfig,
};

export default config;
