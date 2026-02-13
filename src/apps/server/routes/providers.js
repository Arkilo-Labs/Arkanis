import { join } from 'path';
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';

function generateProviderId() {
    return `provider_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

function validateProvider(provider) {
    const required = ['name', 'baseUrl', 'modelName', 'apiKey'];
    for (const field of required) {
        if (!provider?.[field] || String(provider[field]).trim() === '') {
            return { valid: false, error: `字段 ${field} 为必填项` };
        }
    }
    if (provider.thinkingMode && !['enabled', 'disabled', 'none'].includes(provider.thinkingMode)) {
        return { valid: false, error: 'thinkingMode 必须是 enabled/disabled/none' };
    }
    return { valid: true };
}

async function writeProviders({ providersFile, data }) {
    try {
        await writeFile(providersFile, JSON.stringify(data, null, 2), 'utf-8');
        return true;
    } catch (error) {
        console.error('写入 Provider 文件失败:', error);
        return false;
    }
}

async function readProviders({ providersFile }) {
    try {
        if (!existsSync(providersFile)) {
            const data = { providers: [], version: 1 };
            await writeProviders({ providersFile, data });
            return data;
        }
        const content = await readFile(providersFile, 'utf-8');
        return JSON.parse(content);
    } catch (error) {
        console.error('读取 Provider 文件失败:', error);
        return { providers: [], version: 1 };
    }
}

export function registerProviderRoutes({ app, io, projectRoot }) {
    const providersFile = join(projectRoot, 'ai-providers.json');

    app.get('/api/ai-providers', async (_req, res) => {
        try {
            const data = await readProviders({ providersFile });
            return res.json(data.providers);
        } catch (error) {
            return res.status(500).json({ error: error?.message || String(error) });
        }
    });

    app.post('/api/ai-providers', async (req, res) => {
        try {
            const provider = req.body || {};
            const validation = validateProvider(provider);
            if (!validation.valid) {
                return res.status(400).json({ error: validation.error });
            }

            const data = await readProviders({ providersFile });
            provider.id = generateProviderId();
            provider.isActive = provider.isActive || false;

            if (provider.isActive) {
                data.providers.forEach((p) => (p.isActive = false));
            }
            data.providers.push(provider);

            const success = await writeProviders({ providersFile, data });
            if (!success) return res.status(500).json({ error: '保存失败' });

            io.emit('providers-updated');
            return res.json(provider);
        } catch (error) {
            return res.status(500).json({ error: error?.message || String(error) });
        }
    });

    app.put('/api/ai-providers/:id', async (req, res) => {
        try {
            const id = String(req.params.id || '').trim();
            const updates = req.body || {};

            const validation = validateProvider(updates);
            if (!validation.valid) {
                return res.status(400).json({ error: validation.error });
            }

            const data = await readProviders({ providersFile });
            const index = data.providers.findIndex((p) => p.id === id);
            if (index === -1) {
                return res.status(404).json({ error: 'Provider 不存在' });
            }

            if (updates.isActive) {
                data.providers.forEach((p) => (p.isActive = false));
            }

            data.providers[index] = { ...data.providers[index], ...updates, id };

            const success = await writeProviders({ providersFile, data });
            if (!success) return res.status(500).json({ error: '保存失败' });

            io.emit('providers-updated');
            return res.json(data.providers[index]);
        } catch (error) {
            return res.status(500).json({ error: error?.message || String(error) });
        }
    });

    app.delete('/api/ai-providers/:id', async (req, res) => {
        try {
            const id = String(req.params.id || '').trim();
            const data = await readProviders({ providersFile });
            const index = data.providers.findIndex((p) => p.id === id);
            if (index === -1) {
                return res.status(404).json({ error: 'Provider 不存在' });
            }

            data.providers.splice(index, 1);

            const success = await writeProviders({ providersFile, data });
            if (!success) return res.status(500).json({ error: '保存失败' });

            io.emit('providers-updated');
            return res.json({ success: true });
        } catch (error) {
            return res.status(500).json({ error: error?.message || String(error) });
        }
    });

    app.post('/api/ai-providers/:id/activate', async (req, res) => {
        try {
            const id = String(req.params.id || '').trim();
            const data = await readProviders({ providersFile });
            const provider = data.providers.find((p) => p.id === id);
            if (!provider) return res.status(404).json({ error: 'Provider 不存在' });

            data.providers.forEach((p) => (p.isActive = false));
            provider.isActive = true;

            const success = await writeProviders({ providersFile, data });
            if (!success) return res.status(500).json({ error: '保存失败' });

            io.emit('providers-updated');
            return res.json({ success: true });
        } catch (error) {
            return res.status(500).json({ error: error?.message || String(error) });
        }
    });
}

