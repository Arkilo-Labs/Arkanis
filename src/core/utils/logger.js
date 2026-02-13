/**
 * Logger 模块
 * 提供分级日志功能，支持通过环境变量控制日志级别
 */

import { config as dotenvConfig } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 确保 .env 已加载
const envPath = join(__dirname, '..', '..', '..', '.env');
if (existsSync(envPath)) {
    dotenvConfig({ path: envPath });
}

/**
 * 日志级别定义
 * 数值越小，级别越低，输出越详细
 */
const LOG_LEVELS = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
    silent: 4,
};

/**
 * 获取当前配置的日志级别
 */
function getCurrentLevel() {
    const envLevel = (process.env.LOG_LEVEL || 'info').toLowerCase().trim();
    return LOG_LEVELS[envLevel] ?? LOG_LEVELS.info;
}

/**
 * 格式化时间戳
 */
function formatTimestamp() {
    return new Date().toISOString().replace('T', ' ').substring(0, 23);
}

/**
 * 格式化日志前缀
 */
function formatPrefix(level, tag = '') {
    const timestamp = formatTimestamp();
    const levelStr = level.toUpperCase().padEnd(5);
    return tag ? `${timestamp} [${levelStr}] [${tag}]` : `${timestamp} [${levelStr}]`;
}

/**
 * Logger 类
 */
class Logger {
    constructor(tag = '') {
        this.tag = tag;
    }

    /**
     * 创建带标签的子 logger
     */
    child(tag) {
        return new Logger(tag);
    }

    /**
     * Debug 级别日志
     */
    debug(...args) {
        if (getCurrentLevel() <= LOG_LEVELS.debug) {
            console.log(formatPrefix('debug', this.tag), ...args);
        }
    }

    /**
     * Info 级别日志
     */
    info(...args) {
        if (getCurrentLevel() <= LOG_LEVELS.info) {
            console.log(formatPrefix('info', this.tag), ...args);
        }
    }

    /**
     * Warn 级别日志
     */
    warn(...args) {
        if (getCurrentLevel() <= LOG_LEVELS.warn) {
            console.warn(formatPrefix('warn', this.tag), ...args);
        }
    }

    /**
     * Error 级别日志
     */
    error(...args) {
        if (getCurrentLevel() <= LOG_LEVELS.error) {
            console.error(formatPrefix('error', this.tag), ...args);
        }
    }
}

// 默认导出根 logger
const logger = new Logger();

export { Logger, LOG_LEVELS };
export default logger;
