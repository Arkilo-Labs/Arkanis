function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeSecretValues(values) {
    const uniq = new Set();
    for (const item of values || []) {
        const value = typeof item === 'string' ? item : String(item ?? '');
        const trimmed = value.trim();
        if (!trimmed) continue;
        if (trimmed.length < 8) continue;
        uniq.add(trimmed);
    }
    return Array.from(uniq).sort((a, b) => b.length - a.length);
}

export function createRedactor({ secretValues = [] } = {}) {
    const normalized = normalizeSecretValues(secretValues);
    const exactPatterns = normalized.map((value) => new RegExp(escapeRegExp(value), 'g'));

    const commonPatterns = [
        { pattern: /\bsk-[A-Za-z0-9]{10,}\b/g, replacement: 'sk-[REDACTED]' },
        { pattern: /\bBearer\s+[A-Za-z0-9._-]{10,}\b/gi, replacement: 'Bearer [REDACTED]' },
        { pattern: /"apiKey"\s*:\s*"[^"]+"/g, replacement: '"apiKey":"[REDACTED]"' },
    ];

    return function redact(input) {
        if (input === null || input === undefined) return '';
        let text = typeof input === 'string' ? input : String(input);

        for (const re of exactPatterns) {
            text = text.replace(re, '[REDACTED]');
        }

        for (const { pattern, replacement } of commonPatterns) {
            text = text.replace(pattern, replacement);
        }

        return text;
    };
}

