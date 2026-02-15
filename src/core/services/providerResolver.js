import { readProviderDefinitions } from './aiProvidersStore.js';
import { readSecrets } from './secretsStore.js';
import { readProviderConfig } from './providerConfigStore.js';

function resolveProviderKeyFromEnv(envName) {
    const key = String(process.env[envName] || '').trim();
    return key || null;
}

export function resolveProviderKey({ providerId, apiKeyEnv, secrets }) {
    const id = String(providerId || '').trim();
    const envName = String(apiKeyEnv || '').trim();

    if (envName) {
        const envKey = resolveProviderKeyFromEnv(envName);
        if (envKey) return { apiKey: envKey, source: 'env' };
    }

    const apiKey = secrets?.providers?.[id]?.apiKey;
    const normalized = typeof apiKey === 'string' ? apiKey.trim() : '';
    if (normalized) return { apiKey: normalized, source: 'secrets' };

    return { apiKey: null, source: 'none' };
}

export async function listProvidersWithStatus({ projectRoot, dataDir, encKey = '' }) {
    const { providers } = await readProviderDefinitions({ projectRoot, dataDir });
    const secrets = await readSecrets({ dataDir, encKey });

    return providers.map((provider) => {
        const { apiKey, source } = resolveProviderKey({
            providerId: provider.id,
            apiKeyEnv: provider.apiKeyEnv,
            secrets,
        });
        return {
            ...provider,
            hasKey: Boolean(apiKey),
            keySource: source,
            locked: source === 'env',
        };
    });
}

export async function resolveProviderForRole({ projectRoot, dataDir, encKey = '', role }) {
    const roleName = String(role || '').trim();
    if (!roleName) throw new Error('role 不能为空');

    const config = await readProviderConfig({ dataDir });
    const providerId = config.roles?.[roleName] ?? null;
    if (!providerId) throw new Error(`未配置 role(${roleName}) 的 Provider`);

    const { providers } = await readProviderDefinitions({ projectRoot, dataDir });
    const provider = providers.find((p) => p.id === providerId);
    if (!provider) throw new Error(`role(${roleName}) 引用了不存在的 provider: ${providerId}`);

    const secrets = await readSecrets({ dataDir, encKey });
    const { apiKey, source } = resolveProviderKey({ providerId: provider.id, apiKeyEnv: provider.apiKeyEnv, secrets });
    if (!apiKey) throw new Error(`Provider 未配置密钥: ${provider.id}`);

    return { provider, apiKey, keySource: source };
}

