import { readFile } from 'fs/promises';
import chokidar from 'chokidar';

// 解析 .env 文件内容
function parseEnvContent(content) {
    const env = {};
    const lines = content.split('\n');
    
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#')) continue;
        
        const eqIndex = trimmed.indexOf('=');
        if (eqIndex > 0) {
            const key = trimmed.substring(0, eqIndex).trim();
            let value = trimmed.substring(eqIndex + 1).trim();
            
            // 移除引号
            if ((value.startsWith('"') && value.endsWith('"')) ||
                (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
            }
            
            env[key] = value;
        }
    }
    
    return env;
}

// 重新加载 .env 文件到 process.env
export async function reloadEnv(envPath) {
    try {
        const content = await readFile(envPath, 'utf-8');
        const parsed = parseEnvContent(content);
        
        for (const [key, value] of Object.entries(parsed)) {
            process.env[key] = value;
        }
        
        return parsed;
    } catch (error) {
        console.error(`[Env Reload] 加载失败: ${error.message}`);
        return null;
    }
}

// 监听 .env 文件变化并自动重载
export function watchEnvFile(envPath, callback) {
    const watcher = chokidar.watch(envPath, {
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: {
            stabilityThreshold: 300,
            pollInterval: 100
        }
    });

    watcher.on('change', async (path) => {
        console.log('[Env Hot Reload] .env updated');
        const parsed = await reloadEnv(path);
        if (callback && parsed) {
            callback(parsed);
        }
    });

    watcher.on('error', (error) => {
        console.error(`[Env Watcher] Error: ${error.message}`);
    });

    return watcher;
}
