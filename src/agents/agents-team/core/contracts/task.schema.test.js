import test from 'node:test';
import assert from 'node:assert/strict';

import {
    FailureClass,
    FailureClassSchema,
    LeaseSchema,
    TaskSchema,
    TaskStatus,
    TaskStatusSchema,
    TaskType,
    TaskTypeSchema,
} from './task.schema.js';

function nowIso() {
    return new Date().toISOString();
}

function validLease() {
    return {
        lease_token: '550e8400-e29b-41d4-a716-446655440000',
        owner_agent_id: 'researcher_01',
        lease_expire_at: new Date(Date.now() + 60_000).toISOString(),
        attempt: 1,
    };
}

function validTask(overrides = {}) {
    const now = nowIso();
    return {
        task_id: 'task_01',
        run_id: '20260221_120000',
        title: '调研 Node.js 版本',
        type: TaskType.RESEARCH,
        status: TaskStatus.PENDING,
        input: { query: 'node version' },
        created_at: now,
        updated_at: now,
        ...overrides,
    };
}

test('TaskStatus 冻结且不可变', () => {
    assert.equal(Object.isFrozen(TaskStatus), true);
    assert.throws(() => {
        TaskStatus.NEW = 'new';
    }, TypeError);

    const values = [...Object.values(TaskStatus)].sort();
    assert.deepEqual(values, ['blocked', 'claimed', 'completed', 'failed', 'pending', 'running']);
});

test('TaskType 冻结且不可变', () => {
    assert.equal(Object.isFrozen(TaskType), true);
    assert.throws(() => {
        TaskType.NEW = 'new';
    }, TypeError);
});

test('FailureClass 冻结且不可变', () => {
    assert.equal(Object.isFrozen(FailureClass), true);
    assert.throws(() => {
        FailureClass.NEW = 'new';
    }, TypeError);
});

test('TaskStatusSchema：parse 所有合法值', () => {
    for (const v of Object.values(TaskStatus)) {
        assert.equal(TaskStatusSchema.parse(v), v);
    }
});

test('TaskStatusSchema：拒绝非法值', () => {
    assert.throws(() => TaskStatusSchema.parse('unknown'));
    assert.throws(() => TaskStatusSchema.parse(''));
    assert.throws(() => TaskStatusSchema.parse(null));
});

test('TaskTypeSchema：parse 所有合法值', () => {
    for (const v of Object.values(TaskType)) {
        assert.equal(TaskTypeSchema.parse(v), v);
    }
});

test('FailureClassSchema：parse 所有合法值', () => {
    for (const v of Object.values(FailureClass)) {
        assert.equal(FailureClassSchema.parse(v), v);
    }
});

test('LeaseSchema：parse 合法值', () => {
    const lease = validLease();
    assert.deepEqual(LeaseSchema.parse(lease), lease);
});

test('LeaseSchema：拒绝 attempt=0', () => {
    assert.throws(() => LeaseSchema.parse({ ...validLease(), attempt: 0 }));
});

test('LeaseSchema：拒绝非法 uuid 格式 lease_token', () => {
    assert.throws(() => LeaseSchema.parse({ ...validLease(), lease_token: 'not-a-uuid' }));
});

test('LeaseSchema：拒绝非 datetime 格式 lease_expire_at', () => {
    assert.throws(() => LeaseSchema.parse({ ...validLease(), lease_expire_at: '2026-02-21' }));
});

test('TaskSchema：parse 最小必填字段', () => {
    const task = validTask();
    const result = TaskSchema.parse(task);
    assert.equal(result.task_id, 'task_01');
    assert.equal(result.status, TaskStatus.PENDING);
    assert.equal(result.type, TaskType.RESEARCH);
});

test('TaskSchema：parse 完整字段（含 lease + artifact_refs + failure 字段）', () => {
    const now = nowIso();
    const task = validTask({
        status: TaskStatus.RUNNING,
        assigned_role: 'researcher',
        depends_on: ['task_00'],
        lease: validLease(),
        artifact_refs: [{ artifact_id: 'a1', type: 'text' }],
        failure_class: FailureClass.RETRYABLE,
        failure_message: '网络超时',
        blocking_tasks: ['task_02'],
        idempotency_key: 'idem_abc123',
    });
    const result = TaskSchema.parse(task);
    assert.equal(result.assigned_role, 'researcher');
    assert.deepEqual(result.depends_on, ['task_00']);
    assert.equal(result.lease?.attempt, 1);
    assert.equal(result.idempotency_key, 'idem_abc123');
});

test('TaskSchema：拒绝非法 status', () => {
    assert.throws(() => TaskSchema.parse(validTask({ status: 'unknown' })));
});

test('TaskSchema：拒绝非法 type', () => {
    assert.throws(() => TaskSchema.parse(validTask({ type: 'plan' })));
});

test('TaskSchema：拒绝额外字段（strict）', () => {
    assert.throws(() => TaskSchema.parse(validTask({ extra_field: 'x' })));
});

test('TaskSchema：拒绝缺失必填字段', () => {
    const { title: _title, ...noTitle } = validTask();
    assert.throws(() => TaskSchema.parse(noTitle));
});
