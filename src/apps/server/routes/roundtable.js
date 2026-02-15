import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { readdir, readFile, stat } from 'fs/promises';
import { join } from 'path';

import { resolveDataDir } from '../../../core/utils/dataDir.js';
import { readProviderDefinitions } from '../../../core/services/aiProvidersStore.js';
import { readSecrets } from '../../../core/services/secretsStore.js';
import { createRedactor } from '../../../core/utils/redactSecrets.js';

const ROUND_EVENT_PREFIX = '__AGENTS_ROUND_EVENT__';

function newSessionId() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}_${pad(
        d.getUTCHours(),
    )}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

function normalizeSessionId(value) {
    const id = String(value || '').trim();
    if (!id) return '';
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/.test(id)) {
        throw new Error(`sessionId 不合法: ${id}`);
    }
    return id;
}

function parseArgs(value) {
    if (!Array.isArray(value)) return [];
    return value.filter((arg) => typeof arg === 'string');
}

function readString(body, keys) {
    for (const k of keys) {
        const v = body?.[k];
        if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return '';
}

function readNumber(body, keys) {
    for (const k of keys) {
        const v = body?.[k];
        if (v === null || v === undefined || v === '') continue;
        const n = Number(v);
        if (Number.isFinite(n)) return n;
    }
    return null;
}

function readBool(body, keys) {
    for (const k of keys) {
        const v = body?.[k];
        if (v === true) return true;
        if (v === false) return false;
        if (typeof v === 'string') {
            const s = v.trim().toLowerCase();
            if (['1', 'true', 'yes', 'y'].includes(s)) return true;
            if (['0', 'false', 'no', 'n'].includes(s)) return false;
        }
    }
    return null;
}

function buildArgsFromBody(body) {
    const args = [];

    const symbol = readString(body, ['symbol']);
    if (symbol) args.push('--symbol', symbol);

    const exchange = readString(body, ['exchange']);
    if (exchange) args.push('--exchange', exchange);

    const marketType = readString(body, ['marketType', 'market_type']);
    if (marketType) args.push('--market-type', marketType);

    const exchangeFallbacks = readString(body, ['exchangeFallbacks', 'exchange_fallbacks']);
    if (exchangeFallbacks) args.push('--exchange-fallbacks', exchangeFallbacks);

    const assetClass = readString(body, ['assetClass', 'asset_class']);
    if (assetClass) args.push('--asset-class', assetClass);

    const bars = readNumber(body, ['bars']);
    if (bars != null) args.push('--bars', String(Math.trunc(bars)));

    const primary = readString(body, ['primary']);
    if (primary) args.push('--primary', primary);

    const aux = readString(body, ['aux']);
    if (aux) args.push('--aux', aux);

    const dataSource = readString(body, ['dataSource', 'data_source']);
    if (dataSource) args.push('--data-source', dataSource);

    const skipLlm = readBool(body, ['skipLlm', 'skip_llm']);
    if (skipLlm) args.push('--skip-llm');

    const skipNews = readBool(body, ['skipNews', 'skip_news']);
    if (skipNews) args.push('--skip-news');

    const skipLiquidation = readBool(body, ['skipLiquidation', 'skip_liquidation']);
    if (skipLiquidation) args.push('--skip-liquidation');

    const skipMcp = readBool(body, ['skipMcp', 'skip_mcp']);
    if (skipMcp) args.push('--skip-mcp');

    return args;
}

function sanitizeRunArgs(args) {
    const list = Array.isArray(args) ? args : [];
    const stripFlagsWithValue = new Set(['--output-dir', '--config-dir', '--prompts-dir', '--session-id']);

    const out = [];
    for (let i = 0; i < list.length; i++) {
        const token = list[i];
        if (stripFlagsWithValue.has(token)) {
            i += 1; // 跳过 value
            continue;
        }
        out.push(token);
    }
    return out;
}

function resolveRoundtableScriptPath({ projectRoot }) {
    return join(projectRoot, 'src', 'cli', 'roundtable', 'main.js');
}

function extractSessionIdFromArgs(args) {
    const list = Array.isArray(args) ? args : [];
    for (let i = 0; i < list.length; i++) {
        if (list[i] !== '--session-id') continue;
        const next = list[i + 1];
        if (typeof next !== 'string') return '';
        return normalizeSessionId(next);
    }
    return '';
}

function upsertSessionIdArg(args, sessionId) {
    const list = Array.isArray(args) ? args.slice() : [];

    for (let i = 0; i < list.length; i++) {
        if (list[i] !== '--session-id') continue;
        list[i + 1] = sessionId;
        return list;
    }

    return [...list, '--session-id', sessionId];
}

function redactDeep(value, redact) {
    if (typeof value === 'string') return redact(value);
    if (Array.isArray(value)) return value.map((v) => redactDeep(v, redact));
    if (!value || typeof value !== 'object') return value;

    const out = {};
    for (const [k, v] of Object.entries(value)) {
        out[k] = redactDeep(v, redact);
    }
    return out;
}

function createLineBuffer(onLine) {
    let buffer = '';

    return {
        push(chunk) {
            buffer += chunk.toString();
            let idx = buffer.indexOf('\n');
            while (idx >= 0) {
                const line = buffer.slice(0, idx).replace(/\r$/, '');
                buffer = buffer.slice(idx + 1);
                onLine(line);
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

async function fileExists(path) {
    try {
        await stat(path);
        return true;
    } catch {
        return false;
    }
}

async function safeReadText(path) {
    try {
        return await readFile(path, 'utf-8');
    } catch {
        return '';
    }
}

async function safeReadJson(path) {
    const raw = await safeReadText(path);
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function extractJsonObject(text) {
    const raw = String(text || '').trim();
    if (!raw) return null;
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end < 0 || end <= start) return null;
    const candidate = raw.slice(start, end + 1);
    try {
        return JSON.parse(candidate);
    } catch {
        return null;
    }
}

function summarizeDecisionForList(decisionText) {
    const json = extractJsonObject(decisionText);
    if (json) return json;
    const preview = String(decisionText || '').trim();
    return preview ? { preview: preview.slice(0, 240) } : null;
}

export function registerRoundtableRoutes({ app, io, projectRoot, activeProcesses }) {
    const dataDir = resolveDataDir({ projectRoot });
    const outputsDir = join(projectRoot, 'outputs', 'roundtable');

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

    app.post('/api/roundtable/run', async (req, res) => {
        const body = req.body || {};
        const providedArgs = parseArgs(body.args);
        const rawArgs = providedArgs.length ? providedArgs : buildArgsFromBody(body);

        let sessionId = '';
        try {
            sessionId =
                normalizeSessionId(body.sessionId) ||
                extractSessionIdFromArgs(rawArgs) ||
                newSessionId();
        } catch (e) {
            return res.status(400).json({ error: e?.message || String(e) });
        }

        const args = upsertSessionIdArg(sanitizeRunArgs(rawArgs), sessionId);
        const scriptPath = resolveRoundtableScriptPath({ projectRoot });
        const cmdArgs = [scriptPath, ...args];

        try {
            const child = spawn(process.execPath, cmdArgs, {
                cwd: projectRoot,
                env: { ...process.env, FORCE_COLOR: '1', AGENTS_ROUND_EMIT_EVENTS: '1' },
                stdio: ['ignore', 'pipe', 'pipe'],
            });

            const pid = child.pid;
            if (pid) activeProcesses.set(pid, child);

            const allowedEventTypes = new Set(['agent-speak', 'tool-call', 'belief-update', 'decision']);

            const makeOnLine = (streamType) => async (line) => {
                if (!line) return;

                if (line.startsWith(ROUND_EVENT_PREFIX)) {
                    const raw = line.slice(ROUND_EVENT_PREFIX.length);
                    let parsed = null;
                    try {
                        parsed = JSON.parse(raw);
                    } catch {
                        // 结构化事件解析失败时当普通日志处理
                        parsed = null;
                    }

                    if (parsed && allowedEventTypes.has(parsed.type)) {
                        try {
                            const redact = await getRedactor();
                            const payload = {
                                sessionId: parsed.sessionId || sessionId,
                                pid: parsed.pid || pid || null,
                                timestamp: parsed.timestamp || Date.now(),
                                ...(parsed.payload || {}),
                            };
                            io.emit(parsed.type, redactDeep(payload, redact));
                            return;
                        } catch {
                            // redactor 异常时仍然推送
                            io.emit(parsed.type, {
                                sessionId: parsed.sessionId || sessionId,
                                pid: parsed.pid || pid || null,
                                timestamp: parsed.timestamp || Date.now(),
                                ...(parsed.payload || {}),
                            });
                            return;
                        }
                    }
                }

                try {
                    const redact = await getRedactor();
                    io.emit('log', {
                        type: streamType,
                        data: redact(`${line}\n`),
                        pid: pid || null,
                        sessionId,
                        source: 'roundtable',
                    });
                } catch {
                    io.emit('log', {
                        type: streamType,
                        data: `${line}\n`,
                        pid: pid || null,
                        sessionId,
                        source: 'roundtable',
                    });
                }
            };

            const outBuffer = createLineBuffer((line) => void makeOnLine('stdout')(line));
            const errBuffer = createLineBuffer((line) => void makeOnLine('stderr')(line));

            child.stdout.on('data', (chunk) => outBuffer.push(chunk));
            child.stderr.on('data', (chunk) => errBuffer.push(chunk));

            child.on('close', (code) => {
                outBuffer.flush();
                errBuffer.flush();
                io.emit('process-exit', { code, pid, sessionId, source: 'roundtable' });
                if (pid) activeProcesses.delete(pid);
            });

            child.on('error', async (err) => {
                const msg = `Failed to start process: ${err.message}`;
                try {
                    const redact = await getRedactor();
                    io.emit('log', {
                        type: 'error',
                        data: redact(`${msg}\n`),
                        pid: pid || null,
                        sessionId,
                        source: 'roundtable',
                    });
                } catch {
                    io.emit('log', {
                        type: 'error',
                        data: `${msg}\n`,
                        pid: pid || null,
                        sessionId,
                        source: 'roundtable',
                    });
                }
            });

            return res.json({ pid, sessionId });
        } catch (error) {
            const msg = error?.message || String(error);
            try {
                const redact = await getRedactor();
                return res.status(500).json({ error: redact(msg) });
            } catch {
                return res.status(500).json({ error: msg });
            }
        }
    });

    app.get('/api/roundtable/sessions', async (req, res) => {
        const limit = Math.max(1, Math.min(200, Number(req.query?.limit) || 50));

        try {
            if (!(await fileExists(outputsDir))) return res.json({ sessions: [] });

            const entries = await readdir(outputsDir, { withFileTypes: true });
            const dirs = entries
                .filter((d) => d.isDirectory() && d.name !== 'history')
                .map((d) => d.name)
                .filter((name) => /^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/.test(name));

            const withStats = await Promise.all(
                dirs.map(async (id) => {
                    const full = join(outputsDir, id);
                    const st = await stat(full);
                    const decisionPath = join(full, 'decision.json');
                    const decisionData = existsSync(decisionPath) ? await safeReadJson(decisionPath) : null;
                    const decisionSummary = decisionData?.decision
                        ? summarizeDecisionForList(decisionData.decision)
                        : null;

                    return {
                        id,
                        createdAt: st.mtime.toISOString(),
                        hasDecision: Boolean(decisionData),
                        decision: decisionSummary,
                        urls: {
                            dir: `/outputs/roundtable/${id}/`,
                            log: `/outputs/roundtable/${id}/session.log`,
                            decision: existsSync(decisionPath) ? `/outputs/roundtable/${id}/decision.json` : null,
                        },
                    };
                }),
            );

            withStats.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
            return res.json({ sessions: withStats.slice(0, limit) });
        } catch (error) {
            return res.status(500).json({ error: error?.message || String(error) });
        }
    });

    app.get('/api/roundtable/sessions/:id', async (req, res) => {
        const id = String(req.params.id || '').trim();
        let sessionId = '';

        try {
            sessionId = normalizeSessionId(id);
        } catch (e) {
            return res.status(400).json({ error: e?.message || String(e) });
        }
        if (!sessionId) return res.status(400).json({ error: 'sessionId 不能为空' });

        const sessionDir = join(outputsDir, sessionId);
        try {
            const st = await stat(sessionDir);
            if (!st.isDirectory()) return res.status(404).json({ error: 'Session not found' });

            const chartsDir = join(sessionDir, 'charts');
            const toolShotsDir = join(sessionDir, 'tool_shots');

            const [decision, auditReport, newsMeta] = await Promise.all([
                safeReadJson(join(sessionDir, 'decision.json')),
                safeReadJson(join(sessionDir, 'audit_report.json')),
                safeReadJson(join(sessionDir, 'news_meta.json')),
            ]);

            const [transcriptText, sessionLog, contextTail, auditSummary, newsBriefing, historyStats] =
                await Promise.all([
                    safeReadText(join(sessionDir, 'transcript.txt')),
                    safeReadText(join(sessionDir, 'session.log')),
                    safeReadText(join(sessionDir, 'context_tail.txt')),
                    safeReadText(join(sessionDir, 'audit_summary.md')),
                    safeReadText(join(sessionDir, 'news_briefing.md')),
                    safeReadText(join(sessionDir, 'history_stats.md')),
                ]);

            const charts = (await fileExists(chartsDir))
                ? (await readdir(chartsDir)).map((name) => ({
                    name,
                    url: `/outputs/roundtable/${sessionId}/charts/${name}`,
                }))
                : [];

            const toolShots = (await fileExists(toolShotsDir))
                ? (await readdir(toolShotsDir)).map((name) => ({
                    name,
                    url: `/outputs/roundtable/${sessionId}/tool_shots/${name}`,
                }))
                : [];

            return res.json({
                id: sessionId,
                createdAt: st.mtime.toISOString(),
                decision,
                transcriptText,
                sessionLog,
                contextTail,
                audit: {
                    report: auditReport,
                    summaryMarkdown: auditSummary,
                },
                news: {
                    meta: newsMeta,
                    briefingMarkdown: newsBriefing,
                },
                history: {
                    statsMarkdown: historyStats,
                },
                assets: {
                    charts,
                    toolShots,
                },
                urls: {
                    dir: `/outputs/roundtable/${sessionId}/`,
                    log: `/outputs/roundtable/${sessionId}/session.log`,
                    decision: existsSync(join(sessionDir, 'decision.json'))
                        ? `/outputs/roundtable/${sessionId}/decision.json`
                        : null,
                },
            });
        } catch (error) {
            const msg = error?.message || String(error);
            if (msg.includes('ENOENT')) return res.status(404).json({ error: 'Session not found' });
            return res.status(500).json({ error: msg });
        }
    });
}
