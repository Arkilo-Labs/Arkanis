import { resolveDataDir } from '../../../core/utils/dataDir.js';
import { readProviderDefinitions } from '../../../core/services/aiProvidersStore.js';
import { readProviderConfig, setProviderRoles } from '../../../core/services/providerConfigStore.js';

export function registerProviderConfigRoutes({ app, io, projectRoot }) {
    const dataDir = resolveDataDir({ projectRoot });

    app.get('/api/provider-config', async (_req, res) => {
        try {
            const config = await readProviderConfig({ dataDir });
            return res.json(config);
        } catch (error) {
            return res.status(500).json({ error: error?.message || String(error) });
        }
    });

    app.put('/api/provider-config', async (req, res) => {
        try {
            const roles = req.body?.roles;
            if (!roles || typeof roles !== 'object') {
                return res.status(400).json({ error: 'roles 必须是对象' });
            }

            const defs = await readProviderDefinitions({ projectRoot, dataDir });
            const knownIds = defs.providers.map((p) => p.id);
            const config = await setProviderRoles({ dataDir, roles, knownProviderIds: knownIds });

            io.emit('providers-updated');
            return res.json(config);
        } catch (error) {
            return res.status(400).json({ error: error?.message || String(error) });
        }
    });
}

