import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { config as dotenvConfig } from 'dotenv';

import Redis from 'ioredis';

import { bridgeConfigDefaults, loadBridgeConfig } from '../src/bridge/redis_config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenvConfig({ path: join(__dirname, '..', '.env') });

const BASE_PORT = Number(process.env.PORT || 3100);
const REDIS_URL = (process.env.REDIS_URL || 'redis://localhost:6379/0').trim();

const redis = new Redis(REDIS_URL, { lazyConnect: false, enableReadyCheck: true, maxRetriesPerRequest: null, });

function sendJson(res, status, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end(body);
}

async function readBody(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf-8');
    if (!raw) return null;
    return JSON.parse(raw);
}

async function serveStatic(res, relPath) {
    const p = join(__dirname, relPath);
    const ext = p.split('.').pop();
    const mime = {
        html: 'text/html; charset=utf-8',
        js: 'application/javascript; charset=utf-8',
        css: 'text/css; charset=utf-8',
    }[ext] || 'application/octet-stream';

    const buf = await readFile(p);
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' });
    res.end(buf);
}

const server = createServer(async (req, res) => {
    try {
        const url = new URL(req.url, `http://${req.headers.host}`);

        if (req.method === 'OPTIONS') {
            res.writeHead(204, {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
            });
            return res.end();
        }

        if (url.pathname === '/' && req.method === 'GET') {
            return await serveStatic(res, 'index.html');
        }
        if (url.pathname === '/app.js' && req.method === 'GET') {
            return await serveStatic(res, 'app.js');
        }

        if (url.pathname === '/api/config' && req.method === 'GET') {
            const effective = await loadBridgeConfig(redis);
            const redisKey = (effective.channels.configKey || 'vlmbridge:config').trim();
            const raw = await redis.get(redisKey);

            return sendJson(res, 200, {
                key: redisKey,
                configRaw: raw || '',
                effectiveConfig: effective,
                defaultConfig: bridgeConfigDefaults,
            });
        }

        if (url.pathname === '/api/config' && req.method === 'POST') {
            const body = await readBody(req);
            if (!body || typeof body.configRaw !== 'string') {
                return sendJson(res, 400, { error: 'Invalid body, expected {configRaw: string}' });
            }

            const effective = await loadBridgeConfig(redis);
            const redisKey = (effective.channels.configKey || 'vlmbridge:config').trim();

            const trimmed = body.configRaw.trim();
            if (trimmed) JSON.parse(trimmed);

            if (!trimmed) {
                await redis.del(redisKey);
                return sendJson(res, 200, { ok: true, key: redisKey, cleared: true });
            }

            await redis.set(redisKey, trimmed);
            return sendJson(res, 200, { ok: true, key: redisKey, cleared: false });
        }

        if (url.pathname === '/api/status' && req.method === 'GET') {
            const [lastSignal, lastDecision] = await Promise.all([
                redis.get('vlmbridge:last_signal_json'),
                redis.get('vlmbridge:last_decision_json'),
            ]);
            return sendJson(res, 200, {
                now: new Date().toISOString(),
                last_signal_json: lastSignal ? JSON.parse(lastSignal) : null,
                last_decision_json: lastDecision ? JSON.parse(lastDecision) : null,
            });
        }

        return sendJson(res, 404, { error: 'Not found' });
    } catch (e) {
        return sendJson(res, 500, { error: e.message });
    }
});

function listenWithFallback(port, triesLeft) {
    server.listen(port, () => {
        // eslint-disable-next-line no-console
        console.log(`web_channel running: http://localhost:${port} (Redis: ${REDIS_URL})`);
    });

    server.on('error', (err) => {
        if (err && err.code === 'EADDRINUSE' && triesLeft > 0) {
            const nextPort = port + 1;
            // eslint-disable-next-line no-console
            console.log(`端口 ${port} 已被占用，尝试 ${nextPort}...`);
            server.removeAllListeners('error');
            server.close(() => listenWithFallback(nextPort, triesLeft - 1));
            return;
        }
        throw err;
    });
}

listenWithFallback(BASE_PORT, 20);
