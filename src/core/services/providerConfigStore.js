import { access, mkdir, readFile, rename, writeFile } from 'fs/promises';
import { constants as fsConstants } from 'fs';
import { join } from 'path';

const CONFIG_VERSION = 1;
const DEFAULT_FILE_MODE = 0o600;
const ROLE_KEYS = ['lens', 'newser', 'researcher', 'auditor'];

function defaultConfig() {
    return {
        version: CONFIG_VERSION,
        roles: {
            lens: null,
            newser: null,
            researcher: null,
            auditor: null,
        },
    };
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

function normalizeRoles(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('provider-config.json roles 字段必须是对象');
    }

    const keys = Object.keys(value);
    for (const k of keys) {
        if (!ROLE_KEYS.includes(k)) throw new Error(`未知 role: ${k}`);
    }
    for (const required of ROLE_KEYS) {
        if (!(required in value)) throw new Error(`缺少 role: ${required}`);
    }

    const roles = {};
    for (const role of ROLE_KEYS) {
        const v = value[role];
        if (v === null) {
            roles[role] = null;
            continue;
        }
        const id = String(v || '').trim();
        roles[role] = id || null;
    }

    return roles;
}

function normalizeConfig(value) {
    if (!value || typeof value !== 'object') throw new Error('provider-config.json 格式不正确');
    if (value.version !== CONFIG_VERSION) throw new Error(`provider-config.json 版本不支持: ${value.version}`);
    return { version: CONFIG_VERSION, roles: normalizeRoles(value.roles) };
}

export function getProviderConfigPath({ dataDir }) {
    return join(dataDir, 'provider-config.json');
}

export function getRoleKeys() {
    return ROLE_KEYS.slice();
}

export async function readProviderConfig({ dataDir }) {
    const path = getProviderConfigPath({ dataDir });
    if (!(await fileExists(path))) return defaultConfig();

    const raw = await readFile(path, 'utf-8');
    const parsed = JSON.parse(raw);
    return normalizeConfig(parsed);
}

export async function writeProviderConfigAtomic({ dataDir, config }) {
    await mkdir(dataDir, { recursive: true });
    const path = getProviderConfigPath({ dataDir });
    const normalized = normalizeConfig(config);
    await writeJsonFileAtomic(path, normalized, { mode: DEFAULT_FILE_MODE });
    return normalized;
}

export async function setProviderRoles({ dataDir, roles, knownProviderIds }) {
    const normalized = normalizeRoles(roles);

    if (knownProviderIds) {
        const known = new Set(knownProviderIds);
        for (const [role, providerId] of Object.entries(normalized)) {
            if (providerId === null) continue;
            if (!known.has(providerId)) throw new Error(`role(${role}) 引用了不存在的 provider: ${providerId}`);
        }
    }

    const next = { version: CONFIG_VERSION, roles: normalized };
    return writeProviderConfigAtomic({ dataDir, config: next });
}

export async function removeProviderFromRoles({ dataDir, providerId }) {
    const id = String(providerId || '').trim();
    if (!id) return { changed: false };

    const current = await readProviderConfig({ dataDir });
    let changed = false;
    const roles = { ...current.roles };
    for (const key of ROLE_KEYS) {
        if (roles[key] === id) {
            roles[key] = null;
            changed = true;
        }
    }
    if (!changed) return { changed: false };
    await writeProviderConfigAtomic({ dataDir, config: { version: CONFIG_VERSION, roles } });
    return { changed: true };
}
