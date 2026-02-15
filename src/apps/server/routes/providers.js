import { resolveDataDir } from '../../../core/utils/dataDir.js';
import {
    createProviderDefinition,
    deleteProviderDefinition,
    updateProviderDefinition,
} from '../../../core/services/aiProvidersStore.js';
import { listProvidersWithStatus } from '../../../core/services/providerResolver.js';
import { deleteProviderApiKey } from '../../../core/services/secretsStore.js';
import { removeProviderFromRoles } from '../../../core/services/providerConfigStore.js';

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
            const provider = await createProviderDefinition({
                projectRoot,
                dataDir,
                provider: req.body || {},
            });
            io.emit('providers-updated');
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
            io.emit('providers-updated');
            return res.json(provider);
        } catch (error) {
            const msg = error?.message || String(error);
            if (msg.includes('不存在')) return res.status(404).json({ error: msg });
            return res.status(400).json({ error: msg });
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

            io.emit('providers-updated');
            return res.json({ success: true });
        } catch (error) {
            const msg = error?.message || String(error);
            if (msg.includes('不存在')) return res.status(404).json({ error: msg });
            return res.status(400).json({ error: msg });
        }
    });

}
