import test from 'node:test';
import assert from 'node:assert/strict';

import { applyRoundtableEvent, createRoundtableEventState } from './roundtableState.js';

test('applyRoundtableEvent: 按序累计并写入类型列表', () => {
    let state = createRoundtableEventState();

    state = applyRoundtableEvent(state, {
        seq: 1,
        type: 'log',
        timestamp: 1,
        sessionId: 'rt_a',
        payload: { type: 'stdout', data: 'hello\\n', source: 'roundtable' },
    });

    state = applyRoundtableEvent(state, {
        seq: 2,
        type: 'agent-speak',
        timestamp: 2,
        sessionId: 'rt_a',
        payload: { name: 'vision', text: 'summary' },
    });

    state = applyRoundtableEvent(state, {
        seq: 3,
        type: 'decision',
        timestamp: 3,
        sessionId: 'rt_a',
        payload: { stage: 'draft', json: { signal: 'WAIT' } },
    });

    assert.equal(state.lastSeq, 3);
    assert.equal(state.logs.length, 1);
    assert.equal(state.agentSpeaks.length, 1);
    assert.equal(state.decisions.length, 1);
});

test('applyRoundtableEvent: 重复或乱序 seq 会被去重', () => {
    let state = createRoundtableEventState();
    state = applyRoundtableEvent(state, {
        seq: 10,
        type: 'log',
        payload: { type: 'stdout', data: 'a' },
    });
    state = applyRoundtableEvent(state, {
        seq: 10,
        type: 'log',
        payload: { type: 'stdout', data: 'b' },
    });
    state = applyRoundtableEvent(state, {
        seq: 9,
        type: 'log',
        payload: { type: 'stdout', data: 'c' },
    });

    assert.equal(state.lastSeq, 10);
    assert.equal(state.logs.length, 1);
    assert.equal(state.logs[0].data, 'a');
});

test('applyRoundtableEvent: process-exit 更新退出信息', () => {
    let state = createRoundtableEventState();
    state = applyRoundtableEvent(state, {
        seq: 1,
        type: 'process-exit',
        sessionId: 'rt_x',
        timestamp: 123,
        payload: { code: 0, signal: null, killRequested: false },
    });

    assert.equal(state.lastSeq, 1);
    assert.equal(state.processExit?.code, 0);
    assert.equal(state.processExit?.sessionId, 'rt_x');
});

