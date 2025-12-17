#!/usr/bin/env node
/**
 * 一键启动：VLM bridge + Telegram bridge + web_channel
 */

import { spawn } from 'child_process';
import readline from 'readline';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import net from 'net';
import { config as dotenvConfig } from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

dotenvConfig({ path: join(PROJECT_ROOT, '.env') });

async function findAvailablePort(startPort, maxTries = 20) {
    for (let i = 0; i < maxTries; i++) {
        const port = startPort + i;
        // eslint-disable-next-line no-await-in-loop
        const ok = await new Promise((resolve) => {
            const s = net.createServer();
            s.unref();
            s.on('error', () => resolve(false));
            s.listen(port, '127.0.0.1', () => {
                s.close(() => resolve(true));
            });
        });
        if (ok) return port;
    }
    return startPort;
}

function pipeWithPrefix(child, label) {
    const attach = (stream, isErr) => {
        if (!stream) return;
        const rl = readline.createInterface({ input: stream });
        rl.on('line', (line) => {
            const out = isErr ? process.stderr : process.stdout;
            out.write(`[${label}] ${line}\n`);
        });
    };
    attach(child.stdout, false);
    attach(child.stderr, true);
}

function startNode(label, relPath, extraEnv = {}) {
    const absPath = join(PROJECT_ROOT, relPath);
    const child = spawn(process.execPath, [absPath], {
        cwd: PROJECT_ROOT,
        env: { ...process.env, ...extraEnv, FORCE_COLOR: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    pipeWithPrefix(child, label);
    child.on('exit', (code, signal) => {
        const msg = `[${label}] exited code=${code} signal=${signal || '-'}\n`;
        process.stderr.write(msg);
    });
    return child;
}

async function main() {
    const children = [];

    const webPort = await findAvailablePort(Number(process.env.PORT || 3100));

    children.push(startNode('WEB', 'web_channel/server.mjs', { PORT: String(webPort) }));
    children.push(startNode('VLM', 'scripts/main_redis.js'));

    if (!process.env.TG_BOT_TOKEN || !process.env.TG_CHAT_ID) {
        process.stderr.write(
            '[TG] 缺少 TG_BOT_TOKEN 或 TG_CHAT_ID，telegram-bot 不会启动（你可以先 set 环境变量再运行 pnpm bridge:tg）\n'
        );
    } else {
        children.push(startNode('TG', 'telegram-bot/index.js'));
    }

    const shutdown = () => {
        process.stderr.write('收到退出信号，正在关闭子进程...\n');
        for (const c of children) {
            try {
                c.kill();
            } catch {
                // ignore
            }
        }
        setTimeout(() => process.exit(0), 800);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

main().catch((e) => {
    process.stderr.write(`[bridge_all] 启动失败: ${e.message}\n`);
    process.exit(1);
});
