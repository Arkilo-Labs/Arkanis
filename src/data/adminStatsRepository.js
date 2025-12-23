function clampInt(value, { min, max, fallback }) {
    const n = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(Math.max(n, min), max);
}

export function normalizeOverviewDays(value) {
    return clampInt(value, { min: 7, max: 365, fallback: 30 });
}

export async function getOverviewTotals(client) {
    const res = await client.query(
        `
          SELECT
            (SELECT COUNT(*)::int FROM users) AS users,
            (SELECT COUNT(*)::int FROM organizations) AS organizations,
            (
              SELECT COUNT(*)::int
              FROM subscriptions
              WHERE status = 'active' AND current_period_end IS NOT NULL AND current_period_end > now()
            ) AS active_subscriptions
        `
    );
    return res.rows[0] || { users: 0, organizations: 0, active_subscriptions: 0 };
}

export async function getOverviewByPlan(client) {
    const res = await client.query(
        `
          SELECT
            plan_code,
            COUNT(*) FILTER (
              WHERE status = 'active' AND current_period_end IS NOT NULL AND current_period_end > now()
            )::int AS active_subscriptions,
            COUNT(DISTINCT organization_id) FILTER (
              WHERE status = 'active' AND current_period_end IS NOT NULL AND current_period_end > now()
            )::int AS active_organizations,
            COUNT(*)::int AS total_subscriptions,
            COUNT(DISTINCT organization_id)::int AS total_organizations
          FROM subscriptions
          GROUP BY plan_code
          ORDER BY plan_code ASC
        `
    );
    return res.rows.map((r) => ({
        planCode: r.plan_code,
        activeSubscriptions: r.active_subscriptions,
        activeOrganizations: r.active_organizations,
        totalSubscriptions: r.total_subscriptions,
        totalOrganizations: r.total_organizations,
    }));
}

export async function getDailyUserRegistrations(client, days) {
    const safeDays = normalizeOverviewDays(days);
    const res = await client.query(
        `
          WITH d AS (
            SELECT generate_series(
              date_trunc('day', now()) - ($1::int - 1) * interval '1 day',
              date_trunc('day', now()),
              interval '1 day'
            ) AS day
          ),
          c AS (
            SELECT date_trunc('day', created_at) AS day, COUNT(*)::int AS count
            FROM users
            WHERE created_at >= date_trunc('day', now()) - ($1::int - 1) * interval '1 day'
            GROUP BY 1
          )
          SELECT to_char(d.day, 'YYYY-MM-DD') AS day, COALESCE(c.count, 0)::int AS count
          FROM d
          LEFT JOIN c USING (day)
          ORDER BY d.day ASC
        `,
        [safeDays]
    );
    return res.rows;
}

export async function getDailySubscriptionCreations(client, days) {
    const safeDays = normalizeOverviewDays(days);
    const res = await client.query(
        `
          WITH d AS (
            SELECT generate_series(
              date_trunc('day', now()) - ($1::int - 1) * interval '1 day',
              date_trunc('day', now()),
              interval '1 day'
            ) AS day
          ),
          c AS (
            SELECT date_trunc('day', created_at) AS day, COUNT(*)::int AS count
            FROM subscriptions
            WHERE created_at >= date_trunc('day', now()) - ($1::int - 1) * interval '1 day'
            GROUP BY 1
          )
          SELECT to_char(d.day, 'YYYY-MM-DD') AS day, COALESCE(c.count, 0)::int AS count
          FROM d
          LEFT JOIN c USING (day)
          ORDER BY d.day ASC
        `,
        [safeDays]
    );
    return res.rows;
}

