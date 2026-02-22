import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createTaskBoard, FailureClass } from './taskBoard.js';
import { TaskStatus, TaskType } from '../../contracts/task.schema.js';
import { ErrorCode } from '../../contracts/errors.js';
import { DenyReason } from '../../contracts/denyReasons.js';

const RUN_ID = '20260101_120000';
const LEASE_MS = 60_000;

async function makeBoard() {
    const dir = await mkdtemp(join(tmpdir(), 'arkanis-p3-board-'));
    const board = createTaskBoard({ outputDir: join(dir, 'outputs/agents_team') });
    return board;
}

function baseTaskParams(overrides = {}) {
    return {
        task_id: 'task-1',
        title: '调研任务',
        type: TaskType.RESEARCH,
        input: { query: 'test' },
        ...overrides,
    };
}

test('createTask 写入 pending 状态', async () => {
    const board = await makeBoard();
    const task = await board.createTask(RUN_ID, baseTaskParams());
    assert.equal(task.status, TaskStatus.PENDING);
    assert.equal(task.task_id, 'task-1');
    assert.equal(task.run_id, RUN_ID);
});

test('正常完整链路：pending → claimed → running → completed', async () => {
    const board = await makeBoard();
    await board.createTask(RUN_ID, baseTaskParams());

    const { lease_token } = await board.claimTask(RUN_ID, 'task-1', {
        agent_id: 'researcher-01',
        lease_duration_ms: LEASE_MS,
    });
    assert.ok(lease_token, 'claimTask 应返回 lease_token');

    await board.startTask(RUN_ID, 'task-1', lease_token);

    await board.completeTask(RUN_ID, 'task-1', lease_token, {
        artifact_refs: [{ artifact_id: 'artifact-a', type: 'research_report' }],
    });

    // completed 态不可再认领，间接验证落盘状态
    await assert.rejects(
        () =>
            board.claimTask(RUN_ID, 'task-1', {
                agent_id: 'executor-01',
                lease_duration_ms: LEASE_MS,
            }),
        (err) => {
            assert.equal(err.code, ErrorCode.ERR_POLICY_DENIED);
            assert.equal(err.deny_reason, DenyReason.TASK_WRONG_STATE);
            return true;
        },
    );
});

test('失败链路：pending → claimed → running → failed', async () => {
    const board = await makeBoard();
    await board.createTask(RUN_ID, baseTaskParams({ task_id: 'task-fail' }));

    const { lease_token } = await board.claimTask(RUN_ID, 'task-fail', {
        agent_id: 'executor-01',
        lease_duration_ms: LEASE_MS,
    });

    await board.startTask(RUN_ID, 'task-fail', lease_token);

    await board.failTask(RUN_ID, 'task-fail', lease_token, {
        failure_class: FailureClass.RETRYABLE,
        message: '外部服务超时',
    });

    // failed 态不可再认领
    await assert.rejects(
        () =>
            board.claimTask(RUN_ID, 'task-fail', {
                agent_id: 'executor-02',
                lease_duration_ms: LEASE_MS,
            }),
        (err) => {
            assert.equal(err.code, ErrorCode.ERR_POLICY_DENIED);
            assert.equal(err.deny_reason, DenyReason.TASK_WRONG_STATE);
            return true;
        },
    );
});

test('认领冲突：两次 claimTask 同一 task → ERR_LEASE_CONFLICT', async () => {
    const board = await makeBoard();
    await board.createTask(RUN_ID, baseTaskParams({ task_id: 'task-conflict' }));

    await board.claimTask(RUN_ID, 'task-conflict', {
        agent_id: 'agent-a',
        lease_duration_ms: LEASE_MS,
    });

    await assert.rejects(
        () =>
            board.claimTask(RUN_ID, 'task-conflict', {
                agent_id: 'agent-b',
                lease_duration_ms: LEASE_MS,
            }),
        (err) => {
            assert.equal(err.code, ErrorCode.ERR_LEASE_CONFLICT);
            return true;
        },
    );
});

