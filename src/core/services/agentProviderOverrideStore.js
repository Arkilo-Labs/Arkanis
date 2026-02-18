import { access, mkdir, readFile, rename, writeFile } from 'fs/promises';
import { constants as fsConstants } from 'fs';
import { join } from 'path';

const OVERRIDE_VERSION = 1;
const DEFAULT_FILE_MODE = 0o600;
const OVERRIDE_FILE = 'agent-provider-overrides.json';

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

export function getOverridePath({ dataDir }) {
    return join(dataDir, OVERRIDE_FILE);
}

// 返回 { version, overrides: { agentName: providerId | null } }
export async function readAgentProviderOverrides({ dataDir }) {
    const path = getOverridePath({ dataDir });
    if (!(await fileExists(path))) {
        return { version: OVERRIDE_VERSION, overrides: {} };
    }
    const raw = await readFile(path, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { version: OVERRIDE_VERSION, overrides: {} };
    const overrides = {};
    for (const [k, v] of Object.entries(parsed.overrides || {})) {
        const agentName = String(k || '').trim();
        if (!agentName) continue;
        overrides[agentName] = v === null ? null : String(v || '').trim() || null;
    }
    return { version: OVERRIDE_VERSION, overrides };
}

// overridesMap: { agentName: providerId | null }，null 表示清除覆盖（回退到 agents.json 默认值）
// knownAgentNames 和 knownProviderIds 用于校验
export async function writeAgentProviderOverrides({ dataDir, overridesMap, knownAgentNames, knownProviderIds }) {
    const agentSet = knownAgentNames ? new Set(knownAgentNames) : null;
    const providerSet = knownProviderIds ? new Set(knownProviderIds) : null;

    const overrides = {};
    for (const [name, providerId] of Object.entries(overridesMap || {})) {
        const agentName = String(name || '').trim();
        if (!agentName) continue;

        if (agentSet && !agentSet.has(agentName)) {
            throw new Error(`未知 agent: ${agentName}`);
        }

        if (providerId === null || providerId === '') {
            overrides[agentName] = null;
            continue;
        }

        const id = String(providerId || '').trim();
        if (!id) {
            overrides[agentName] = null;
            continue;
        }

        if (providerSet && !providerSet.has(id)) {
            throw new Error(`agent(${agentName}) 引用了不存在的 provider: ${id}`);
        }

        overrides[agentName] = id;
    }

    await mkdir(dataDir, { recursive: true });
    const path = getOverridePath({ dataDir });
    await writeJsonFileAtomic(path, { version: OVERRIDE_VERSION, overrides }, { mode: DEFAULT_FILE_MODE });
    return { version: OVERRIDE_VERSION, overrides };
}
