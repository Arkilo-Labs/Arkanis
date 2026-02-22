import test from 'node:test';
import assert from 'node:assert/strict';

import {
    ArtifactsSummarySchema,
    DecisionSchema,
    MessagesSummarySchema,
    RunSessionSchema,
    SessionConfigSchema,
    SessionStatus,
    SessionStatusSchema,
    TasksSummarySchema,
} from './session.schema.js';
import { MessageType } from './message.schema.js';

function nowIso() {
    return new Date().toISOString();
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

function defaultConfig() {
    return { max_turns: 20, timeout_ms: 300_000 };
}

function validSession(overrides = {}) {
    const now = nowIso();
    return {
        run_id: '20260221_120000',
        status: SessionStatus.CREATED,
        goal: '分析当前 Node.js 版本并生成报告',
        config: defaultConfig(),
        created_at: now,
        updated_at: now,
        tasks_summary: emptyTasksSummary(),
        messages_summary: emptyMessagesSummary(),
        artifacts_summary: emptyArtifactsSummary(),
        ...overrides,
    };
}

test('SessionStatus 冻结且不可变', () => {
    assert.equal(Object.isFrozen(SessionStatus), true);
    assert.throws(() => {
        SessionStatus.NEW = 'new';
    }, TypeError);

    const values = [...Object.values(SessionStatus)].sort();
    assert.deepEqual(values, [
        'aborted',
        'completed',
        'created',
        'failed',
        'finalizing',
        'planned',
        'running',
    ]);
});

test('SessionStatusSchema：parse 所有合法值', () => {
    for (const v of Object.values(SessionStatus)) {
        assert.equal(SessionStatusSchema.parse(v), v);
    }
});

test('SessionStatusSchema：拒绝非法值', () => {
    assert.throws(() => SessionStatusSchema.parse('paused'));
    assert.throws(() => SessionStatusSchema.parse(''));
});

test('SessionConfigSchema：parse 合法值', () => {
    const config = { max_turns: 10, timeout_ms: 60_000, budget_tokens: 100_000 };
    assert.deepEqual(SessionConfigSchema.parse(config), config);
});

test('SessionConfigSchema：budget_tokens 可选', () => {
    const config = defaultConfig();
    assert.doesNotThrow(() => SessionConfigSchema.parse(config));
});

test('SessionConfigSchema：拒绝 max_turns=0', () => {
    assert.throws(() => SessionConfigSchema.parse({ max_turns: 0, timeout_ms: 0 }));
});

test('SessionConfigSchema：拒绝负 timeout_ms', () => {
    assert.throws(() => SessionConfigSchema.parse({ max_turns: 1, timeout_ms: -1 }));
});

test('SessionConfigSchema：拒绝 timeout_ms=0', () => {
    assert.throws(() => SessionConfigSchema.parse({ max_turns: 1, timeout_ms: 0 }));
});

test('DecisionSchema：导出且可解析合法值', () => {
    const now = new Date().toISOString();
    const decision = { artifact_id: 'decision_01', direction: '建议升级', decided_at: now };
    assert.deepEqual(DecisionSchema.parse(decision), decision);
});

test('TasksSummarySchema：parse 合法值', () => {
    const s = emptyTasksSummary();
    assert.deepEqual(TasksSummarySchema.parse(s), s);
});

test('MessagesSummarySchema：parse 含 by_type 记录', () => {
    const s = {
        total: 3,
        by_type: { [MessageType.UPDATE]: 2, [MessageType.ARTIFACT]: 1 },
    };
    assert.deepEqual(MessagesSummarySchema.parse(s), s);
});

test('ArtifactsSummarySchema：parse 合法值', () => {
    const s = { total: 2, artifact_ids: ['a1', 'a2'] };
    assert.deepEqual(ArtifactsSummarySchema.parse(s), s);
});

test('RunSessionSchema：parse status=created 初始态', () => {
    const session = validSession();
    const result = RunSessionSchema.parse(session);
    assert.equal(result.status, SessionStatus.CREATED);
    assert.equal(result.tasks_summary.total, 0);
    assert.equal(result.decision, undefined);
});

test('RunSessionSchema：parse status=completed 完整态（含 decision）', () => {
    const now = nowIso();
    const session = validSession({
        status: SessionStatus.COMPLETED,
        tasks_summary: { total: 3, pending: 0, claimed: 0, running: 0, completed: 3, failed: 0, blocked: 0 },
        messages_summary: { total: 5, by_type: { update: 3, artifact: 1, decision: 1 } },
        artifacts_summary: { total: 2, artifact_ids: ['a1', 'a2'] },
        decision: {
            artifact_id: 'decision_01',
            direction: '建议升级至 Node.js v22',
            decided_at: now,
        },
    });
    const result = RunSessionSchema.parse(session);
    assert.equal(result.status, SessionStatus.COMPLETED);
    assert.equal(result.decision?.artifact_id, 'decision_01');
    assert.equal(result.tasks_summary.completed, 3);
});

test('RunSessionSchema：parse status=failed（含 failure_reason）', () => {
    const session = validSession({
        status: SessionStatus.FAILED,
        failure_reason: '仲裁超限，无法收敛',
    });
    const result = RunSessionSchema.parse(session);
    assert.equal(result.failure_reason, '仲裁超限，无法收敛');
});

test('RunSessionSchema：拒绝非法 status', () => {
    assert.throws(() => RunSessionSchema.parse(validSession({ status: 'paused' })));
});

test('RunSessionSchema：拒绝空 goal', () => {
    assert.throws(() => RunSessionSchema.parse(validSession({ goal: '' })));
});

test('RunSessionSchema：拒绝额外字段（strict）', () => {
    assert.throws(() => RunSessionSchema.parse(validSession({ extra: 'x' })));
});
