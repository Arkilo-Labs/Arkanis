import { readFileSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';

import { resolveDataDir } from '../../../../core/utils/dataDir.js';
import { readProviderDefinitions } from '../../../../core/services/aiProvidersStore.js';

const ProviderSchema = z.object({
    type: z.enum(['openai_compatible']),
    protocol: z.enum(['chat_completions', 'responses', 'anthropic']),
    base_url: z.string().min(1),
    api_key_env: z.string().optional().default(''),
    model: z.string().min(1),
    supports_vision: z.boolean().default(false),
    temperature: z.number().min(0).max(2).optional(),
    max_tokens: z.number().int().positive().optional(),
});

const ProvidersConfigSchema = z.object({
    version: z.number().int().positive(),
    providers: z.record(ProviderSchema),
});

const ToolSchema = z.object({
    type: z.enum(['mcp']),
    server: z.string().min(1),
    call: z.object({
        method: z.string().min(1),
        params: z.record(z.any()).default({}),
    }),
});

const AgentSchema = z.object({
    name: z.string().min(1),
    provider_ref: z.string().min(1),
    role: z.string().min(1),
    prompt: z.string().min(1),
    order: z.number().int(),
    can_see_images: z.boolean().optional().default(false),
    is_final_decision: z.boolean().optional().default(false),
    tools: z.array(ToolSchema).optional().default([]),
});

const AuditSettingsSchema = z.object({
    enabled: z.boolean().optional().default(false),
    auditor_agent: z.string().min(1).optional(),
    strict_mode: z.enum(['strict', 'moderate', 'lenient']).optional().default('moderate'),
    log_filtered: z.boolean().optional().default(true),
    filter_threshold: z.number().min(0).max(1).optional().default(0.6),
    chairman_relax_factor: z.number().min(0).max(0.5).optional().default(0.1),
});

const NewsPipelineSettingsSchema = z.object({
    enabled: z.boolean().optional().default(true),
    collector_agent: z.string().min(1),

    // --- search provider ---
    // "searxng"（开源自部署）或 "tavily"（SaaS），默认 searxng 保证向后兼容
    search_provider: z.enum(['searxng', 'tavily']).optional().default('searxng'),
    searxng: z
        .object({
            base_url: z.string().min(1).default('http://localhost:8080'),
            timeout_ms: z.number().int().positive().default(15000),
            docker_fallback_container: z.string().min(1).optional().default('searxng'),
        })
        .optional()
        .default({}),
    tavily: z
        .object({
            // 存放 Tavily API Key 的环境变量名
            api_key_env: z.string().optional().default('TAVILY_API_KEY'),
            timeout_ms: z.number().int().positive().default(15000),
        })
        .optional()
        .default({}),

    // --- fetch provider ---
    // "firecrawl"（开源自部署/SaaS）或 "jina"（SaaS），默认 firecrawl 保证向后兼容
    fetch_provider: z.enum(['firecrawl', 'jina']).optional().default('firecrawl'),
    firecrawl: z
        .object({
            base_url: z.string().min(1).default('http://localhost:3002'),
            timeout_ms: z.number().int().positive().default(30000),
            api_key_env: z.string().optional().default(''),
        })
        .optional()
        .default({}),
    jina: z
        .object({
            // 存放 Jina API Key 的环境变量名（无 key 时仍可请求，但速率受限）
            api_key_env: z.string().optional().default('JINA_API_KEY'),
            base_url: z.string().optional().default('https://r.jina.ai'),
            timeout_ms: z.number().int().positive().default(30000),
        })
        .optional()
        .default({}),

    search: z
        .object({
            queries_max: z.number().int().positive().default(4),
            results_per_query: z.number().int().positive().default(10),
            pages_per_query: z.number().int().min(1).max(5).default(1),
            language: z.string().min(1).optional().default('zh-CN'),
            recency_hours: z.number().int().positive().optional().default(24),
        })
        .default({}),
    fetch: z
        .object({
            max_urls: z.number().int().positive().default(6),
            concurrency: z.number().int().positive().default(3),
            max_markdown_chars_per_url: z.number().int().positive().default(7000),
            max_total_markdown_chars: z.number().int().positive().default(22000),
        })
        .default({}),
});

const AgentsConfigSchema = z.object({
    version: z.number().int().positive(),
    roundtable_settings: z.object({
        max_rounds: z.number().int().positive().default(1),
        summary_agent: z.string().min(1),
        final_agent: z.string().min(1),
        max_context_chars: z.number().int().positive().default(24000),
        llm_timeout_ms: z.number().int().positive().default(60000),
        llm_retries: z.number().int().min(0).max(5).default(1),
        mcp_timeout_ms: z.number().int().positive().default(10000),
        debate_rules: z.string().optional(),
        audit_settings: AuditSettingsSchema.optional(),
    }),
    agents: z.array(AgentSchema).min(1),
    subagents: z.array(AgentSchema).optional().default([]),
    news_pipeline_settings: NewsPipelineSettingsSchema.optional(),
});

const McpConfigSchema = z.object({
    version: z.number().int().positive(),
    mcpServers: z.record(
        z.object({
            type: z.enum(['stdio']),
            command: z.string().min(1),
            args: z.array(z.string()).default([]),
        }),
    ),
});

function readJson(path) {
    const raw = readFileSync(path, 'utf-8');
    return JSON.parse(raw);
}

export async function loadProvidersConfig(configDir) {
    const projectRoot = join(configDir, '..', '..', '..', '..');
    const dataDir = resolveDataDir({ projectRoot });

    const { providers } = await readProviderDefinitions({ projectRoot, dataDir });
    return ProvidersConfigSchema.parse({
        version: 1,
        providers: Object.fromEntries(
            providers.map((p) => [
                p.id,
                {
                    type: 'openai_compatible',
                    protocol: p.protocol,
                    base_url: p.baseUrl,
                    api_key_env: p.apiKeyEnv || '',
                    model: p.modelName,
                    supports_vision: Boolean(p.supportsVision),
                    temperature: typeof p.temperature === 'number' ? p.temperature : undefined,
                    max_tokens: typeof p.maxTokens === 'number' ? p.maxTokens : undefined,
                },
            ]),
        ),
    });
}

export function loadAgentsConfig(configDir) {
    const path = join(configDir, 'agents.json');
    return AgentsConfigSchema.parse(readJson(path));
}

export function loadMcpConfig(configDir) {
    const path = join(configDir, 'mcp_config.json');
    return McpConfigSchema.parse(readJson(path));
}
