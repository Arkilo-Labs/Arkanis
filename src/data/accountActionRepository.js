export async function insertUserAccountAction(
    client,
    { actionType, targetUserId, actorUserId, email, displayName, snapshot, note, ip, userAgent }
) {
    const res = await client.query(
        `
          INSERT INTO user_account_actions (
            action_type,
            target_user_id,
            actor_user_id,
            email,
            display_name,
            snapshot,
            note,
            ip,
            user_agent
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          RETURNING id, action_type, target_user_id, actor_user_id, created_at
        `,
        [
            actionType,
            targetUserId,
            actorUserId || null,
            email,
            displayName || null,
            snapshot,
            note || null,
            ip || null,
            userAgent || null,
        ]
    );
    return res.rows[0];
}

