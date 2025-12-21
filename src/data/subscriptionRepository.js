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
          SELECT id, organization_id, provider, plan_code, status, current_period_start, current_period_end
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
          SELECT id, organization_id, provider, plan_code, status, current_period_start, current_period_end
          FROM subscriptions
          WHERE organization_id = $1
          ORDER BY created_at DESC
          LIMIT 1
        `,
        [organizationId]
    );
    return res.rowCount ? res.rows[0] : null;
}

