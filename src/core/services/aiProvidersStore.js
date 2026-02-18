import { access, mkdir, readFile, rename, writeFile } from 'fs/promises';
import { constants as fsConstants, existsSync } from 'fs';
import { join } from 'path';

const PROVIDERS_VERSION = 1;
const DEFAULT_FILE_MODE = 0o600;
const PROVIDER_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
const ENV_NAME_RE = /^[A-Z][A-Z0-9_]+$/;

export const DEFAULT_PROVIDERS_FILE = 'ai-providers.default.json';
export const OVERLAY_PROVIDERS_FILE = 'ai-providers.json';

function normalizeBaseUrl(raw) {
    let base = String(raw || '').trim();
    base = base.replace(/\/+$/, '');
    if (base.toLowerCase().endsWith('/v1')) {
        base = base.slice(0, -3);
    }
    return base.replace(/\/+$/, '');
}

const VALID_PROTOCOLS = ['chat_completions', 'responses', 'anthropic'];

function normalizeProtocol(value) {
    const v = String(value || '').trim();
    if (!v || !VALID_PROTOCOLS.includes(v)) {
        throw new Error(`字段 protocol 为必填项，必须是 ${VALID_PROTOCOLS.join(' / ')}`);
    }
    return v;
}

function normalizeThinkingMode(value) {
    const v = String(value || '').trim();
    if (!v) return 'disabled';
    if (['enabled', 'disabled', 'none'].includes(v)) return v;
    throw new Error('thinkingMode 必须是 enabled/disabled/none');
}

function normalizeProvider(provider, { requireId = true } = {}) {
    if (!provider || typeof provider !== 'object') throw new Error('Provider 必须是对象');
    if ('apiKey' in provider) throw new Error('Provider 定义禁止包含 apiKey 字段');

    const id = String(provider.id || '').trim();
    if (requireId && !id) throw new Error('字段 id 为必填项');
    if (id && !PROVIDER_ID_RE.test(id)) throw new Error('字段 id 格式不合法');

    const name = String(provider.name || '').trim();
    if (!name) throw new Error('字段 name 为必填项');

    const type = String(provider.type || '').trim() || 'openai_compatible';
    if (type !== 'openai_compatible') throw new Error(`不支持的 provider type: ${type}`);

    const baseUrl = normalizeBaseUrl(provider.baseUrl);
    if (!baseUrl) throw new Error('字段 baseUrl 为必填项');

    const modelName = String(provider.modelName || '').trim();
    if (!modelName) throw new Error('字段 modelName 为必填项');

    const apiKeyEnv = provider.apiKeyEnv === null || provider.apiKeyEnv === undefined ? '' : String(provider.apiKeyEnv);
    const apiKeyEnvTrimmed = apiKeyEnv.trim();
    if (apiKeyEnvTrimmed && !ENV_NAME_RE.test(apiKeyEnvTrimmed)) {
        throw new Error('字段 apiKeyEnv 必须是环境变量名（例如 OPENAI_API_KEY）');
    }

    const protocol = normalizeProtocol(provider.protocol);
    const supportsVision = Boolean(provider.supportsVision);
    const thinkingMode = normalizeThinkingMode(provider.thinkingMode);

    const maxTokens = provider.maxTokens === undefined || provider.maxTokens === null ? undefined : Number(provider.maxTokens);
    if (maxTokens !== undefined && (!Number.isFinite(maxTokens) || maxTokens <= 0)) {
        throw new Error('字段 maxTokens 必须是正数');
    }

    const temperature =
        provider.temperature === undefined || provider.temperature === null ? undefined : Number(provider.temperature);
    if (temperature !== undefined && (!Number.isFinite(temperature) || temperature < 0 || temperature > 2)) {
        throw new Error('字段 temperature 必须在 0~2 之间');
    }

    const description = String(provider.description || '').trim();

    return {
        id,
        name,
        type,
        protocol,
        baseUrl,
        modelName,
        apiKeyEnv: apiKeyEnvTrimmed,
        supportsVision,
        thinkingMode,
        maxTokens,
        temperature,
        description,
    };
}

function normalizeProvidersFile(value) {
    if (!value || typeof value !== 'object') throw new Error('Provider 文件格式不正确');
    if (value.version !== PROVIDERS_VERSION) throw new Error(`Provider 文件版本不支持: ${value.version}`);
    if (!Array.isArray(value.providers)) throw new Error('Provider 文件必须包含 providers 数组');

    const providers = value.providers.map((p) => normalizeProvider(p, { requireId: true }));
    const ids = new Set();
    for (const p of providers) {
        if (ids.has(p.id)) throw new Error(`Provider id 重复: ${p.id}`);
        ids.add(p.id);
    }

    return { version: PROVIDERS_VERSION, providers };
}

