import test from 'node:test';
import assert from 'node:assert/strict';

import {
    ClaimSchema,
    MessageDeliveryStatus,
    MessageDeliveryStatusSchema,
    MessageSchema,
    MessageType,
    MessageTypeSchema,
} from './message.schema.js';

function nowIso() {
    return new Date().toISOString();
}

function validMessage(overrides = {}) {
    return {
        msg_id: 'msg_01',
        run_id: '20260221_120000',
        task_refs: ['task_01'],
        type: MessageType.UPDATE,
        from_agent: 'researcher_01',
        content: '调研完成，版本为 v20.x',
        delivery_status: MessageDeliveryStatus.SENT,
        created_at: nowIso(),
        ...overrides,
    };
}

test('MessageType 冻结且不可变', () => {
    assert.equal(Object.isFrozen(MessageType), true);
    assert.throws(() => {
        MessageType.NEW = 'new';
    }, TypeError);

    const values = [...Object.values(MessageType)].sort();
    assert.deepEqual(values, ['artifact', 'conflict', 'decision', 'question', 'risk', 'update']);
});

test('MessageDeliveryStatus 冻结且不可变', () => {
    assert.equal(Object.isFrozen(MessageDeliveryStatus), true);
    assert.throws(() => {
        MessageDeliveryStatus.NEW = 'new';
    }, TypeError);

    const values = [...Object.values(MessageDeliveryStatus)].sort();
    assert.deepEqual(values, ['acknowledged', 'delivered', 'sent']);
});

test('MessageTypeSchema：parse 所有合法值', () => {
    for (const v of Object.values(MessageType)) {
        assert.equal(MessageTypeSchema.parse(v), v);
    }
});

test('MessageDeliveryStatusSchema：parse 所有合法值', () => {
    for (const v of Object.values(MessageDeliveryStatus)) {
        assert.equal(MessageDeliveryStatusSchema.parse(v), v);
    }
});

test('ClaimSchema：parse 合法值', () => {
    const claim = { claim: '声明正确', evidence: ['artifacts/a1.json', 'a2#L10'] };
    assert.deepEqual(ClaimSchema.parse(claim), claim);
});

test('ClaimSchema：evidence 可为空数组', () => {
    const claim = { claim: '未经证实的声明', evidence: [] };
    assert.deepEqual(ClaimSchema.parse(claim), claim);
});

test('ClaimSchema：拒绝额外字段', () => {
    assert.throws(() => ClaimSchema.parse({ claim: 'x', evidence: [], extra: true }));
});

test('MessageSchema：parse type=update 合法消息', () => {
    const msg = validMessage();
    const result = MessageSchema.parse(msg);
    assert.equal(result.type, MessageType.UPDATE);
    assert.equal(result.delivery_status, MessageDeliveryStatus.SENT);
});

test('MessageSchema：parse type=artifact（含 artifact_refs）', () => {
    const msg = validMessage({
        type: MessageType.ARTIFACT,
        artifact_refs: [{ artifact_id: 'a1', type: 'text' }],
        content: '产出研究报告',
    });
    const result = MessageSchema.parse(msg);
    assert.equal(result.type, MessageType.ARTIFACT);
    assert.equal(result.artifact_refs?.[0].artifact_id, 'a1');
});

test('MessageSchema：parse type=conflict（含 claims）', () => {
    const msg = validMessage({
        type: MessageType.CONFLICT,
        claims: [{ claim: '结论无引用', evidence: [] }],
        content: '发现无证据断言',
    });
    const result = MessageSchema.parse(msg);
    assert.equal(result.type, MessageType.CONFLICT);
    assert.equal(result.claims?.length, 1);
});

test('MessageSchema：artifact 类型 claims 字段可选（schema 层不强制）', () => {
    // Mailbox 层负责业务规则，schema 只验证结构
    const msg = validMessage({ type: MessageType.ARTIFACT, content: '报告' });
    assert.doesNotThrow(() => MessageSchema.parse(msg));
});

test('MessageSchema：parse 含可选字段（to_agent + escalation）', () => {
    const msg = validMessage({
        type: MessageType.QUESTION,
        to_agent: 'lead_01',
        escalation: true,
        content: '需要 Lead 仲裁',
    });
    const result = MessageSchema.parse(msg);
    assert.equal(result.to_agent, 'lead_01');
    assert.equal(result.escalation, true);
});

test('MessageSchema：拒绝非法 type', () => {
    assert.throws(() => MessageSchema.parse(validMessage({ type: 'broadcast' })));
});

test('MessageSchema：拒绝非法 delivery_status', () => {
    assert.throws(() => MessageSchema.parse(validMessage({ delivery_status: 'read' })));
});

test('MessageSchema：拒绝空 content', () => {
    assert.throws(() => MessageSchema.parse(validMessage({ content: '' })));
});

test('MessageSchema：拒绝额外字段（strict）', () => {
    assert.throws(() => MessageSchema.parse(validMessage({ extra: 'x' })));
});

test('MessageSchema：拒绝 task_refs 空数组', () => {
    assert.throws(() => MessageSchema.parse(validMessage({ task_refs: [] })));
});
