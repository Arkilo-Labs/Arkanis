import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { authedFetch } from './useAuth.js';
import { applyRoundtableEvent, createRoundtableEventState } from './roundtableState.js';
import { useSocket } from './useSocket.js';

const SESSION_STORAGE_KEY = 'arkanis_roundtable_last_session_id';
const SESSION_LIST_LIMIT = 100;
const REPLAY_LIMIT = 2000;

function normalizeSessionId(value) {
    const id = typeof value === 'string' ? value.trim() : '';
    return id ? id : null;
}

function readStoredSessionId() {
    try {
        return normalizeSessionId(localStorage.getItem(SESSION_STORAGE_KEY));
    } catch {
        return null;
    }
}

function writeStoredSessionId(sessionId) {
    try {
        if (sessionId) localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
        else localStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
        // ignore
    }
}

function extractJsonObject(text) {
    const raw = String(text || '').trim();
    if (!raw) return null;
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) return null;

    try {
        return JSON.parse(raw.slice(start, end + 1));
    } catch {
        return null;
    }
}

function createFallbackEventsFromDetail(detail, sessionId) {
    const id = normalizeSessionId(sessionId);
    if (!id || !detail || typeof detail !== 'object') return [];

    const transcript = Array.isArray(detail?.decision?.transcript)
        ? detail.decision.transcript
        : [];

    const createdAt = Date.parse(detail.createdAt || '') || Date.now();
    let seq = 0;
    const pid = Number.isFinite(Number(detail?.pid)) ? Number(detail.pid) : null;

    const events = transcript.map((item, index) => {
        seq += 1;
        return {
            seq,
            type: 'agent-speak',
            timestamp: createdAt + index,
            sessionId: id,
            pid,
            payload: {
                phase: 'history',
                turn: index + 1,
                name: String(item?.name || '').trim() || `agent-${index + 1}`,
                role: String(item?.role || '').trim() || 'UnknownRole',
                provider: '',
                text: String(item?.text || ''),
                audited: Boolean(item?.audited),
                filtered: Boolean(item?.filtered),
            },
        };
    });

    const decisionText = String(detail?.decision?.decision || '').trim();
    if (decisionText) {
        const parsed = extractJsonObject(decisionText);
        seq += 1;
        events.push({
            seq,
            type: 'decision',
            timestamp: createdAt + seq,
            sessionId: id,
            pid,
            payload: {
                stage: 'final',
                turn: seq,
                speaker: parsed?.meta?.agent || 'leader',
                json: parsed || { preview: decisionText.slice(0, 240) },
            },
        });
    }

    if (detail?.status && detail.status !== 'running') {
        seq += 1;
        events.push({
            seq,
            type: 'process-exit',
            timestamp: createdAt + seq,
            sessionId: id,
            pid,
            payload: {
                code: Number.isFinite(Number(detail.exitCode)) ? Number(detail.exitCode) : null,
                signal: detail.status === 'killed' ? 'SIGTERM' : null,
                killRequested: detail.status === 'killed',
            },
        });
    }

    return events;
}

function normalizeSessionMeta(raw, sessionId) {
    if (!raw || typeof raw !== 'object') return null;

    return {
        id: normalizeSessionId(raw.id) || normalizeSessionId(sessionId),
        status: String(raw.status || '').trim() || 'incomplete',
        pid: Number.isFinite(Number(raw.pid)) ? Number(raw.pid) : null,
        exitCode: Number.isFinite(Number(raw.exitCode)) ? Number(raw.exitCode) : null,
        startedAt: typeof raw.startedAt === 'string' ? raw.startedAt : null,
        endedAt: typeof raw.endedAt === 'string' ? raw.endedAt : null,
        lastSeq: Number.isFinite(Number(raw.lastSeq)) ? Number(raw.lastSeq) : 0,
    };
}

