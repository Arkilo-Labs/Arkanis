import { queryCore } from './pgClient.js';

export async function getPrimaryOrganizationForUserId(userId) {
    const sql = `
      SELECT o.id, o.name, o.slug, m.role
      FROM organization_members m
      JOIN organizations o ON o.id = m.organization_id
      WHERE m.user_id = $1
      ORDER BY m.created_at ASC
      LIMIT 1
    `;
    const res = await queryCore(sql, [userId]);
    return res.rowCount ? res.rows[0] : null;
}