async function ensureReadableFile(path) {
    await access(path, fsConstants.R_OK);
}

async function writeJsonFileAtomic(path, data, { mode = DEFAULT_FILE_MODE } = {}) {
    const tmpPath = `${path}.tmp.${process.pid}.${Date.now()}`;
    const content = `${JSON.stringify(data, null, 2)}\n`;
    await writeFile(tmpPath, content, { encoding: 'utf-8', mode });
    await rename(tmpPath, path);
}

export function generateProviderId() {
    return `provider_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

export function getProvidersPaths({ projectRoot, dataDir }) {
    return {
        defaultPath: join(projectRoot, DEFAULT_PROVIDERS_FILE),
        overlayPath: join(dataDir, OVERLAY_PROVIDERS_FILE),
    };
}

export async function readProviderDefinitions({ projectRoot, dataDir }) {
    const { defaultPath, overlayPath } = getProvidersPaths({ projectRoot, dataDir });
    const chosenPath = existsSync(overlayPath) ? overlayPath : defaultPath;

    if (!existsSync(chosenPath)) {
        return { version: PROVIDERS_VERSION, providers: [], source: 'missing' };
    }

    await ensureReadableFile(chosenPath);
    const raw = await readFile(chosenPath, 'utf-8');
    const parsed = JSON.parse(raw);
    const normalized = normalizeProvidersFile(parsed);
    return { ...normalized, source: chosenPath === overlayPath ? 'overlay' : 'default' };
}

export async function writeProviderDefinitionsAtomic({ projectRoot, dataDir, providers }) {
    await mkdir(dataDir, { recursive: true });
    const { overlayPath } = getProvidersPaths({ projectRoot, dataDir });
    const normalized = normalizeProvidersFile({ version: PROVIDERS_VERSION, providers });
    await writeJsonFileAtomic(overlayPath, normalized, { mode: DEFAULT_FILE_MODE });
    return normalized;
}

export async function ensureOverlayInitialized({ projectRoot, dataDir }) {
    const { overlayPath } = getProvidersPaths({ projectRoot, dataDir });
    if (existsSync(overlayPath)) return;
    const current = await readProviderDefinitions({ projectRoot, dataDir });
    await writeProviderDefinitionsAtomic({ projectRoot, dataDir, providers: current.providers });
}

export async function createProviderDefinition({ projectRoot, dataDir, provider }) {
    await ensureOverlayInitialized({ projectRoot, dataDir });
    const current = await readProviderDefinitions({ projectRoot, dataDir });
    const nextProvider = normalizeProvider(
        { ...provider, id: provider?.id ? String(provider.id).trim() : generateProviderId() },
        { requireId: true },
    );
    if (current.providers.some((p) => p.id === nextProvider.id)) {
        throw new Error(`Provider id 已存在: ${nextProvider.id}`);
    }
    const nextProviders = [...current.providers, nextProvider];
    await writeProviderDefinitionsAtomic({ projectRoot, dataDir, providers: nextProviders });
    return nextProvider;
}

export async function updateProviderDefinition({ projectRoot, dataDir, id, updates }) {
    await ensureOverlayInitialized({ projectRoot, dataDir });
    const current = await readProviderDefinitions({ projectRoot, dataDir });
    const targetId = String(id || '').trim();
    const index = current.providers.findIndex((p) => p.id === targetId);
    if (index === -1) throw new Error('Provider 不存在');

    const merged = { ...current.providers[index], ...updates, id: targetId };
    const nextProvider = normalizeProvider(merged, { requireId: true });
    const nextProviders = current.providers.slice();
    nextProviders[index] = nextProvider;
    await writeProviderDefinitionsAtomic({ projectRoot, dataDir, providers: nextProviders });
    return nextProvider;
}

export async function deleteProviderDefinition({ projectRoot, dataDir, id }) {
    await ensureOverlayInitialized({ projectRoot, dataDir });
    const current = await readProviderDefinitions({ projectRoot, dataDir });
    const targetId = String(id || '').trim();
    const index = current.providers.findIndex((p) => p.id === targetId);
    if (index === -1) throw new Error('Provider 不存在');
    const nextProviders = current.providers.slice();
    nextProviders.splice(index, 1);
    await writeProviderDefinitionsAtomic({ projectRoot, dataDir, providers: nextProviders });
    return { removed: true };
}

