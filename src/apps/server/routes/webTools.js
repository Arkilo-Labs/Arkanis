import { readFile, rename, writeFile } from 'fs/promises';
import { join } from 'path';

import { resolveDataDir } from '../../../core/utils/dataDir.js';
import { deleteProviderApiKey, readSecrets, setProviderApiKey } from '../../../core/services/secretsStore.js';
import { SOCKET_EVENTS } from '../socket/events.js';

// agents.json 相对项目根的路径
const AGENTS_CONFIG_REL = join('src', 'agents', 'agents-round', 'config', 'agents.json');

// 在 secrets.json 里存储 web 服务密钥时使用的 provider ID
const WS_KEY_IDS = {
    tavily: '__ws_tavily',
    jina: '__ws_jina',
    firecrawl: '__ws_firecrawl',
};

const VALID_SERVICES = new Set(Object.keys(WS_KEY_IDS));

// 标准环境变量名，spawn 子进程时注入
export const WS_ENV_NAMES = {
    tavily: 'TAVILY_API_KEY',
    jina: 'JINA_API_KEY',
    firecrawl: 'FIRECRAWL_API_KEY',
};

function extractWebSettings(nps) {
    const s = nps ?? {};
    return {
        search_provider: s.search_provider ?? 'searxng',
        fetch_provider: s.fetch_provider ?? 'firecrawl',
        searxng: {
            base_url: s.searxng?.base_url ?? 'http://localhost:8080',
            timeout_ms: s.searxng?.timeout_ms ?? 15000,
            docker_fallback_container: s.searxng?.docker_fallback_container ?? 'searxng',
        },
        tavily: {
            timeout_ms: s.tavily?.timeout_ms ?? 15000,
        },
        firecrawl: {
            base_url: s.firecrawl?.base_url ?? 'http://localhost:3002',
            timeout_ms: s.firecrawl?.timeout_ms ?? 30000,
        },
        jina: {
            base_url: s.jina?.base_url ?? 'https://r.jina.ai',
            timeout_ms: s.jina?.timeout_ms ?? 30000,
        },
    };
}

async function readAgentsJson(agentsConfigPath) {
    const raw = await readFile(agentsConfigPath, 'utf-8');
    return JSON.parse(raw);
}

async function writeAgentsJsonAtomic(agentsConfigPath, data) {
    const content = JSON.stringify(data, null, 2) + '\n';
    const tmp = `${agentsConfigPath}.tmp.${process.pid}.${Date.now()}`;
    await writeFile(tmp, content, 'utf-8');
    await rename(tmp, agentsConfigPath);
}

