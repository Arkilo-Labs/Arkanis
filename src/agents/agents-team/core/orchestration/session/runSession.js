import { readdir, unlink } from 'node:fs/promises';
import path from 'node:path';

import { createRunPaths, formatUtcRunId } from '../../outputs/runPaths.js';
import { createSessionStore } from './sessionStore.js';
import { createTaskBoardStore } from '../taskboard/taskBoardStore.js';
import { createTaskBoard } from '../taskboard/taskBoard.js';
import { createMailboxStore } from '../mailbox/mailboxStore.js';
import { SessionStatus, SessionConfigSchema } from '../../contracts/session.schema.js';
import { TaskStatus } from '../../contracts/task.schema.js';
import { ErrorCode } from '../../contracts/errors.js';
import { makeError } from '../errors.util.js';

// 合法状态迁移表
const VALID_TRANSITIONS = Object.freeze({
    [SessionStatus.CREATED]: [SessionStatus.PLANNED, SessionStatus.ABORTED],
    [SessionStatus.PLANNED]: [SessionStatus.RUNNING, SessionStatus.ABORTED],
    [SessionStatus.RUNNING]: [
        SessionStatus.FINALIZING,
        SessionStatus.FAILED,
        SessionStatus.ABORTED,
    ],
    [SessionStatus.FINALIZING]: [
        SessionStatus.COMPLETED,
        SessionStatus.FAILED,
        SessionStatus.ABORTED,
    ],
    [SessionStatus.COMPLETED]: [],
    [SessionStatus.FAILED]: [],
    [SessionStatus.ABORTED]: [],
});

function assertTransition(current, next) {
    const allowed = VALID_TRANSITIONS[current];
    if (!allowed || !allowed.includes(next)) {
        throw makeError(
            ErrorCode.ERR_SESSION_INVALID_STATE,
            `会话状态不可从 ${current} 迁移到 ${next}`,
            { current, next },
        );
    }
}

function emptyTasksSummary() {
    return { total: 0, pending: 0, claimed: 0, running: 0, completed: 0, failed: 0, blocked: 0 };
}

function emptyMessagesSummary() {
    return { total: 0, by_type: {} };
}

function emptyArtifactsSummary() {
    return { total: 0, artifact_ids: [] };
}

function buildTasksSummary(tasks) {
    const counts = {
        total: tasks.length,
        pending: 0,
        claimed: 0,
        running: 0,
        completed: 0,
        failed: 0,
        blocked: 0,
    };
    for (const t of tasks) {
        if (Object.prototype.hasOwnProperty.call(counts, t.status)) {
            counts[t.status]++;
        }
    }
    return counts;
}

function buildMessagesSummary(messages) {
    const by_type = {};
    for (const m of messages) {
        by_type[m.type] = (by_type[m.type] ?? 0) + 1;
    }
    return { total: messages.length, by_type };
}

async function buildArtifactsSummary(artifactsDir) {
    let entries;
    try {
        entries = await readdir(artifactsDir, { withFileTypes: true });
    } catch (err) {
        if (err.code === 'ENOENT') return emptyArtifactsSummary();
        throw err;
    }
    const artifactIds = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    return { total: artifactIds.length, artifact_ids: artifactIds };
}

/**
 * @param {{ outputDir?: string, cwd?: string, now?: () => Date }} [opts]
 */