test('startTask 用错误的 lease_token → ERR_LEASE_EXPIRED', async () => {
    const board = await makeBoard();
    await board.createTask(RUN_ID, baseTaskParams({ task_id: 'task-stale' }));

    await board.claimTask(RUN_ID, 'task-stale', {
        agent_id: 'agent-a',
        lease_duration_ms: LEASE_MS,
    });

    await assert.rejects(
        () => board.startTask(RUN_ID, 'task-stale', '00000000-0000-4000-8000-000000000000'),
        (err) => {
            assert.equal(err.code, ErrorCode.ERR_LEASE_EXPIRED);
            return true;
        },
    );
});

test('completeTask 用错误的 lease_token → ERR_LEASE_EXPIRED', async () => {
    const board = await makeBoard();
    await board.createTask(RUN_ID, baseTaskParams({ task_id: 'task-stale2' }));

    const { lease_token } = await board.claimTask(RUN_ID, 'task-stale2', {
        agent_id: 'agent-a',
        lease_duration_ms: LEASE_MS,
    });

    await board.startTask(RUN_ID, 'task-stale2', lease_token);

    await assert.rejects(
        () =>
            board.completeTask(RUN_ID, 'task-stale2', '00000000-0000-4000-8000-000000000000', {
                artifact_refs: [{ artifact_id: 'art-x' }],
            }),
        (err) => {
            assert.equal(err.code, ErrorCode.ERR_LEASE_EXPIRED);
            return true;
        },
    );
});

test('completeTask artifact_refs 为空 → ERR_INVALID_ARGUMENT', async () => {
    const board = await makeBoard();
    await board.createTask(RUN_ID, baseTaskParams({ task_id: 'task-noref' }));

    const { lease_token } = await board.claimTask(RUN_ID, 'task-noref', {
        agent_id: 'agent-a',
        lease_duration_ms: LEASE_MS,
    });
    await board.startTask(RUN_ID, 'task-noref', lease_token);

    await assert.rejects(
        () => board.completeTask(RUN_ID, 'task-noref', lease_token, { artifact_refs: [] }),
        (err) => {
            assert.equal(err.code, ErrorCode.ERR_INVALID_ARGUMENT);
            return true;
        },
    );
});

test('completed 任务无法再次 claim → ERR_POLICY_DENIED', async () => {
    const board = await makeBoard();
    await board.createTask(RUN_ID, baseTaskParams({ task_id: 'task-done' }));

    const { lease_token } = await board.claimTask(RUN_ID, 'task-done', {
        agent_id: 'agent-a',
        lease_duration_ms: LEASE_MS,
    });
    await board.startTask(RUN_ID, 'task-done', lease_token);
    await board.completeTask(RUN_ID, 'task-done', lease_token, {
        artifact_refs: [{ artifact_id: 'art-done' }],
    });

    await assert.rejects(
        () =>
            board.claimTask(RUN_ID, 'task-done', {
                agent_id: 'agent-b',
                lease_duration_ms: LEASE_MS,
            }),
        (err) => {
            assert.equal(err.code, ErrorCode.ERR_POLICY_DENIED);
            assert.equal(err.deny_reason, DenyReason.TASK_WRONG_STATE);
            return true;
        },
    );
});

test('startTask 在非 claimed 状态 → ERR_POLICY_DENIED', async () => {
    const board = await makeBoard();
    await board.createTask(RUN_ID, baseTaskParams({ task_id: 'task-ns' }));

    await assert.rejects(
        () =>
            board.startTask(
                RUN_ID,
                'task-ns',
                '00000000-0000-4000-8000-000000000000',
            ),
        (err) => {
            assert.equal(err.code, ErrorCode.ERR_POLICY_DENIED);
            assert.equal(err.deny_reason, DenyReason.TASK_WRONG_STATE);
            return true;
        },
    );
});

