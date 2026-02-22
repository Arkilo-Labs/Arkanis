import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createOrchestratorAgent, createLeadGateway } from './orchestratorAgent.js';
import { createRunSession } from '../core/orchestration/session/runSession.js';
import { createTaskBoardStore } from '../core/orchestration/taskboard/taskBoardStore.js';
import { createMailbox } from '../core/orchestration/mailbox/mailbox.js';
import { createPromptAssembler } from '../core/prompt/promptAssembler.js';
import { ErrorCode } from '../core/contracts/errors.js';

async function makeFragments(base) {
    const fragmentsBaseDir = join(base, 'fragments');
    await mkdir(join(fragmentsBaseDir, 'platform'), { recursive: true });
    await mkdir(join(fragmentsBaseDir, 'runtime'), { recursive: true });
    await mkdir(join(fragmentsBaseDir, 'role'), { recursive: true });

    await writeFile(join(fragmentsBaseDir, 'platform', 'safety.md'), 'SAFETY', 'utf-8');
    await writeFile(join(fragmentsBaseDir, 'platform', 'tooling.md'), 'TOOLING', 'utf-8');
    await writeFile(join(fragmentsBaseDir, 'runtime', 'context.md'), 'CONTEXT', 'utf-8');
    await writeFile(join(fragmentsBaseDir, 'runtime', 'sandbox.md'), 'SANDBOX', 'utf-8');
    await writeFile(join(fragmentsBaseDir, 'role', 'lead.md'), 'ROLE_LEAD', 'utf-8');

    return fragmentsBaseDir;
}

const VALID_TASK_PLAN = JSON.stringify({
    tasks: [
        { task_id: 'task-r1', title: '调研市场', type: 'research', input: {}, assigned_role: 'researcher' },
        { task_id: 'task-e1', title: '执行操作', type: 'execute', input: {}, assigned_role: 'executor', depends_on: ['task-r1'] },
        { task_id: 'task-a1', title: '审计结果', type: 'audit', input: {}, assigned_role: 'auditor', depends_on: ['task-e1'] },
    ],
});

async function makeSetup({ llmClientFactory, roleDispatcherFactory } = {}) {
    const tmpDir = await mkdtemp(join(tmpdir(), 'arkanis-p14-'));
    const outputDir = join(tmpDir, 'outputs', 'agents_team');

    const fragmentsBaseDir = await makeFragments(tmpDir);

    const mailbox = createMailbox({ outputDir });
    const promptAssembler = createPromptAssembler({ fragmentsBaseDir, outputDir });
    const session = createRunSession({ outputDir });

    const roleDispatcher = roleDispatcherFactory?.() ?? {
        dispatch: async (_runId, _task) => ({ status: 'completed', artifact_refs: [] }),
    };

    const llmClient = llmClientFactory?.() ?? {
        chatWithTools: async () => ({
            textContent: VALID_TASK_PLAN,
            toolCalls: [],
            stopReason: 'end_turn',
            usage: { input: 100, output: 50 },
        }),
    };

    const orchestrator = createOrchestratorAgent({
        llmClient,
        mailbox,
        promptAssembler,
        roleDispatcher,
        runContext: {},
    });

    const tbStore = createTaskBoardStore({ outputDir });

    return { orchestrator, session, mailbox, tbStore, outputDir };
}

const SESSION_CONFIG = { max_turns: 10, timeout_ms: 60_000 };
const GOAL = '完成一次调研与执行';

