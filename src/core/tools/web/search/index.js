import { SearxngSearchProvider } from './providers/searxng.js';
import { TavilySearchProvider } from './providers/tavily.js';

/**
 * 根据 provider 名称和配置块创建 WebSearchProvider 实例。
 *
 * @param {'searxng'|'tavily'} provider
 * @param {object} cfg  news_pipeline_settings 整体配置对象
 * @param {object} [logger]
 * @returns {SearxngSearchProvider|TavilySearchProvider}
 */
export function createWebSearchClient(provider, cfg, logger = null) {
    const name = String(provider || 'searxng').trim().toLowerCase();

    if (name === 'tavily') {
        const tavilyCfg = cfg?.tavily ?? {};
        const apiKeyEnv = String(tavilyCfg.api_key_env || 'TAVILY_API_KEY').trim();
        const apiKey = String(process.env[apiKeyEnv] || '').trim();
        if (!apiKey) throw new Error(`Tavily apiKey 未配置：环境变量 ${apiKeyEnv} 为空`);
        return new TavilySearchProvider({
            apiKey,
            timeoutMs: tavilyCfg.timeout_ms,
        });
    }

    if (name === 'searxng') {
        const searxngCfg = cfg?.searxng ?? {};
        return new SearxngSearchProvider({
            baseUrl: searxngCfg.base_url,
            timeoutMs: searxngCfg.timeout_ms,
            dockerFallbackContainer: searxngCfg.docker_fallback_container,
            logger,
        });
    }

    throw new Error(`不支持的 search provider：${provider}，可选值：searxng | tavily`);
}

export { SearxngSearchProvider, TavilySearchProvider };
