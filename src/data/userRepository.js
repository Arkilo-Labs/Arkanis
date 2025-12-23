function normalizeOptionalText(value) {
    const s = String(value ?? '').trim();
    return s ? s : null;
}

export async function getUserByEmail(client, email) {
    const res = await client.query(
        `
          SELECT id, email, password_hash, display_name, status, email_verified_at, deleted_at, created_at, updated_at
          FROM users
          WHERE email = $1
          LIMIT 1
        `,
        [String(email || '').trim()]
    );
    return res.rowCount ? res.rows[0] : null;
}

export async function lockUserById(client, userId) {
    const res = await client.query(
        `
          SELECT id, email, password_hash, display_name, status, email_verified_at, deleted_at, created_at, updated_at
          FROM users
          WHERE id = $1
          LIMIT 1
          FOR UPDATE
        `,
        [userId]
    );
    return res.rowCount ? res.rows[0] : null;
}

export async function updateUserById(client, { userId, email, displayName, status }) {
    const fields = [];
    const values = [];
    let p = 1;

    const nextEmail = normalizeOptionalText(email);
    const nextDisplayName = displayName === undefined ? undefined : normalizeOptionalText(displayName);
    const nextStatus = status === undefined ? undefined : String(status);

    if (email !== undefined) {
        fields.push(`email = $${p}`);
        values.push(nextEmail);
        p += 1;
    }
    if (displayName !== undefined) {
        fields.push(`display_name = $${p}`);
        values.push(nextDisplayName);
        p += 1;
    }
    if (status !== undefined) {
        fields.push(`status = $${p}`);
        values.push(nextStatus);
        p += 1;
    }

    if (!fields.length) return null;

    values.push(userId);
    const res = await client.query(
        `
          UPDATE users
          SET ${fields.join(', ')},
              updated_at = now()
          WHERE id = $${p}
          RETURNING id, email, display_name, status, email_verified_at, deleted_at, created_at, updated_at
        `,
        values
    );
    return res.rowCount ? res.rows[0] : null;
}

export async function markUserDeleted(client, { userId, deletedEmail, deletedAt, status = 'deleted' }) {
    const res = await client.query(
        `
          UPDATE users
          SET email = $2,
              password_hash = NULL,
              email_verified_at = NULL,
              status = $3,
              deleted_at = $4,
              updated_at = now()
          WHERE id = $1
          RETURNING id, email, display_name, status, deleted_at
        `,
        [userId, deletedEmail, status, deletedAt]
    );
    return res.rowCount ? res.rows[0] : null;
}

