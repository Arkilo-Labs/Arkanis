import { withCoreConnection } from '../../../data/pgClient.js';
import { getBillingCustomerByOrgAndProvider, insertBillingCustomer } from '../../../data/billingCustomerRepository.js';
import { tryInsertStripeWebhookEvent, markStripeWebhookEventProcessed } from '../../../data/stripeWebhookEventRepository.js';
import {
    getSubscriptionByProviderSubscriptionId,
    getLatestSubscriptionForOrganizationId,
    upsertSubscriptionByProviderSubscriptionId,
} from '../../../data/subscriptionRepository.js';
import { getStripeClient } from './stripeClient.js';
import { getStripePlanCatalog, resolvePlanCodeFromStripeSubscription } from './stripePlans.js';

function unixToIso(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return null;
    return new Date(n * 1000).toISOString();
}

function getPublishableKey(env) {
    return String(env.STRIPE_PUBLISHABLE_KEY || '').trim();
}

function getWebhookSecret(env) {
    return String(env.STRIPE_WEBHOOK_SECRET || '').trim();
}

function getPlanPriceId({ env, planCode }) {
    if (planCode === 'yearly') return String(env.STRIPE_PRICE_YEARLY || '').trim();
    return String(env.STRIPE_PRICE_MONTHLY || '').trim();
}

export function getStripePublicConfig({ env = process.env } = {}) {
    const publishableKey = getPublishableKey(env);
    if (!publishableKey) throw new Error('缺少 STRIPE_PUBLISHABLE_KEY');

    const plans = getStripePlanCatalog({ env }).map((p) => ({
        code: p.code,
        displayName: p.displayName,
        allowanceCreditsPerMonth: p.allowanceCreditsPerMonth,
        available: p.available,
    }));

    return { publishableKey, plans };
}

async function cancelIfRemoteBlocking({ stripe, providerSubscriptionId, env }) {
    if (!providerSubscriptionId) return;

    const remote = await stripe.subscriptions.retrieve(providerSubscriptionId, {
        expand: ['latest_invoice.payment_intent'],
    });
    if (!remote?.status) return;

    const remotePlan = resolvePlanCodeFromStripeSubscription({ subscription: remote, env });
    if (remote.status === 'incomplete' || remote.status === 'incomplete_expired') {
        try {
            await stripe.subscriptions.cancel(remote.id);
        } catch {}
        return;
    }

    if (remote.status !== 'canceled' && (remote.status === 'trialing' || remote.status === 'active')) {
        // 已经是有效订阅，别动
        return;
    }

    // 其它中间态（例如 past_due/unpaid）先不强杀，避免误伤
    if (remotePlan !== 'monthly' && remotePlan !== 'yearly') {
        try {
            await stripe.subscriptions.cancel(remote.id);
        } catch {}
    }
}

