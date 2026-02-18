import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { appendFile, mkdir, readdir, readFile, stat, writeFile } from 'fs/promises';
import { join } from 'path';

import { resolveDataDir } from '../../../core/utils/dataDir.js';
import { readProviderDefinitions } from '../../../core/services/aiProvidersStore.js';
import { readSecrets } from '../../../core/services/secretsStore.js';
import { createRedactor } from '../../../core/utils/redactSecrets.js';
import { ROUND_EVENT_TO_SOCKET_EVENT, SOCKET_EVENTS } from '../socket/events.js';
import { loadAgentsConfig } from '../../../agents/agents-round/core/config/configLoader.js';
import {
    readAgentProviderOverrides,
    writeAgentProviderOverrides,
} from '../../../core/services/agentProviderOverrideStore.js';
import {
    applySessionEvent,
    createSessionMeta,
    parseEventsNdjson,
    parseSeqQuery,
} from './roundtableSessionStore.js';

const ROUND_EVENT_PREFIX = '__AGENTS_ROUND_EVENT__';
const SESSION_META_FILE = 'session.meta.json';
const SESSION_EVENTS_FILE = 'events.ndjson';

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
            i += 1;
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

function normalizePid(value) {
    const pid = Number(value);
    if (!Number.isFinite(pid) || pid <= 0) return null;
    return Math.trunc(pid);
}

function normalizeExitCode(value) {
    if (value === null || value === undefined || value === '') return null;
    const code = Number(value);
    if (!Number.isFinite(code)) return null;
    return Math.trunc(code);
}

function normalizeLastSeq(value) {
    const seq = Number(value);
    if (!Number.isFinite(seq) || seq < 0) return 0;
    return Math.trunc(seq);
}

function buildSessionPaths(outputsDir, sessionId) {
    const sessionDir = join(outputsDir, sessionId);
    return {
        sessionDir,
        metaPath: join(sessionDir, SESSION_META_FILE),
        eventsPath: join(sessionDir, SESSION_EVENTS_FILE),
    };
}

function enqueueRuntimeTask(runtime, task) {
    runtime.queue = runtime.queue.then(task, task);
    return runtime.queue;
}

function allocateSessionEvent(runtime, { type, timestamp = Date.now(), pid, payload = {} } = {}) {
    const event = {
        seq: normalizeLastSeq(runtime.meta.lastSeq) + 1,
        type: String(type || '').trim(),
        timestamp: Number(timestamp) || Date.now(),
        sessionId: runtime.id,
        pid: normalizePid(pid ?? runtime.meta.pid),
        payload: payload && typeof payload === 'object' ? payload : {},
    };

    runtime.meta = applySessionEvent(runtime.meta, event);
    return event;
}

async function persistRuntimeMeta(runtime) {
    await writeFile(runtime.paths.metaPath, JSON.stringify(runtime.meta, null, 2));
}

async function persistSessionEvent(runtime, event) {
    await appendFile(runtime.paths.eventsPath, `${JSON.stringify(event)}\n`);
    await persistRuntimeMeta(runtime);
}

function createRuntimeSession({ outputsDir, sessionId, pid }) {
    return {
        id: sessionId,
        paths: buildSessionPaths(outputsDir, sessionId),
        queue: Promise.resolve(),
        meta: createSessionMeta({ id: sessionId, pid: normalizePid(pid), timestamp: Date.now() }),
    };
}

function toSessionSnapshot({ sessionId, meta, createdAt, hasDecision = false }) {
    const statusCandidates = new Set(['running', 'completed', 'failed', 'killed', 'incomplete']);
    const status = statusCandidates.has(meta?.status)
        ? meta.status
        : hasDecision
            ? 'completed'
            : 'incomplete';

    const snapshot = {
        id: sessionId,
        status,
        pid: normalizePid(meta?.pid),
        exitCode: normalizeExitCode(meta?.exitCode),
        startedAt:
            typeof meta?.startedAt === 'string' && meta.startedAt
                ? meta.startedAt
                : createdAt || null,
        endedAt:
            typeof meta?.endedAt === 'string' && meta.endedAt
                ? meta.endedAt
                : null,
        lastSeq: normalizeLastSeq(meta?.lastSeq),
    };

    return snapshot;
}

