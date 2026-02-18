import { resolveDataDir } from '../../../core/utils/dataDir.js';
import {
    createProviderDefinition,
    deleteProviderDefinition,
    generateProviderId,
    readProviderDefinitions,
    updateProviderDefinition,
} from '../../../core/services/aiProvidersStore.js';
import { listProvidersWithStatus } from '../../../core/services/providerResolver.js';
import { deleteProviderApiKey, setProviderApiKey } from '../../../core/services/secretsStore.js';
import { removeProviderFromRoles } from '../../../core/services/providerConfigStore.js';
import { SOCKET_EVENTS } from '../socket/events.js';

export function registerProviderRoutes({ app, io, projectRoot }) {
    const dataDir = resolveDataDir({ projectRoot });

    app.get('/api/ai-providers', async (_req, res) => {
        try {
            const providers = await listProvidersWithStatus({
                projectRoot,
                dataDir,
                encKey: process.env.SECRETS_ENC_KEY || '',
            });
            return res.json(providers);
        } catch (error) {
            return res.status(500).json({ error: error?.message || String(error) });
        }
    });

    app.post('/api/ai-providers', async (req, res) => {
        try {
            const body = req.body || {};
            const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
            // apiKey 不能写入 provider 定义层，store 里有校验，这里提前剔除
            const { apiKey: _stripped, ...providerBody } = body;
            void _stripped;

            const provider = await createProviderDefinition({
                projectRoot,
                dataDir,
                provider: providerBody,
            });

            if (apiKey) {
                await setProviderApiKey({
                    dataDir,
                    encKey: process.env.SECRETS_ENC_KEY || '',
                    providerId: provider.id,
                    apiKey,
                });
            }

            io.emit(SOCKET_EVENTS.PROVIDERS_UPDATED);
            return res.json(provider);
        } catch (error) {
            return res.status(400).json({ error: error?.message || String(error) });
        }
    });

    app.put('/api/ai-providers/:id', async (req, res) => {
        try {
            const id = String(req.params.id || '').trim();
            const provider = await updateProviderDefinition({
                projectRoot,
                dataDir,
                id,
                updates: req.body || {},
            });
            io.emit(SOCKET_EVENTS.PROVIDERS_UPDATED);
            return res.json(provider);
        } catch (error) {
            const msg = error?.message || String(error);
            if (msg.includes('不存在')) return res.status(404).json({ error: msg });
            return res.status(400).json({ error: msg });
        }
    });

    app.post('/api/ai-providers/:id/copy', async (req, res) => {
        try {
            const srcId = String(req.params.id || '').trim();
            const { providers } = await readProviderDefinitions({ projectRoot, dataDir });
            const src = providers.find((p) => p.id === srcId);
            if (!src) return res.status(404).json({ error: 'Provider 不存在' });

            const newId = generateProviderId();
            const copied = await createProviderDefinition({
                projectRoot,
                dataDir,
                provider: {
                    ...src,
                    id: newId,
                    name: `${src.name} (副本)`,
                    apiKeyEnv: '',
                },
            });

            io.emit(SOCKET_EVENTS.PROVIDERS_UPDATED);
            return res.json(copied);
        } catch (error) {
            return res.status(400).json({ error: error?.message || String(error) });
        }
    });

    app.delete('/api/ai-providers/:id', async (req, res) => {
        try {
            const id = String(req.params.id || '').trim();
            await deleteProviderDefinition({ projectRoot, dataDir, id });

            await deleteProviderApiKey({ dataDir, encKey: process.env.SECRETS_ENC_KEY || '', providerId: id }).catch(
                () => null,
            );
            await removeProviderFromRoles({ dataDir, providerId: id }).catch(() => null);

            io.emit(SOCKET_EVENTS.PROVIDERS_UPDATED);
            return res.json({ success: true });
        } catch (error) {
            const msg = error?.message || String(error);
            if (msg.includes('不存在')) return res.status(404).json({ error: msg });
            return res.status(400).json({ error: msg });
        }
    });

}