export async function createEmbeddedStripeSubscription({
    organizationId,
    userId,
    email,
    planCode,
    env = process.env,
}) {
    if (planCode !== 'monthly' && planCode !== 'yearly') throw new Error('planCode 无效');

    const priceId = getPlanPriceId({ env, planCode });
    if (!priceId) throw new Error('套餐未配置（缺少 STRIPE_PRICE_*）');

    const stripe = getStripeClient({ secretKey: env.STRIPE_SECRET_KEY });

    const customer = await withCoreConnection(async (client) => {
        const existing = await getBillingCustomerByOrgAndProvider(client, { organizationId, provider: 'stripe' });
        if (existing) return existing;

        const created = await stripe.customers.create({
            email,
            metadata: { organizationId },
        });

        try {
            return await insertBillingCustomer(client, {
                organizationId,
                provider: 'stripe',
                providerCustomerId: created.id,
            });
        } catch (e) {
            const fallback = await getBillingCustomerByOrgAndProvider(client, { organizationId, provider: 'stripe' });
            if (fallback) return fallback;
            throw e;
        }
    });

    const existingLocal = await withCoreConnection((client) => getLatestSubscriptionForOrganizationId(client, organizationId));
    if (existingLocal?.provider === 'stripe' && existingLocal?.provider_subscription_id) {
        const remote = await stripe.subscriptions.retrieve(existingLocal.provider_subscription_id, {
            expand: ['latest_invoice.payment_intent'],
        });
        const remotePlan = resolvePlanCodeFromStripeSubscription({ subscription: remote, env });

        if (remote.status === 'incomplete' && remotePlan === planCode) {
            await withCoreConnection((client) =>
                upsertSubscriptionByProviderSubscriptionId(client, {
                    organizationId,
                    provider: 'stripe',
                    providerSubscriptionId: remote.id,
                    planCode: remotePlan,
                    status: remote.status,
                    currentPeriodStart: unixToIso(remote.current_period_start),
                    currentPeriodEnd: unixToIso(remote.current_period_end),
                    cancelAtPeriodEnd: !!remote.cancel_at_period_end,
                })
            );

            const clientSecret = remote?.latest_invoice?.payment_intent?.client_secret || null;
            if (!clientSecret) throw new Error('未获取到 client_secret（订阅未完成，且缺少支付意图）');

            return { subscriptionId: remote.id, clientSecret, status: remote.status, resumed: true };
        }

        if (remote.status && remote.status !== 'canceled') {
            if (remote.status === 'incomplete_expired' || remotePlan !== planCode) {
                try {
                    await stripe.subscriptions.cancel(remote.id);
                } catch {}
            }
        }
    }

    const subscription = await stripe.subscriptions.create({
        customer: customer.provider_customer_id,
        items: [{ price: priceId }],
        payment_behavior: 'default_incomplete',
        payment_settings: { save_default_payment_method: 'on_subscription' },
        metadata: { organizationId, planCode },
        expand: ['latest_invoice.payment_intent'],
    });

    const plan = resolvePlanCodeFromStripeSubscription({ subscription, env });
    await withCoreConnection((client) =>
        upsertSubscriptionByProviderSubscriptionId(client, {
            organizationId,
            provider: 'stripe',
            providerSubscriptionId: subscription.id,
            planCode: plan,
            status: subscription.status,
            currentPeriodStart: unixToIso(subscription.current_period_start),
            currentPeriodEnd: unixToIso(subscription.current_period_end),
            cancelAtPeriodEnd: !!subscription.cancel_at_period_end,
        })
    );

    const clientSecret = subscription?.latest_invoice?.payment_intent?.client_secret || null;
    if (!clientSecret) throw new Error('未获取到 client_secret');

    return { subscriptionId: subscription.id, clientSecret, status: subscription.status, resumed: false };
}

export async function createStripeCheckoutSession({ organizationId, email, planCode, publicUrl, env = process.env }) {
    if (planCode !== 'monthly' && planCode !== 'yearly') throw new Error('planCode 无效');
    const base = String(publicUrl || '').trim().replace(/\/+$/, '');
    if (!base) throw new Error('缺少 APP_PUBLIC_URL，无法生成 Stripe 回跳地址');

    const priceId = getPlanPriceId({ env, planCode });
    if (!priceId) throw new Error('套餐未配置（缺少 STRIPE_PRICE_*）');

    const stripe = getStripeClient({ secretKey: env.STRIPE_SECRET_KEY });

    const customer = await withCoreConnection(async (client) => {
        const existing = await getBillingCustomerByOrgAndProvider(client, { organizationId, provider: 'stripe' });
        if (existing) return existing;

        const created = await stripe.customers.create({ email, metadata: { organizationId } });
        try {
            return await insertBillingCustomer(client, {
                organizationId,
                provider: 'stripe',
                providerCustomerId: created.id,
            });
        } catch (e) {
            const fallback = await getBillingCustomerByOrgAndProvider(client, { organizationId, provider: 'stripe' });
            if (fallback) return fallback;
            throw e;
        }
    });

    const latest = await withCoreConnection((client) => getLatestSubscriptionForOrganizationId(client, organizationId));
    if (latest?.provider === 'stripe' && latest?.provider_subscription_id) {
        await cancelIfRemoteBlocking({
            stripe,
            providerSubscriptionId: latest.provider_subscription_id,
            env,
        });
    }

    const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: customer.provider_customer_id,
        line_items: [{ price: priceId, quantity: 1 }],
        subscription_data: { metadata: { organizationId, planCode } },
        success_url: `${base}/app/subscription?stripe=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${base}/app/subscription?stripe=cancel`,
        client_reference_id: organizationId,
        metadata: { organizationId, planCode },
    });

    if (!session?.url) throw new Error('未获取到 Stripe Checkout URL');
    return { url: session.url, sessionId: session.id };
}

