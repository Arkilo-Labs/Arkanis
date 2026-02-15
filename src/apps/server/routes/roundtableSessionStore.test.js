import test from 'node:test';
import assert from 'node:assert/strict';

import {
    applySessionEvent,
    createSessionMeta,
    parseEventsNdjson,
    resolveExitStatus,
} from './roundtableSessionStore.js';

test('parseEventsNdjson: 过滤坏行并按 after/limit 返回', () => {
    const raw = [
        '{"seq":1,"type":"session-start","timestamp":1,"sessionId":"rt_a","payload":{}}',
        '{"seq":2,"type":"agent-speak","timestamp":2,"sessionId":"rt_a","payload":{"name":"a"}}',
        'not-json',
        '{"seq":"x","type":"agent-speak"}',
        '{"seq":3,"type":"decision","timestamp":3,"sessionId":"rt_a","payload":{"stage":"draft"}}',
        '{"seq":4,"type":"process-exit","timestamp":4,"sessionId":"rt_a","payload":{"code":0}}',
    ].join('\n');

    const result = parseEventsNdjson(raw, { after: 1, limit: 2 });
    assert.equal(result.events.length, 2);
    assert.equal(result.events[0].seq, 2);
    assert.equal(result.events[1].seq, 3);
    assert.equal(result.nextAfter, 3);
});

test('resolveExitStatus: completed/failed/killed 状态判断', () => {
    assert.equal(resolveExitStatus({ code: 0 }), 'completed');
    assert.equal(resolveExitStatus({ code: 1 }), 'failed');
    assert.equal(resolveExitStatus({ code: null }), 'failed');
    assert.equal(resolveExitStatus({ code: 0, signal: 'SIGTERM' }), 'killed');
    assert.equal(resolveExitStatus({ code: 0, killRequested: true }), 'killed');
});

test('applySessionEvent: 会话状态机转换', () => {
    const base = createSessionMeta({ id: 'rt_a', pid: 100, timestamp: 1 });
    const started = applySessionEvent(base, {
        seq: 1,
        type: 'session-start',
        timestamp: 10,
        sessionId: 'rt_a',
        pid: 100,
        payload: {},
    });
    assert.equal(started.status, 'running');
    assert.equal(started.lastSeq, 1);

    const completed = applySessionEvent(started, {
        seq: 2,
        type: 'process-exit',
        timestamp: 20,
        sessionId: 'rt_a',
        pid: 100,
        payload: { code: 0 },
    });
    assert.equal(completed.status, 'completed');
    assert.equal(completed.exitCode, 0);
    assert.equal(completed.lastSeq, 2);

    const killed = applySessionEvent(started, {
        seq: 3,
        type: 'process-exit',
        timestamp: 30,
        sessionId: 'rt_a',
        pid: 100,
        payload: { code: null, signal: 'SIGTERM', killRequested: true },
    });
    assert.equal(killed.status, 'killed');
    assert.equal(killed.exitCode, null);
    assert.equal(killed.lastSeq, 3);
});

