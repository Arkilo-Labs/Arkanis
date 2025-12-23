exports.shorthands = undefined;

exports.up = (pgm) => {
    pgm.addColumns('users', {
        deleted_at: { type: 'timestamptz' },
    });

    // 允许同邮箱重新注册：仅对未删除用户保持唯一
    pgm.dropConstraint('users', 'users_email_key', { ifExists: true });
    pgm.createIndex('users', ['email'], {
        unique: true,
        name: 'users_email_active_unique',
        where: 'deleted_at IS NULL',
    });

    // 账户注销/删除审计与备份（用于对接后续注销流程）
    pgm.createTable('user_account_actions', {
        id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
        action_type: { type: 'text', notNull: true }, // self_deactivate | admin_delete
        target_user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'restrict' },
        actor_user_id: { type: 'uuid', references: 'users', onDelete: 'set null' },
        email: { type: 'citext', notNull: true },
        display_name: { type: 'text' },
        snapshot: { type: 'jsonb', notNull: true },
        note: { type: 'text' },
        ip: { type: 'inet' },
        user_agent: { type: 'text' },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });
    pgm.createIndex('user_account_actions', ['target_user_id', 'created_at']);
    pgm.createIndex('user_account_actions', ['created_at']);
};

exports.down = (pgm) => {
    pgm.dropTable('user_account_actions');
    pgm.dropIndex('users', ['email'], { name: 'users_email_active_unique', ifExists: true });
    pgm.addConstraint('users', 'users_email_key', { unique: ['email'] });
    pgm.dropColumns('users', ['deleted_at']);
};

