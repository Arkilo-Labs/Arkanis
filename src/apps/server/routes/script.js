import { spawn } from 'child_process';
import { join } from 'path';

import { getChartWriteToken } from '../services/chartWriteToken.js';
import { SOCKET_EVENTS } from '../socket/events.js';
import { resolveDataDir } from '../../../core/utils/dataDir.js';
import { readProviderDefinitions } from '../../../core/services/aiProvidersStore.js';
import { readSecrets } from '../../../core/services/secretsStore.js';
import { createRedactor } from '../../../core/utils/redactSecrets.js';

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

            child.stdout.on('data', (data) => {
                const text = data.toString();
                void getRedactor()
                    .then((redact) => io.emit(SOCKET_EVENTS.LOG, { type: 'stdout', data: redact(text) }))
                    .catch(() => io.emit(SOCKET_EVENTS.LOG, { type: 'stdout', data: text }));
            });

            child.stderr.on('data', (data) => {
                const text = data.toString();
                void getRedactor()
                    .then((redact) => io.emit(SOCKET_EVENTS.LOG, { type: 'stderr', data: redact(text) }))
                    .catch(() => io.emit(SOCKET_EVENTS.LOG, { type: 'stderr', data: text }));
            });

            child.on('close', (code) => {
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
