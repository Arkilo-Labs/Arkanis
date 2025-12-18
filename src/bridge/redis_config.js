import { defaultConfig } from '../config/index.js';
import { readFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import chokidar from 'chokidar';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..', '..');

const DEFAULTS = {
    channels: {
        signal: 'vlmbridge:signals',
        decision: 'vlmbridge:decisions',
        configKey: 'vlmbridge:config',
    },
    queue: {
        // all: 每条信号都处理（可能触发大量 VLM 调用）
        // latest_per_symbol: 按 symbol+timeframe 合并，只保留最后一条待处理信号（默认）
        mode: 'latest_per_symbol',
        maxPending: 200,
        concurrency: 1,
    },
    vlm: {
        symbol: defaultConfig.symbol,
        timeframe: defaultConfig.timeframe,
        bars: defaultConfig.bars,
        waitMs: 500,
        enable4xChart: false,
        auxTimeframe: null,
        skipVlm: false,
    },
    telegram: {
        sendNonEnter: false,
    },
};

function safeJsonParse(s) {
    try {
        return JSON.parse(s);
    } catch {
        return null;
    }
}

function deepMerge(base, override) {
    if (!override || typeof override !== 'object') return base;
    const out = Array.isArray(base) ? [...base] : { ...base };
    for (const [k, v] of Object.entries(override)) {
        if (v && typeof v === 'object' && !Array.isArray(v) && base?.[k] && typeof base[k] === 'object') {
            out[k] = deepMerge(base[k], v);
        } else {
            out[k] = v;
        }
    }
    return out;
}

async function loadJsonFileIfExists(filePath) {
    try {
        const raw = await readFile(filePath, 'utf-8');
        return safeJsonParse(raw);
    } catch {
        return null;
    }
}

// 配置缓存
let configCache = null;
let configCacheTime = 0;
const CACHE_TTL = 1000; // 1秒缓存，防止频繁读取

export async function loadBridgeConfig(redis) {
    // 使用缓存避免频繁读取文件
    const now = Date.now();
    if (configCache && (now - configCacheTime) < CACHE_TTL) {
        return configCache;
    }

    // 优先本地文件，减少必须改 Redis 的心智负担
    const cfgPath = (process.env.BRIDGE_CONFIG_PATH || join(PROJECT_ROOT, 'bridge.config.json')).trim();
    const fileCfg = await loadJsonFileIfExists(cfgPath);

    let merged = deepMerge(DEFAULTS, fileCfg || null);

    if (redis) {
        const redisKey = (process.env.BRIDGE_CONFIG_KEY || merged.channels.configKey).trim();
        const raw = await redis.get(redisKey);
        const redisCfg = raw ? safeJsonParse(raw) : null;
        merged = deepMerge(merged, redisCfg || null);
        merged.channels.configKey = redisKey;
    }

    configCache = merged;
    configCacheTime = now;
    return merged;
}

// 清除缓存，强制下次读取时重新加载
export function invalidateConfigCache() {
    configCache = null;
    configCacheTime = 0;
}

// 启动配置文件监听，自动失效缓存
export function watchConfigFiles(callback) {
    const cfgPath = (process.env.BRIDGE_CONFIG_PATH || join(PROJECT_ROOT, 'bridge.config.json')).trim();
    
    const watcher = chokidar.watch(cfgPath, {
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: {
            stabilityThreshold: 300,
            pollInterval: 100
        }
    });

    watcher.on('change', (path) => {
        console.log(`[Config Hot Reload] bridge.config.json 已更新`);
        invalidateConfigCache();
        if (callback) callback(path);
    });

    watcher.on('error', (error) => {
        console.error(`[Config Watcher] Error: ${error.message}`);
    });

    return watcher;
}

export { DEFAULTS as bridgeConfigDefaults };
