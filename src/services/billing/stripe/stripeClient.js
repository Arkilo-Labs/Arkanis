import Stripe from 'stripe';

let cached = null;

export function getStripeClient({ secretKey = process.env.STRIPE_SECRET_KEY } = {}) {
    const key = String(secretKey || '').trim();
    if (!key) throw new Error('缺少 STRIPE_SECRET_KEY');

    if (cached && cached.__arkanis_key === key) return cached;
    const client = new Stripe(key);
    client.__arkanis_key = key;
    cached = client;
    return client;
}
