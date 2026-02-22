import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { createAgentRunner } from './agentRunner.js';
import { createMailbox } from '../core/orchestration/mailbox/mailbox.js';
import { createPromptAssembler } from '../core/prompt/promptAssembler.js';
import { ErrorCode } from '../core/contracts/errors.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function makeFragments(base) {
    const fragmentsBaseDir = join(base, 'fragments');
    await mkdir(join(fragmentsBaseDir, 'platform'), { recursive: true });
    await mkdir(join(fragmentsBaseDir, 'runtime'), { recursive: true });
    await mkdir(join(fragmentsBaseDir, 'role'), { recursive: true });

    await writeFile(join(fragmentsBaseDir, 'platform', 'safety.md'), 'SAFETY', 'utf-8');
    await writeFile(join(fragmentsBaseDir, 'platform', 'tooling.md'), 'TOOLING', 'utf-8');
    await writeFile(join(fragmentsBaseDir, 'runtime', 'context.md'), 'CONTEXT', 'utf-8');
    await writeFile(join(fragmentsBaseDir, 'runtime', 'sandbox.md'), 'SANDBOX', 'utf-8');
    await writeFile(join(fragmentsBaseDir, 'role', 'researcher.md'), 'ROLE_RESEARCHER', 'utf-8');

    return fragmentsBaseDir;
}

async function makeSetup(llmClientFactory, overrides = {}) {
    const tmpDir = await mkdtemp(join(tmpdir(), 'arkanis-p13-'));
    const outputDir = join(tmpDir, 'outputs', 'agents_team');

    const fragmentsBaseDir = await makeFragments(tmpDir);

    const mailbox = createMailbox({ outputDir });
    const promptAssembler = createPromptAssembler({ fragmentsBaseDir, outputDir });

    let toolGatewayCallCount = 0;
    const toolGateway = overrides.toolGateway ?? {
        call: async (_toolName, _args, _ctx, _meta) => {
            toolGatewayCallCount++;
            return { ok: true, data: { result: 'ok', artifact_refs: [] } };
        },
    };

    const runId = '20260101_120000';
    const runContext = {
        runId,
        outputDir,
        maxTurns: overrides.maxTurns ?? 10,
    };

    const llmClient = llmClientFactory();
    const runner = createAgentRunner({ llmClient, toolGateway, mailbox, promptAssembler, runContext });

    return { runner, mailbox, runId, getToolCallCount: () => toolGatewayCallCount };
}

const TASK = { task_id: 'task-p13', title: '测试任务', type: 'research' };

// T1 — mock LLM 第 1 轮返回 tool_call，第 2 轮返回 end_turn
test('T1: tool_call → ToolGateway 调用 → end_turn → status=completed, turns=2', async () => {
    let callCount = 0;
    const { runner, mailbox, runId, getToolCallCount } = await makeSetup(() => ({
        chatWithTools: async () => {
            callCount++;
            if (callCount === 1) {
                return {
                    textContent: 'LLM 准备调用工具',
                    toolCalls: [{ call_id: 'call-1', tool_name: 'file.read', input: { path: '/tmp/x' } }],
                    stopReason: 'tool_use',
                    usage: { input: 100, output: 50 },
                };
            }
            return {
                textContent: '工具结果已收到，任务完成',
                toolCalls: [],
                stopReason: 'end_turn',
                usage: { input: 150, output: 80 },
            };
        },
    }));

    const result = await runner.run({ task: TASK, role: 'researcher' });

    assert.equal(result.status, 'completed');
    assert.equal(result.turns, 2);
    assert.equal(getToolCallCount(), 1, 'toolGateway.call 应被调用 1 次');

    const messages = await mailbox.getMessages(runId);
    const updates = messages.filter((m) => m.type === 'update');
    assert.ok(updates.length >= 2, `至少应有 2 条 update 消息，实际: ${updates.length}`);
});

