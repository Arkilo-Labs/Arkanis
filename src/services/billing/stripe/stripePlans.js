export function getStripePlanCatalog({ env = process.env } = {}) {
    const monthlyPriceId = String(env.STRIPE_PRICE_MONTHLY || '').trim();
    const quarterlyPriceId = String(env.STRIPE_PRICE_QUARTERLY || '').trim();
    const yearlyPriceId = String(env.STRIPE_PRICE_YEARLY || '').trim();

    return [
        {
            code: 'monthly',
            displayName: '月度',
            allowanceCreditsPerMonth: 300,
            priceId: monthlyPriceId || null,
            available: !!monthlyPriceId,
        },
        {
            code: 'quarterly',
            displayName: '季度',
            allowanceCreditsPerMonth: 400,
            priceId: quarterlyPriceId || null,
            available: !!quarterlyPriceId,
        },
        {
            code: 'yearly',
            displayName: '年度',
            allowanceCreditsPerMonth: 500,
            priceId: yearlyPriceId || null,
            available: !!yearlyPriceId,
        },
    ];
}

export function resolvePlanCodeFromStripeSubscription({ subscription, env = process.env } = {}) {
    const monthly = String(env.STRIPE_PRICE_MONTHLY || '').trim();
    const quarterly = String(env.STRIPE_PRICE_QUARTERLY || '').trim();
    const yearly = String(env.STRIPE_PRICE_YEARLY || '').trim();

    const items = subscription?.items?.data || [];
    const priceIds = items.map((it) => it?.price?.id).filter(Boolean);
    if (yearly && priceIds.includes(yearly)) return 'yearly';
    if (quarterly && priceIds.includes(quarterly)) return 'quarterly';
    if (monthly && priceIds.includes(monthly)) return 'monthly';

    // metadata 可能在升级后没更新，作为兜底而不是优先级最高
    const meta = subscription?.metadata || {};
    const fromMeta = String(meta.planCode || '').trim();
    if (fromMeta === 'monthly' || fromMeta === 'quarterly' || fromMeta === 'yearly') return fromMeta;
    return 'monthly';
}
