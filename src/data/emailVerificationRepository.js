export async function getUserById(client, userId) {
    const res = await client.query(
        `
          SELECT id, email, email_verified_at
          FROM users
          WHERE id = $1
          LIMIT 1
        `,
        [userId]
    );
    return res.rowCount ? res.rows[0] : null;
}

export async function getLatestEmailVerificationForUserId(client, userId) {
    const res = await client.query(
        `
          SELECT id, created_at, used_at, expires_at
          FROM user_email_verifications
          WHERE user_id = $1
          ORDER BY created_at DESC
          LIMIT 1
        `,
        [userId]
    );
    return res.rowCount ? res.rows[0] : null;
}

export async function insertEmailVerification(client, { userId, email, tokenHash, expiresAt }) {
    const res = await client.query(
        `
          INSERT INTO user_email_verifications (user_id, email, token_hash, expires_at)
          VALUES ($1, $2, $3, $4)
          RETURNING id, user_id, email, expires_at, created_at
        `,
        [userId, email, tokenHash, expiresAt]
    );
    return res.rows[0];
}

export async function getEmailVerificationByTokenHashForUpdate(client, tokenHash) {
    const res = await client.query(
        `
          SELECT id, user_id, email, used_at, expires_at
          FROM user_email_verifications
          WHERE token_hash = $1
          LIMIT 1
          FOR UPDATE
        `,
        [tokenHash]
    );
    return res.rowCount ? res.rows[0] : null;
}

export async function markEmailVerificationUsed(client, verificationId) {
    const res = await client.query(
        `
          UPDATE user_email_verifications
          SET used_at = now()
          WHERE id = $1 AND used_at IS NULL
          RETURNING id, used_at
        `,
        [verificationId]
    );
    return res.rowCount ? res.rows[0] : null;
}

export async function markUserEmailVerified(client, userId) {
    const res = await client.query(
        `
          UPDATE users
          SET email_verified_at = COALESCE(email_verified_at, now()),
              updated_at = now()
          WHERE id = $1
          RETURNING id, email, email_verified_at
        `,
        [userId]
    );
    return res.rowCount ? res.rows[0] : null;
}
