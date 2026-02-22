import { randomUUID } from 'node:crypto';

import { createTaskBoardStore } from './taskBoardStore.js';
import { createLeaseManager } from './leaseManager.js';
import { TaskStatus, FailureClass } from '../../contracts/task.schema.js';
import { ErrorCode } from '../../contracts/errors.js';
import { DenyReason } from '../../contracts/denyReasons.js';

function makeError(code, message, details) {
    const err = new Error(message);
    err.code = code;
    if (details !== undefined) err.details = details;
    return err;
}

function makePolicyError(denyReason, message, details) {
    const err = new Error(message);
    err.code = ErrorCode.ERR_POLICY_DENIED;
    err.deny_reason = denyReason;
    if (details !== undefined) err.details = details;
    return err;
}

function isLeaseExpired(lease, currentTime) {
    return new Date(lease.lease_expire_at) <= currentTime;
}

function validateLease(task, leaseToken, operation, currentTime) {
    if (!task.lease || task.lease.lease_token !== leaseToken) {
        throw makeError(
            ErrorCode.ERR_LEASE_EXPIRED,
            `lease_token 不匹配，拒绝 ${operation}: ${task.task_id}`,
            { taskId: task.task_id, operation },
        );
    }
    if (isLeaseExpired(task.lease, currentTime)) {
        throw makeError(ErrorCode.ERR_LEASE_EXPIRED, `租约已过期，拒绝 ${operation}: ${task.task_id}`, {
            taskId: task.task_id,
            lease_expire_at: task.lease.lease_expire_at,
        });
    }
}

/**
 * @param {{ outputDir?: string, cwd?: string, now?: () => Date, maxRetries?: number }} [opts]
 */
