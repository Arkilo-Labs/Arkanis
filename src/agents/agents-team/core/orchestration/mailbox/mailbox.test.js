import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createMailbox } from './mailbox.js';
import { MessageType, MessageDeliveryStatus } from '../../contracts/message.schema.js';
import { ErrorCode } from '../../contracts/errors.js';

const RUN_ID = '20260101_120000';

function nowIso() {
    return new Date().toISOString();
}

async function makeMailbox() {
    const dir = await mkdtemp(join(tmpdir(), 'arkanis-p7-mb-'));
    const mailbox = createMailbox({ outputDir: join(dir, 'outputs/agents_team') });
    return { mailbox, dir };
}

function baseInput(overrides = {}) {
    return {
        task_refs: ['task-1'],
        type: MessageType.UPDATE,
        from_agent: 'researcher-01',
        content: '调研进展更新',
        ...overrides,
    };
}

// P7 — 正常投递
test('postMessage 返回 msg_id，消息可读，delivery_status=SENT', async () => {
    const { mailbox } = await makeMailbox();
    const msgId = await mailbox.postMessage(RUN_ID, baseInput());
    assert.ok(typeof msgId === 'string' && msgId.length > 0);

    const msgs = await mailbox.getMessages(RUN_ID);
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0].msg_id, msgId);
    assert.equal(msgs[0].delivery_status, MessageDeliveryStatus.SENT);
    assert.equal(msgs[0].from_agent, 'researcher-01');
});

// P7 — artifact 无 artifact_refs 被拒绝
test('postMessage artifact 类型无 artifact_refs → ERR_INVALID_ARGUMENT', async () => {
    const { mailbox } = await makeMailbox();
    await assert.rejects(
        () => mailbox.postMessage(RUN_ID, baseInput({ type: MessageType.ARTIFACT })),
        (err) => {
            assert.equal(err.code, ErrorCode.ERR_INVALID_ARGUMENT);
            return true;
        },
    );
});

// P7 — artifact 空 artifact_refs 也被拒绝
test('postMessage artifact 类型空 artifact_refs → ERR_INVALID_ARGUMENT', async () => {
    const { mailbox } = await makeMailbox();
    await assert.rejects(
        () =>
            mailbox.postMessage(
                RUN_ID,
                baseInput({ type: MessageType.ARTIFACT, artifact_refs: [] }),
            ),
        (err) => {
            assert.equal(err.code, ErrorCode.ERR_INVALID_ARGUMENT);
            return true;
        },
    );
});

// P7 — conflict 无 claims 被拒绝
test('postMessage conflict 类型无 claims → ERR_INVALID_ARGUMENT', async () => {
    const { mailbox } = await makeMailbox();
    await assert.rejects(
        () => mailbox.postMessage(RUN_ID, baseInput({ type: MessageType.CONFLICT })),
        (err) => {
            assert.equal(err.code, ErrorCode.ERR_INVALID_ARGUMENT);
            return true;
        },
    );
});

// P7 — getMessages 返回全量
test('getMessages 返回全部已投递消息', async () => {
    const { mailbox } = await makeMailbox();
    await mailbox.postMessage(RUN_ID, baseInput({ from_agent: 'researcher-01' }));
    await mailbox.postMessage(RUN_ID, baseInput({ from_agent: 'executor-01' }));

    const msgs = await mailbox.getMessages(RUN_ID);
    assert.equal(msgs.length, 2);
});

// P7 — getMessages 按 type 过滤
test('getMessages 按 type 过滤', async () => {
    const { mailbox } = await makeMailbox();
    await mailbox.postMessage(RUN_ID, baseInput({ type: MessageType.UPDATE }));
    await mailbox.postMessage(
        RUN_ID,
        baseInput({
            type: MessageType.ARTIFACT,
            artifact_refs: [{ artifact_id: 'a1', type: 'text' }],
        }),
    );

    const result = await mailbox.getMessages(RUN_ID, { type: MessageType.UPDATE });
    assert.equal(result.length, 1);
    assert.equal(result[0].type, MessageType.UPDATE);
});

// P7 — getMessages 按 from_agent 过滤
test('getMessages 按 from_agent 过滤', async () => {
    const { mailbox } = await makeMailbox();
    await mailbox.postMessage(RUN_ID, baseInput({ from_agent: 'researcher-01' }));
    await mailbox.postMessage(RUN_ID, baseInput({ from_agent: 'executor-01' }));

    const result = await mailbox.getMessages(RUN_ID, { from_agent: 'executor-01' });
    assert.equal(result.length, 1);
    assert.equal(result[0].from_agent, 'executor-01');
});