export async function completeStripeCheckoutSession({ organizationId, sessionId, env = process.env }) {
    const id = String(sessionId || '').trim();
    if (!id) throw new Error('缺少 sessionId');

    const stripe = getStripeClient({ secretKey: env.STRIPE_SECRET_KEY });
    const session = await stripe.checkout.sessions.retrieve(id, { expand: ['subscription'] });

    const remoteSub = session?.subscription;
    if (!remoteSub || typeof remoteSub !== 'object') throw new Error('Checkout Session 未包含 subscription');

    const customerId = String(session?.customer || '').trim();
    const billingCustomer = await withCoreConnection((client) =>
        getBillingCustomerByOrgAndProvider(client, { organizationId, provider: 'stripe' })
    );
    if (!billingCustomer) throw new Error('当前组织未绑定 Stripe Customer');
    if (customerId && customerId !== billingCustomer.provider_customer_id) {
        throw new Error('Checkout Session 不属于当前组织');
    }

    const plan = resolvePlanCodeFromStripeSubscription({ subscription: remoteSub, env });
    const updated = await withCoreConnection((client) =>
        upsertSubscriptionByProviderSubscriptionId(client, {
            organizationId,
            provider: 'stripe',
            providerSubscriptionId: remoteSub.id,
            planCode: plan,
            status: remoteSub.status,
            currentPeriodStart: unixToIso(remoteSub.current_period_start),
            currentPeriodEnd: unixToIso(remoteSub.current_period_end),
            cancelAtPeriodEnd: !!remoteSub.cancel_at_period_end,
        })
    );

    return { subscription: updated, stripeStatus: remoteSub.status };
}

export async function syncStripeSubscriptionForOrganization({ organizationId, env = process.env }) {
    const stripe = getStripeClient({ secretKey: env.STRIPE_SECRET_KEY });

    const latest = await withCoreConnection((client) => getLatestSubscriptionForOrganizationId(client, organizationId));
    if (!latest || latest.provider !== 'stripe') return { subscription: latest || null };

    const remote = await stripe.subscriptions.retrieve(latest.provider_subscription_id, {
        expand: ['latest_invoice.payment_intent'],
    });
    const plan = resolvePlanCodeFromStripeSubscription({ subscription: remote, env });

    const updated = await withCoreConnection((client) =>
        upsertSubscriptionByProviderSubscriptionId(client, {
            organizationId,
            provider: 'stripe',
            providerSubscriptionId: remote.id,
            planCode: plan,
            status: remote.status,
            currentPeriodStart: unixToIso(remote.current_period_start),
            currentPeriodEnd: unixToIso(remote.current_period_end),
            cancelAtPeriodEnd: !!remote.cancel_at_period_end,
        })
    );

    return { subscription: updated };
}

export async function handleStripeWebhook({ rawBody, signature, env = process.env }) {
    const secret = getWebhookSecret(env);
    if (!secret) throw new Error('缺少 STRIPE_WEBHOOK_SECRET');

    const stripe = getStripeClient({ secretKey: env.STRIPE_SECRET_KEY });
    const event = stripe.webhooks.constructEvent(rawBody, signature, secret);

    await withCoreConnection(async (client) => {
        const inserted = await tryInsertStripeWebhookEvent(client, { eventId: event.id, type: event.type });
        if (!inserted) return;

        try {
            if (event.type.startsWith('customer.subscription.')) {
                const s = event.data.object;
                const organizationId = String(s?.metadata?.organizationId || '').trim();
                if (!organizationId) {
                    const existing = await getSubscriptionByProviderSubscriptionId(client, {
                        provider: 'stripe',
                        providerSubscriptionId: s.id,
                    });
                    if (!existing) throw new Error('缺少 organizationId，且本地无订阅映射');
                }

                const orgId =
                    organizationId ||
                    (await getSubscriptionByProviderSubscriptionId(client, {
                        provider: 'stripe',
                        providerSubscriptionId: s.id,
                    }))?.organization_id;

                if (!orgId) throw new Error('无法确定 organizationId');
                const plan = resolvePlanCodeFromStripeSubscription({ subscription: s, env });

                await upsertSubscriptionByProviderSubscriptionId(client, {
                    organizationId: orgId,
                    provider: 'stripe',
                    providerSubscriptionId: s.id,
                    planCode: plan,
                    status: s.status,
                    currentPeriodStart: unixToIso(s.current_period_start),
                    currentPeriodEnd: unixToIso(s.current_period_end),
                    cancelAtPeriodEnd: !!s.cancel_at_period_end,
                });
            }

            await markStripeWebhookEventProcessed(client, { eventId: event.id, error: null });
        } catch (e) {
            await markStripeWebhookEventProcessed(client, { eventId: event.id, error: e?.message || String(e) });
            throw e;
        }
    });

    return { received: true };
}
