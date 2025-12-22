export async function lockActivationCodeSubscriptionForOrg(client, organizationId) {
    const res = await client.query(
        `
          SELECT id, current_period_end
          FROM subscriptions
          WHERE organization_id = $1
            AND provider = 'activation_code'
            AND provider_subscription_id = $2
          LIMIT 1
          FOR UPDATE
        `,
        [organizationId, `activation_code:${organizationId}`]
    );
    return res.rowCount ? res.rows[0] : null;
}

export async function insertActivationCodeSubscription(client, { organizationId, planCode, startAt, endAt }) {
    const res = await client.query(
        `
          INSERT INTO subscriptions (
            organization_id,
            provider,
            provider_subscription_id,
            plan_code,
            status,
            current_period_start,
            current_period_end
          )
          VALUES ($1, 'activation_code', $2, $3, 'active', $4, $5)
          RETURNING id, organization_id, provider, plan_code, status, current_period_start, current_period_end
        `,
        [organizationId, `activation_code:${organizationId}`, planCode, startAt, endAt]
    );
    return res.rows[0];
}

export async function updateSubscriptionPeriodEnd(client, { subscriptionId, planCode, endAt }) {
    await client.query(
        `
          UPDATE subscriptions
          SET plan_code = $1,
              status = 'active',
              current_period_end = $2,
              updated_at = now()
          WHERE id = $3
        `,
        [planCode, endAt, subscriptionId]
    );
}

export async function getSubscriptionById(client, subscriptionId) {
    const res = await client.query(
        `
          SELECT id, organization_id, provider, provider_subscription_id, plan_code, status,
                 current_period_start, current_period_end, cancel_at_period_end, created_at, updated_at
          FROM subscriptions
          WHERE id = $1
        `,
        [subscriptionId]
    );
    return res.rowCount ? res.rows[0] : null;
}

export async function getLatestSubscriptionForOrganizationId(client, organizationId) {
    const res = await client.query(
        `
          SELECT id, organization_id, provider, provider_subscription_id, plan_code, status,
                 current_period_start, current_period_end, cancel_at_period_end, created_at, updated_at
          FROM subscriptions
          WHERE organization_id = $1
          ORDER BY created_at DESC
          LIMIT 1
        `,
        [organizationId]
    );
    return res.rowCount ? res.rows[0] : null;
}

export async function getSubscriptionByProviderSubscriptionId(client, { provider, providerSubscriptionId }) {
    const res = await client.query(
        `
          SELECT id, organization_id, provider, provider_subscription_id, plan_code, status,
                 current_period_start, current_period_end, cancel_at_period_end, created_at, updated_at
          FROM subscriptions
          WHERE provider = $1 AND provider_subscription_id = $2
          LIMIT 1
        `,
        [provider, providerSubscriptionId]
    );
    return res.rowCount ? res.rows[0] : null;
}

export async function upsertSubscriptionByProviderSubscriptionId(
    client,
    { organizationId, provider, providerSubscriptionId, planCode, status, currentPeriodStart, currentPeriodEnd, cancelAtPeriodEnd }
) {
    const res = await client.query(
        `
          INSERT INTO subscriptions (
            organization_id,
            provider,
            provider_subscription_id,
            plan_code,
            status,
            current_period_start,
            current_period_end,
            cancel_at_period_end
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (provider_subscription_id)
          DO UPDATE SET
            organization_id = EXCLUDED.organization_id,
            provider = EXCLUDED.provider,
            plan_code = EXCLUDED.plan_code,
            status = EXCLUDED.status,
            current_period_start = EXCLUDED.current_period_start,
            current_period_end = EXCLUDED.current_period_end,
            cancel_at_period_end = EXCLUDED.cancel_at_period_end,
            updated_at = now()
          RETURNING id, organization_id, provider, provider_subscription_id, plan_code, status,
                    current_period_start, current_period_end, cancel_at_period_end, created_at, updated_at
        `,
        [
            organizationId,
            provider,
            providerSubscriptionId,
            planCode,
            status,
            currentPeriodStart,
            currentPeriodEnd,
            cancelAtPeriodEnd,
        ]
    );
    return res.rows[0];
}
