import { withCoreConnection } from '../../data/pgClient.js';
import { insertUserAccountAction } from '../../data/accountActionRepository.js';
import { lockUserById, markUserDeleted } from '../../data/userRepository.js';
import { revokeAllUserSessions } from '../../data/adminUsersRepository.js';

function buildDeletedEmail(userId) {
    const safe = String(userId || '').trim();
    return `deleted+${safe}@deleted.invalid`;
}

async function buildDeletionSnapshot(client, userId) {
    const userRes = await client.query(
        `
          SELECT id, email, display_name, status, email_verified_at, deleted_at, created_at, updated_at
          FROM users
          WHERE id = $1
          LIMIT 1
        `,
        [userId]
    );
    const user = userRes.rowCount ? userRes.rows[0] : null;

    const orgsRes = await client.query(
        `
          SELECT
            o.id,
            o.name,
            o.slug,
            m.role,
            m.created_at AS member_created_at
          FROM organization_members m
          JOIN organizations o ON o.id = m.organization_id
          WHERE m.user_id = $1
          ORDER BY m.created_at ASC
        `,
        [userId]
    );

    const subsRes = await client.query(
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
            s.updated_at
          FROM subscriptions s
          WHERE s.organization_id IN (
            SELECT organization_id FROM organization_members WHERE user_id = $1
          )
          ORDER BY s.created_at DESC
          LIMIT 200
        `,
        [userId]
    );

    const sessionsRes = await client.query(
        `SELECT COUNT(*)::int AS count FROM user_sessions WHERE user_id = $1`,
        [userId]
    );

    return {
        user,
        organizations: orgsRes.rows,
        subscriptions: subsRes.rows,
        sessionsCount: sessionsRes.rows[0]?.count ?? 0,
        capturedAt: new Date().toISOString(),
    };
}

export async function deleteUserAccount({ targetUserId, actorUserId, actionType, note, ip, userAgent }) {
    const safeActionType = String(actionType || '').trim();
    if (!['self_deactivate', 'admin_delete'].includes(safeActionType)) {
        throw new Error('actionType 不合法');
    }

    return withCoreConnection(async (client) => {
        await client.query('BEGIN');
        try {
            const locked = await lockUserById(client, targetUserId);
            if (!locked) throw new Error('用户不存在');
            if (locked.deleted_at) throw new Error('用户已删除/注销');

            const snapshot = await buildDeletionSnapshot(client, targetUserId);
            await insertUserAccountAction(client, {
                actionType: safeActionType,
                targetUserId,
                actorUserId: actorUserId || null,
                email: locked.email,
                displayName: locked.display_name,
                snapshot,
                note,
                ip,
                userAgent,
            });

            await revokeAllUserSessions(client, { userId: targetUserId });
            const deletedAt = new Date().toISOString();
            const deletedEmail = buildDeletedEmail(targetUserId);
            const user = await markUserDeleted(client, { userId: targetUserId, deletedEmail, deletedAt });

            await client.query('COMMIT');
            return { success: true, user };
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        }
    });
}

