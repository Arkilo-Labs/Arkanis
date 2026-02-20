import { spawn } from 'child_process';
import { join } from 'path';

import { getChartWriteToken } from '../services/chartWriteToken.js';
import { SOCKET_EVENTS } from '../socket/events.js';
import { resolveDataDir } from '../../../core/utils/dataDir.js';
import { readProviderDefinitions } from '../../../core/services/aiProvidersStore.js';
import { readSecrets } from '../../../core/services/secretsStore.js';
import { createRedactor } from '../../../core/utils/redactSecrets.js';

const LENS_EVENT_PREFIX = '__LENS_EVENT__';

function createLineBuffer(onLine) {
    let buffer = '';
    return {
        push(chunk) {
            buffer += chunk.toString();
            let idx = buffer.indexOf('\n');
            while (idx >= 0) {
                onLine(buffer.slice(0, idx).replace(/\r$/, ''));
                buffer = buffer.slice(idx + 1);
                idx = buffer.indexOf('\n');
            }
        },
        flush() {
            const tail = buffer.replace(/\r$/, '');
            buffer = '';
            if (tail) onLine(tail);
        },
    };
}

function resolveScriptPath({ projectRoot, script }) {
    return join(projectRoot, 'src', 'agents', 'lens', `${script}.js`);
}

function parseArgs(value) {
    if (!Array.isArray(value)) return [];
    return value.filter((arg) => typeof arg === 'string');
}

export function registerScriptRoutes({ app, io, projectRoot, activeProcesses }) {
    const dataDir = resolveDataDir({ projectRoot });
    let redactorCache = null;
    let redactorCacheTime = 0;

    async function getRedactor() {
        const now = Date.now();
        if (redactorCache && now - redactorCacheTime < 3000) return redactorCache;

        const { providers } = await readProviderDefinitions({ projectRoot, dataDir }).catch(() => ({ providers: [] }));
        const secrets = await readSecrets({ dataDir, encKey: process.env.SECRETS_ENC_KEY || '' }).catch(() => ({
            providers: {},
        }));

        const secretValues = [];
        for (const item of Object.values(secrets.providers || {})) {
            if (item?.apiKey) secretValues.push(item.apiKey);
        }
        for (const p of providers) {
            const envName = String(p?.apiKeyEnv || '').trim();
            if (!envName) continue;
            const v = String(process.env[envName] || '').trim();
            if (v) secretValues.push(v);
        }

        redactorCache = createRedactor({ secretValues });
        redactorCacheTime = now;
        return redactorCache;
    }

    app.post('/api/run-script', (req, res) => {
        const script = String(req.body?.script || '').trim();
        const args = parseArgs(req.body?.args);

        if (script !== 'main') {
            return res.status(400).json({ error: 'Invalid script name' });
        }

        const scriptPath = resolveScriptPath({ projectRoot, script });
        const cmdArgs = [scriptPath, ...args];

        console.log(`Spawning script: ${script}`);

        try {
            const child = spawn(process.execPath, cmdArgs, {
                cwd: projectRoot,
                env: { ...process.env, FORCE_COLOR: '1', CHART_WRITE_TOKEN: getChartWriteToken() },
                stdio: ['ignore', 'pipe', 'pipe'],
            });

            const pid = child.pid;
            if (pid) activeProcesses.set(pid, child);

            const handleLine = (streamType) => (line) => {
                if (streamType === 'stdout' && line.startsWith(LENS_EVENT_PREFIX)) {
                    const raw = line.slice(LENS_EVENT_PREFIX.length);
                    let parsed = null;
                    try { parsed = JSON.parse(raw); } catch { parsed = null; }
                    if (parsed?.type === 'token-usage' && parsed.payload) {
                        io.emit(SOCKET_EVENTS.LENS_TOKEN_USAGE, { pid, ...parsed.payload });
                        return;
                    }
                }
                const text = `${line}\n`;
                void getRedactor()
                    .then((redact) => io.emit(SOCKET_EVENTS.LOG, { type: streamType, data: redact(text) }))
                    .catch(() => io.emit(SOCKET_EVENTS.LOG, { type: streamType, data: text }));
            };

            const outBuffer = createLineBuffer(handleLine('stdout'));
            const errBuffer = createLineBuffer(handleLine('stderr'));

            child.stdout.on('data', (chunk) => outBuffer.push(chunk));
            child.stderr.on('data', (chunk) => errBuffer.push(chunk));

            child.on('close', (code) => {
                outBuffer.flush();
                errBuffer.flush();
                io.emit(SOCKET_EVENTS.PROCESS_EXIT, { code, pid });
                if (pid) activeProcesses.delete(pid);
            });

            child.on('error', (err) => {
                const msg = `Failed to start process: ${err.message}`;
                void getRedactor()
                    .then((redact) => io.emit(SOCKET_EVENTS.LOG, { type: 'error', data: redact(msg) }))
                    .catch(() => io.emit(SOCKET_EVENTS.LOG, { type: 'error', data: msg }));
            });

            return res.json({ pid });
        } catch (error) {
            const msg = error?.message || String(error);
            void getRedactor()
                .then((redact) => res.status(500).json({ error: redact(msg) }))
                .catch(() => res.status(500).json({ error: msg }));
        }
    });
}
