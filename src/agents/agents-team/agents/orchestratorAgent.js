import { z } from 'zod';

import { ErrorCode } from '../core/contracts/errors.js';
import { DenyReason } from '../core/contracts/denyReasons.js';
import { TaskType } from '../core/contracts/task.schema.js';
import { MessageType } from '../core/contracts/message.schema.js';
import { PromptMode } from '../core/prompt/promptAssembler.js';
import { makeError } from '../core/orchestration/errors.util.js';

const LEAD_AGENT_ID = 'lead';
const PLAN_TASK_ID = 'lead-planning';
const PLAN_MAX_ATTEMPTS = 2;

// research → execute → audit 串行顺序
const ROLE_DISPATCH_ORDER = Object.freeze([TaskType.RESEARCH, TaskType.EXECUTE, TaskType.AUDIT]);

// Lead 仅允许调用此工具（虚拟消息工具）
const LEAD_ALLOWED_TOOLS = Object.freeze(new Set(['mailbox.post']));

// TaskPlan 条目 schema
const TaskPlanItemSchema = z
    .object({
        task_id: z
            .string()
            .min(1)
            .regex(/^[a-zA-Z0-9_-]+$/),
        title: z.string().min(1),
        type: z.enum(Object.values(TaskType)),
        input: z.unknown(),
        depends_on: z.array(z.string().min(1)).optional(),
        assigned_role: z.string().min(1),
    })
    .strict();

const TaskPlanSchema = z
    .object({
        tasks: z.array(TaskPlanItemSchema).min(1),
    })
    .strict();

// 去除 LLM 输出中可能包含的 markdown 代码围栏
function stripCodeFence(text) {
    const match = /^```(?:json)?\n?([\s\S]*?)\n?```$/m.exec(text.trim());
    return match ? match[1].trim() : text.trim();
}

/**
 * Lead 专用 ToolGateway 包装：仅允许 LEAD_ALLOWED_TOOLS 中的工具。
 * sandbox.exec / fileWrite / filePatch 等一律以 ERR_POLICY_DENIED 拒绝。
 *
 * @param {object} outerGateway
 * @returns {{ call: Function }}
 */
export function createLeadGateway(outerGateway) {
    return {
        async call(toolName, args, ctx, meta) {
            if (!LEAD_ALLOWED_TOOLS.has(toolName)) {
                return {
                    ok: false,
                    error: {
                        code: ErrorCode.ERR_POLICY_DENIED,
                        deny_reason: DenyReason.TOOL_NOT_ALLOWED,
                        message: `Lead 禁止调用工具: ${toolName}`,
                    },
                };
            }
            return outerGateway.call(toolName, args, ctx, meta);
        },
    };
}

/**
 * @param {{
 *   llmClient: { chatWithTools: Function },
 *   mailbox: object,
 *   promptAssembler: object,
 *   roleDispatcher: { dispatch: Function },
 *   runContext: { runConfig?: object },
 * }} deps
 */
