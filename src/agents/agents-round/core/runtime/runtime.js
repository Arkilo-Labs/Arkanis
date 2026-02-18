export function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

export async function withTimeout(promise, ms, label) {
    const timeoutMs = Math.max(1, Number(ms) || 0);
    let t = null;
    try {
        return await Promise.race([
            promise,
            new Promise((_, reject) => {
                t = setTimeout(() => {
                    reject(new Error(`${label || '操作'} 超时（${timeoutMs}ms）`));
                }, timeoutMs);
            }),
        ]);
    } finally {
        if (t) clearTimeout(t);
    }
}

export async function withRetries(fn, { retries = 2, baseDelayMs = 800, onRetry = null } = {}) {
    let lastErr = null;
    for (let attempt = 1; attempt <= retries + 1; attempt++) {
        try {
            return await fn({ attempt });
        } catch (e) {
            lastErr = e;
            if (attempt > retries) break;
            const delay = baseDelayMs * attempt;
            if (onRetry) onRetry({ attempt, retries, delay, error: e });
            await sleep(delay);
        }
    }
    throw lastErr;
}