export function registerWebToolsRoutes({ app, io, projectRoot }) {
    const dataDir = resolveDataDir({ projectRoot });
    const agentsConfigPath = join(projectRoot, AGENTS_CONFIG_REL);
    const encKey = process.env.SECRETS_ENC_KEY || '';

    // GET /api/web-tools/settings
    app.get('/api/web-tools/settings', async (_req, res) => {
        try {
            const agents = await readAgentsJson(agentsConfigPath);
            return res.json({ settings: extractWebSettings(agents.news_pipeline_settings) });
        } catch (error) {
            return res.status(500).json({ error: error?.message || String(error) });
        }
    });

    // POST /api/web-tools/settings
    app.post('/api/web-tools/settings', async (req, res) => {
        try {
            const incoming = req.body?.settings;
            if (!incoming || typeof incoming !== 'object') {
                return res.status(400).json({ error: 'settings 不能为空' });
            }

            const agents = await readAgentsJson(agentsConfigPath);
            const existing = agents.news_pipeline_settings ?? {};

            // 只更新可配置字段，保留 search/fetch pipeline、enabled、collector_agent 等
            agents.news_pipeline_settings = {
                ...existing,
                search_provider: incoming.search_provider ?? existing.search_provider ?? 'searxng',
                fetch_provider: incoming.fetch_provider ?? existing.fetch_provider ?? 'firecrawl',
                searxng: {
                    ...(existing.searxng ?? {}),
                    ...(incoming.searxng ?? {}),
                },
                // api_key_env 固定为标准 env var 名，确保子进程注入生效
                tavily: {
                    ...(existing.tavily ?? {}),
                    ...(incoming.tavily ?? {}),
                    api_key_env: WS_ENV_NAMES.tavily,
                },
                firecrawl: {
                    ...(existing.firecrawl ?? {}),
                    ...(incoming.firecrawl ?? {}),
                    api_key_env: WS_ENV_NAMES.firecrawl,
                },
                jina: {
                    ...(existing.jina ?? {}),
                    ...(incoming.jina ?? {}),
                    api_key_env: WS_ENV_NAMES.jina,
                    base_url: incoming.jina?.base_url ?? existing.jina?.base_url ?? 'https://r.jina.ai',
                },
            };

            await writeAgentsJsonAtomic(agentsConfigPath, agents);
            io?.emit(SOCKET_EVENTS.CONFIG_RELOAD, { file: 'agents.json', timestamp: Date.now() });
            return res.json({ success: true });
        } catch (error) {
            return res.status(500).json({ error: error?.message || String(error) });
        }
    });

    // GET /api/web-tools/keys/status
    app.get('/api/web-tools/keys/status', async (_req, res) => {
        try {
            const secrets = await readSecrets({ dataDir, encKey }).catch(() => ({ providers: {} }));
            const status = {};
            for (const [service, id] of Object.entries(WS_KEY_IDS)) {
                status[service] = { hasKey: Boolean(secrets.providers[id]?.apiKey) };
            }
            return res.json({ status });
        } catch (error) {
            return res.status(500).json({ error: error?.message || String(error) });
        }
    });

    // PUT /api/web-tools/keys/:service
    app.put('/api/web-tools/keys/:service', async (req, res) => {
        try {
            const service = String(req.params.service || '').trim().toLowerCase();
            if (!VALID_SERVICES.has(service)) {
                return res.status(400).json({ error: `不支持的服务: ${service}，可选：${[...VALID_SERVICES].join(', ')}` });
            }
            const apiKey = String(req.body?.apiKey || '').trim();
            if (!apiKey) return res.status(400).json({ error: 'apiKey 不能为空' });

            await setProviderApiKey({ dataDir, encKey, providerId: WS_KEY_IDS[service], apiKey });
            io?.emit(SOCKET_EVENTS.CONFIG_RELOAD, { file: 'secrets.json', timestamp: Date.now() });
            return res.json({ success: true });
        } catch (error) {
            return res.status(400).json({ error: error?.message || String(error) });
        }
    });

    // DELETE /api/web-tools/keys/:service
    app.delete('/api/web-tools/keys/:service', async (req, res) => {
        try {
            const service = String(req.params.service || '').trim().toLowerCase();
            if (!VALID_SERVICES.has(service)) {
                return res.status(400).json({ error: `不支持的服务: ${service}` });
            }
            const result = await deleteProviderApiKey({ dataDir, encKey, providerId: WS_KEY_IDS[service] });
            io?.emit(SOCKET_EVENTS.CONFIG_RELOAD, { file: 'secrets.json', timestamp: Date.now() });
            return res.json({ success: true, removed: result.removed });
        } catch (error) {
            return res.status(400).json({ error: error?.message || String(error) });
        }
    });
}

/**
 * 从 secrets.json 读取 web 服务 API keys，返回可注入子进程的 env 对象。
 * 调用方：spawn roundtable 子进程前使用。
 */
export async function buildWebServiceEnv({ dataDir, encKey = '' }) {
    const secrets = await readSecrets({ dataDir, encKey }).catch(() => ({ providers: {} }));
    const env = {};
    for (const [service, id] of Object.entries(WS_KEY_IDS)) {
        const key = secrets.providers[id]?.apiKey;
        if (key) env[WS_ENV_NAMES[service]] = key;
    }
    return env;
}