export function useRoundtable({ initialSessionId = '' } = {}) {
    const { socket } = useSocket();

    const [sessions, setSessions] = useState([]);
    const [selectedSessionId, setSelectedSessionId] = useState(
        () => normalizeSessionId(initialSessionId) || readStoredSessionId(),
    );
    const [sessionMeta, setSessionMeta] = useState(null);
    const [isReplaying, setIsReplaying] = useState(false);
    const [eventState, setEventState] = useState(() => createRoundtableEventState());

    const selectedSessionRef = useRef(selectedSessionId);
    const lastSeqRef = useRef(eventState.lastSeq);

    selectedSessionRef.current = selectedSessionId;
    lastSeqRef.current = eventState.lastSeq;

    const clear = useCallback(() => {
        setEventState(createRoundtableEventState());
    }, []);

    const applyEvent = useCallback((event) => {
        const incomingSessionId = normalizeSessionId(event?.sessionId);
        const currentSessionId = selectedSessionRef.current;
        if (!currentSessionId || incomingSessionId !== currentSessionId) return;

        setEventState((prev) => applyRoundtableEvent(prev, event));
    }, []);

    const loadSessions = useCallback(async () => {
        const response = await authedFetch(
            `/api/roundtable/sessions?limit=${SESSION_LIST_LIMIT}`,
        );
        const payload = await response.json().catch(() => null);

        if (!response.ok) {
            const message =
                payload && typeof payload === 'object' && payload.error
                    ? String(payload.error)
                    : `请求失败: ${response.status}`;
            throw new Error(message);
        }

        const list = Array.isArray(payload?.sessions) ? payload.sessions : [];
        setSessions(list);
        return list;
    }, []);

    const replayFrom = useCallback(async (afterSeq = 0, options = {}) => {
        const targetSessionId =
            normalizeSessionId(options.sessionId) || selectedSessionRef.current;
        if (!targetSessionId) return null;

        const after = Math.max(0, Number(afterSeq) || 0);
        const limit = Math.max(1, Math.min(REPLAY_LIMIT, Number(options.limit) || REPLAY_LIMIT));
        const replace = Boolean(options.replace);
        const includeFallback = options.includeFallback !== false;

        setIsReplaying(true);
        try {
            const response = await authedFetch(
                `/api/roundtable/sessions/${targetSessionId}/events?after=${after}&limit=${limit}`,
            );
            const payload = await response.json().catch(() => null);

            if (!response.ok) {
                const message =
                    payload && typeof payload === 'object' && payload.error
                        ? String(payload.error)
                        : `请求失败: ${response.status}`;
                throw new Error(message);
            }

            const remoteEvents = Array.isArray(payload?.events) ? payload.events : [];
            const remoteMeta = normalizeSessionMeta(payload?.session, targetSessionId);
            if (remoteMeta) {
                setSessionMeta((prev) => {
                    // 不允许从终态回退到 running（防止 kill 后 API 响应滞后覆盖正确状态）
                    const TERMINAL = new Set(['killed', 'completed', 'failed']);
                    if (prev && TERMINAL.has(prev.status) && remoteMeta.status === 'running') {
                        return prev;
                    }
                    return remoteMeta;
                });
            }

            setEventState((prev) => {
                let next = replace ? createRoundtableEventState() : prev;
                for (const event of remoteEvents) {
                    next = applyRoundtableEvent(next, event);
                }
                return next;
            });

            if (!remoteEvents.length && includeFallback && replace) {
                const detailRes = await authedFetch(`/api/roundtable/sessions/${targetSessionId}`);
                const detail = await detailRes.json().catch(() => null);

                if (detailRes.ok && detail && typeof detail === 'object') {
                    const fallbackEvents = createFallbackEventsFromDetail(
                        detail,
                        targetSessionId,
                    );
                    const detailMeta = normalizeSessionMeta(
                        detail.session || {
                            id: detail.id,
                            status: detail.status,
                            pid: detail.pid,
                            exitCode: detail.exitCode,
                            lastSeq: detail.lastSeq,
                            startedAt: detail.startedAt || detail.createdAt,
                            endedAt: detail.endedAt || null,
                        },
                        targetSessionId,
                    );

                    if (detailMeta) setSessionMeta(detailMeta);

                    setEventState(() => {
                        let next = createRoundtableEventState();
                        for (const event of fallbackEvents) {
                            next = applyRoundtableEvent(next, event);
                        }
                        return next;
                    });
                }
            }

            return payload;
        } finally {
            setIsReplaying(false);
        }
    }, []);

    const selectSession = useCallback(
        async (sessionId, { replace = true } = {}) => {
            const id = normalizeSessionId(sessionId);
            if (!id) return;

            setSelectedSessionId(id);
            selectedSessionRef.current = id;
            writeStoredSessionId(id);
            setSessionMeta(null);

            await replayFrom(0, {
                sessionId: id,
                replace,
                includeFallback: true,
                limit: REPLAY_LIMIT,
            });
        },
        [replayFrom],
    );

    useEffect(() => {
        const preferred = normalizeSessionId(initialSessionId);
        if (!preferred) return;

        setSelectedSessionId(preferred);
        selectedSessionRef.current = preferred;
        writeStoredSessionId(preferred);
    }, [initialSessionId]);

    useEffect(() => {
        let cancelled = false;

        async function bootstrap() {
            const list = await loadSessions().catch(() => []);
            if (cancelled) return;

            const current = selectedSessionRef.current;
            if (current) {
                const ok = await replayFrom(0, {
                    sessionId: current,
                    replace: true,
                    includeFallback: true,
                    limit: REPLAY_LIMIT,
                })
                    .then(() => true)
                    .catch(() => false);
                if (ok) return;
            }

            const first = list[0]?.id ? normalizeSessionId(list[0].id) : null;
            if (!first) return;
            setSelectedSessionId(first);
            selectedSessionRef.current = first;
            writeStoredSessionId(first);
            await replayFrom(0, {
                sessionId: first,
                replace: true,
                includeFallback: true,
                limit: REPLAY_LIMIT,
            }).catch(() => null);
        }

        void bootstrap();

        return () => {
            cancelled = true;
        };
    }, [loadSessions, replayFrom]);

    useEffect(() => {
        function onLog(msg) {
            if (String(msg?.source || '').trim() !== 'roundtable') return;
            applyEvent({
                type: 'log',
                seq: msg?.seq,
                timestamp: msg?.timestamp,
                sessionId: msg?.sessionId,
                pid: msg?.pid,
                payload: {
                    type: msg?.type,
                    data: msg?.data,
                    source: msg?.source,
                },
            });
        }

        function onProcessExit(msg) {
            if (String(msg?.source || '').trim() !== 'roundtable') return;
            applyEvent({
                type: 'process-exit',
                seq: msg?.seq,
                timestamp: msg?.timestamp,
                sessionId: msg?.sessionId,
                pid: msg?.pid,
                payload: {
                    code: msg?.code,
                    signal: msg?.signal,
                    killRequested: msg?.killRequested,
                },
            });
            // 立即从 socket 事件同步 sessionMeta，不依赖后续 API 轮询
            const incomingId = normalizeSessionId(msg?.sessionId);
            if (incomingId && incomingId === selectedSessionRef.current) {
                const killRequested = Boolean(msg?.killRequested);
                const rawCode = msg?.code;
                const exitCode = Number.isFinite(Number(rawCode)) ? Number(rawCode) : null;
                const newStatus = killRequested ? 'killed' : exitCode === 0 ? 'completed' : 'failed';
                setSessionMeta((prev) =>
                    prev ? { ...prev, status: newStatus, exitCode } : prev,
                );
                void loadSessions().catch(() => null);
            }
        }

        function onAgentSpeak(msg) {
            applyEvent({
                type: 'agent-speak',
                seq: msg?.seq,
                timestamp: msg?.timestamp,
                sessionId: msg?.sessionId,
                pid: msg?.pid,
                payload: msg,
            });
        }

        function onToolCall(msg) {
            applyEvent({
                type: 'tool-call',
                seq: msg?.seq,
                timestamp: msg?.timestamp,
                sessionId: msg?.sessionId,
                pid: msg?.pid,
                payload: msg,
            });
        }

        function onBeliefUpdate(msg) {
            applyEvent({
                type: 'belief-update',
                seq: msg?.seq,
                timestamp: msg?.timestamp,
                sessionId: msg?.sessionId,
                pid: msg?.pid,
                payload: msg,
            });
        }

        function onDecision(msg) {
            applyEvent({
                type: 'decision',
                seq: msg?.seq,
                timestamp: msg?.timestamp,
                sessionId: msg?.sessionId,
                pid: msg?.pid,
                payload: msg,
            });
        }

        function onTokenUsage(msg) {
            applyEvent({
                type: 'token-usage',
                seq: msg?.seq,
                timestamp: msg?.timestamp,
                sessionId: msg?.sessionId,
                pid: msg?.pid,
                payload: msg,
            });
        }

        function onConnect() {
            const target = selectedSessionRef.current;
            if (!target) return;

            void replayFrom(lastSeqRef.current, {
                sessionId: target,
                replace: false,
                includeFallback: false,
                limit: REPLAY_LIMIT,
            }).catch(() => null);
        }

        socket.on('connect', onConnect);
        socket.on('log', onLog);
        socket.on('process-exit', onProcessExit);
        socket.on('roundtable:agent-speak', onAgentSpeak);
        socket.on('roundtable:tool-call', onToolCall);
        socket.on('roundtable:belief-update', onBeliefUpdate);
        socket.on('roundtable:decision', onDecision);
        socket.on('roundtable:token-usage', onTokenUsage);

        return () => {
            socket.off('connect', onConnect);
            socket.off('log', onLog);
            socket.off('process-exit', onProcessExit);
            socket.off('roundtable:agent-speak', onAgentSpeak);
            socket.off('roundtable:tool-call', onToolCall);
            socket.off('roundtable:belief-update', onBeliefUpdate);
            socket.off('roundtable:decision', onDecision);
            socket.off('roundtable:token-usage', onTokenUsage);
        };
    }, [applyEvent, replayFrom, socket]);

    const isSessionRunning = useMemo(() => {
        if (sessionMeta?.status === 'running') return true;
        return false;
    }, [sessionMeta?.status]);

    return {
        sessions,
        selectedSessionId,
        sessionMeta,
        isReplaying,
        lastSeq: eventState.lastSeq,
        logs: eventState.logs,
        agentSpeaks: eventState.agentSpeaks,
        toolCalls: eventState.toolCalls,
        beliefUpdates: eventState.beliefUpdates,
        decisions: eventState.decisions,
        processExit: eventState.processExit,
        tokenUsage: eventState.tokenUsage,
        isSessionRunning,
        clear,
        applyEvent,
        loadSessions,
        selectSession,
        replayFrom,
        setSelectedSessionId,
    };
}
