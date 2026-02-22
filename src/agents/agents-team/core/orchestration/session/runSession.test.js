import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createRunSession } from './runSession.js';
import { createTaskBoard } from '../taskboard/taskBoard.js';
import { createFileLock, LockMode } from '../taskboard/fileLock.js';
import { createRunPaths } from '../../outputs/runPaths.js';
import { SessionStatus } from '../../contracts/session.schema.js';
import { TaskStatus } from '../../contracts/task.schema.js';
import { ErrorCode } from '../../contracts/errors.js';

const DEFAULT_CONFIG = { max_turns: 10, timeout_ms: 60_000 };
const GOAL = '分析当前 Node.js 版本';

// 每次测试使用独立临时目录，避免 run_id 同秒冲突
async function makeCtx() {
    const dir = await mkdtemp(join(tmpdir(), 'arkanis-p9-'));
    const outputDir = join(dir, 'outputs/agents_team');
    const runSession = createRunSession({ outputDir });
    return { runSession, outputDir, dir };
}

// --- T1: createSession ---
test('createSession：返回合法 run_id，index.json 可读，status=created', async () => {
    const { runSession, outputDir } = await makeCtx();
    const { run_id, session } = await runSession.createSession(GOAL, DEFAULT_CONFIG);

    assert.match(run_id, /^[0-9]{8}_[0-9]{6}$/);
    assert.equal(session.status, SessionStatus.CREATED);
    assert.equal(session.goal, GOAL);
    assert.equal(session.tasks_summary.total, 0);
    assert.equal(session.decision, undefined);

    // index.json 已落盘
    const indexPath = join(outputDir, run_id, 'index.json');
    const raw = JSON.parse(await readFile(indexPath, 'utf-8'));
    assert.equal(raw.status, SessionStatus.CREATED);
});

// --- T2: planSession ---
test('planSession：tasks_summary 反映正确的 pending 计数', async () => {
    const { runSession } = await makeCtx();
    const { run_id } = await runSession.createSession(GOAL, DEFAULT_CONFIG);

    const session = await runSession.planSession(run_id, [
        { task_id: 'task-01', title: '调研', type: 'research', input: {} },
        { task_id: 'task-02', title: '执行', type: 'execute', input: {}, depends_on: ['task-01'] },
    ]);

    assert.equal(session.status, SessionStatus.PLANNED);
    assert.equal(session.tasks_summary.total, 2);
    assert.equal(session.tasks_summary.pending, 2);
    assert.equal(session.tasks_summary.completed, 0);
});

// --- T3: 完整链路 ---
test('完整链路：created→planned→running→finalizing→completed，decision 字段存在', async () => {
    const { runSession } = await makeCtx();
    const { run_id } = await runSession.createSession(GOAL, DEFAULT_CONFIG);

    await runSession.planSession(run_id, [
        { task_id: 'task-01', title: '调研', type: 'research', input: {} },
    ]);

    let session = await runSession.startSession(run_id);
    assert.equal(session.status, SessionStatus.RUNNING);

    session = await runSession.finalizeSession(run_id);
    assert.equal(session.status, SessionStatus.FINALIZING);

    session = await runSession.completeSession(run_id, {
        artifact_id: 'decision-01',
        direction: '建议升级至 Node.js v22',
    });
    assert.equal(session.status, SessionStatus.COMPLETED);
    assert.equal(session.decision.artifact_id, 'decision-01');
    assert.equal(session.decision.direction, '建议升级至 Node.js v22');
    assert.ok(typeof session.decision.decided_at === 'string');
});

// --- T4: failSession ---
test('failSession 从 running 状态写入 failed + failure_reason', async () => {
    const { runSession } = await makeCtx();
    const { run_id } = await runSession.createSession(GOAL, DEFAULT_CONFIG);
    await runSession.planSession(run_id, [
        { task_id: 'task-01', title: '调研', type: 'research', input: {} },
    ]);
    await runSession.startSession(run_id);

    const session = await runSession.failSession(run_id, '仲裁超限，无法收敛');
    assert.equal(session.status, SessionStatus.FAILED);
    assert.equal(session.failure_reason, '仲裁超限，无法收敛');
});

