export function getStripePlanCatalog({ env = process.env } = {}) {
    const monthlyPriceId = String(env.STRIPE_PRICE_MONTHLY || '').trim();
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
            code: 'yearly',
            displayName: '年度',
            allowanceCreditsPerMonth: 500,
            priceId: yearlyPriceId || null,
            available: !!yearlyPriceId,
        },
    ];
}

export function resolvePlanCodeFromStripeSubscription({ subscription, env = process.env } = {}) {
    const meta = subscription?.metadata || {};
    const fromMeta = String(meta.planCode || '').trim();
    if (fromMeta === 'monthly' || fromMeta === 'yearly') return fromMeta;

    const monthly = String(env.STRIPE_PRICE_MONTHLY || '').trim();
    const yearly = String(env.STRIPE_PRICE_YEARLY || '').trim();

    const items = subscription?.items?.data || [];
    const priceIds = items.map((it) => it?.price?.id).filter(Boolean);
    if (yearly && priceIds.includes(yearly)) return 'yearly';
    if (monthly && priceIds.includes(monthly)) return 'monthly';
    return 'monthly';
}

