import test from 'node:test';
import assert from 'node:assert/strict';
import { planMonthlyAllowanceUnits, unitsToCredits } from './credits.js';

test('credits: planMonthlyAllowanceUnits 与套餐一致', () => {
    assert.equal(unitsToCredits(planMonthlyAllowanceUnits('free')), 10);
    assert.equal(unitsToCredits(planMonthlyAllowanceUnits('monthly')), 300);
    assert.equal(unitsToCredits(planMonthlyAllowanceUnits('quarterly')), 400);
    assert.equal(unitsToCredits(planMonthlyAllowanceUnits('yearly')), 500);
    assert.equal(unitsToCredits(planMonthlyAllowanceUnits('annual')), 500);
});