// --- T5: abortSession 清理 ---
test('abortSession：claimed 任务回收为 pending，lease 清除，locks 目录无残留', async () => {
    const { runSession, outputDir } = await makeCtx();
    const { run_id } = await runSession.createSession(GOAL, DEFAULT_CONFIG);

    await runSession.planSession(run_id, [
        { task_id: 'task-01', title: '调研', type: 'research', input: {} },
    ]);
    await runSession.startSession(run_id);

    const rp = createRunPaths({ outputDir, runId: run_id });

    // 认领任务（使用独立 TaskBoard 实例，同一 file-based 存储）
    const tb = createTaskBoard({ outputDir });
    const { lease_token } = await tb.claimTask(run_id, 'task-01', {
        agent_id: 'researcher-01',
        lease_duration_ms: 60_000,
    });

    // 获取一个 write 锁
    const fl = createFileLock({ outputDir });
    const leaseExpireAt = new Date(Date.now() + 60_000).toISOString();
    await fl.acquireLock(run_id, {
        targetPath: '/workspace/report.md',
        mode: LockMode.WRITE,
        leaseToken: lease_token,
        agentId: 'researcher-01',
        leaseExpireAt,
    });

    // abort
    const session = await runSession.abortSession(run_id);
    assert.equal(session.status, SessionStatus.ABORTED);

    // 验证任务回收为 pending，lease 清除
    const tbAfter = createTaskBoard({ outputDir });
    const task = await tbAfter.getTask(run_id, 'task-01');
    assert.equal(task.status, TaskStatus.PENDING);
    assert.equal(task.lease, undefined);

    // 验证 locks 目录无 .json 文件
    let lockFiles;
    try {
        lockFiles = await readdir(rp.locksDir);
    } catch (err) {
        lockFiles = [];
    }
    const remaining = lockFiles.filter((f) => f.endsWith('.json') && !f.includes('.tmp'));
    assert.equal(remaining.length, 0);
});

// --- T6: refreshIndex ---
test('refreshIndex：claimTask 后调用，tasks_summary.claimed 正确更新', async () => {
    const { runSession, outputDir } = await makeCtx();
    const { run_id } = await runSession.createSession(GOAL, DEFAULT_CONFIG);

    await runSession.planSession(run_id, [
        { task_id: 'task-01', title: '调研', type: 'research', input: {} },
        { task_id: 'task-02', title: '执行', type: 'execute', input: {} },
    ]);
    await runSession.startSession(run_id);

    // claimTask 直接通过 TaskBoard（绕过 runSession 内部，模拟外部 Agent 操作）
    const tb = createTaskBoard({ outputDir });
    await tb.claimTask(run_id, 'task-01', {
        agent_id: 'researcher-01',
        lease_duration_ms: 60_000,
    });

    // refreshIndex 前 index.json 仍是 planSession 写入的摘要（pending=2）
    // refreshIndex 后应反映 claimed=1, pending=1
    const session = await runSession.refreshIndex(run_id);
    assert.equal(session.tasks_summary.total, 2);
    assert.equal(session.tasks_summary.claimed, 1);
    assert.equal(session.tasks_summary.pending, 1);
});

// --- T7: 非法状态迁移 ---
test('非法迁移 completed→planSession 抛 ERR_SESSION_INVALID_STATE', async () => {
    const { runSession } = await makeCtx();
    const { run_id } = await runSession.createSession(GOAL, DEFAULT_CONFIG);
    await runSession.planSession(run_id, [
        { task_id: 'task-01', title: '调研', type: 'research', input: {} },
    ]);
    await runSession.startSession(run_id);
    await runSession.finalizeSession(run_id);
    await runSession.completeSession(run_id, {
        artifact_id: 'decision-01',
        direction: '建议升级',
    });

    // completed 是终态，无法再 planSession（内部先 readSession 再 assertTransition）
    await assert.rejects(
        () =>
            runSession.planSession(run_id, [
                { task_id: 'task-99', title: '多余', type: 'audit', input: {} },
            ]),
        (err) => {
            assert.equal(err.code, ErrorCode.ERR_SESSION_INVALID_STATE);
            return true;
        },
    );
});

// --- 补充：createSession 配置校验 ---
test('createSession：config 校验失败（max_turns=0）→ ERR_INVALID_ARGUMENT', async () => {
    const { runSession } = await makeCtx();
    await assert.rejects(
        () => runSession.createSession(GOAL, { max_turns: 0, timeout_ms: 60_000 }),
        (err) => {
            assert.equal(err.code, ErrorCode.ERR_INVALID_ARGUMENT);
            return true;
        },
    );
});

// --- 补充：abort from planned ---
test('abortSession 从 planned 状态直接中止', async () => {
    const { runSession } = await makeCtx();
    const { run_id } = await runSession.createSession(GOAL, DEFAULT_CONFIG);
    await runSession.planSession(run_id, [
        { task_id: 'task-01', title: '调研', type: 'research', input: {} },
    ]);

    const session = await runSession.abortSession(run_id);
    assert.equal(session.status, SessionStatus.ABORTED);
});

// --- 补充：failSession 从 finalizing ---
test('failSession 从 finalizing 状态', async () => {
    const { runSession } = await makeCtx();
    const { run_id } = await runSession.createSession(GOAL, DEFAULT_CONFIG);
    await runSession.planSession(run_id, [
        { task_id: 'task-01', title: '调研', type: 'research', input: {} },
    ]);
    await runSession.startSession(run_id);
    await runSession.finalizeSession(run_id);

    const session = await runSession.failSession(run_id, '证据不足，无法收敛');
    assert.equal(session.status, SessionStatus.FAILED);
    assert.equal(session.failure_reason, '证据不足，无法收敛');
});