export function createOrchestratorAgent({
    llmClient,
    mailbox,
    promptAssembler,
    roleDispatcher,
    runContext,
}) {
    async function postUpdate(runId, taskId, content) {
        try {
            await mailbox.postMessage(runId, {
                task_refs: [taskId],
                type: MessageType.UPDATE,
                from_agent: LEAD_AGENT_ID,
                content,
            });
        } catch (err) {
            process.stderr.write(`[orchestrator] mailbox 投递失败: ${err?.message}\n`);
        }
    }

    // 调用 LLM 获取 TaskPlan JSON，最多重试 PLAN_MAX_ATTEMPTS 次
    async function callLLMForPlan(runId, goal) {
        const taskContract = {
            task_id: PLAN_TASK_ID,
            title: '任务规划',
            type: TaskType.EXECUTE,
            input: { goal },
        };

        const { system, user } = await promptAssembler.assemble({
            runId,
            agentId: LEAD_AGENT_ID,
            taskId: PLAN_TASK_ID,
            role: 'lead',
            runConfig: runContext.runConfig ?? {},
            taskContract,
            contextSeed: [
                `目标: ${goal}`,
                '',
                '输出合法 JSON TaskPlan，格式：{"tasks":[...]}',
                '每个任务包含字段：task_id, title, type (research|execute|audit), input, assigned_role，以及可选的 depends_on。',
                '只输出 JSON，不要包含任何其他内容。',
            ].join('\n'),
            promptMode: PromptMode.FULL,
        });

        const messages = [{ role: 'user', content: user }];

        for (let attempt = 1; attempt <= PLAN_MAX_ATTEMPTS; attempt++) {
            let llmResp;
            try {
                llmResp = await llmClient.chatWithTools({ systemPrompt: system, messages, tools: [] });
            } catch (err) {
                throw makeError(
                    ErrorCode.ERR_TOOL_EXEC_FAILED,
                    `规划阶段 LLM 调用失败: ${err.message}`,
                );
            }

            const text = llmResp.textContent ?? '';
            const cleaned = stripCodeFence(text);

            let parsed;
            try {
                parsed = JSON.parse(cleaned);
            } catch {
                const msg = `TaskPlan JSON 解析失败（第 ${attempt} 次）`;
                await postUpdate(runId, PLAN_TASK_ID, msg);
                if (attempt < PLAN_MAX_ATTEMPTS) {
                    messages.push({ role: 'assistant', textContent: text, toolCalls: [] });
                    messages.push({
                        role: 'user',
                        content: '上次输出不是合法 JSON，请只输出 JSON TaskPlan，不要包含其他内容。',
                    });
                    continue;
                }
                throw makeError(
                    ErrorCode.ERR_INVALID_ARGUMENT,
                    `LLM 输出无法解析为 JSON（${PLAN_MAX_ATTEMPTS} 次尝试后放弃）`,
                );
            }

            const result = TaskPlanSchema.safeParse(parsed);
            if (!result.success) {
                const firstIssues = result.error.issues
                    .slice(0, 2)
                    .map((i) => i.message)
                    .join(', ');
                const msg = `TaskPlan schema 校验失败（第 ${attempt} 次）: ${firstIssues}`;
                await postUpdate(runId, PLAN_TASK_ID, msg);
                if (attempt < PLAN_MAX_ATTEMPTS) {
                    messages.push({ role: 'assistant', textContent: text, toolCalls: [] });
                    messages.push({
                        role: 'user',
                        content: `TaskPlan 格式不合法（${firstIssues}），请修正后重新输出 JSON TaskPlan。`,
                    });
                    continue;
                }
                throw makeError(
                    ErrorCode.ERR_INVALID_ARGUMENT,
                    `TaskPlan schema 校验失败（${PLAN_MAX_ATTEMPTS} 次尝试后放弃）`,
                    { issues: result.error.issues },
                );
            }

            return result.data;
        }
    }

    // 按 research → execute → audit 顺序排序任务
    function sortByRoleOrder(tasks) {
        return [...tasks].sort((a, b) => {
            const ai = ROLE_DISPATCH_ORDER.indexOf(a.type);
            const bi = ROLE_DISPATCH_ORDER.indexOf(b.type);
            return (ai === -1 ? ROLE_DISPATCH_ORDER.length : ai) -
                   (bi === -1 ? ROLE_DISPATCH_ORDER.length : bi);
        });
    }

    /**
     * 编排主入口：LLM 生成 TaskPlan → 写入 TaskBoard → 串行分派角色执行链。
     *
     * @param {{ runId: string, goal: string, session: object }} params
     * @returns {Promise<{ status: 'dispatched'|'failed', task_count?: number, error?: object }>}
     */
    async function orchestrate({ runId, goal, session }) {
        let taskPlan;
        try {
            taskPlan = await callLLMForPlan(runId, goal);
        } catch (err) {
            await postUpdate(runId, PLAN_TASK_ID, `规划失败: ${err.message}`);
            try {
                await session.failSession(runId, err.message);
            } catch {
                // session 可能尚未创建或已在终态，忽略
            }
            return { status: 'failed', error: { code: err.code, message: err.message } };
        }

        // 创建所有任务（session 内部写入 TaskBoard + 更新 index.json → planned）
        await session.planSession(runId, taskPlan.tasks);

        // planned → running
        await session.startSession(runId);

        // 按角色顺序串行分派
        const sorted = sortByRoleOrder(taskPlan.tasks);
        for (const task of sorted) {
            await postUpdate(runId, task.task_id, `Lead 分派任务: ${task.title} (${task.type})`);

            const dispatchResult = await roleDispatcher.dispatch(runId, task);

            if (dispatchResult.status === 'failed') {
                const reason = `任务 ${task.task_id} 执行失败`;
                await postUpdate(runId, task.task_id, reason);
                try {
                    await session.failSession(runId, reason);
                } catch {
                    // 状态已在终态时忽略
                }
                return { status: 'failed', error: { message: reason } };
            }
        }

        return { status: 'dispatched', task_count: taskPlan.tasks.length };
    }

    return { orchestrate };
}