// T2 — max_turns 超限后正确失败
test('T2: max_turns=2，LLM 永远返回 tool_call → status=failed, turns=2，mailbox 含超限提示', async () => {
    const { runner, mailbox, runId } = await makeSetup(
        () => ({
            chatWithTools: async () => ({
                textContent: '继续调用工具',
                toolCalls: [{ call_id: 'call-x', tool_name: 'file.read', input: { path: '/tmp/y' } }],
                stopReason: 'tool_use',
                usage: { input: 50, output: 20 },
            }),
        }),
        { maxTurns: 2 },
    );

    const result = await runner.run({ task: TASK, role: 'researcher' });

    assert.equal(result.status, 'failed');
    assert.equal(result.turns, 2);
    assert.ok(result.error?.message?.includes('超出最大轮次'), `error.message 应含"超出最大轮次": ${result.error?.message}`);

    const messages = await mailbox.getMessages(runId);
    const updates = messages.filter((m) => m.type === 'update');
    const hasLimitMsg = updates.some((m) => m.content.includes('超出最大轮次'));
    assert.ok(hasLimitMsg, 'mailbox 中应有含"超出最大轮次"的 update 消息');
});

// T3 — LLM 调用每次 throw，重试后仍失败
test('T3: LLM 每次 throw → 重试后 status=failed, error.code=ERR_TOOL_EXEC_FAILED', async () => {
    let attemptCount = 0;
    const { runner, mailbox, runId } = await makeSetup(() => ({
        chatWithTools: async () => {
            attemptCount++;
            throw new Error('网络连接超时');
        },
    }));

    const result = await runner.run({ task: TASK, role: 'researcher' });

    assert.equal(result.status, 'failed');
    // MAX_LLM_RETRIES=2，每轮调用 2+1=3 次
    assert.equal(attemptCount, 3, `应尝试 3 次（1 次 + 2 次重试），实际: ${attemptCount}`);
    assert.equal(result.error?.code, ErrorCode.ERR_TOOL_EXEC_FAILED);
    assert.ok(result.error?.message?.includes('网络连接超时'), `error.message 应含原始错误: ${result.error?.message}`);

    const messages = await mailbox.getMessages(runId);
    const updates = messages.filter((m) => m.type === 'update');
    assert.ok(updates.length >= 1, 'mailbox 中应有失败 update 消息');
});

// T4 — 每轮都向 Mailbox 投递 type=update 消息，数量等于 turns
test('T4: 每轮都向 mailbox 投递 update 消息，消息数 = turns', async () => {
    let callCount = 0;
    const { runner, mailbox, runId } = await makeSetup(() => ({
        chatWithTools: async () => {
            callCount++;
            if (callCount === 1) {
                return {
                    textContent: '第一轮输出',
                    toolCalls: [{ call_id: 'c1', tool_name: 'file.read', input: {} }],
                    stopReason: 'tool_use',
                    usage: { input: 80, output: 40 },
                };
            }
            return {
                textContent: '第二轮输出，结束',
                toolCalls: [],
                stopReason: 'end_turn',
                usage: { input: 120, output: 60 },
            };
        },
    }));

    const result = await runner.run({ task: TASK, role: 'researcher' });

    assert.equal(result.status, 'completed');
    assert.equal(result.turns, 2);

    const messages = await mailbox.getMessages(runId);
    const updates = messages.filter((m) => m.type === 'update' && m.from_agent === 'researcher-runner');
    assert.equal(updates.length, result.turns, `update 消息数应等于 turns=${result.turns}，实际: ${updates.length}`);

    const contents = updates.map((u) => u.content);
    assert.ok(contents.some((c) => c.includes('第一轮输出')), `update 消息集合中应含"第一轮输出"，实际: ${JSON.stringify(contents)}`);
    assert.ok(contents.some((c) => c.includes('第二轮输出')), `update 消息集合中应含"第二轮输出"，实际: ${JSON.stringify(contents)}`);
});