// P7 — getMessages 按 task_refs 过滤
test('getMessages 按 task_refs 过滤（任一匹配即返回）', async () => {
    const { mailbox } = await makeMailbox();
    await mailbox.postMessage(RUN_ID, baseInput({ task_refs: ['task-alpha'] }));
    await mailbox.postMessage(RUN_ID, baseInput({ task_refs: ['task-beta'] }));
    await mailbox.postMessage(RUN_ID, baseInput({ task_refs: ['task-alpha', 'task-beta'] }));

    const result = await mailbox.getMessages(RUN_ID, { task_refs: ['task-alpha'] });
    assert.equal(result.length, 2);
    for (const m of result) {
        assert.ok(m.task_refs.includes('task-alpha'));
    }
});

// P7 — acknowledgeMessage 更新 delivery_status
test('acknowledgeMessage 后 delivery_status 变为 acknowledged', async () => {
    const { mailbox } = await makeMailbox();
    const msgId = await mailbox.postMessage(RUN_ID, baseInput());

    await mailbox.acknowledgeMessage(RUN_ID, msgId, 'executor-01');

    const msgs = await mailbox.getMessages(RUN_ID);
    assert.equal(msgs[0].delivery_status, MessageDeliveryStatus.ACKNOWLEDGED);
});

// P7 — 消息体不可变，ack 分离落盘，acknowledged_by 存入 ack 文件
test('acknowledgeMessage：原始消息文件不含 acknowledged，ack 单独落盘含 acknowledged_by', async () => {
    const { mailbox, dir } = await makeMailbox();
    const msgId = await mailbox.postMessage(RUN_ID, baseInput());
    await mailbox.acknowledgeMessage(RUN_ID, msgId, 'executor-01');

    const msgPath = join(dir, 'outputs/agents_team', RUN_ID, 'mailbox', `${msgId}.json`);
    const ackPath = join(dir, 'outputs/agents_team', RUN_ID, 'mailbox', `${msgId}.ack.json`);

    const rawMsg = JSON.parse(await readFile(msgPath, 'utf-8'));
    assert.equal(rawMsg.delivery_status, MessageDeliveryStatus.SENT);

    const rawAck = JSON.parse(await readFile(ackPath, 'utf-8'));
    assert.equal(rawAck.delivery_status, MessageDeliveryStatus.ACKNOWLEDGED);
    assert.equal(rawAck.acknowledged_by, 'executor-01');
});

// P7 — acknowledgeMessage 不存在消息
test('acknowledgeMessage 不存在的 msg_id → ERR_MESSAGE_NOT_FOUND', async () => {
    const { mailbox } = await makeMailbox();
    await assert.rejects(
        () => mailbox.acknowledgeMessage(RUN_ID, 'ghost-msg', 'agent-01'),
        (err) => {
            assert.equal(err.code, ErrorCode.ERR_MESSAGE_NOT_FOUND);
            return true;
        },
    );
});

// P8 — 两次 conflict 无新证据 → 自动升级
test('P8：同 task 两次 conflict 无新证据 → 生成 type=question escalation=true', async () => {
    const { mailbox } = await makeMailbox();

    const conflictInput = {
        task_refs: ['task-x'],
        type: MessageType.CONFLICT,
        from_agent: 'auditor-01',
        content: '无证据断言',
        claims: [{ claim: '结论无引用', evidence: [] }],
    };

    await mailbox.postMessage(RUN_ID, conflictInput);
    await mailbox.postMessage(RUN_ID, { ...conflictInput, content: '二次无证据断言' });

    const questions = await mailbox.getMessages(RUN_ID, {
        type: MessageType.QUESTION,
        task_refs: ['task-x'],
    });
    assert.equal(questions.length, 1);
    assert.equal(questions[0].escalation, true);
    assert.equal(questions[0].from_agent, 'mailbox_system');
    assert.equal(questions[0].to_agent, 'lead');
});

// P8 — 第二次 conflict 有新 artifact_ref → 不升级
test('P8：第二次 conflict 有新 artifact_ref → 不生成升级消息', async () => {
    const { mailbox } = await makeMailbox();

    await mailbox.postMessage(RUN_ID, {
        task_refs: ['task-y'],
        type: MessageType.CONFLICT,
        from_agent: 'auditor-01',
        content: '第一次冲突',
        claims: [{ claim: '声明 A', evidence: [] }],
        artifact_refs: [{ artifact_id: 'a1', type: 'text' }],
    });

    // 第二次带新 artifact_ref
    await mailbox.postMessage(RUN_ID, {
        task_refs: ['task-y'],
        type: MessageType.CONFLICT,
        from_agent: 'auditor-01',
        content: '第二次冲突，附新证据',
        claims: [{ claim: '声明 B', evidence: ['artifacts/a2.json'] }],
        artifact_refs: [{ artifact_id: 'a2', type: 'text' }],
    });

    const questions = await mailbox.getMessages(RUN_ID, {
        type: MessageType.QUESTION,
        task_refs: ['task-y'],
    });
    assert.equal(questions.length, 0);
});