async function readSessionEvents(eventsPath, { after = 0, limit = 200 } = {}) {
    if (!(await fileExists(eventsPath))) return { events: [], nextAfter: parseSeqQuery(after) };

    const raw = await safeReadText(eventsPath);
    if (!raw) return { events: [], nextAfter: parseSeqQuery(after) };
    return parseEventsNdjson(raw, { after: parseSeqQuery(after), limit });
}

function normalizeSocketPayload(event, extra = {}) {
    return {
        ...extra,
        seq: event.seq,
        sessionId: event.sessionId,
        pid: event.pid,
        timestamp: event.timestamp,
    };
}

export function registerRoundtableRoutes({ app, io, projectRoot, activeProcesses }) {
    const dataDir = resolveDataDir({ projectRoot });
    const outputsDir = join(projectRoot, 'outputs', 'roundtable');
    const runtimeSessions = new Map();

    let redactorCache = null;
    let redactorCacheTime = 0;

    async function getRedactor() {
        const now = Date.now();
        if (redactorCache && now - redactorCacheTime < 3000) return redactorCache;

        const { providers } = await readProviderDefinitions({ projectRoot, dataDir }).catch(() => ({
            providers: [],
        }));
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

        // 加载 agent provider 覆盖，注入 CLI 参数
        let overrideArgs = [];
        try {
            const { overrides } = await readAgentProviderOverrides({ dataDir });
            const nonNullOverrides = Object.fromEntries(
                Object.entries(overrides).filter(([, v]) => v !== null),
            );
            if (Object.keys(nonNullOverrides).length > 0) {
                overrideArgs = ['--agent-provider-overrides', JSON.stringify(nonNullOverrides)];
            }
        } catch {
            // 覆盖读取失败不阻断启动
        }

        const scriptPath = resolveRoundtableScriptPath({ projectRoot });
        const cmdArgs = [scriptPath, ...args, ...overrideArgs];

        try {
            const child = spawn(process.execPath, cmdArgs, {
                cwd: projectRoot,
                env: { ...process.env, FORCE_COLOR: '1', AGENTS_ROUND_EMIT_EVENTS: '1' },
                stdio: ['ignore', 'pipe', 'pipe'],
            });

            const pid = normalizePid(child.pid);
            if (pid) activeProcesses.set(pid, child);

            const runtime = createRuntimeSession({
                outputsDir,
                sessionId,
                pid,
            });
            runtimeSessions.set(sessionId, runtime);

            await enqueueRuntimeTask(runtime, async () => {
                await mkdir(runtime.paths.sessionDir, { recursive: true });
                await persistRuntimeMeta(runtime);
                const startEvent = allocateSessionEvent(runtime, {
                    type: 'session-start',
                    timestamp: Date.now(),
                    pid,
                    payload: {
                        source: 'roundtable',
                    },
                });
                await persistSessionEvent(runtime, startEvent);
            });

            const allowedEventTypes = new Set(Object.keys(ROUND_EVENT_TO_SOCKET_EVENT));

            const handleLine = (streamType) => async (line) => {
                if (!line) return;

                await enqueueRuntimeTask(runtime, async () => {
                    if (line.startsWith(ROUND_EVENT_PREFIX)) {
                        const raw = line.slice(ROUND_EVENT_PREFIX.length);
                        let parsed = null;
                        try {
                            parsed = JSON.parse(raw);
                        } catch {
                            parsed = null;
                        }

                        const eventType = parsed?.type ? String(parsed.type).trim() : '';
                        if (parsed && eventType && allowedEventTypes.has(eventType)) {
                            const socketEventName = ROUND_EVENT_TO_SOCKET_EVENT[eventType];
                            if (!socketEventName) return;

                            const rawPayload = {
                                sessionId: parsed.sessionId || sessionId,
                                pid: normalizePid(parsed.pid || pid),
                                timestamp: Number(parsed.timestamp) || Date.now(),
                                ...(parsed.payload || {}),
                            };

                            let sanitizedPayload = rawPayload;
                            try {
                                const redact = await getRedactor();
                                sanitizedPayload = redactDeep(rawPayload, redact);
                            } catch {
                                sanitizedPayload = rawPayload;
                            }

                            const timestamp = Number(sanitizedPayload.timestamp) || Date.now();
                            const event = allocateSessionEvent(runtime, {
                                type: eventType,
                                timestamp,
                                pid: sanitizedPayload.pid,
                                payload: sanitizedPayload,
                            });
                            await persistSessionEvent(runtime, event);

                            io.emit(
                                socketEventName,
                                normalizeSocketPayload(event, {
                                    ...(event.payload || {}),
                                }),
                            );
                            return;
                        }
                    }

                    const baseLog = {
                        type: streamType,
                        data: `${line}\n`,
                        source: 'roundtable',
                    };

                    let sanitizedLog = baseLog;
                    try {
                        const redact = await getRedactor();
                        sanitizedLog = {
                            ...baseLog,
                            data: redact(baseLog.data),
                        };
                    } catch {
                        sanitizedLog = baseLog;
                    }

                    const event = allocateSessionEvent(runtime, {
                        type: 'log',
                        timestamp: Date.now(),
                        pid,
                        payload: sanitizedLog,
                    });
                    await persistSessionEvent(runtime, event);

                    io.emit(
                        SOCKET_EVENTS.LOG,
                        normalizeSocketPayload(event, {
                            ...(event.payload || {}),
                        }),
                    );
                });
            };

            const outBuffer = createLineBuffer((line) => void handleLine('stdout')(line));
            const errBuffer = createLineBuffer((line) => void handleLine('stderr')(line));

            child.stdout.on('data', (chunk) => outBuffer.push(chunk));
            child.stderr.on('data', (chunk) => errBuffer.push(chunk));

            child.on('close', (code, signal) => {
                outBuffer.flush();
                errBuffer.flush();

                void enqueueRuntimeTask(runtime, async () => {
                    const rawCode =
                        code === null || code === undefined || code === '' ? null : Number(code);
                    const payload = {
                        code: Number.isFinite(rawCode) ? rawCode : null,
                        signal: signal || null,
                        source: 'roundtable',
                        killRequested: Boolean(child.__roundtableKilledByUser),
                    };

                    const event = allocateSessionEvent(runtime, {
                        type: 'process-exit',
                        timestamp: Date.now(),
                        pid,
                        payload,
                    });
                    await persistSessionEvent(runtime, event);

                    io.emit(
                        SOCKET_EVENTS.PROCESS_EXIT,
                        normalizeSocketPayload(event, {
                            ...(event.payload || {}),
                        }),
                    );
                })
                    .catch(() => null)
                    .finally(() => {
                        if (pid) activeProcesses.delete(pid);
                        runtimeSessions.delete(sessionId);
                    });
            });

            child.on('error', (err) => {
                const msg = `Failed to start process: ${err.message}`;

                void enqueueRuntimeTask(runtime, async () => {
                    const basePayload = {
                        type: 'error',
                        data: `${msg}\n`,
                        source: 'roundtable',
                    };

                    let payload = basePayload;
                    try {
                        const redact = await getRedactor();
                        payload = {
                            ...basePayload,
                            data: redact(basePayload.data),
                        };
                    } catch {
                        payload = basePayload;
                    }

                    const event = allocateSessionEvent(runtime, {
                        type: 'log',
                        timestamp: Date.now(),
                        pid,
                        payload,
                    });
                    await persistSessionEvent(runtime, event);

                    io.emit(
                        SOCKET_EVENTS.LOG,
                        normalizeSocketPayload(event, {
                            ...(event.payload || {}),
                        }),
                    );
                }).catch(() => null);
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

                    const runtime = runtimeSessions.get(id) || null;
                    const metaPath = join(full, SESSION_META_FILE);
                    const fileMeta = runtime ? null : await safeReadJson(metaPath);
                    const sessionMeta = toSessionSnapshot({
                        sessionId: id,
                        meta: runtime?.meta || fileMeta,
                        createdAt: st.mtime.toISOString(),
                        hasDecision: Boolean(decisionData),
                    });

                    return {
                        id,
                        createdAt: st.mtime.toISOString(),
                        status: sessionMeta.status,
                        pid: sessionMeta.pid,
                        exitCode: sessionMeta.exitCode,
                        lastSeq: sessionMeta.lastSeq,
                        hasDecision: Boolean(decisionData),
                        decision: decisionSummary,
                        urls: {
                            dir: `/outputs/roundtable/${id}/`,
                            log: `/outputs/roundtable/${id}/session.log`,
                            decision: existsSync(decisionPath)
                                ? `/outputs/roundtable/${id}/decision.json`
                                : null,
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

    app.get('/api/roundtable/sessions/:id/events', async (req, res) => {
        const id = String(req.params.id || '').trim();
        let sessionId = '';

        try {
            sessionId = normalizeSessionId(id);
        } catch (e) {
            return res.status(400).json({ error: e?.message || String(e) });
        }
        if (!sessionId) return res.status(400).json({ error: 'sessionId 不能为空' });

        const after = parseSeqQuery(req.query?.after);
        const limit = Math.max(1, Math.min(2000, Number(req.query?.limit) || 500));

        const { sessionDir, eventsPath, metaPath } = buildSessionPaths(outputsDir, sessionId);

        try {
            const st = await stat(sessionDir);
            if (!st.isDirectory()) return res.status(404).json({ error: 'Session not found' });

            const runtime = runtimeSessions.get(sessionId) || null;
            const fileMeta = runtime ? null : await safeReadJson(metaPath);
            const decision = await safeReadJson(join(sessionDir, 'decision.json'));

            const { events, nextAfter } = await readSessionEvents(eventsPath, { after, limit });
            const snapshot = toSessionSnapshot({
                sessionId,
                meta: runtime?.meta || fileMeta,
                createdAt: st.mtime.toISOString(),
                hasDecision: Boolean(decision),
            });

            return res.json({
                session: snapshot,
                events,
                nextAfter,
            });
        } catch (error) {
            const msg = error?.message || String(error);
            if (msg.includes('ENOENT')) return res.status(404).json({ error: 'Session not found' });
            return res.status(500).json({ error: msg });
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
            const runtime = runtimeSessions.get(sessionId) || null;
            const sessionMetaRaw = runtime?.meta || (await safeReadJson(join(sessionDir, SESSION_META_FILE)));
            const decision = await safeReadJson(join(sessionDir, 'decision.json'));
            const sessionMeta = toSessionSnapshot({
                sessionId,
                meta: sessionMetaRaw,
                createdAt: st.mtime.toISOString(),
                hasDecision: Boolean(decision),
            });

            const [auditReport, newsMeta] = await Promise.all([
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
                status: sessionMeta.status,
                pid: sessionMeta.pid,
                exitCode: sessionMeta.exitCode,
                lastSeq: sessionMeta.lastSeq,
                session: sessionMeta,
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

    // --- Agent Provider 覆盖管理 ---

    const ROUNDTABLE_CONFIG_DIR = join(projectRoot, 'src', 'agents', 'agents-round', 'config');

    app.get('/api/roundtable/agent-providers', async (_req, res) => {
        try {
            const [agentsConfig, { overrides }, { providers }] = await Promise.all([
                Promise.resolve().then(() => loadAgentsConfig(ROUNDTABLE_CONFIG_DIR)),
                readAgentProviderOverrides({ dataDir }),
                readProviderDefinitions({ projectRoot, dataDir }),
            ]);

            const allAgents = [
                ...(agentsConfig.agents || []),
                ...(agentsConfig.subagents || []),
            ];

            const agents = allAgents.map((a) => ({
                name: a.name,
                role: a.role,
                defaultProviderRef: a.provider_ref,
                overrideProviderRef: overrides[a.name] ?? null,
                effectiveProviderRef: overrides[a.name] ?? a.provider_ref,
                isOverridden: Boolean(overrides[a.name]),
                order: a.order,
                isSubagent: (agentsConfig.subagents || []).some((s) => s.name === a.name),
            }));

            const providerList = providers.map((p) => ({ id: p.id, name: p.name }));
            return res.json({ agents, providers: providerList });
        } catch (error) {
            return res.status(500).json({ error: error?.message || String(error) });
        }
    });

    app.put('/api/roundtable/agent-providers', async (req, res) => {
        try {
            const overridesMap = req.body?.overrides;
            if (!overridesMap || typeof overridesMap !== 'object' || Array.isArray(overridesMap)) {
                return res.status(400).json({ error: 'overrides 必须是对象' });
            }

            const [agentsConfig, { providers }] = await Promise.all([
                Promise.resolve().then(() => loadAgentsConfig(ROUNDTABLE_CONFIG_DIR)),
                readProviderDefinitions({ projectRoot, dataDir }),
            ]);

            const allAgents = [
                ...(agentsConfig.agents || []),
                ...(agentsConfig.subagents || []),
            ];
            const knownAgentNames = allAgents.map((a) => a.name);
            const knownProviderIds = providers.map((p) => p.id);

            const result = await writeAgentProviderOverrides({
                dataDir,
                overridesMap,
                knownAgentNames,
                knownProviderIds,
            });

            io.emit(SOCKET_EVENTS.PROVIDERS_UPDATED);
            return res.json(result);
        } catch (error) {
            return res.status(400).json({ error: error?.message || String(error) });
        }
    });
}
