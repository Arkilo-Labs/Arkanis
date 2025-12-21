export async function insertActivationCode(
    client,
    { codeHash, planCode, durationDays, maxRedemptions, expiresAt, createdByUserId, note }
) {
    const sql = `
      INSERT INTO activation_codes (code_hash, plan_code, duration_days, max_redemptions, expires_at, created_by_user_id, note)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, plan_code, duration_days, max_redemptions, redeemed_count, expires_at, revoked_at, created_at
    `;
    const res = await client.query(sql, [
        codeHash,
        planCode,
        durationDays,
        maxRedemptions,
        expiresAt,
        createdByUserId,
        note,
    ]);
    return res.rows[0];
}

export async function lockActivationCodeByHash(client, codeHash) {
    const res = await client.query(
        `
          SELECT id, plan_code, duration_days, max_redemptions, redeemed_count, expires_at, revoked_at
          FROM activation_codes
          WHERE code_hash = $1
          FOR UPDATE
        `,
        [codeHash]
    );
    return res.rowCount ? res.rows[0] : null;
}

export async function incrementActivationCodeRedeemedCount(client, activationCodeId) {
    await client.query(
        `
          UPDATE activation_codes
          SET redeemed_count = redeemed_count + 1
          WHERE id = $1
        `,
        [activationCodeId]
    );
}

export async function insertActivationCodeRedemption(
    client,
    { activationCodeId, organizationId, userId, subscriptionId, ip, userAgent }
) {
    await client.query(
        `
          INSERT INTO activation_code_redemptions (activation_code_id, organization_id, user_id, subscription_id, ip, user_agent)
          VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [activationCodeId, organizationId, userId, subscriptionId, ip, userAgent]
    );
}

export async function listActivationCodes(client, { limit = 50, offset = 0 } = {}) {
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const safeOffset = Math.max(Number(offset) || 0, 0);

    const res = await client.query(
        `
          SELECT
            ac.id,
            ac.plan_code,
            ac.duration_days,
            ac.max_redemptions,
            ac.redeemed_count,
            ac.expires_at,
            ac.revoked_at,
            ac.note,
            ac.created_by_user_id,
            u.email AS created_by_email,
            ac.created_at
          FROM activation_codes ac
          LEFT JOIN users u ON u.id = ac.created_by_user_id
          ORDER BY ac.created_at DESC
          LIMIT $1 OFFSET $2
        `,
        [safeLimit, safeOffset]
    );
    return res.rows;
}

export async function revokeActivationCodeById(client, activationCodeId) {
    const res = await client.query(
        `
          UPDATE activation_codes
          SET revoked_at = now()
          WHERE id = $1 AND revoked_at IS NULL
          RETURNING id, plan_code, duration_days, max_redemptions, redeemed_count, expires_at, revoked_at, created_at
        `,
        [activationCodeId]
    );
    return res.rowCount ? res.rows[0] : null;
}