// P8 — 升级次数上限 3 次
test('P8：升级次数上限为 3，第 5 次 conflict 无新证据不再生成升级消息', async () => {
    const { mailbox } = await makeMailbox();

    const conflictBase = {
        task_refs: ['task-z'],
        type: MessageType.CONFLICT,
        from_agent: 'auditor-01',
        content: '无证据冲突',
        claims: [{ claim: '断言', evidence: [] }],
    };

    // 5 次 conflict 无新证据：第 2-4 次各触发一次升级（共 3 条），第 5 次达上限不再升级
    await mailbox.postMessage(RUN_ID, conflictBase);
    await mailbox.postMessage(RUN_ID, { ...conflictBase, content: '冲突2' });
    await mailbox.postMessage(RUN_ID, { ...conflictBase, content: '冲突3' });
    await mailbox.postMessage(RUN_ID, { ...conflictBase, content: '冲突4' });
    await mailbox.postMessage(RUN_ID, { ...conflictBase, content: '冲突5' });

    const questions = await mailbox.getMessages(RUN_ID, {
        type: MessageType.QUESTION,
        task_refs: ['task-z'],
    });
    const escalations = questions.filter((m) => m.escalation === true);
    assert.equal(escalations.length, 3);
});

// 补充：acknowledgeMessage 幂等性
test('acknowledgeMessage 幂等：连续两次 ack 同一消息不报错', async () => {
    const { mailbox } = await makeMailbox();
    const msgId = await mailbox.postMessage(RUN_ID, baseInput());

    await mailbox.acknowledgeMessage(RUN_ID, msgId, 'executor-01');
    await assert.doesNotReject(() => mailbox.acknowledgeMessage(RUN_ID, msgId, 'executor-01'));

    const msgs = await mailbox.getMessages(RUN_ID);
    assert.equal(msgs[0].delivery_status, MessageDeliveryStatus.ACKNOWLEDGED);
});

// 补充：P8 跨多个 task_refs 时各 task 独立升级
test('P8：conflict 跨多个 task_refs，各 task 独立触发升级', async () => {
    const { mailbox } = await makeMailbox();

    const conflictInput = {
        task_refs: ['task-p', 'task-q'],
        type: MessageType.CONFLICT,
        from_agent: 'auditor-01',
        content: '跨任务冲突',
        claims: [{ claim: '声明 X', evidence: [] }],
    };

    await mailbox.postMessage(RUN_ID, conflictInput);
    await mailbox.postMessage(RUN_ID, { ...conflictInput, content: '跨任务冲突2' });

    // task-p 和 task-q 各自有独立的升级消息
    const escalationsP = (
        await mailbox.getMessages(RUN_ID, { type: MessageType.QUESTION, task_refs: ['task-p'] })
    ).filter((m) => m.escalation === true);
    const escalationsQ = (
        await mailbox.getMessages(RUN_ID, { type: MessageType.QUESTION, task_refs: ['task-q'] })
    ).filter((m) => m.escalation === true);

    assert.equal(escalationsP.length, 1);
    assert.equal(escalationsQ.length, 1);
    assert.deepEqual(escalationsP[0].task_refs, ['task-p']);
    assert.deepEqual(escalationsQ[0].task_refs, ['task-q']);
});

// 补充：调用方传入系统字段被覆写
test('postMessage 覆写调用方传入的 msg_id 和 delivery_status', async () => {
    const { mailbox } = await makeMailbox();
    const msgId = await mailbox.postMessage(RUN_ID, {
        ...baseInput(),
        msg_id: 'caller-supplied-id',
        delivery_status: MessageDeliveryStatus.ACKNOWLEDGED,
    });

    assert.notEqual(msgId, 'caller-supplied-id');
    // UUID v4 格式
    assert.match(msgId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

    const msgs = await mailbox.getMessages(RUN_ID);
    assert.equal(msgs[0].delivery_status, MessageDeliveryStatus.SENT);
    assert.equal(msgs[0].msg_id, msgId);
});
