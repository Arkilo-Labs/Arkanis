import { createHash, randomBytes } from 'crypto';

export function hashActivationCode(code) {
    return createHash('sha256').update(String(code ?? ''), 'utf8').digest('base64url');
}

export function generateActivationCodePlaintext({ prefix = 'ARKILO', sizeBytes = 16 } = {}) {
    const token = randomBytes(sizeBytes).toString('base64url').toUpperCase();
    return `${prefix}-${token}`;
}