export function createRunSession({ outputDir, cwd, now = () => new Date() } = {}) {
    const store = createSessionStore({ outputDir, cwd });
    const tbStore = createTaskBoardStore({ outputDir, cwd });
    const taskBoard = createTaskBoard({ outputDir, cwd, now });
    const mbStore = createMailboxStore({ outputDir, cwd });

    function runPaths(runId) {
        return createRunPaths({ outputDir, runId, cwd });
    }

    /**
     * 创建新会话，写 index.json（status=created）。
     *
     * @param {string} goal
     * @param {{ max_turns: number, timeout_ms: number, budget_tokens?: number }} config
     * @returns {{ run_id: string, session: object }}
     */
    async function createSession(goal, config) {
        const configResult = SessionConfigSchema.safeParse(config);
        if (!configResult.success) {
            throw makeError(
                ErrorCode.ERR_INVALID_ARGUMENT,
                '会话配置校验失败',
                { issues: configResult.error.issues },
            );
        }

        const runId = formatUtcRunId(now());
        const ts = now().toISOString();
        const session = {
            run_id: runId,
            status: SessionStatus.CREATED,
            goal,
            config: configResult.data,
            created_at: ts,
            updated_at: ts,
            tasks_summary: emptyTasksSummary(),
            messages_summary: emptyMessagesSummary(),
            artifacts_summary: emptyArtifactsSummary(),
        };
        const written = await store.writeSession(runId, session);
        return { run_id: runId, session: written };
    }

    /**
     * 规划会话：创建所有任务并推进到 planned 态。
     *
     * @param {string} runId
     * @param {Array<{ task_id: string, title: string, type: string, input: unknown, depends_on?: string[], assigned_role?: string }>} taskPlan
     */
    async function planSession(runId, taskPlan) {
        const session = await store.readSession(runId);
        assertTransition(session.status, SessionStatus.PLANNED);

        for (const t of taskPlan) {
            await taskBoard.createTask(runId, t);
        }

        const tasks = await tbStore.listTasks(runId);
        const updated = {
            ...session,
            status: SessionStatus.PLANNED,
            tasks_summary: buildTasksSummary(tasks),
            updated_at: now().toISOString(),
        };
        return store.writeSession(runId, updated);
    }

    /**
     * 启动会话（planned → running）。
     *
     * @param {string} runId
     */
    async function startSession(runId) {
        const session = await store.readSession(runId);
        assertTransition(session.status, SessionStatus.RUNNING);
        const updated = {
            ...session,
            status: SessionStatus.RUNNING,
            updated_at: now().toISOString(),
        };
        return store.writeSession(runId, updated);
    }

    /**
     * 进入收敛阶段（running → finalizing）。
     *
     * @param {string} runId
     */
    async function finalizeSession(runId) {
        const session = await store.readSession(runId);
        assertTransition(session.status, SessionStatus.FINALIZING);
        const updated = {
            ...session,
            status: SessionStatus.FINALIZING,
            updated_at: now().toISOString(),
        };
        return store.writeSession(runId, updated);
    }

    /**
     * 完成会话（finalizing → completed），写入 decision。
     *
     * @param {string} runId
     * @param {{ artifact_id: string, direction: string }} decision
     */
    async function completeSession(runId, { artifact_id, direction }) {
        const session = await store.readSession(runId);
        assertTransition(session.status, SessionStatus.COMPLETED);
        const updated = {
            ...session,
            status: SessionStatus.COMPLETED,
            decision: {
                artifact_id,
                direction,
                decided_at: now().toISOString(),
            },
            updated_at: now().toISOString(),
        };
        return store.writeSession(runId, updated);
    }

    /**
     * 标记会话失败，写入 failure_reason。
     *
     * @param {string} runId
     * @param {string} reason
     */
    async function failSession(runId, reason) {
        const session = await store.readSession(runId);
        assertTransition(session.status, SessionStatus.FAILED);
        const updated = {
            ...session,
            status: SessionStatus.FAILED,
            failure_reason: reason,
            updated_at: now().toISOString(),
        };
        return store.writeSession(runId, updated);
    }

    /**
     * 中止会话：强制清除所有锁文件，回收 claimed/running 任务为 pending，推进到 aborted 态。
     *
     * @param {string} runId
     */
    async function abortSession(runId) {
        const session = await store.readSession(runId);
        assertTransition(session.status, SessionStatus.ABORTED);

        const rp = runPaths(runId);

        // 1. 强制清除 locks/ 目录下所有锁文件
        try {
            const lockFiles = await readdir(rp.locksDir);
            await Promise.allSettled(
                lockFiles
                    .filter((f) => f.endsWith('.json') && !f.includes('.tmp'))
                    .map((f) => unlink(path.join(rp.locksDir, f))),
            );
        } catch (err) {
            if (err.code !== 'ENOENT') throw err;
        }

        // 2. 回收所有 claimed/running 任务为 pending，清除 lease 字段
        const tasks = await tbStore.listTasks(runId);
        const ts = now().toISOString();
        for (const task of tasks) {
            if (task.status !== TaskStatus.CLAIMED && task.status !== TaskStatus.RUNNING) continue;
            const { lease: _lease, ...rest } = task;
            await tbStore.writeTask(runId, {
                ...rest,
                status: TaskStatus.PENDING,
                updated_at: ts,
            });
        }

        // 3. 更新 session 状态
        const updated = {
            ...session,
            status: SessionStatus.ABORTED,
            updated_at: ts,
        };
        return store.writeSession(runId, updated);
    }

    /**
     * 重新扫描 tasks / mailbox / artifacts，更新 index.json 摘要。
     * 用于从外部状态变化后同步 index.json。
     *
     * @param {string} runId
     */
    async function refreshIndex(runId) {
        const session = await store.readSession(runId);
        const rp = runPaths(runId);

        const [tasks, messages, artifactsSummary] = await Promise.all([
            tbStore.listTasks(runId),
            mbStore.listMessages(runId),
            buildArtifactsSummary(rp.artifactsDir),
        ]);

        const updated = {
            ...session,
            tasks_summary: buildTasksSummary(tasks),
            messages_summary: buildMessagesSummary(messages),
            artifacts_summary: artifactsSummary,
            updated_at: now().toISOString(),
        };
        return store.writeSession(runId, updated);
    }

    return {
        createSession,
        planSession,
        startSession,
        finalizeSession,
        completeSession,
        failSession,
        abortSession,
        refreshIndex,
    };
}
