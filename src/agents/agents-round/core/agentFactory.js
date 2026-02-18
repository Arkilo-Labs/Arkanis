import { createLlmClient } from '../../../core/llm/llmClientFactory.js';
import { Agent } from './agent.js';

function buildProviderMap(providersConfig) {
    const providers = new Map();
    for (const [id, cfg] of Object.entries(providersConfig.providers)) {
        providers.set(id, createLlmClient(id, cfg));
    }
    return providers;
}

function buildAgentFromConfig({ agentConfig, providers, promptStore, logger }) {
    const provider = providers.get(agentConfig.provider_ref);
    if (!provider) throw new Error(`agents.json 引用未知 provider_ref: ${agentConfig.provider_ref}`);
    const promptText = promptStore.getPrompt(agentConfig.prompt);
    const requestedImages = Boolean(agentConfig.can_see_images);
    const providerSupportsVision = Boolean(provider.supportsVision);
    const canSeeImages = requestedImages && providerSupportsVision;
    if (requestedImages && !providerSupportsVision) {
        logger?.warn?.(
            `[配置] ${agentConfig.name} 设置 can_see_images=true，但 provider(${agentConfig.provider_ref}) 不支持图片；已自动关闭图片输入`,
        );
    }
    return new Agent({
        name: agentConfig.name,
        role: agentConfig.role,
        order: agentConfig.order,
        systemPrompt: promptText,
        provider,
        canSeeImages,
        tools: agentConfig.tools,
        logger,
    });
}

export function buildAgents({ agentsConfig, providersConfig, promptStore, logger }) {
    const providers = buildProviderMap(providersConfig);
    const agents = agentsConfig.agents.map((agentConfig) =>
        buildAgentFromConfig({ agentConfig, providers, promptStore, logger }),
    );

    return agents.sort((x, y) => x.order - y.order);
}

export function buildSubagents({ agentsConfig, providersConfig, promptStore, logger }) {
    const providers = buildProviderMap(providersConfig);
    const subagents = (agentsConfig.subagents ?? []).map((agentConfig) =>
        buildAgentFromConfig({ agentConfig, providers, promptStore, logger }),
    );
    return subagents.sort((x, y) => (x.order ?? 0) - (y.order ?? 0));
}
