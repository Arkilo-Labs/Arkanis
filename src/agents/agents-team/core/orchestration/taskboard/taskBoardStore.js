import { readFile, readdir, unlink } from 'node:fs/promises';

import { createRunPaths } from '../../outputs/runPaths.js';
import { TaskSchema } from '../../contracts/task.schema.js';
import { ErrorCode } from '../../contracts/errors.js';
import { atomicWriteJson } from '../atomicWrite.js';

function makeError(code, message, details) {
    const err = new Error(message);
    err.code = code;
    if (details !== undefined) err.details = details;
    return err;
}

/**
 * @param {{ outputDir?: string, cwd?: string }} [opts]
 * @returns {{ readTask, writeTask, listTasks, deleteTask }}
 */
export function createTaskBoardStore({ outputDir, cwd } = {}) {
    function runPaths(runId) {
        return createRunPaths({ outputDir, runId, cwd });
    }

    async function readTask(runId, taskId) {
        const rp = runPaths(runId);
        const filePath = rp.taskPath(taskId);
        let raw;
        try {
            raw = await readFile(filePath, 'utf-8');
        } catch (err) {
            if (err.code === 'ENOENT') {
                throw makeError(ErrorCode.ERR_TASK_NOT_FOUND, `task 不存在: ${taskId}`, {
                    runId,
                    taskId,
                });
            }
            throw err;
        }

        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch {
            throw makeError(ErrorCode.ERR_INVALID_ARGUMENT, `task 文件 JSON 解析失败: ${taskId}`, {
                runId,
                taskId,
                filePath,
            });
        }

        const result = TaskSchema.safeParse(parsed);
        if (!result.success) {
            throw makeError(ErrorCode.ERR_INVALID_ARGUMENT, `task schema 校验失败: ${taskId}`, {
                runId,
                taskId,
                filePath,
                issues: result.error.issues,
            });
        }
        return result.data;
    }

    async function writeTask(runId, task) {
        const result = TaskSchema.safeParse(task);
        if (!result.success) {
            throw makeError(ErrorCode.ERR_INVALID_ARGUMENT, 'task 数据 schema 校验失败', {
                issues: result.error.issues,
            });
        }
        const rp = runPaths(runId);
        await atomicWriteJson(rp.taskPath(result.data.task_id), result.data);
    }

    async function listTasks(runId) {
        const rp = runPaths(runId);
        let entries;
        try {
            entries = await readdir(rp.tasksDir);
        } catch (err) {
            if (err.code === 'ENOENT') return [];
            throw err;
        }

        const jsonFiles = entries.filter((f) => f.endsWith('.json') && !f.includes('.tmp'));
        const tasks = [];
        for (const file of jsonFiles) {
            const taskId = file.slice(0, -5);
            let task;
            try {
                task = await readTask(runId, taskId);
            } catch (err) {
                if (err.code === ErrorCode.ERR_TASK_NOT_FOUND) continue;
                throw err;
            }
            tasks.push(task);
        }
        return tasks;
    }

    async function deleteTask(runId, taskId) {
        const rp = runPaths(runId);
        try {
            await unlink(rp.taskPath(taskId));
        } catch (err) {
            if (err.code === 'ENOENT') {
                throw makeError(ErrorCode.ERR_TASK_NOT_FOUND, `task 不存在: ${taskId}`, {
                    runId,
                    taskId,
                });
            }
            throw err;
        }
    }

    return { readTask, writeTask, listTasks, deleteTask };
}
