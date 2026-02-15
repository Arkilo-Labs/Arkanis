import { OpenAICompatibleProvider } from './openaiCompatibleProvider.js';

export function createProvider(providerCfg) {
    if (providerCfg.type === 'openai_compatible') {
        return new OpenAICompatibleProvider({
            baseUrl: providerCfg.base_url,
            apiKeyEnv: providerCfg.api_key_env,
            model: providerCfg.model,
            temperature: providerCfg.temperature,
            maxTokens: providerCfg.max_tokens,
            supportsVision: providerCfg.supports_vision,
        });
    }

    throw new Error(`不支持的 provider type: ${providerCfg.type}`);
}

