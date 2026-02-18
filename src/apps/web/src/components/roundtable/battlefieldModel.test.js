import test from 'node:test';
import assert from 'node:assert/strict';

import {
    campFromDirection,
    inferBattlePhase,
    pickWinnerSideFromDecision,
} from './battlefieldModel.js';

test('campFromDirection: LONG/SHORT/WAIT 映射阵营', () => {
    assert.equal(campFromDirection('LONG'), 'BULL');
    assert.equal(campFromDirection('short'), 'BEAR');
    assert.equal(campFromDirection('WAIT'), 'NEUTRAL');
    assert.equal(campFromDirection('unknown'), 'NEUTRAL');
});

test('inferBattlePhase: 先判断对抗，其次 leader/draft', () => {
    assert.equal(
        inferBattlePhase({
            hasLeader: true,
            hasDraftDecision: false,
            bullCount: 2,
            bearCount: 2,
            agentCount: 6,
        }),
        'duel',
    );

    assert.equal(
        inferBattlePhase({
            hasLeader: true,
            hasDraftDecision: false,
            bullCount: 1,
            bearCount: 0,
            agentCount: 6,
        }),
        'synthesis',
    );

    assert.equal(
        inferBattlePhase({
            hasLeader: false,
            hasDraftDecision: false,
            bullCount: 0,
            bearCount: 0,
            agentCount: 6,
        }),
        'gathering',
    );
});

test('pickWinnerSideFromDecision: direction 推断左右胜方', () => {
    assert.equal(pickWinnerSideFromDecision({ json: { direction: 'LONG' } }), 'LEFT');
    assert.equal(pickWinnerSideFromDecision({ json: { direction: 'short' } }), 'RIGHT');
    assert.equal(pickWinnerSideFromDecision({ json: { direction: 'WAIT' } }), null);
});