test('failTask 在非 running 状态 → ERR_POLICY_DENIED', async () => {
    const board = await makeBoard();
    await board.createTask(RUN_ID, baseTaskParams({ task_id: 'task-nf' }));

    const { lease_token } = await board.claimTask(RUN_ID, 'task-nf', {
        agent_id: 'agent-a',
        lease_duration_ms: LEASE_MS,
    });

    // 此时是 claimed 态，不是 running
    await assert.rejects(
        () =>
            board.failTask(RUN_ID, 'task-nf', lease_token, {
                failure_class: FailureClass.RETRYABLE,
                message: '测试',
            }),
        (err) => {
            assert.equal(err.code, ErrorCode.ERR_POLICY_DENIED);
            assert.equal(err.deny_reason, DenyReason.TASK_WRONG_STATE);
            return true;
        },
    );
});

test('claimTask 返回的 attempt 为 1（首次认领）', async () => {
    const board = await makeBoard();
    await board.createTask(RUN_ID, baseTaskParams({ task_id: 'task-attempt' }));

    await board.claimTask(RUN_ID, 'task-attempt', {
        agent_id: 'agent-a',
        lease_duration_ms: LEASE_MS,
    });

    // 通过再次 claimTask 触发 ERR_LEASE_CONFLICT 确认租约已写入
    const err = await board
        .claimTask(RUN_ID, 'task-attempt', { agent_id: 'agent-b', lease_duration_ms: LEASE_MS })
        .catch((e) => e);
    assert.equal(err.code, ErrorCode.ERR_LEASE_CONFLICT);
    // 冲突错误的 details 包含 holder
    assert.equal(err.details.holder, 'agent-a');
});

// --- P4: 依赖图 ---

test('depends_on B 时无法认领 A → ERR_TASK_DEPENDENCY_NOT_MET', async () => {
    const board = await makeBoard();
    await board.createTask(RUN_ID, baseTaskParams({ task_id: 'dep-b' }));
    await board.createTask(RUN_ID, baseTaskParams({ task_id: 'dep-a', depends_on: ['dep-b'] }));

    await assert.rejects(
        () => board.claimTask(RUN_ID, 'dep-a', { agent_id: 'agent-x', lease_duration_ms: LEASE_MS }),
        (err) => {
            assert.equal(err.code, ErrorCode.ERR_TASK_DEPENDENCY_NOT_MET);
            assert.deepEqual(err.details.blocking_tasks, ['dep-b']);
            return true;
        },
    );
});

test('B 完成后 A 自动 unblock，A 可被认领', async () => {
    const board = await makeBoard();
    await board.createTask(RUN_ID, baseTaskParams({ task_id: 'auto-b' }));
    await board.createTask(RUN_ID, baseTaskParams({ task_id: 'auto-a', depends_on: ['auto-b'] }));

    // 触发 block
    await assert.rejects(
        () => board.claimTask(RUN_ID, 'auto-a', { agent_id: 'agent-x', lease_duration_ms: LEASE_MS }),
        (err) => err.code === ErrorCode.ERR_TASK_DEPENDENCY_NOT_MET,
    );

    // 完成 B
    const { lease_token: ltB } = await board.claimTask(RUN_ID, 'auto-b', {
        agent_id: 'agent-b',
        lease_duration_ms: LEASE_MS,
    });
    await board.startTask(RUN_ID, 'auto-b', ltB);
    await board.completeTask(RUN_ID, 'auto-b', ltB, {
        artifact_refs: [{ artifact_id: 'art-b', type: 'research_report' }],
    });

    // A 应已自动 unblock，可认领
    const { lease_token: ltA } = await board.claimTask(RUN_ID, 'auto-a', {
        agent_id: 'agent-a',
        lease_duration_ms: LEASE_MS,
    });
    assert.ok(ltA, 'B 完成后 A 应可认领');
});

test('循环依赖被拒绝 → ERR_INVALID_ARGUMENT', async () => {
    const board = await makeBoard();
    // 建立 cyc-a，再建 cyc-b depends_on cyc-a
    await board.createTask(RUN_ID, baseTaskParams({ task_id: 'cyc-a' }));
    await board.createTask(RUN_ID, baseTaskParams({ task_id: 'cyc-b', depends_on: ['cyc-a'] }));

    // 试图让 cyc-a depends_on cyc-b → 形成 cyc-a → cyc-b → cyc-a 循环
    await assert.rejects(
        () =>
            board.createTask(RUN_ID, baseTaskParams({ task_id: 'cyc-a', depends_on: ['cyc-b'] })),
        (err) => {
            assert.equal(err.code, ErrorCode.ERR_INVALID_ARGUMENT);
            return true;
        },
    );
});