// T1 — 合法 TaskPlan → TaskBoard 写入 3 个 task，status=dispatched
test('T1: 合法 TaskPlan → TaskBoard 写入 3 个 task，status=dispatched', async () => {
    let llmCallCount = 0;
    const { orchestrator, session, tbStore } = await makeSetup({
        llmClientFactory: () => ({
            chatWithTools: async () => {
                llmCallCount++;
                return {
                    textContent: VALID_TASK_PLAN,
                    toolCalls: [],
                    stopReason: 'end_turn',
                    usage: { input: 100, output: 50 },
                };
            },
        }),
    });

    const { run_id: runId } = await session.createSession(GOAL, SESSION_CONFIG);
    const result = await orchestrator.orchestrate({ runId, goal: GOAL, session });

    assert.equal(result.status, 'dispatched', `期望 status=dispatched，实际: ${result.status}`);
    assert.equal(result.task_count, 3, `期望 task_count=3，实际: ${result.task_count}`);
    assert.equal(llmCallCount, 1, `LLM 应被调用 1 次，实际: ${llmCallCount}`);

    const tasks = await tbStore.listTasks(runId);
    assert.equal(tasks.length, 3, `TaskBoard 应有 3 个任务，实际: ${tasks.length}`);

    const taskIds = tasks.map((t) => t.task_id).sort();
    assert.deepEqual(taskIds, ['task-a1', 'task-e1', 'task-r1']);
});

// T2 — 非法 JSON × PLAN_MAX_ATTEMPTS → status=failed，mailbox 有解析失败记录，LLM 调用 2 次
test('T2: 非法 JSON → 重试一次 → status=failed，mailbox 有解析失败记录', async () => {
    let llmCallCount = 0;
    const { orchestrator, session, mailbox } = await makeSetup({
        llmClientFactory: () => ({
            chatWithTools: async () => {
                llmCallCount++;
                return {
                    textContent: 'not valid json !!!',
                    toolCalls: [],
                    stopReason: 'end_turn',
                    usage: { input: 50, output: 20 },
                };
            },
        }),
    });

    const { run_id: runId } = await session.createSession(GOAL, SESSION_CONFIG);
    const result = await orchestrator.orchestrate({ runId, goal: GOAL, session });

    assert.equal(result.status, 'failed', `期望 status=failed，实际: ${result.status}`);
    assert.ok(result.error?.code, 'error.code 应存在');
    assert.equal(llmCallCount, 2, `LLM 应被调用 2 次（原始 + 1 次重试），实际: ${llmCallCount}`);

    const messages = await mailbox.getMessages(runId);
    const updates = messages.filter((m) => m.type === 'update');
    const hasParseFailMsg = updates.some((m) => m.content.includes('解析失败'));
    assert.ok(hasParseFailMsg, `mailbox 中应有含"解析失败"的 update 消息，实际 updates: ${JSON.stringify(updates.map((m) => m.content))}`);
});

// T3 — createLeadGateway：sandbox.exec 被拒绝，outerGateway 未被调用
test('T3: createLeadGateway 拒绝 sandbox.exec，返回 ERR_POLICY_DENIED', async () => {
    let outerCalled = false;
    const mockOuter = {
        call: async () => {
            outerCalled = true;
            return { ok: true, data: {} };
        },
    };

    const leadGateway = createLeadGateway(mockOuter);
    const result = await leadGateway.call('sandbox.exec', { cmd: 'ls' }, {}, {});

    assert.equal(result.ok, false, `ok 应为 false，实际: ${result.ok}`);
    assert.equal(
        result.error?.code,
        ErrorCode.ERR_POLICY_DENIED,
        `error.code 应为 ERR_POLICY_DENIED，实际: ${result.error?.code}`,
    );
    assert.ok(result.error?.deny_reason, 'deny_reason 应存在');
    assert.ok(result.error?.message?.includes('sandbox.exec'), `error.message 应含 'sandbox.exec'`);
    assert.equal(outerCalled, false, 'outerGateway.call 不应被调用');
});

// T3b — createLeadGateway：mailbox.post 被允许，透传给 outerGateway
test('T3b: createLeadGateway 允许 mailbox.post，透传给 outerGateway', async () => {
    let calledWith = null;
    const mockOuter = {
        call: async (toolName, args) => {
            calledWith = { toolName, args };
            return { ok: true, data: { result: 'sent' } };
        },
    };

    const leadGateway = createLeadGateway(mockOuter);
    const result = await leadGateway.call('mailbox.post', { content: 'hello' }, {}, {});

    assert.equal(result.ok, true, `ok 应为 true，实际: ${result.ok}`);
    assert.deepEqual(calledWith, { toolName: 'mailbox.post', args: { content: 'hello' } });
});
