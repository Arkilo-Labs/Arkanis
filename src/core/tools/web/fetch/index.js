import { FirecrawlFetchProvider } from './providers/firecrawl.js';
import { JinaFetchProvider } from './providers/jina.js';

/**
 * 根据 provider 名称和配置块创建 WebFetchProvider 实例。
 *
 * @param {'firecrawl'|'jina'} provider
 * @param {object} cfg  news_pipeline_settings 整体配置对象
 * @returns {FirecrawlFetchProvider|JinaFetchProvider}
 */
export function createWebFetchClient(provider, cfg) {
    const name = String(provider || 'firecrawl').trim().toLowerCase();

    if (name === 'jina') {
        const jinaCfg = cfg?.jina ?? {};
        const apiKeyEnv = String(jinaCfg.api_key_env || 'JINA_API_KEY').trim();
        const apiKey = String(process.env[apiKeyEnv] || '').trim() || null;
        return new JinaFetchProvider({
            apiKey,
            baseUrl: jinaCfg.base_url,
            timeoutMs: jinaCfg.timeout_ms,
        });
    }

    if (name === 'firecrawl') {
        const firecrawlCfg = cfg?.firecrawl ?? {};
        const apiKeyEnv = String(firecrawlCfg.api_key_env || '').trim();
        const apiKey = apiKeyEnv ? String(process.env[apiKeyEnv] || '').trim() : '';
        return new FirecrawlFetchProvider({
            baseUrl: firecrawlCfg.base_url,
            timeoutMs: firecrawlCfg.timeout_ms,
            apiKey: apiKey || null,
        });
    }

    throw new Error(`不支持的 fetch provider：${provider}，可选值：firecrawl | jina`);
}

export { FirecrawlFetchProvider, JinaFetchProvider };
