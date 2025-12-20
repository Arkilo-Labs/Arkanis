import { createHash, randomBytes } from 'crypto';

function hashToken(token) {
    return createHash('sha256').update(token).digest('base64url');
}

export function generateSessionToken() {
    return randomBytes(32).toString('base64url');
}

export function tokenToHash(token) {
    const value = String(token ?? '').trim();
    if (!value) throw new Error('缺少 token');
    return hashToken(value);
}

