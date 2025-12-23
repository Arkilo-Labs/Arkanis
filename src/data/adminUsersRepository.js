export async function listUsers(client, { limit, offset, q }) {
    const keyword = String(q || '').trim();
    const where = keyword
        ? `WHERE u.email ILIKE $3 OR COALESCE(u.display_name, '') ILIKE $3`
        : '';
    const params = keyword
        ? [limit, offset, `%${keyword}%`]
        : [limit, offset];

    const res = await client.query(
        `
          SELECT
            u.id,
            u.email,
            u.display_name,
            u.status,
            u.email_verified_at,
            u.deleted_at,
            u.created_at,
            u.updated_at,
            COUNT(*) OVER()::int AS total_count
          FROM users u
          ${where}
          ORDER BY u.created_at DESC
          LIMIT $1 OFFSET $2
        `,
        params
    );

    const total = res.rowCount ? res.rows[0].total_count : 0;
    return { items: res.rows.map(stripTotalCount), total };
}

export async function updateUserStatusById(client, { userId, status }) {
    const res = await client.query(
        `
          UPDATE users
          SET status = $2,
              updated_at = now()
          WHERE id = $1
          RETURNING id, email, display_name, status, email_verified_at, created_at, updated_at
        `,
        [userId, status]
    );
    return res.rowCount ? res.rows[0] : null;
}

export async function revokeAllUserSessions(client, { userId }) {
    const res = await client.query(
        `
          UPDATE user_sessions
          SET revoked_at = now()
          WHERE user_id = $1 AND revoked_at IS NULL
        `,
        [userId]
    );
    return { revoked: res.rowCount };
}

function stripTotalCount(row) {
    const { total_count, ...rest } = row;
    return rest;
}
