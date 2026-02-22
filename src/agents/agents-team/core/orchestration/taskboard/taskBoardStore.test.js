import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createTaskBoardStore } from './taskBoardStore.js';
import { TaskStatus, TaskType } from '../../contracts/task.schema.js';
import { ErrorCode } from '../../contracts/errors.js';

const RUN_ID = '20260101_120000';

function nowIso() {
    return new Date().toISOString();
}

function validTask(overrides = {}) {
    const now = nowIso();
    return {
        task_id: 'task-1',
        run_id: RUN_ID,
        title: '调研任务',
        type: TaskType.RESEARCH,
        status: TaskStatus.PENDING,
        input: { query: 'test' },
        created_at: now,
        updated_at: now,
        ...overrides,
    };
}

async function makeStore() {
    const dir = await mkdtemp(join(tmpdir(), 'arkanis-p2-task-'));
    const store = createTaskBoardStore({ outputDir: join(dir, 'outputs/agents_team') });
    return { store, dir };
}

test('writeTask → readTask 数据一致', async () => {
    const { store } = await makeStore();
    const task = validTask();
    await store.writeTask(RUN_ID, task);
    const got = await store.readTask(RUN_ID, task.task_id);
    assert.equal(got.task_id, task.task_id);
    assert.equal(got.title, task.title);
    assert.equal(got.status, TaskStatus.PENDING);
});

test('tmp 残留文件不影响 readTask', async () => {
    const { store, dir } = await makeStore();
    const task = validTask();

    // 先正常写入
    await store.writeTask(RUN_ID, task);

    // 在同目录手动留一个 tmp 文件（模拟上次写入崩溃）
    const tasksDir = join(dir, 'outputs/agents_team', RUN_ID, 'tasks');
    await writeFile(join(tasksDir, 'task-1.json.deadbeef.tmp'), '{"broken":true}', 'utf-8');

    // readTask 仍读到正确数据
    const got = await store.readTask(RUN_ID, task.task_id);
    assert.equal(got.task_id, 'task-1');
});

test('task 文件 JSON 损坏 → 抛 ERR_INVALID_ARGUMENT', async () => {
    const { dir } = await makeStore();
    const tasksDir = join(dir, 'outputs/agents_team', RUN_ID, 'tasks');
    await mkdir(tasksDir, { recursive: true });
    await writeFile(join(tasksDir, 'task-bad.json'), '{ broken json', 'utf-8');

    const store = createTaskBoardStore({ outputDir: join(dir, 'outputs/agents_team') });
    await assert.rejects(
        () => store.readTask(RUN_ID, 'task-bad'),
        (err) => {
            assert.equal(err.code, ErrorCode.ERR_INVALID_ARGUMENT);
            return true;
        },
    );
});

test('writeTask 传入非法 schema 数据 → 抛 ERR_INVALID_ARGUMENT', async () => {
    const { store } = await makeStore();
    await assert.rejects(
        () => store.writeTask(RUN_ID, { task_id: 'x', title: 123 }),
        (err) => {
            assert.equal(err.code, ErrorCode.ERR_INVALID_ARGUMENT);
            return true;
        },
    );
});

test('readTask 不存在 → 抛 ERR_TASK_NOT_FOUND', async () => {
    const { store } = await makeStore();
    await assert.rejects(
        () => store.readTask(RUN_ID, 'task-ghost'),
        (err) => {
            assert.equal(err.code, ErrorCode.ERR_TASK_NOT_FOUND);
            return true;
        },
    );
});

test('listTasks 返回所有 task，tmp 文件不出现', async () => {
    const { store, dir } = await makeStore();

    await store.writeTask(RUN_ID, validTask({ task_id: 'task-a', title: '任务 A' }));
    await store.writeTask(RUN_ID, validTask({ task_id: 'task-b', title: '任务 B' }));

    // 手动留一个 tmp 文件
    const tasksDir = join(dir, 'outputs/agents_team', RUN_ID, 'tasks');
    await writeFile(join(tasksDir, 'task-a.json.aabbccdd.tmp'), '{}', 'utf-8');

    const tasks = await store.listTasks(RUN_ID);
    assert.equal(tasks.length, 2);
    const ids = tasks.map((t) => t.task_id).sort();
    assert.deepEqual(ids, ['task-a', 'task-b']);
});

test('listTasks 目录不存在时返回空数组', async () => {
    const { store } = await makeStore();
    const tasks = await store.listTasks(RUN_ID);
    assert.deepEqual(tasks, []);
});

test('deleteTask 后 readTask 抛 ERR_TASK_NOT_FOUND', async () => {
    const { store } = await makeStore();
    const task = validTask();
    await store.writeTask(RUN_ID, task);
    await store.deleteTask(RUN_ID, task.task_id);
    await assert.rejects(
        () => store.readTask(RUN_ID, task.task_id),
        (err) => {
            assert.equal(err.code, ErrorCode.ERR_TASK_NOT_FOUND);
            return true;
        },
    );
});

test('deleteTask 不存在 → 抛 ERR_TASK_NOT_FOUND', async () => {
    const { store } = await makeStore();
    await assert.rejects(
        () => store.deleteTask(RUN_ID, 'task-ghost'),
        (err) => {
            assert.equal(err.code, ErrorCode.ERR_TASK_NOT_FOUND);
            return true;
        },
    );
});
