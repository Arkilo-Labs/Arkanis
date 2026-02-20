export function nowIso() {
    return new Date().toISOString();
}

export function durationMs(startedAt, endedAt) {
    return Math.max(0, new Date(endedAt).getTime() - new Date(startedAt).getTime());
}
