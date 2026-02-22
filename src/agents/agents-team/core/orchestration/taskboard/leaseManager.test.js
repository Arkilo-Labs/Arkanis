import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createLeaseManager } from './leaseManager.js';
import { createTaskBoardStore } from './taskBoardStore.js';
import { createTaskBoard, FailureClass } from './taskBoard.js';
import { TaskStatus, TaskType } from '../../contracts/task.schema.js';
import { ErrorCode } from '../../contracts/errors.js';
import { DenyReason } from '../../contracts/denyReasons.js';

const RUN_ID = '20260101_120000';
const LEASE_MS = 60_000; // 1 分钟

async function makeEnv() {
    const dir = await mkdtemp(join(tmpdir(), 'arkanis-p5-lm-'));
    const outputDir = join(dir, 'outputs/agents_team');
    return { outputDir };
}

function baseTask(overrides = {}) {
    return {
        task_id: 'task-1',
        title: '测试任务',
        type: TaskType.RESEARCH,
        input: { query: 'test' },
        ...overrides,
    };
}

// 快进时间：返回一个比当前时间晚 offsetMs 的 Date
function futureDate(offsetMs) {
    return new Date(Date.now() + offsetMs);
}

// --- 单元测试：直接测 leaseManager ---

test('sweep 无过期租约时返回空列表', async () => {
    const { outputDir } = await makeEnv();
    const store = createTaskBoardStore({ outputDir });
    const board = createTaskBoard({ outputDir });

    await board.createTask(RUN_ID, baseTask());
    await board.claimTask(RUN_ID, 'task-1', { agent_id: 'agent-a', lease_duration_ms: LEASE_MS });

    // now 未快进，租约未过期
    const lm = createLeaseManager({ store, now: () => new Date(), maxRetries: 3 });
    const result = await lm.sweepExpiredLeases(RUN_ID);

    assert.deepEqual(result.recovered, []);
    assert.deepEqual(result.exhausted, []);
});

test('CLAIMED 任务租约过期 → 回收为 pending，lease.attempt 保留', async () => {
    const { outputDir } = await makeEnv();
    const store = createTaskBoardStore({ outputDir });
    const board = createTaskBoard({ outputDir });

    await board.createTask(RUN_ID, baseTask());
    await board.claimTask(RUN_ID, 'task-1', { agent_id: 'agent-a', lease_duration_ms: LEASE_MS });

    const lm = createLeaseManager({ store, now: () => futureDate(LEASE_MS * 2), maxRetries: 3 });
    const result = await lm.sweepExpiredLeases(RUN_ID);

    assert.deepEqual(result.recovered, ['task-1']);
    assert.deepEqual(result.exhausted, []);

    // 验证落盘状态
    const task = await store.readTask(RUN_ID, 'task-1');
    assert.equal(task.status, TaskStatus.PENDING);
    // lease 保留以传递 attempt 计数
    assert.ok(task.lease, 'lease 应保留用于 attempt 计数');
    assert.equal(task.lease.attempt, 1);
});

test('RUNNING 任务租约过期 → 回收为 pending', async () => {
    const { outputDir } = await makeEnv();
    const store = createTaskBoardStore({ outputDir });
    const board = createTaskBoard({ outputDir });

    await board.createTask(RUN_ID, baseTask());
    const { lease_token } = await board.claimTask(RUN_ID, 'task-1', {
        agent_id: 'agent-a',
        lease_duration_ms: LEASE_MS,
    });
    await board.startTask(RUN_ID, 'task-1', lease_token);

    const lm = createLeaseManager({ store, now: () => futureDate(LEASE_MS * 2), maxRetries: 3 });
    const result = await lm.sweepExpiredLeases(RUN_ID);

    assert.deepEqual(result.recovered, ['task-1']);
    assert.deepEqual(result.exhausted, []);

    const task = await store.readTask(RUN_ID, 'task-1');
    assert.equal(task.status, TaskStatus.PENDING);
});

test('attempt >= maxRetries 时回收为 failed', async () => {
    const { outputDir } = await makeEnv();
    const store = createTaskBoardStore({ outputDir });

    // 手动走 2 次 claim+sweep（maxRetries=2），第 2 次 sweep 应触发 failed
    let virtualNow = new Date();
    const board = createTaskBoard({ outputDir, now: () => virtualNow, maxRetries: 2 });
    const lm = createLeaseManager({ store, now: () => virtualNow, maxRetries: 2 });

    await board.createTask(RUN_ID, baseTask());

    // 第 1 次认领（attempt=1）
    await board.claimTask(RUN_ID, 'task-1', { agent_id: 'agent-a', lease_duration_ms: LEASE_MS });

    // 快进 → 过期；attempt=1 < 2 → recovered
    virtualNow = futureDate(LEASE_MS * 2);
    const r1 = await lm.sweepExpiredLeases(RUN_ID);
    assert.deepEqual(r1.recovered, ['task-1']);
    assert.deepEqual(r1.exhausted, []);

    // 第 2 次认领（attempt=2）
    await board.claimTask(RUN_ID, 'task-1', { agent_id: 'agent-b', lease_duration_ms: LEASE_MS });

    // 再次快进 → 过期；attempt=2 >= 2 → exhausted
    virtualNow = futureDate(LEASE_MS * 4);
    const r2 = await lm.sweepExpiredLeases(RUN_ID);
    assert.deepEqual(r2.recovered, []);
    assert.deepEqual(r2.exhausted, ['task-1']);

    const task = await store.readTask(RUN_ID, 'task-1');
    assert.equal(task.status, TaskStatus.FAILED);
    assert.equal(task.failure_class, FailureClass.RETRYABLE);
    assert.equal(task.lease, undefined, 'failed 后 lease 应被移除');
});

