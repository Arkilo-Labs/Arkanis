import test from 'node:test';
import assert from 'node:assert/strict';

import { Roundtable } from './roundtable.js';

const ZERO_USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

function wrapSpeak(fn) {
    return async (...args) => {
        const result = await fn(...args);
        if (result && typeof result === 'object' && 'text' in result) return result;
        return { text: String(result ?? ''), usage: ZERO_USAGE };
    };
}

function newAgent({ name, role, order, speak }) {
    return { name, role, order, tools: [], canSeeImages: false, speak: wrapSpeak(speak) };
}

function newLogger() {
    return {
        info() {},
        warn() {},
        error() {},
    };
}

test('Roundtable：先开场全员陈述，再由主席选择 next_speaker', async () => {
    const calls = [];
    const A = newAgent({
        name: 'A',
        role: 'AnalystA',
        order: 1,
        speak: async () => {
            calls.push('A');
            return 'A opening';
        },
    });
    const B = newAgent({
        name: 'B',
        role: 'AnalystB',
        order: 2,
        speak: async () => {
            calls.push('B');
            return 'B says';
        },
    });

    let chairTimes = 0;
    const Chair = newAgent({
        name: 'Chair',
        role: 'DecisionMaker',
        order: 3,
        speak: async () => {
            calls.push('Chair');
            chairTimes += 1;
            if (chairTimes === 1) {
                return JSON.stringify({
                    consensus: false,
                    signal: 'WAIT',
                    direction: null,
                    confidence: 0.4,
                    rationale: ['need rebuttal'],
                    plan: { entry: 'limit@0', stop_loss: '0', take_profit: '0', invalid_if: ['n/a'] },
                    next_round: { needed: true, questions: ['B 请具体回应 A 的关键位假设'] },
                    next_speaker: 'B',
                    next_speaker_reason: '让 B 回应开场的关键分歧',
                });
            }
            return JSON.stringify({
                consensus: true,
                signal: 'WAIT',
                direction: null,
                confidence: 0.6,
                rationale: ['done'],
                plan: { entry: 'limit@0', stop_loss: '0', take_profit: '0', invalid_if: ['n/a'] },
                next_round: { needed: false, questions: [] },
                next_speaker: null,
                next_speaker_reason: '信息足够，收敛输出',
            });
        },
    });

    const roundtable = new Roundtable({
        agents: [A, B, Chair],
        settings: { max_rounds: 2, final_agent: 'Chair', max_context_chars: 20000 },
        mcpClient: { call: async () => null },
        logger: newLogger(),
    });

    const { transcript } = await roundtable.run({ contextSeed: '# seed', imagePaths: [] });
    assert.deepEqual(calls.slice(0, 2), ['A', 'B']);
    assert.equal(transcript[2].name, 'Chair');
    assert.equal(transcript[3].name, 'B');
    assert.equal(transcript[transcript.length - 1].name, 'Chair');
});

test('Roundtable：主席给出无效 next_speaker 时走轮换兜底', async () => {
    const calls = [];
    const A = newAgent({
        name: 'A',
        role: 'AnalystA',
        order: 1,
        speak: async () => {
            calls.push('A');
            return 'A opening';
        },
    });
    const B = newAgent({
        name: 'B',
        role: 'AnalystB',
        order: 2,
        speak: async () => {
            calls.push('B');
            return 'B opening';
        },
    });

    const Chair = newAgent({
        name: 'Chair',
        role: 'DecisionMaker',
        order: 3,
        speak: async () => {
            calls.push('Chair');
            return JSON.stringify({
                consensus: false,
                signal: 'WAIT',
                direction: null,
                confidence: 0.2,
                rationale: ['need more'],
                plan: { entry: 'limit@0', stop_loss: '0', take_profit: '0', invalid_if: ['n/a'] },
                next_round: { needed: true, questions: ['next'] },
                next_speaker: 'UNKNOWN',
                next_speaker_reason: 'invalid speaker to trigger fallback',
            });
        },
    });

    const Scribe = newAgent({
        name: 'Scribe',
        role: 'Summarizer',
        order: 99,
        speak: async () => 'summary',
    });

    const roundtable = new Roundtable({
        agents: [A, B, Chair, Scribe],
        settings: { max_rounds: 1, final_agent: 'Chair', summary_agent: 'Scribe', max_context_chars: 20000 },
        mcpClient: { call: async () => null },
        logger: newLogger(),
    });

    await roundtable.run({ contextSeed: '# seed', imagePaths: [] });
    assert.deepEqual(calls, ['A', 'B', 'Chair', 'A', 'Chair']);
});

test('Roundtable：turn 预算结束在参与者后会补一次主席收敛', async () => {
    const calls = [];
    const A = newAgent({
        name: 'A',
        role: 'AnalystA',
        order: 1,
        speak: async () => {
            calls.push('A');
            return 'A opening';
        },
    });
    const B = newAgent({
        name: 'B',
        role: 'AnalystB',
        order: 2,
        speak: async () => {
            calls.push('B');
            return 'B opening';
        },
    });

    let chairTimes = 0;
    const Chair = newAgent({
        name: 'Chair',
        role: 'DecisionMaker',
        order: 3,
        speak: async () => {
            calls.push('Chair');
            chairTimes += 1;
            return JSON.stringify({
                consensus: false,
                signal: 'WAIT',
                direction: null,
                confidence: 0.2,
                rationale: ['keep going'],
                plan: { entry: 'limit@0', stop_loss: '0', take_profit: '0', invalid_if: ['n/a'] },
                next_round: { needed: true, questions: [] },
                next_speaker: chairTimes === 1 ? 'A' : null,
                next_speaker_reason: 'budget test',
            });
        },
    });

    const Scribe = newAgent({
        name: 'Scribe',
        role: 'Summarizer',
        order: 99,
        speak: async () => 'summary',
    });

    const roundtable = new Roundtable({
        agents: [A, B, Chair, Scribe],
        settings: { max_rounds: 1, final_agent: 'Chair', summary_agent: 'Scribe', max_context_chars: 20000 },
        mcpClient: { call: async () => null },
        logger: newLogger(),
    });

    const { transcript } = await roundtable.run({ contextSeed: '# seed', imagePaths: [] });
    assert.equal(transcript[transcript.length - 2].name, 'Chair');
    assert.equal(transcript[transcript.length - 1].name, 'Scribe');
});
