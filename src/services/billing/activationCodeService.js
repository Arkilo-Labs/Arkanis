import { withCoreConnection } from '../../data/pgClient.js';
import { getPrimaryOrganizationForUserId } from '../../data/orgRepository.js';
import {
    incrementActivationCodeRedeemedCount,
    insertActivationCode,
    insertActivationCodeRedemption,
    lockActivationCodeByHash,
} from '../../data/activationCodeRepository.js';
import {
    getLatestSubscriptionForOrganizationId,
    getSubscriptionById,
    insertActivationCodeSubscription,
    lockActivationCodeSubscriptionForOrg,
    updateSubscriptionPeriodEnd,
} from '../../data/subscriptionRepository.js';
import { hashActivationCode, generateActivationCodePlaintext } from './activationCode.js';

function addDays(date, days) {
    const d = new Date(date.getTime());
    d.setUTCDate(d.getUTCDate() + days);
    return d;
}

function parsePositiveInt(value, fallback) {
    const n = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return n;
}

export async function createActivationCodes({
    createdByUserId,
    planCode,
    durationDays,
    count = 1,
    expiresAt = null,
    maxRedemptions = 1,
    note = null,
}) {
    const safeCount = Math.min(Math.max(parsePositiveInt(count, 1), 1), 100);
    const safeDurationDays = parsePositiveInt(durationDays, 30);
    const safeMaxRedemptions = Math.min(Math.max(parsePositiveInt(maxRedemptions, 1), 1), 1000);

    return withCoreConnection(async (client) => {
        await client.query('BEGIN');
        try {
            const codes = [];
            for (let i = 0; i < safeCount; i += 1) {
                const plaintext = generateActivationCodePlaintext();
                const codeHash = hashActivationCode(plaintext);
                const row = await insertActivationCode(client, {
                    codeHash,
                    planCode,
                    durationDays: safeDurationDays,
                    maxRedemptions: safeMaxRedemptions,
                    expiresAt,
                    createdByUserId,
                    note,
                });
                codes.push({ plaintext, ...row });
            }

            await client.query('COMMIT');
            return codes;
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        }
    });
}

export async function redeemActivationCode({ userId, code, ip = null, userAgent = null }) {
    const org = await getPrimaryOrganizationForUserId(userId);
    if (!org) throw new Error('当前用户未绑定组织');

    const codeHash = hashActivationCode(code);
    const now = new Date();

    return withCoreConnection(async (client) => {
        await client.query('BEGIN');
        try {
            const ac = await lockActivationCodeByHash(client, codeHash);
            if (!ac) throw new Error('激活码无效');
            if (ac.revoked_at) throw new Error('激活码已失效');
            if (ac.expires_at && new Date(ac.expires_at).getTime() <= now.getTime()) throw new Error('激活码已过期');
            if (ac.redeemed_count >= ac.max_redemptions) throw new Error('激活码已被使用');

            const sub = await lockActivationCodeSubscriptionForOrg(client, org.id);
            const currentEnd = sub?.current_period_end ? new Date(sub.current_period_end) : null;
            const base = currentEnd && currentEnd.getTime() > now.getTime() ? currentEnd : now;
            const nextEnd = addDays(base, Number(ac.duration_days));

            let subscriptionId = null;
            if (!sub) {
                const inserted = await insertActivationCodeSubscription(client, {
                    organizationId: org.id,
                    planCode: ac.plan_code,
                    startAt: now.toISOString(),
                    endAt: nextEnd.toISOString(),
                });
                subscriptionId = inserted.id;
            } else {
                subscriptionId = sub.id;
                await updateSubscriptionPeriodEnd(client, {
                    subscriptionId,
                    planCode: ac.plan_code,
                    endAt: nextEnd.toISOString(),
                });
            }

            await incrementActivationCodeRedeemedCount(client, ac.id);
            await insertActivationCodeRedemption(client, {
                activationCodeId: ac.id,
                organizationId: org.id,
                userId,
                subscriptionId,
                ip,
                userAgent,
            });

            const subscription = await getSubscriptionById(client, subscriptionId);

            await client.query('COMMIT');
            return { organization: org, subscription };
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        }
    });
}

export async function getCurrentSubscriptionForOrganizationId(organizationId) {
    return withCoreConnection(async (client) => getLatestSubscriptionForOrganizationId(client, organizationId));
}