test('sweepExpiredLeases 幂等性：连续两次调用，第二次均为空', async () => {
    const { outputDir } = await makeEnv();
    const store = createTaskBoardStore({ outputDir });
    const board = createTaskBoard({ outputDir });

    await board.createTask(RUN_ID, baseTask());
    await board.claimTask(RUN_ID, 'task-1', { agent_id: 'agent-a', lease_duration_ms: LEASE_MS });

    const future = () => futureDate(LEASE_MS * 2);
    const lm = createLeaseManager({ store, now: future, maxRetries: 3 });

    const r1 = await lm.sweepExpiredLeases(RUN_ID);
    assert.deepEqual(r1.recovered, ['task-1']);

    // 第二次调用：任务已是 pending，不再触发
    const r2 = await lm.sweepExpiredLeases(RUN_ID);
    assert.deepEqual(r2.recovered, []);
    assert.deepEqual(r2.exhausted, []);
});

// --- 集成测试：验证 claimTask 懒触发 sweep ---

test('claimTask 懒触发 sweep → 过期任务被回收，新 agent 可认领', async () => {
    const { outputDir } = await makeEnv();

    // 用真实时钟建 board，写入 claimed 任务（1 秒租约）
    const realBoard = createTaskBoard({ outputDir });
    await realBoard.createTask(RUN_ID, baseTask());
    await realBoard.claimTask(RUN_ID, 'task-1', {
        agent_id: 'agent-a',
        lease_duration_ms: 1_000, // 1 秒租约
    });

    // 用快进时钟建 board（10 秒后），claimTask 触发内部 sweep
    const futureBoard = createTaskBoard({
        outputDir,
        now: () => futureDate(10_000),
    });

    const { lease_token } = await futureBoard.claimTask(RUN_ID, 'task-1', {
        agent_id: 'agent-b',
        lease_duration_ms: LEASE_MS,
    });
    assert.ok(lease_token, '租约超时回收后新 agent 应能认领');

    // 验证新 lease 属于 agent-b，attempt=2
    const store = createTaskBoardStore({ outputDir });
    const task = await store.readTask(RUN_ID, 'task-1');
    assert.equal(task.status, TaskStatus.CLAIMED);
    assert.equal(task.lease.owner_agent_id, 'agent-b');
    assert.equal(task.lease.attempt, 2);
});

test('attempt 累计超限后 claimTask 返回 ERR_POLICY_DENIED', async () => {
    const { outputDir } = await makeEnv();

    let virtualNow = new Date();
    const board = createTaskBoard({ outputDir, now: () => virtualNow, maxRetries: 2 });

    await board.createTask(RUN_ID, baseTask());

    // 第 1 次认领（attempt=1）
    await board.claimTask(RUN_ID, 'task-1', { agent_id: 'agent-a', lease_duration_ms: LEASE_MS });

    // 快进 → 内部 sweep 回收（attempt=1 < 2 → pending）
    virtualNow = futureDate(LEASE_MS * 2);

    // 第 2 次认领（attempt=2）
    await board.claimTask(RUN_ID, 'task-1', { agent_id: 'agent-b', lease_duration_ms: LEASE_MS });

    // 再次快进 → 内部 sweep 触发 exhausted（attempt=2 >= 2 → failed）
    // 接着 claimTask 读到 failed 任务，返回 ERR_POLICY_DENIED
    virtualNow = futureDate(LEASE_MS * 4);

    await assert.rejects(
        () =>
            board.claimTask(RUN_ID, 'task-1', { agent_id: 'agent-c', lease_duration_ms: LEASE_MS }),
        (err) => {
            assert.equal(err.code, ErrorCode.ERR_POLICY_DENIED);
            assert.equal(err.deny_reason, DenyReason.TASK_WRONG_STATE);
            return true;
        },
    );

    // 最终落盘为 failed
    const store = createTaskBoardStore({ outputDir });
    const task = await store.readTask(RUN_ID, 'task-1');
    assert.equal(task.status, TaskStatus.FAILED);
    assert.equal(task.failure_class, FailureClass.RETRYABLE);
});
