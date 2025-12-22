import { withCoreConnection } from '../../data/pgClient.js';
import { lockCreditStateForUpdate, insertCreditLedger, insertCreditState, updateCreditState } from '../../data/aiCreditsRepository.js';
import { addMonthsKeepDayUtc, computeMonthlyWindowUtc, computeChargeUnits, planMonthlyAllowanceUnits } from './credits.js';

function getUtcDayOfMonth(date) {
    return new Date(date).getUTCDate();
}

function normalizeSubscriptionStart(subscription) {
    const raw = subscription?.current_period_start || subscription?.created_at || null;
    if (!raw) return new Date();
    const d = new Date(raw);
    if (!Number.isFinite(d.getTime())) return new Date();
    return d;
}

export async function getCreditStatus({ subscription, organizationId }) {
    const now = new Date();
    const anchorDay = getUtcDayOfMonth(normalizeSubscriptionStart(subscription));
    const subscriptionStart = normalizeSubscriptionStart(subscription);
    const window = computeMonthlyWindowUtc({ subscriptionStart, now, anchorDay });
    const allowanceUnits = planMonthlyAllowanceUnits(subscription?.plan_code);

    return withCoreConnection(async (client) => {
        const existing = await lockCreditStateForUpdate(client, subscription.id);
        if (!existing) {
            const inserted = await insertCreditState(client, {
                subscriptionId: subscription.id,
                organizationId,
                anchorDay,
                periodStart: window.periodStart.toISOString(),
                periodEnd: window.periodEnd.toISOString(),
                allowanceUnits,
                usedUnits: 0,
            });
            return {
                periodStart: inserted.period_start,
                periodEnd: inserted.period_end,
                allowanceUnits: inserted.allowance_units,
                usedUnits: inserted.used_units,
            };
        }

        let periodStart = new Date(existing.period_start);
        let periodEnd = new Date(existing.period_end);
        let usedUnits = Number(existing.used_units) || 0;

        while (now.getTime() >= periodEnd.getTime()) {
            periodStart = periodEnd;
            periodEnd = addMonthsKeepDayUtc(periodStart, 1, existing.anchor_day);
            usedUnits = 0;
        }

        const nextState = {
            subscriptionId: subscription.id,
            anchorDay,
            periodStart: periodStart.toISOString(),
            periodEnd: periodEnd.toISOString(),
            allowanceUnits,
            usedUnits,
        };
        await updateCreditState(client, nextState);

        return {
            periodStart: nextState.periodStart,
            periodEnd: nextState.periodEnd,
            allowanceUnits: nextState.allowanceUnits,
            usedUnits: nextState.usedUnits,
        };
    });
}

export async function chargeCredits({
    subscription,
    organizationId,
    userId,
    providerDefinitionId,
    multiplierX100,
    baseUnits,
    reason,
    meta,
}) {
    const now = new Date();
    const chargeUnits = computeChargeUnits({ baseUnits, multiplierX100 });
    const allowanceUnits = planMonthlyAllowanceUnits(subscription?.plan_code);
    const anchorDay = getUtcDayOfMonth(normalizeSubscriptionStart(subscription));
    const subscriptionStart = normalizeSubscriptionStart(subscription);

    return withCoreConnection(async (client) => {
        await client.query('BEGIN');
        try {
            let state = await lockCreditStateForUpdate(client, subscription.id);
            if (!state) {
                const window = computeMonthlyWindowUtc({ subscriptionStart, now, anchorDay });
                state = await insertCreditState(client, {
                    subscriptionId: subscription.id,
                    organizationId,
                    anchorDay,
                    periodStart: window.periodStart.toISOString(),
                    periodEnd: window.periodEnd.toISOString(),
                    allowanceUnits,
                    usedUnits: 0,
                });
            }

            let periodStart = new Date(state.period_start);
            let periodEnd = new Date(state.period_end);
            let usedUnits = Number(state.used_units) || 0;

            while (now.getTime() >= periodEnd.getTime()) {
                periodStart = periodEnd;
                periodEnd = addMonthsKeepDayUtc(periodStart, 1, state.anchor_day);
                usedUnits = 0;
            }

            if (usedUnits + chargeUnits > allowanceUnits) {
                const err = new Error('credit 不足');
                err.code = 'INSUFFICIENT_CREDIT';
                err.details = {
                    allowanceUnits,
                    usedUnits,
                    remainingUnits: Math.max(0, allowanceUnits - usedUnits),
                    periodEnd: periodEnd.toISOString(),
                    chargeUnits,
                };
                throw err;
            }

            usedUnits += chargeUnits;

            await updateCreditState(client, {
                subscriptionId: subscription.id,
                anchorDay,
                periodStart: periodStart.toISOString(),
                periodEnd: periodEnd.toISOString(),
                allowanceUnits,
                usedUnits,
            });

            const ledger = await insertCreditLedger(client, {
                organizationId,
                userId,
                subscriptionId: subscription.id,
                providerDefinitionId,
                units: chargeUnits,
                multiplierX100,
                reason,
                meta,
            });

            await client.query('COMMIT');

            return {
                ledgerId: ledger.id,
                chargedUnits: chargeUnits,
                allowanceUnits,
                usedUnits,
                remainingUnits: Math.max(0, allowanceUnits - usedUnits),
                periodEnd: periodEnd.toISOString(),
            };
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        }
    });
}

