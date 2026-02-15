import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { access, mkdir, readFile, rename, writeFile } from 'fs/promises';
import { constants as fsConstants } from 'fs';
import { join } from 'path';

const SECRETS_VERSION = 1;
const ENCRYPTION_VERSION = 1;
const ENCRYPTION_ALGO = 'aes-256-gcm';
const DEFAULT_FILE_MODE = 0o600;

function nowIso() {
    return new Date().toISOString();
}

function deriveKey(encKey) {
    const raw = String(encKey || '');
    return createHash('sha256').update(raw, 'utf8').digest();
}

function encryptJson({ value, encKey }) {
    const key = deriveKey(encKey);
    const iv = randomBytes(12);
    const cipher = createCipheriv(ENCRYPTION_ALGO, key, iv);

    const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();

    return {
        version: ENCRYPTION_VERSION,
        encrypted: true,
        algorithm: ENCRYPTION_ALGO,
        iv: iv.toString('base64'),
        tag: tag.toString('base64'),
        data: encrypted.toString('base64'),
    };
}

function decryptJson({ record, encKey }) {
    if (!record || record.encrypted !== true) {
        throw new Error('decryptJson: record 不是加密格式');
    }
    if (record.version !== ENCRYPTION_VERSION) {
        throw new Error(`secrets.json 加密版本不支持: ${record.version}`);
    }
    if (record.algorithm !== ENCRYPTION_ALGO) {
        throw new Error(`secrets.json 加密算法不支持: ${record.algorithm}`);
    }

    const key = deriveKey(encKey);
    const iv = Buffer.from(String(record.iv || ''), 'base64');
    const tag = Buffer.from(String(record.tag || ''), 'base64');
    const data = Buffer.from(String(record.data || ''), 'base64');
    if (!iv.length || !tag.length || !data.length) {
        throw new Error('secrets.json 加密字段缺失');
    }

    const decipher = createDecipheriv(ENCRYPTION_ALGO, key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    const text = decrypted.toString('utf8');
    return JSON.parse(text);
}

async function fileExists(path) {
    try {
        await access(path, fsConstants.F_OK);
        return true;
    } catch {
        return false;
    }
}

async function writeJsonFileAtomic(path, data, { mode = DEFAULT_FILE_MODE } = {}) {
    const tmpPath = `${path}.tmp.${process.pid}.${Date.now()}`;
    const content = `${JSON.stringify(data, null, 2)}\n`;
    await writeFile(tmpPath, content, { encoding: 'utf-8', mode });
    await rename(tmpPath, path);
}

function normalizeSecrets(value) {
    if (!value || typeof value !== 'object') throw new Error('secrets.json 格式不正确');
    if (value.version !== SECRETS_VERSION) throw new Error(`secrets.json 版本不支持: ${value.version}`);
    const providersRaw = value.providers ?? {};
    if (!providersRaw || typeof providersRaw !== 'object' || Array.isArray(providersRaw)) {
        throw new Error('secrets.json providers 字段必须是对象');
    }

    const providers = {};
    for (const [providerId, item] of Object.entries(providersRaw)) {
        if (!item || typeof item !== 'object') continue;
        const apiKey = typeof item.apiKey === 'string' ? item.apiKey.trim() : '';
        if (!apiKey) continue;
        providers[providerId] = { apiKey };
    }

    return {
        version: SECRETS_VERSION,
        providers,
        createdAt: typeof value.createdAt === 'string' ? value.createdAt : null,
        updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null,
    };
}

export async function readSecrets({ dataDir, encKey = '' }) {
    const filePath = join(dataDir, 'secrets.json');
    if (!(await fileExists(filePath))) {
        return {
            version: SECRETS_VERSION,
            providers: {},
            createdAt: null,
            updatedAt: null,
        };
    }

    const raw = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw);

    if (parsed && parsed.encrypted === true) {
        const key = String(encKey || '').trim();
        if (!key) throw new Error('secrets.json 已加密，但未设置 SECRETS_ENC_KEY');
        const decrypted = decryptJson({ record: parsed, encKey: key });
        return normalizeSecrets(decrypted);
    }

    return normalizeSecrets(parsed);
}

export async function writeSecretsAtomic({ dataDir, encKey = '', secrets }) {
    await mkdir(dataDir, { recursive: true });
    const filePath = join(dataDir, 'secrets.json');
    const key = String(encKey || '').trim();
    const record = key ? encryptJson({ value: secrets, encKey: key }) : secrets;
    await writeJsonFileAtomic(filePath, record, { mode: DEFAULT_FILE_MODE });
}

export async function setProviderApiKey({ dataDir, encKey = '', providerId, apiKey }) {
    const id = String(providerId || '').trim();
    if (!id) throw new Error('providerId 不能为空');
    const key = String(apiKey || '').trim();
    if (!key) throw new Error('apiKey 不能为空');

    const secrets = await readSecrets({ dataDir, encKey });
    const createdAt = secrets.createdAt || nowIso();
    const updatedAt = nowIso();
    const next = {
        version: SECRETS_VERSION,
        providers: { ...secrets.providers, [id]: { apiKey: key } },
        createdAt,
        updatedAt,
    };
    await writeSecretsAtomic({ dataDir, encKey, secrets: next });
    return { providerId: id };
}

export async function deleteProviderApiKey({ dataDir, encKey = '', providerId }) {
    const id = String(providerId || '').trim();
    if (!id) throw new Error('providerId 不能为空');

    const secrets = await readSecrets({ dataDir, encKey });
    if (!secrets.providers[id]) return { removed: false };

    const nextProviders = { ...secrets.providers };
    delete nextProviders[id];
    const next = {
        version: SECRETS_VERSION,
        providers: nextProviders,
        createdAt: secrets.createdAt || nowIso(),
        updatedAt: nowIso(),
    };
    await writeSecretsAtomic({ dataDir, encKey, secrets: next });
    return { removed: true };
}

