import fs from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..', '..');
const PROVIDERS_FILE = join(PROJECT_ROOT, 'ai-providers.json');

function tryParseProviderOverride() {
    const raw = String(process.env.ARKANIS_PROVIDER_OVERRIDE_JSON || '').trim();
    if (!raw) return null;
    try {
        const obj = JSON.parse(raw);
        if (!obj || typeof obj !== 'object') return null;
        if (Array.isArray(obj.providers)) {
            return obj;
        }
        if (obj.apiKey && (obj.modelName || obj.model)) {
            return { providers: [{ ...obj, isActive: true }], version: 1 };
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * AI Provider 服务
 * 统一管理 ai-providers.json 的读取和配置
 */
class ProviderService {
    constructor() {
        this._cache = null;
        this._cacheTime = 0;
        this.CACHE_TTL = 5000; // 5秒缓存
    }

    async _readProvidersFile() {
        const override = tryParseProviderOverride();
        if (override) return override;

        const now = Date.now();
        if (this._cache && now - this._cacheTime < this.CACHE_TTL) {
            return this._cache;
        }

        try {
            const content = await fs.readFile(PROVIDERS_FILE, 'utf-8');
            const data = JSON.parse(content);
            this._cache = data;
            this._cacheTime = now;
            return data;
        } catch (err) {
            if (err.code === 'ENOENT') {
                return { providers: [], version: 1 };
            }
            throw err;
        }
    }

    /**
     * 获取激活的 provider
     * @returns {Promise<Object|null>}
     */
    async getActiveProvider() {
        const data = await this._readProvidersFile();
        return data.providers.find((p) => p.isActive) || null;
    }

    /**
     * 获取所有 providers
     * @returns {Promise<Array>}
     */
    async getAllProviders() {
        const data = await this._readProvidersFile();
        return data.providers || [];
    }

    /**
     * 根据 ID 获取 provider
     * @param {string} id
     * @returns {Promise<Object|null>}
     */
    async getProviderById(id) {
        const data = await this._readProvidersFile();
        return data.providers.find((p) => p.id === id) || null;
    }

    /**
     * 清除缓存（测试用）
     */
    clearCache() {
        this._cache = null;
        this._cacheTime = 0;
    }
}

export default new ProviderService();
