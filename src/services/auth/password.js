import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scrypt = promisify(scryptCallback);

const DEFAULT_SCRYPT_PARAMS = {
    N: 1 << 14,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
};

function b64urlEncode(buf) {
    return Buffer.from(buf).toString('base64url');
}

function b64urlDecode(str) {
    return Buffer.from(str, 'base64url');
}

export async function hashPassword(password) {
    const plain = String(password ?? '');
    if (plain.length < 8) throw new Error('密码长度至少 8 位');

    const salt = randomBytes(16);
    const key = await scrypt(plain, salt, 64, DEFAULT_SCRYPT_PARAMS);
    const { N, r, p } = DEFAULT_SCRYPT_PARAMS;
    return `scrypt$v1$${N}$${r}$${p}$${b64urlEncode(salt)}$${b64urlEncode(key)}`;
}

export async function verifyPassword(password, stored) {
    const plain = String(password ?? '');
    const value = String(stored ?? '');
    const parts = value.split('$');

    if (parts.length < 5 || parts[0] !== 'scrypt' || parts[1] !== 'v1') {
        return false;
    }

    let N = DEFAULT_SCRYPT_PARAMS.N;
    let r = DEFAULT_SCRYPT_PARAMS.r;
    let p = DEFAULT_SCRYPT_PARAMS.p;
    let saltPartIndex = 3;
    let keyPartIndex = 4;

    // 兼容旧格式：scrypt$v1$salt$key
    if (parts.length >= 7) {
        N = Number.parseInt(parts[2], 10);
        r = Number.parseInt(parts[3], 10);
        p = Number.parseInt(parts[4], 10);
        saltPartIndex = 5;
        keyPartIndex = 6;
    }

    if (![N, r, p].every((n) => Number.isInteger(n) && n > 0)) return false;

    const salt = b64urlDecode(parts[saltPartIndex]);
    const expected = b64urlDecode(parts[keyPartIndex]);
    const key = await scrypt(plain, salt, expected.length, { ...DEFAULT_SCRYPT_PARAMS, N, r, p });

    if (expected.length !== key.length) return false;
    return timingSafeEqual(expected, key);
}
