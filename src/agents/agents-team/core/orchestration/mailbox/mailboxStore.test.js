import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createMailboxStore } from './mailboxStore.js';
import { MessageType, MessageDeliveryStatus } from '../../contracts/message.schema.js';
import { ErrorCode } from '../../contracts/errors.js';

const RUN_ID = '20260101_120000';

function nowIso() {
    return new Date().toISOString();
}

function validMessage(overrides = {}) {
    return {
        msg_id: 'msg-1',
        run_id: RUN_ID,
        task_refs: ['task-1'],
        type: MessageType.UPDATE,
        from_agent: 'researcher-01',
        content: '调研进展更新',
        delivery_status: MessageDeliveryStatus.SENT,
        created_at: nowIso(),
        ...overrides,
    };
}

async function makeStore() {
    const dir = await mkdtemp(join(tmpdir(), 'arkanis-p2-mail-'));
    const store = createMailboxStore({ outputDir: join(dir, 'outputs/agents_team') });
    return { store, dir };
}

test('writeMessage → readMessage 数据一致', async () => {
    const { store } = await makeStore();
    const msg = validMessage();
    await store.writeMessage(RUN_ID, msg);
    const got = await store.readMessage(RUN_ID, msg.msg_id);
    assert.equal(got.msg_id, msg.msg_id);
    assert.equal(got.type, MessageType.UPDATE);
    assert.equal(got.from_agent, 'researcher-01');
});

test('tmp 残留不影响 readMessage', async () => {
    const { store, dir } = await makeStore();
    const msg = validMessage();
    await store.writeMessage(RUN_ID, msg);

    const mailboxDir = join(dir, 'outputs/agents_team', RUN_ID, 'mailbox');
    await writeFile(join(mailboxDir, 'msg-1.json.deadbeef.tmp'), '{"broken":1}', 'utf-8');

    const got = await store.readMessage(RUN_ID, msg.msg_id);
    assert.equal(got.msg_id, 'msg-1');
});

test('消息文件 JSON 损坏 → 抛 ERR_INVALID_ARGUMENT', async () => {
    const { dir } = await makeStore();
    const mailboxDir = join(dir, 'outputs/agents_team', RUN_ID, 'mailbox');
    await mkdir(mailboxDir, { recursive: true });
    await writeFile(join(mailboxDir, 'msg-bad.json'), '{ broken json', 'utf-8');

    const store = createMailboxStore({ outputDir: join(dir, 'outputs/agents_team') });
    await assert.rejects(
        () => store.readMessage(RUN_ID, 'msg-bad'),
        (err) => {
            assert.equal(err.code, ErrorCode.ERR_INVALID_ARGUMENT);
            return true;
        },
    );
});

test('writeMessage 非法 schema → 抛 ERR_INVALID_ARGUMENT', async () => {
    const { store } = await makeStore();
    await assert.rejects(
        () => store.writeMessage(RUN_ID, { msg_id: 'x', content: 123 }),
        (err) => {
            assert.equal(err.code, ErrorCode.ERR_INVALID_ARGUMENT);
            return true;
        },
    );
});

test('listMessages 全量返回，.ack.json 和 .tmp 不包含', async () => {
    const { store, dir } = await makeStore();

    await store.writeMessage(RUN_ID, validMessage({ msg_id: 'msg-a', type: MessageType.UPDATE }));
    await store.writeMessage(
        RUN_ID,
        validMessage({ msg_id: 'msg-b', type: MessageType.ARTIFACT }),
    );

    const mailboxDir = join(dir, 'outputs/agents_team', RUN_ID, 'mailbox');
    // 模拟 ack 文件和 tmp 残留
    await writeFile(join(mailboxDir, 'msg-a.ack.json'), '{}', 'utf-8');
    await writeFile(join(mailboxDir, 'msg-a.json.aabbccdd.tmp'), '{}', 'utf-8');

    const msgs = await store.listMessages(RUN_ID);
    assert.equal(msgs.length, 2);
    const ids = msgs.map((m) => m.msg_id).sort();
    assert.deepEqual(ids, ['msg-a', 'msg-b']);
});

test('listMessages 按 type 过滤', async () => {
    const { store } = await makeStore();
    await store.writeMessage(RUN_ID, validMessage({ msg_id: 'msg-u', type: MessageType.UPDATE }));
    await store.writeMessage(
        RUN_ID,
        validMessage({ msg_id: 'msg-c', type: MessageType.CONFLICT }),
    );

    const result = await store.listMessages(RUN_ID, { type: MessageType.UPDATE });
    assert.equal(result.length, 1);
    assert.equal(result[0].msg_id, 'msg-u');
});

test('listMessages 按 from_agent 过滤', async () => {
    const { store } = await makeStore();
    await store.writeMessage(
        RUN_ID,
        validMessage({ msg_id: 'msg-r', from_agent: 'researcher-01' }),
    );
    await store.writeMessage(
        RUN_ID,
        validMessage({ msg_id: 'msg-e', from_agent: 'executor-01' }),
    );

    const result = await store.listMessages(RUN_ID, { from_agent: 'executor-01' });
    assert.equal(result.length, 1);
    assert.equal(result[0].msg_id, 'msg-e');
});

test('listMessages 按 task_refs 过滤（任一匹配即返回）', async () => {
    const { store } = await makeStore();
    await store.writeMessage(
        RUN_ID,
        validMessage({ msg_id: 'msg-1', task_refs: ['task-alpha'] }),
    );
    await store.writeMessage(
        RUN_ID,
        validMessage({ msg_id: 'msg-2', task_refs: ['task-beta'] }),
    );
    await store.writeMessage(
        RUN_ID,
        validMessage({ msg_id: 'msg-3', task_refs: ['task-alpha', 'task-beta'] }),
    );

    const result = await store.listMessages(RUN_ID, { task_refs: ['task-alpha'] });
    const ids = result.map((m) => m.msg_id).sort();
    assert.deepEqual(ids, ['msg-1', 'msg-3']);
});

test('listMessages 目录不存在时返回空数组', async () => {
    const { store } = await makeStore();
    const msgs = await store.listMessages(RUN_ID);
    assert.deepEqual(msgs, []);
});

test('readMessage 不存在 → 抛 ERR_MESSAGE_NOT_FOUND', async () => {
    const { store } = await makeStore();
    await assert.rejects(
        () => store.readMessage(RUN_ID, 'msg-ghost'),
        (err) => {
            assert.equal(err.code, ErrorCode.ERR_MESSAGE_NOT_FOUND);
            return true;
        },
    );
});

test('readMessage 合并 .ack.json 的 delivery_status', async () => {
    const { store, dir } = await makeStore();
    const msg = validMessage({ delivery_status: MessageDeliveryStatus.SENT });
    await store.writeMessage(RUN_ID, msg);

    const mailboxDir = join(dir, 'outputs/agents_team', RUN_ID, 'mailbox');
    const ackPath = join(mailboxDir, `${msg.msg_id}.ack.json`);
    await writeFile(ackPath, JSON.stringify({ delivery_status: MessageDeliveryStatus.ACKNOWLEDGED }), 'utf-8');

    const got = await store.readMessage(RUN_ID, msg.msg_id);
    assert.equal(got.delivery_status, MessageDeliveryStatus.ACKNOWLEDGED);
});
