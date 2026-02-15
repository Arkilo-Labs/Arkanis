import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSocket } from './useSocket.js';

const LOG_LIMIT = 1200;
const EVENT_LIMIT = 300;

function normalizeSessionId(value) {
    const id = typeof value === 'string' ? value.trim() : '';
    return id ? id : null;
}

function appendWithLimit(prev, item, limit) {
    const next = [...prev, item];
    if (next.length <= limit) return next;
    return next.slice(next.length - limit);
}

export function useRoundtable({ sessionId }) {
    const { socket } = useSocket();
    const normalizedSessionId = useMemo(() => normalizeSessionId(sessionId), [sessionId]);
    const sessionRef = useRef(normalizedSessionId);

    // 让事件回调永远读取到最新 sessionId
    sessionRef.current = normalizedSessionId;

    const [logs, setLogs] = useState([]);
    const [agentSpeaks, setAgentSpeaks] = useState([]);
    const [toolCalls, setToolCalls] = useState([]);
    const [beliefUpdates, setBeliefUpdates] = useState([]);
    const [decisions, setDecisions] = useState([]);
    const [processExit, setProcessExit] = useState(null);

    const clear = useCallback(() => {
        setLogs([]);
        setAgentSpeaks([]);
        setToolCalls([]);
        setBeliefUpdates([]);
        setDecisions([]);
        setProcessExit(null);
    }, []);

    useEffect(() => {
        clear();
    }, [clear, normalizedSessionId]);

    useEffect(() => {
        function matchSession(msg) {
            const expected = sessionRef.current;
            if (!expected) return false;
            const incoming = normalizeSessionId(msg?.sessionId);
            return incoming === expected;
        }

        function onLog(msg) {
            if (!matchSession(msg)) return;
            if (String(msg?.source || '').trim() !== 'roundtable') return;

            const entry = {
                type: String(msg?.type || 'stdout'),
                data: typeof msg?.data === 'string' ? msg.data : String(msg?.data ?? ''),
                timestamp: Date.now(),
                pid: msg?.pid ?? null,
                sessionId: sessionRef.current,
            };

            setLogs((prev) => appendWithLimit(prev, entry, LOG_LIMIT));
        }

        function onProcessExit(msg) {
            if (!matchSession(msg)) return;
            if (String(msg?.source || '').trim() !== 'roundtable') return;

            const exitInfo = {
                code: Number.isFinite(Number(msg?.code)) ? Number(msg.code) : null,
                pid: msg?.pid ?? null,
                sessionId: sessionRef.current,
                timestamp: Date.now(),
            };

            setProcessExit(exitInfo);
        }

        function onAgentSpeak(msg) {
            if (!matchSession(msg)) return;
            const entry = { ...(msg || {}), timestamp: msg?.timestamp ?? Date.now() };
            setAgentSpeaks((prev) => appendWithLimit(prev, entry, EVENT_LIMIT));
        }

        function onToolCall(msg) {
            if (!matchSession(msg)) return;
            const entry = { ...(msg || {}), timestamp: msg?.timestamp ?? Date.now() };
            setToolCalls((prev) => appendWithLimit(prev, entry, EVENT_LIMIT));
        }

        function onBeliefUpdate(msg) {
            if (!matchSession(msg)) return;
            const entry = { ...(msg || {}), timestamp: msg?.timestamp ?? Date.now() };
            setBeliefUpdates((prev) => appendWithLimit(prev, entry, EVENT_LIMIT));
        }

        function onDecision(msg) {
            if (!matchSession(msg)) return;
            const entry = { ...(msg || {}), timestamp: msg?.timestamp ?? Date.now() };
            setDecisions((prev) => appendWithLimit(prev, entry, EVENT_LIMIT));
        }

        socket.on('log', onLog);
        socket.on('process-exit', onProcessExit);
        socket.on('roundtable:agent-speak', onAgentSpeak);
        socket.on('roundtable:tool-call', onToolCall);
        socket.on('roundtable:belief-update', onBeliefUpdate);
        socket.on('roundtable:decision', onDecision);

        return () => {
            socket.off('log', onLog);
            socket.off('process-exit', onProcessExit);
            socket.off('roundtable:agent-speak', onAgentSpeak);
            socket.off('roundtable:tool-call', onToolCall);
            socket.off('roundtable:belief-update', onBeliefUpdate);
            socket.off('roundtable:decision', onDecision);
        };
    }, [socket]);

    return {
        logs,
        agentSpeaks,
        toolCalls,
        beliefUpdates,
        decisions,
        processExit,
        clear,
    };
}

