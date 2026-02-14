import { randomBytes, timingSafeEqual } from 'crypto';

let cachedToken = null;

function normalizeToken(value) {
    if (typeof value !== 'string') return '';
    return value.trim();
}

export function getChartWriteToken() {
    if (cachedToken) return cachedToken;

    const configured = normalizeToken(process.env.CHART_WRITE_TOKEN);
    if (configured) {
        cachedToken = configured;
        return cachedToken;
    }

    cachedToken = randomBytes(32).toString('base64url');
    return cachedToken;
}

export function isValidChartWriteToken(value) {
    const candidate = normalizeToken(value);
    if (!candidate) return false;

    const expected = getChartWriteToken();
    if (!expected) return false;

    const expectedBuf = Buffer.from(expected);
    const candidateBuf = Buffer.from(candidate);
    if (expectedBuf.length !== candidateBuf.length) return false;
    return timingSafeEqual(candidateBuf, expectedBuf);
}

