import { join } from 'path';
import { createProvider } from './providerRegistry.js';
import { Agent } from './agent.js';

export function buildAgents({ agentsConfig, providersConfig, promptStore, logger }) {
    const providers = new Map();
    for (const [id, cfg] of Object.entries(providersConfig.providers)) {
        providers.set(id, createProvider(cfg));
    }

    const agents = agentsConfig.agents.map((a) => {
        const provider = providers.get(a.provider_ref);
        if (!provider) throw new Error(`agents.json 引用未知 provider_ref: ${a.provider_ref}`);
        const promptText = promptStore.getPrompt(a.prompt);
        return new Agent({
            name: a.name,
            role: a.role,
            order: a.order,
            systemPrompt: promptText,
            provider,
            canSeeImages: a.can_see_images,
            tools: a.tools,
            logger,
        });
    });

    return agents.sort((x, y) => x.order - y.order);
}
