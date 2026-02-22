import { ErrorCode } from '../core/contracts/errors.js';
import { MessageType } from '../core/contracts/message.schema.js';
import { PromptMode } from '../core/prompt/promptAssembler.js';

const MAX_LLM_RETRIES = 2;
const DEFAULT_MAX_TURNS = 10;
const CONTENT_PREVIEW_LIMIT = 500;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * llmClient 接口约定（供注入方实现）：
 *
 * chatWithTools({
 *   systemPrompt: string,
 *   messages: NormalizedMessage[],
 *   tools: ToolDef[],
 * }) => Promise<{
 *   textContent: string | null,
 *   toolCalls: Array<{ call_id: string, tool_name: string, input: object }>,
 *   stopReason: 'end_turn' | 'tool_use' | 'max_tokens',
 *   usage: { input: number, output: number },
 * }>
 *
 * NormalizedMessage 三种形式：
 *   { role: 'user',         content: string }
 *   { role: 'assistant',    textContent: string|null, toolCalls: ToolCall[] }
 *   { role: 'tool_results', results: Array<{ call_id, tool_name, result }> }
 *
 * Anthropic tool_use block / OpenAI tool_calls 数组的归一化由各 llmClient 实现层负责。
 */

/**
 * @param {{
 *   llmClient: { chatWithTools: Function },
 *   toolGateway: object,
 *   mailbox: object,
 *   promptAssembler: object,
 *   runContext: {
 *     runId: string,
 *     outputDir?: string,
 *     cwd?: string,
 *     runConfig?: object,
 *     maxTurns?: number,
 *   },
 * }} deps
 */
export function createAgentRunner({ llmClient, toolGateway, mailbox, promptAssembler, runContext }) {
    const maxTurns = runContext.maxTurns ?? DEFAULT_MAX_TURNS;

    /**
     * @param {{
     *   task: object,
     *   role: string,
     *   agentId?: string,
     *   contextSeed?: string,
     *   artifactRefs?: Array<{ artifact_id: string, content?: string }>,
     *   promptMode?: string,
     *   tools?: Array<{ name: string, description: string, input_schema: object }>,
     * }} opts
     * @returns {Promise<{
     *   status: 'completed' | 'failed',
     *   artifact_refs: object[],
     *   turns: number,
     *   error?: { code: string, message: string },
     * }>}
     */
    async function run({
        task,
        role,
        agentId,
        contextSeed = '',
        artifactRefs = [],
        promptMode = PromptMode.FULL,
        tools = [],
    }) {
        const { runId } = runContext;
        const taskId = task.task_id;
        const resolvedAgentId = agentId ?? `${role}-runner`;

        const { system, user } = await promptAssembler.assemble({
            runId,
            agentId: resolvedAgentId,
            taskId,
            role,
            runConfig: runContext.runConfig ?? {},
            taskContract: task,
            contextSeed,
            artifactRefs,
            promptMode,
        });

        const messages = [{ role: 'user', content: user }];
        const collectedArtifactRefs = [];
        let turns = 0;

        while (turns < maxTurns) {
            turns++;

            // LLM 调用，失败重试最多 MAX_LLM_RETRIES 次
            let llmResponse = null;
            let lastError = null;
            for (let attempt = 0; attempt <= MAX_LLM_RETRIES; attempt++) {
                try {
                    llmResponse = await llmClient.chatWithTools({ systemPrompt: system, messages, tools });
                    lastError = null;
                    break;
                } catch (err) {
                    lastError = err;
                    if (attempt < MAX_LLM_RETRIES) {
                        await sleep(100 * (attempt + 1));
                    }
                }
            }

            if (lastError !== null) {
                const errMsg = `LLM 调用失败（${MAX_LLM_RETRIES + 1} 次后放弃）: ${lastError.message}`;
                await postUpdate(runId, taskId, resolvedAgentId, errMsg);
                return {
                    status: 'failed',
                    artifact_refs: collectedArtifactRefs,
                    turns,
                    error: { code: ErrorCode.ERR_TOOL_EXEC_FAILED, message: errMsg },
                };
            }

            // 每轮都向 Mailbox 投递 update 消息
            const textContent = typeof llmResponse.textContent === 'string' ? llmResponse.textContent.trim() : '';
            const updateContent = textContent
                ? textContent.slice(0, CONTENT_PREVIEW_LIMIT)
                : `第 ${turns} 轮执行`;
            await postUpdate(runId, taskId, resolvedAgentId, updateContent);

            const toolCalls = Array.isArray(llmResponse.toolCalls) ? llmResponse.toolCalls : [];

            if (toolCalls.length > 0) {
                messages.push({ role: 'assistant', textContent: llmResponse.textContent, toolCalls });

                const toolResults = [];
                for (const call of toolCalls) {
                    const result = await toolGateway.call(call.tool_name, call.input, runContext, {
                        run_id: runId,
                        correlation_id: call.call_id,
                    });

                    if (result.ok && Array.isArray(result.data?.artifact_refs)) {
                        collectedArtifactRefs.push(...result.data.artifact_refs);
                    }

                    toolResults.push({ call_id: call.call_id, tool_name: call.tool_name, result });
                }

                messages.push({ role: 'tool_results', results: toolResults });
                continue;
            }

            // toolCalls 为空 → end_turn
            return { status: 'completed', artifact_refs: collectedArtifactRefs, turns };
        }

        // max_turns 超限
        const limitMsg = `超出最大轮次 (max_turns=${maxTurns})，任务中止`;
        await postUpdate(runId, taskId, resolvedAgentId, limitMsg);
        return {
            status: 'failed',
            artifact_refs: collectedArtifactRefs,
            turns,
            error: { code: ErrorCode.ERR_TOOL_EXEC_FAILED, message: limitMsg },
        };
    }

    async function postUpdate(runId, taskId, agentId, content) {
        try {
            await mailbox.postMessage(runId, {
                task_refs: [taskId],
                type: MessageType.UPDATE,
                from_agent: agentId,
                content,
            });
        } catch (err) {
            process.stderr.write(`[agent-runner] mailbox 投递失败: ${err?.message}\n`);
        }
    }

    return { run };
}
