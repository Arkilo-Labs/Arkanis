export async function listOrganizations(client, { limit, offset, q }) {
    const keyword = String(q || '').trim();
    const where = keyword
        ? `WHERE o.name ILIKE $3 OR o.slug ILIKE $3`
        : '';
    const params = keyword
        ? [limit, offset, `%${keyword}%`]
        : [limit, offset];

    const res = await client.query(
        `
          SELECT
            o.id,
            o.name,
            o.slug,
            o.created_at,
            o.updated_at,
            (
              SELECT COUNT(*)::int
              FROM organization_members m
              WHERE m.organization_id = o.id
            ) AS member_count,
            s.plan_code AS subscription_plan_code,
            s.status AS subscription_status,
            s.current_period_end AS subscription_current_period_end,
            COUNT(*) OVER()::int AS total_count
          FROM organizations o
          LEFT JOIN LATERAL (
            SELECT plan_code, status, current_period_end
            FROM subscriptions s
            WHERE s.organization_id = o.id
            ORDER BY s.created_at DESC
            LIMIT 1
          ) s ON true
          ${where}
          ORDER BY o.created_at DESC
          LIMIT $1 OFFSET $2
        `,
        params
    );

    const total = res.rowCount ? res.rows[0].total_count : 0;
    return { items: res.rows.map(stripTotalCount), total };
}

function stripTotalCount(row) {
    const { total_count, ...rest } = row;
    return rest;
}

