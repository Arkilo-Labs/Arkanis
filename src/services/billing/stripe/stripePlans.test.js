import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePlanCodeFromStripeSubscription } from './stripePlans.js';

test('stripePlans: 优先按 price id 识别套餐（覆盖 metadata 未更新）', () => {
    const env = {
        STRIPE_PRICE_MONTHLY: 'price_monthly',
        STRIPE_PRICE_QUARTERLY: 'price_quarterly',
        STRIPE_PRICE_YEARLY: 'price_yearly',
    };

    const subscription = {
        metadata: { planCode: 'monthly' },
        items: { data: [{ price: { id: 'price_quarterly' } }] },
    };

    assert.equal(resolvePlanCodeFromStripeSubscription({ subscription, env }), 'quarterly');
});

test('stripePlans: metadata 仅作为兜底', () => {
    const env = {
        STRIPE_PRICE_MONTHLY: 'price_monthly',
        STRIPE_PRICE_QUARTERLY: 'price_quarterly',
        STRIPE_PRICE_YEARLY: 'price_yearly',
    };

    const subscription = {
        metadata: { planCode: 'yearly' },
        items: { data: [] },
    };

    assert.equal(resolvePlanCodeFromStripeSubscription({ subscription, env }), 'yearly');
});