test('blockTask 显式调用：blocked 状态下再次 claimTask 仍返回 ERR_TASK_DEPENDENCY_NOT_MET', async () => {
    const board = await makeBoard();
    await board.createTask(RUN_ID, baseTaskParams({ task_id: 'blk-dep' }));
    await board.createTask(
        RUN_ID,
        baseTaskParams({ task_id: 'blk-task', depends_on: ['blk-dep'] }),
    );

    await board.blockTask(RUN_ID, 'blk-task', { blocking_task_ids: ['blk-dep'] });

    await assert.rejects(
        () =>
            board.claimTask(RUN_ID, 'blk-task', { agent_id: 'agent-x', lease_duration_ms: LEASE_MS }),
        (err) => {
            assert.equal(err.code, ErrorCode.ERR_TASK_DEPENDENCY_NOT_MET);
            return true;
        },
    );
});

test('unblockTask：依赖未完成时返回 ERR_TASK_DEPENDENCY_NOT_MET', async () => {
    const board = await makeBoard();
    await board.createTask(RUN_ID, baseTaskParams({ task_id: 'ub-dep' }));
    await board.createTask(
        RUN_ID,
        baseTaskParams({ task_id: 'ub-task', depends_on: ['ub-dep'] }),
    );
    await board.blockTask(RUN_ID, 'ub-task', { blocking_task_ids: ['ub-dep'] });

    await assert.rejects(
        () => board.unblockTask(RUN_ID, 'ub-task'),
        (err) => {
            assert.equal(err.code, ErrorCode.ERR_TASK_DEPENDENCY_NOT_MET);
            return true;
        },
    );
});

test('多依赖：全部完成后才 unblock，部分完成时仍 blocked', async () => {
    const board = await makeBoard();
    await board.createTask(RUN_ID, baseTaskParams({ task_id: 'multi-x' }));
    await board.createTask(RUN_ID, baseTaskParams({ task_id: 'multi-y' }));
    await board.createTask(
        RUN_ID,
        baseTaskParams({ task_id: 'multi-z', depends_on: ['multi-x', 'multi-y'] }),
    );

    // 尝试认领 Z → 触发 block
    await assert.rejects(
        () =>
            board.claimTask(RUN_ID, 'multi-z', { agent_id: 'agent-z', lease_duration_ms: LEASE_MS }),
        (err) => err.code === ErrorCode.ERR_TASK_DEPENDENCY_NOT_MET,
    );

    // 仅完成 X
    const { lease_token: ltX } = await board.claimTask(RUN_ID, 'multi-x', {
        agent_id: 'agent-x',
        lease_duration_ms: LEASE_MS,
    });
    await board.startTask(RUN_ID, 'multi-x', ltX);
    await board.completeTask(RUN_ID, 'multi-x', ltX, {
        artifact_refs: [{ artifact_id: 'art-x' }],
    });

    // Z 还在等 Y，仍不可认领
    await assert.rejects(
        () =>
            board.claimTask(RUN_ID, 'multi-z', { agent_id: 'agent-z', lease_duration_ms: LEASE_MS }),
        (err) => {
            assert.equal(err.code, ErrorCode.ERR_TASK_DEPENDENCY_NOT_MET);
            return true;
        },
    );

    // 完成 Y
    const { lease_token: ltY } = await board.claimTask(RUN_ID, 'multi-y', {
        agent_id: 'agent-y',
        lease_duration_ms: LEASE_MS,
    });
    await board.startTask(RUN_ID, 'multi-y', ltY);
    await board.completeTask(RUN_ID, 'multi-y', ltY, {
        artifact_refs: [{ artifact_id: 'art-y' }],
    });

    // Z 现在可认领
    const { lease_token: ltZ } = await board.claimTask(RUN_ID, 'multi-z', {
        agent_id: 'agent-z',
        lease_duration_ms: LEASE_MS,
    });
    assert.ok(ltZ, 'X 和 Y 均完成后 Z 应可认领');
});
