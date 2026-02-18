import { ChatCompletionsClient } from './chatCompletionsClient.js';
import { ResponsesClient } from './responsesClient.js';
import { AnthropicClient } from './anthropicClient.js';

export function createLlmClient(providerId, providerCfg) {
    const args = {
        providerId,
        baseUrl: providerCfg.base_url,
        apiKeyEnv: providerCfg.api_key_env,
        model: providerCfg.model,
        temperature: providerCfg.temperature,
        maxTokens: providerCfg.max_tokens,
        supportsVision: providerCfg.supports_vision,
    };

    switch (providerCfg.protocol) {
        case 'responses':
            return new ResponsesClient(args);
        case 'anthropic':
            return new AnthropicClient(args);
        case 'chat_completions':
            return new ChatCompletionsClient(args);
        default:
            throw new Error(
                `不支持的 protocol: ${providerCfg.protocol}（必须是 chat_completions / responses / anthropic）`,
            );
    }
}