export function createTaskBoard({ outputDir, cwd, now = () => new Date(), maxRetries = 3 } = {}) {
    const store = createTaskBoardStore({ outputDir, cwd });
    const lm = createLeaseManager({ store, now, maxRetries });

    // DFS 检测：从 dependsOn 出发能否到达 newTaskId（即存在循环）
    async function detectCycle(runId, newTaskId, dependsOn) {
        const visited = new Set();

        async function dfs(taskId) {
            if (taskId === newTaskId) return true;
            if (visited.has(taskId)) return false;
            visited.add(taskId);

            let task;
            try {
                task = await store.readTask(runId, taskId);
            } catch (err) {
                if (err.code === ErrorCode.ERR_TASK_NOT_FOUND) return false;
                throw err;
            }

            if (!task.depends_on || task.depends_on.length === 0) return false;
            for (const dep of task.depends_on) {
                if (await dfs(dep)) return true;
            }
            return false;
        }

        for (const dep of dependsOn) {
            if (await dfs(dep)) {
                throw makeError(
                    ErrorCode.ERR_INVALID_ARGUMENT,
                    `创建任务 ${newTaskId} 会引入循环依赖`,
                    { taskId: newTaskId, depends_on: dependsOn },
                );
            }
        }
    }

    // 返回 task.depends_on 中尚未 completed 的依赖 id 列表
    async function getUnfinishedDeps(runId, task) {
        if (!task.depends_on || task.depends_on.length === 0) return [];
        const unfinished = [];
        for (const depId of task.depends_on) {
            let depTask;
            try {
                depTask = await store.readTask(runId, depId);
            } catch (err) {
                if (err.code === ErrorCode.ERR_TASK_NOT_FOUND) {
                    unfinished.push(depId);
                    continue;
                }
                throw err;
            }
            if (depTask.status !== TaskStatus.COMPLETED) {
                unfinished.push(depId);
            }
        }
        return unfinished;
    }

    // completeTask 完成后主动扫描并 unblock 等待该任务的下游
    async function autoUnblockDownstream(runId, completedTaskId) {
        const allTasks = await store.listTasks(runId);
        for (const t of allTasks) {
            if (
                t.status === TaskStatus.BLOCKED &&
                t.depends_on &&
                t.depends_on.includes(completedTaskId)
            ) {
                const unfinished = await getUnfinishedDeps(runId, t);
                if (unfinished.length === 0) {
                    try {
                        await unblockTask(runId, t.task_id);
                    } catch (err) {
                        // TASK_WRONG_STATE 表示状态已被并发操作修改，跳过
                        if (err.code !== ErrorCode.ERR_POLICY_DENIED) throw err;
                    }
                }
            }
        }
    }

    /**
     * 创建任务（写入 pending 状态），存在 depends_on 时做循环依赖检测。
     *
     * @param {string} runId
     * @param {{ task_id: string, title: string, type: string, input: unknown, depends_on?: string[], assigned_role?: string }} params
     */
    async function createTask(runId, { task_id, title, type, input, depends_on, assigned_role }) {
        if (depends_on && depends_on.length > 0) {
            await detectCycle(runId, task_id, depends_on);
        }

        const ts = now().toISOString();
        const task = {
            task_id,
            run_id: runId,
            title,
            type,
            status: TaskStatus.PENDING,
            input,
            created_at: ts,
            updated_at: ts,
        };
        if (depends_on !== undefined) task.depends_on = depends_on;
        if (assigned_role !== undefined) task.assigned_role = assigned_role;
        await store.writeTask(runId, task);
        return task;
    }

    /**
     * 将任务推入 blocked 状态（仅限 pending 态）。
     *
     * @param {string} runId
     * @param {string} taskId
     * @param {{ blocking_task_ids: string[] }} params
     */
    async function blockTask(runId, taskId, { blocking_task_ids }) {
        const task = await store.readTask(runId, taskId);

        if (task.status !== TaskStatus.PENDING) {
            throw makePolicyError(
                DenyReason.TASK_WRONG_STATE,
                `任务 ${taskId} 当前状态不可 block: ${task.status}`,
                { taskId, status: task.status },
            );
        }

        const updated = {
            ...task,
            status: TaskStatus.BLOCKED,
            blocking_tasks: blocking_task_ids,
            updated_at: now().toISOString(),
        };
        await store.writeTask(runId, updated);
    }

    /**
     * 解除任务的 blocked 状态，要求所有 depends_on 均已 completed。
     *
     * @param {string} runId
     * @param {string} taskId
     */
    async function unblockTask(runId, taskId) {
        const task = await store.readTask(runId, taskId);

        if (task.status !== TaskStatus.BLOCKED) {
            throw makePolicyError(
                DenyReason.TASK_WRONG_STATE,
                `任务 ${taskId} 当前状态不可 unblock: ${task.status}`,
                { taskId, status: task.status },
            );
        }

        const unfinished = await getUnfinishedDeps(runId, task);
        if (unfinished.length > 0) {
            throw makeError(
                ErrorCode.ERR_TASK_DEPENDENCY_NOT_MET,
                `任务 ${taskId} 的依赖项尚未完成，无法 unblock: ${unfinished.join(', ')}`,
                { taskId, blocking_tasks: unfinished },
            );
        }

        const updated = { ...task };
        delete updated.blocking_tasks;
        updated.status = TaskStatus.PENDING;
        updated.updated_at = now().toISOString();
        await store.writeTask(runId, updated);
    }

    /**
     * 认领任务（pending → claimed），写入租约字段。
     * 认领前检查 depends_on；未满足时自动推入 blocked 并抛 ERR_TASK_DEPENDENCY_NOT_MET。
     *
     * @param {string} runId
     * @param {string} taskId
     * @param {{ agent_id: string, lease_duration_ms: number }} params
     * @returns {{ lease_token: string, lease_expire_at: string }}
     */
    async function claimTask(runId, taskId, { agent_id, lease_duration_ms }) {
        await lm.sweepExpiredLeases(runId);

        let task = await store.readTask(runId, taskId);

        // 依赖检查（pending 和 blocked 均需检查）
        if (
            task.depends_on &&
            task.depends_on.length > 0 &&
            (task.status === TaskStatus.PENDING || task.status === TaskStatus.BLOCKED)
        ) {
            const unfinished = await getUnfinishedDeps(runId, task);
            if (unfinished.length > 0) {
                        // 首次检测到依赖未满足，静默推入 blocked；调用方只会看到 ERR_TASK_DEPENDENCY_NOT_MET
                if (task.status === TaskStatus.PENDING) {
                    await blockTask(runId, taskId, { blocking_task_ids: unfinished });
                }
                throw makeError(
                    ErrorCode.ERR_TASK_DEPENDENCY_NOT_MET,
                    `任务 ${taskId} 的依赖项未完成: ${unfinished.join(', ')}`,
                    { taskId, blocking_tasks: unfinished },
                );
            }
            // 依赖已全部完成但任务仍处于 blocked → 先 unblock 再继续认领
            if (task.status === TaskStatus.BLOCKED) {
                await unblockTask(runId, taskId);
                task = await store.readTask(runId, taskId);
            }
        }

        if (task.status === TaskStatus.CLAIMED || task.status === TaskStatus.RUNNING) {
            throw makeError(
                ErrorCode.ERR_LEASE_CONFLICT,
                `任务 ${taskId} 已被认领，当前状态: ${task.status}`,
                { taskId, status: task.status, holder: task.lease?.owner_agent_id },
            );
        }

        if (task.status !== TaskStatus.PENDING) {
            throw makePolicyError(
                DenyReason.TASK_WRONG_STATE,
                `任务 ${taskId} 当前状态不可认领: ${task.status}`,
                { taskId, status: task.status },
            );
        }

        const currentTime = now();
        const expireAt = new Date(currentTime.getTime() + lease_duration_ms);
        const lease = {
            lease_token: randomUUID(),
            owner_agent_id: agent_id,
            lease_expire_at: expireAt.toISOString(),
            attempt: (task.lease?.attempt ?? 0) + 1,
        };

        const updated = {
            ...task,
            status: TaskStatus.CLAIMED,
            lease,
            updated_at: currentTime.toISOString(),
        };
        await store.writeTask(runId, updated);
        return { lease_token: lease.lease_token, lease_expire_at: lease.lease_expire_at };
    }

    /**
     * 启动任务（claimed → running），校验租约有效性。
     *
     * @param {string} runId
     * @param {string} taskId
     * @param {string} leaseToken
     */
    async function startTask(runId, taskId, leaseToken) {
        const task = await store.readTask(runId, taskId);

        if (task.status !== TaskStatus.CLAIMED) {
            throw makePolicyError(
                DenyReason.TASK_WRONG_STATE,
                `任务 ${taskId} 当前状态不可启动: ${task.status}`,
                { taskId, status: task.status },
            );
        }

        validateLease(task, leaseToken, 'startTask', now());

        const updated = {
            ...task,
            status: TaskStatus.RUNNING,
            updated_at: now().toISOString(),
        };
        await store.writeTask(runId, updated);
    }

    /**
     * 完成任务（running → completed），artifact_refs 必须非空。
     * 完成后自动 unblock 等待该任务的下游任务。
     *
     * @param {string} runId
     * @param {string} taskId
     * @param {string} leaseToken
     * @param {{ artifact_refs: Array<{ artifact_id: string, type?: string }> }} params
     */
    async function completeTask(runId, taskId, leaseToken, { artifact_refs }) {
        if (!artifact_refs || artifact_refs.length === 0) {
            throw makeError(
                ErrorCode.ERR_INVALID_ARGUMENT,
                `completeTask 要求 artifact_refs 非空: ${taskId}`,
                { taskId },
            );
        }

        const task = await store.readTask(runId, taskId);

        if (task.status !== TaskStatus.RUNNING) {
            throw makePolicyError(
                DenyReason.TASK_WRONG_STATE,
                `任务 ${taskId} 当前状态不可完成: ${task.status}`,
                { taskId, status: task.status },
            );
        }

        validateLease(task, leaseToken, 'completeTask', now());

        const updated = {
            ...task,
            status: TaskStatus.COMPLETED,
            artifact_refs,
            updated_at: now().toISOString(),
        };
        await store.writeTask(runId, updated);

        // best-effort：失败时下游任务在认领时会通过 claimTask 的依赖检查自动 unblock
        try {
            await autoUnblockDownstream(runId, taskId);
        } catch {
            // 不传播：COMPLETED 已落盘，幂等安全
        }
    }

    /**
     * 标记任务失败（running → failed）。
     *
     * @param {string} runId
     * @param {string} taskId
     * @param {string} leaseToken
     * @param {{ failure_class: string, message: string }} params
     */
    async function failTask(runId, taskId, leaseToken, { failure_class, message }) {
        const task = await store.readTask(runId, taskId);

        if (task.status !== TaskStatus.RUNNING) {
            throw makePolicyError(
                DenyReason.TASK_WRONG_STATE,
                `任务 ${taskId} 当前状态不可标记失败: ${task.status}`,
                { taskId, status: task.status },
            );
        }

        validateLease(task, leaseToken, 'failTask', now());

        const updated = {
            ...task,
            status: TaskStatus.FAILED,
            failure_class,
            failure_message: message,
            updated_at: now().toISOString(),
        };
        await store.writeTask(runId, updated);
    }

    function getTask(runId, taskId) {
        return store.readTask(runId, taskId);
    }

    function listTasks(runId) {
        return store.listTasks(runId);
    }

    return { createTask, blockTask, unblockTask, claimTask, startTask, completeTask, failTask, getTask, listTasks };
}

export { FailureClass };
