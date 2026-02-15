import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'crypto';
import { constants as fsConstants } from 'fs';
import { access, mkdir, readFile, rename, unlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { promisify } from 'util';

import { resolveDataDir } from '../../../core/utils/dataDir.js';

const scrypt = promisify(scryptCallback);

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PASSWORD_KEY_LEN = 64;

function isTruthyEnv(value) {
    const normalized = String(value || '')
        .trim()
        .toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'y';
}

function nowIso() {
    return new Date().toISOString();
}

async function ensureWritableDir(dirPath) {
    await mkdir(dirPath, { recursive: true });
    await access(dirPath, fsConstants.W_OK);

    const probePath = join(dirPath, `.arkanis_write_probe_${process.pid}_${Date.now()}`);
    await writeFile(probePath, 'ok', { encoding: 'utf-8', mode: 0o600 });
    await unlink(probePath);
}

async function fileExists(path) {
    try {
        await access(path, fsConstants.F_OK);
        return true;
    } catch {
        return false;
    }
}

async function readJsonFile(path) {
    const content = await readFile(path, 'utf-8');
    return JSON.parse(content);
}

async function writeJsonFileAtomic(path, data, { mode = 0o600 } = {}) {
    const tmpPath = `${path}.tmp.${process.pid}.${Date.now()}`;
    const content = `${JSON.stringify(data, null, 2)}\n`;
    await writeFile(tmpPath, content, { encoding: 'utf-8', mode });
    await rename(tmpPath, path);
}

function validateAdminRecord(value) {
    if (!value || typeof value !== 'object') throw new Error('admin.json 格式不正确');
    if (value.version !== 1) throw new Error('admin.json 版本不支持');
    if (typeof value.username !== 'string' || value.username.trim() === '') throw new Error('admin.json 缺少 username');
    if (!value.password || typeof value.password !== 'object') throw new Error('admin.json 缺少 password');
    if (value.password.algo !== 'scrypt') throw new Error('admin.json password.algo 不支持');
    if (typeof value.password.salt !== 'string' || value.password.salt === '') throw new Error('admin.json 缺少 salt');
    if (typeof value.password.hash !== 'string' || value.password.hash === '') throw new Error('admin.json 缺少 hash');
    if (typeof value.password.keyLen !== 'number' || value.password.keyLen <= 0) {
        throw new Error('admin.json 缺少 keyLen');
    }
    return true;
}

async function hashPassword(password) {
    const salt = randomBytes(16);
    const derivedKey = await scrypt(password, salt, PASSWORD_KEY_LEN);
    return {
        algo: 'scrypt',
        salt: salt.toString('base64'),
        hash: Buffer.from(derivedKey).toString('base64'),
        keyLen: PASSWORD_KEY_LEN,
    };
}

async function verifyPassword(password, stored) {
    if (!stored || stored.algo !== 'scrypt') return false;
    const salt = Buffer.from(String(stored.salt || ''), 'base64');
    const expected = Buffer.from(String(stored.hash || ''), 'base64');
    if (!salt.length || !expected.length) return false;
    const derivedKey = await scrypt(password, salt, stored.keyLen || PASSWORD_KEY_LEN);
    const actual = Buffer.from(derivedKey);
    if (actual.length !== expected.length) return false;
    return timingSafeEqual(actual, expected);
}

function createSessionStore() {
    const sessions = new Map();

    function createSession({ username }) {
        const expiresAt = Date.now() + SESSION_TTL_MS;
        for (let i = 0; i < 5; i += 1) {
            const token = randomBytes(32).toString('base64url');
            if (sessions.has(token)) continue;
            sessions.set(token, { username, expiresAt });
            return token;
        }
        throw new Error('无法生成 session token');
    }

    function validateSession(token) {
        const value = typeof token === 'string' ? token.trim() : '';
        if (!value) return null;
        const session = sessions.get(value);
        if (!session) return null;
        if (session.expiresAt <= Date.now()) {
            sessions.delete(value);
            return null;
        }
        return { token: value, username: session.username };
    }

    function deleteSession(token) {
        const value = typeof token === 'string' ? token.trim() : '';
        if (!value) return;
        sessions.delete(value);
    }

    return { createSession, validateSession, deleteSession };
}

function extractRequestToken(req) {
    const header = req?.headers?.authorization;
    if (typeof header === 'string') {
        const match = header.match(/^Bearer\s+(.+)$/i);
        if (match && match[1]) return match[1].trim();
    }
    const fallback = req?.headers?.['x-session-token'];
    if (typeof fallback === 'string' && fallback.trim()) return fallback.trim();
    return null;
}

export async function initAuthService({ projectRoot }) {
    const allowNoAuth = isTruthyEnv(process.env.ALLOW_NO_AUTH);
    const dataDir = resolveDataDir({ projectRoot });

    try {
        await ensureWritableDir(dataDir);
    } catch (error) {
        const message = error?.message || String(error);
        throw new Error(
            `数据目录不可写: ${dataDir}\n` +
                `请设置 ARKANIS_DATA_DIR（例如本地开发用 ./data；Docker 部署用 /data）\n` +
                `原始错误: ${message}`
        );
    }

    const adminFile = join(dataDir, 'admin.json');
    const setupTokenFile = join(dataDir, 'setup-token.json');

    let admin = null;
    if (await fileExists(adminFile)) {
        const record = await readJsonFile(adminFile);
        validateAdminRecord(record);
        admin = record;
    }

    let setupToken = null;
    if (!allowNoAuth && !admin) {
        if (await fileExists(setupTokenFile)) {
            try {
                const record = await readJsonFile(setupTokenFile);
                if (record && record.version === 1 && typeof record.token === 'string' && record.token.trim() !== '') {
                    setupToken = record.token.trim();
                }
            } catch {
                // 忽略，走重新生成
            }
        }
        if (!setupToken) {
            setupToken = randomBytes(32).toString('base64url');
            await writeJsonFileAtomic(setupTokenFile, { version: 1, token: setupToken, createdAt: nowIso() });
        }
        console.log(`[Setup] 访问 /_setup/${setupToken} 完成初始化`);
    }

    const sessionStore = createSessionStore();

    function isInitialized() {
        return Boolean(admin);
    }

    function isSetupMode() {
        return !allowNoAuth && !admin;
    }

    function validateSetupToken(token) {
        if (!setupToken || typeof token !== 'string') return false;
        return token.trim() === setupToken;
    }

    function getSetupToken() {
        return setupToken;
    }

    function getStatus({ token }) {
        if (allowNoAuth) {
            return { allowNoAuth: true, initialized: true, authed: true, user: null };
        }
        if (!admin) {
            return { allowNoAuth: false, initialized: false, authed: false, user: null };
        }
        const session = sessionStore.validateSession(token);
        if (!session) return { allowNoAuth: false, initialized: true, authed: false, user: null };
        return { allowNoAuth: false, initialized: true, authed: true, user: { username: session.username } };
    }

    async function initAdmin({ username, password }) {
        if (allowNoAuth) throw new Error('ALLOW_NO_AUTH 已开启，不需要初始化');
        if (admin) throw new Error('已初始化');

        const passwordRecord = await hashPassword(password);
        admin = {
            version: 1,
            username,
            password: passwordRecord,
            createdAt: nowIso(),
        };

        await writeJsonFileAtomic(adminFile, admin);
        await unlink(setupTokenFile).catch(() => null);
        setupToken = null;

        const token = sessionStore.createSession({ username });
        return { token, user: { username } };
    }

    async function login({ username, password }) {
        if (allowNoAuth) throw new Error('ALLOW_NO_AUTH 已开启，不需要登录');
        if (!admin) throw new Error('尚未初始化');
        if (String(username).trim() !== admin.username) return null;
        const ok = await verifyPassword(password, admin.password);
        if (!ok) return null;
        const token = sessionStore.createSession({ username: admin.username });
        return { token, user: { username: admin.username } };
    }

    function logout(token) {
        sessionStore.deleteSession(token);
    }

    function requireSession(token) {
        const session = sessionStore.validateSession(token);
        if (!session) return null;
        return { token: session.token, user: { username: session.username } };
    }

    return {
        allowNoAuth,
        dataDir,
        isInitialized,
        isSetupMode,
        validateSetupToken,
        getSetupToken,
        getStatus,
        initAdmin,
        login,
        logout,
        requireSession,
        extractRequestToken,
    };
}
