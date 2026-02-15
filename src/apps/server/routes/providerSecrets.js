import { resolveDataDir } from '../../../core/utils/dataDir.js';
import { readProviderDefinitions } from '../../../core/services/aiProvidersStore.js';
import { listProvidersWithStatus } from '../../../core/services/providerResolver.js';
import { deleteProviderApiKey, setProviderApiKey } from '../../../core/services/secretsStore.js';

function getEnvApiKey(envName) {
    const key = String(process.env[envName] || '').trim();
    return key || null;
}

export function registerProviderSecretRoutes({ app, io, projectRoot }) {
    const dataDir = resolveDataDir({ projectRoot });

    app.get('/api/ai-providers/:id/key/status', async (req, res) => {
        try {
            const id = String(req.params.id || '').trim();
            const providers = await listProvidersWithStatus({
                projectRoot,
                dataDir,
                encKey: process.env.SECRETS_ENC_KEY || '',
            });
            const provider = providers.find((p) => p.id === id);
            if (!provider) return res.status(404).json({ error: 'Provider 不存在' });
            return res.json({ hasKey: provider.hasKey, keySource: provider.keySource, locked: provider.locked });
        } catch (error) {
            return res.status(500).json({ error: error?.message || String(error) });
        }
    });

    app.put('/api/ai-providers/:id/key', async (req, res) => {
        try {
            const id = String(req.params.id || '').trim();
            const apiKey = String(req.body?.apiKey || '').trim();
            if (!apiKey) return res.status(400).json({ error: 'apiKey 不能为空' });

            const defs = await readProviderDefinitions({ projectRoot, dataDir });
            const provider = defs.providers.find((p) => p.id === id);
            if (!provider) return res.status(404).json({ error: 'Provider 不存在' });

            if (provider.apiKeyEnv) {
                const envKey = getEnvApiKey(provider.apiKeyEnv);
                if (envKey) {
                    return res.status(409).json({ error: 'Provider 密钥由环境变量管理，无法在 UI 覆盖' });
                }
            }

            await setProviderApiKey({
                dataDir,
                encKey: process.env.SECRETS_ENC_KEY || '',
                providerId: id,
                apiKey,
            });

            io.emit('providers-updated');
            return res.json({ success: true });
        } catch (error) {
            return res.status(400).json({ error: error?.message || String(error) });
        }
    });

    app.delete('/api/ai-providers/:id/key', async (req, res) => {
        try {
            const id = String(req.params.id || '').trim();
            const result = await deleteProviderApiKey({
                dataDir,
                encKey: process.env.SECRETS_ENC_KEY || '',
                providerId: id,
            });
            io.emit('providers-updated');
            return res.json({ success: true, removed: result.removed });
        } catch (error) {
            return res.status(400).json({ error: error?.message || String(error) });
        }
    });
}

