function normalizeOptionalText(value) {
    const s = String(value || '').trim();
    return s ? s : null;
}

export async function listSubscriptions(client, { limit, offset, q, provider, status }) {
    const keyword = normalizeOptionalText(q);
    const providerFilter = normalizeOptionalText(provider);
    const statusFilter = normalizeOptionalText(status);

    const where = [];
    const params = [limit, offset];
    let p = 3;

    if (keyword) {
        where.push(`(o.name ILIKE $${p} OR o.slug ILIKE $${p})`);
        params.push(`%${keyword}%`);
        p += 1;
    }
    if (providerFilter) {
        where.push(`s.provider = $${p}`);
        params.push(providerFilter);
        p += 1;
    }
    if (statusFilter) {
        where.push(`s.status = $${p}`);
        params.push(statusFilter);
        p += 1;
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const res = await client.query(
        `
          SELECT
            s.id,
            s.organization_id,
            s.provider,
            s.provider_subscription_id,
            s.plan_code,
            s.status,
            s.current_period_start,
            s.current_period_end,
            s.cancel_at_period_end,
            s.created_at,
            s.updated_at,
            o.name AS organization_name,
            o.slug AS organization_slug,
            COUNT(*) OVER()::int AS total_count
          FROM subscriptions s
          JOIN organizations o ON o.id = s.organization_id
          ${whereSql}
          ORDER BY s.created_at DESC
          LIMIT $1 OFFSET $2
        `,
        params
    );

    const total = res.rowCount ? res.rows[0].total_count : 0;
    return { items: res.rows.map(stripTotalCount), total };
}

export async function getSubscriptionById(client, subscriptionId) {
    const res = await client.query(
        `
          SELECT
            s.id,
            s.organization_id,
            s.provider,
            s.provider_subscription_id,
            s.plan_code,
            s.status,
            s.current_period_start,
            s.current_period_end,
            s.cancel_at_period_end,
            s.created_at,
            s.updated_at,
            o.name AS organization_name,
            o.slug AS organization_slug
          FROM subscriptions s
          JOIN organizations o ON o.id = s.organization_id
          WHERE s.id = $1
          LIMIT 1
        `,
        [subscriptionId]
    );
    return res.rowCount ? res.rows[0] : null;
}

export async function updateActivationCodeSubscriptionById(
    client,
    { subscriptionId, planCode, status, currentPeriodEnd, cancelAtPeriodEnd }
) {
    const res = await client.query(
        `
          UPDATE subscriptions
          SET plan_code = COALESCE($2, plan_code),
              status = COALESCE($3, status),
              current_period_end = COALESCE($4, current_period_end),
              cancel_at_period_end = COALESCE($5, cancel_at_period_end),
              updated_at = now()
          WHERE id = $1 AND provider = 'activation_code'
          RETURNING id, organization_id, provider, provider_subscription_id, plan_code, status,
                    current_period_start, current_period_end, cancel_at_period_end, created_at, updated_at
        `,
        [subscriptionId, planCode || null, status || null, currentPeriodEnd || null, cancelAtPeriodEnd ?? null]
    );
    return res.rowCount ? res.rows[0] : null;
}

function stripTotalCount(row) {
    const { total_count, ...rest } = row;
    return rest;
}
