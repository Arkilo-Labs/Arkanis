export const DEFAULT_LOG_LIMIT = 1200;
export const DEFAULT_EVENT_LIMIT = 300;

function appendWithLimit(list, item, limit) {
    const next = [...list, item];
    if (next.length <= limit) return next;
    return next.slice(next.length - limit);
}

function normalizeTimestamp(value) {
    const timestamp = Number(value);
    if (Number.isFinite(timestamp) && timestamp > 0) return timestamp;
    return Date.now();
}

function normalizeSeq(value) {
    const seq = Number(value);
    if (!Number.isFinite(seq) || seq < 0) return null;
    return Math.trunc(seq);
}

function normalizeObject(value) {
    if (!value || typeof value !== 'object') return {};
    return value;
}

export function createRoundtableEventState() {
    return {
        lastSeq: 0,
        logs: [],
        agentSpeaks: [],
        toolCalls: [],
        beliefUpdates: [],
        decisions: [],
        processExit: null,
    };
}

export function applyRoundtableEvent(
    prevState,
    rawEvent,
    { logLimit = DEFAULT_LOG_LIMIT, eventLimit = DEFAULT_EVENT_LIMIT } = {},
) {
    const state = prevState || createRoundtableEventState();
    if (!rawEvent || typeof rawEvent !== 'object') return state;

    const type = String(rawEvent.type || '').trim();
    if (!type) return state;

    const nextSeq = normalizeSeq(rawEvent.seq) ?? state.lastSeq + 1;
    if (nextSeq <= state.lastSeq) return state;

    const base = {
        seq: nextSeq,
        timestamp: normalizeTimestamp(rawEvent.timestamp),
        sessionId: rawEvent.sessionId || null,
        pid: rawEvent.pid || null,
    };

    const next = { ...state, lastSeq: nextSeq };

    if (type === 'log') {
        const payload = normalizeObject(rawEvent.payload);
        next.logs = appendWithLimit(
            state.logs,
            {
                ...base,
                type: String(payload.type || 'stdout'),
                data: typeof payload.data === 'string' ? payload.data : String(payload.data || ''),
                source: String(payload.source || 'roundtable'),
            },
            logLimit,
        );
        return next;
    }

    if (type === 'agent-speak') {
        next.agentSpeaks = appendWithLimit(
            state.agentSpeaks,
            { ...normalizeObject(rawEvent.payload), ...base },
            eventLimit,
        );
        return next;
    }

    if (type === 'tool-call') {
        next.toolCalls = appendWithLimit(
            state.toolCalls,
            { ...normalizeObject(rawEvent.payload), ...base },
            eventLimit,
        );
        return next;
    }

    if (type === 'belief-update') {
        next.beliefUpdates = appendWithLimit(
            state.beliefUpdates,
            { ...normalizeObject(rawEvent.payload), ...base },
            eventLimit,
        );
        return next;
    }

    if (type === 'decision') {
        next.decisions = appendWithLimit(
            state.decisions,
            { ...normalizeObject(rawEvent.payload), ...base },
            eventLimit,
        );
        return next;
    }

    if (type === 'process-exit') {
        const payload = normalizeObject(rawEvent.payload);
        const rawCode =
            payload.code === null || payload.code === undefined || payload.code === ''
                ? null
                : Number(payload.code);
        next.processExit = {
            ...base,
            code: Number.isFinite(rawCode) ? rawCode : null,
            signal: payload.signal || null,
            killRequested: Boolean(payload.killRequested),
        };
        return next;
    }

    return next;
}
