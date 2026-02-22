import { TaskStatus, FailureClass } from '../../contracts/task.schema.js';

const DEFAULT_MAX_RETRIES = 3;

/**
 * @param {{ store: object, maxRetries?: number, now?: () => Date }} opts
 */
export function createLeaseManager({ store, maxRetries = DEFAULT_MAX_RETRIES, now = () => new Date() } = {}) {
    /**
     * 扫描所有 claimed/running 任务，回收过期租约。
     * - attempt < maxRetries：回收为 pending，保留 lease 以继承 attempt 计数
     * - attempt >= maxRetries：改写为 failed（failure_class=retryable）
     *
     * @param {string} runId
     * @returns {{ recovered: string[], exhausted: string[] }}
     */
    async function sweepExpiredLeases(runId) {
        const tasks = await store.listTasks(runId);
        const currentTime = now();
        const recovered = [];
        const exhausted = [];

        for (const task of tasks) {
            if (task.status !== TaskStatus.CLAIMED && task.status !== TaskStatus.RUNNING) continue;
            if (!task.lease) continue;
            if (new Date(task.lease.lease_expire_at) > currentTime) continue;

            const attempt = task.lease.attempt;

            if (attempt >= maxRetries) {
                // lease 字段不再需要，从落盘数据中移除
                const { lease: _lease, ...rest } = task;
                await store.writeTask(runId, {
                    ...rest,
                    status: TaskStatus.FAILED,
                    failure_class: FailureClass.RETRYABLE,
                    failure_message: `租约超时 ${attempt} 次，已超出最大重试次数 ${maxRetries}`,
                    updated_at: currentTime.toISOString(),
                });
                exhausted.push(task.task_id);
            } else {
                // 保留 lease 对象以传递 attempt 计数给下次 claimTask
                await store.writeTask(runId, {
                    ...task,
                    status: TaskStatus.PENDING,
                    updated_at: currentTime.toISOString(),
                });
                recovered.push(task.task_id);
            }
        }

        return { recovered, exhausted };
    }

    return { sweepExpiredLeases };
}
