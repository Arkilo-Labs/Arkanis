function normalizePositiveInteger(value, fallback = 0) {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    const intValue = Math.trunc(num);
    if (intValue < 0) return fallback;
    return intValue;
}

export function createSessionMeta({ id, pid, timestamp = Date.now() } = {}) {
    return {
        id: String(id || '').trim(),
        status: 'running',
        pid: pid ?? null,
        exitCode: null,
        startedAt: new Date(Number(timestamp) || Date.now()).toISOString(),
        endedAt: null,
        lastSeq: 0,
    };
}

export function resolveExitStatus({ code, signal, killRequested = false } = {}) {
    if (killRequested || signal) return 'killed';
    if (code === null || code === undefined || code === '') return 'failed';
    const numericCode = Number(code);
    if (!Number.isFinite(numericCode)) return 'failed';
    return numericCode === 0 ? 'completed' : 'failed';
}

export function applySessionEvent(meta, event) {
    const next = {
        ...(meta || createSessionMeta({})),
    };

    const seq = normalizePositiveInteger(event?.seq, null);
    if (seq != null) next.lastSeq = Math.max(next.lastSeq || 0, seq);

    const timestamp = Number(event?.timestamp) || Date.now();
    const timestampIso = new Date(timestamp).toISOString();

    const type = String(event?.type || '').trim();
    if (type === 'session-start') {
        next.status = 'running';
        next.startedAt = next.startedAt || timestampIso;
        if (event?.pid != null) next.pid = event.pid;
        return next;
    }

    if (type === 'process-exit') {
        const payload = event?.payload && typeof event.payload === 'object' ? event.payload : {};
        const codeValue =
            payload.code === null || payload.code === undefined || payload.code === ''
                ? null
                : Number(payload.code);
        next.exitCode = Number.isFinite(codeValue) ? codeValue : null;
        next.endedAt = timestampIso;
        next.status = resolveExitStatus({
            code: payload.code,
            signal: payload.signal,
            killRequested: payload.killRequested,
        });
        if (event?.pid != null) next.pid = event.pid;
        return next;
    }

    if (event?.pid != null) next.pid = event.pid;
    return next;
}

export function parseEventsNdjson(raw, { after = 0, limit = 200 } = {}) {
    const normalizedAfter = normalizePositiveInteger(after, 0);
    const normalizedLimit = Math.max(1, Math.min(2000, normalizePositiveInteger(limit, 200) || 200));
    const lines = String(raw || '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

    const parsed = [];
    for (const line of lines) {
        let item = null;
        try {
            item = JSON.parse(line);
        } catch {
            continue;
        }
        if (!item || typeof item !== 'object') continue;

        const type = String(item.type || '').trim();
        if (!type) continue;

        const seq = normalizePositiveInteger(item.seq, null);
        if (seq == null || seq <= normalizedAfter) continue;

        parsed.push({ ...item, type, seq });
    }

    parsed.sort((left, right) => left.seq - right.seq);
    const events = parsed.slice(0, normalizedLimit);
    const nextAfter = events.length ? events[events.length - 1].seq : normalizedAfter;
    return { events, nextAfter };
}

export function parseSeqQuery(value) {
    return normalizePositiveInteger(value, 0);
}
