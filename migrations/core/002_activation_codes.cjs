exports.shorthands = undefined;

exports.up = (pgm) => {
    pgm.createTable('activation_codes', {
        id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
        code_hash: { type: 'text', notNull: true, unique: true },
        plan_code: { type: 'text', notNull: true },
        duration_days: { type: 'integer', notNull: true },
        max_redemptions: { type: 'integer', notNull: true, default: 1 },
        redeemed_count: { type: 'integer', notNull: true, default: 0 },
        expires_at: { type: 'timestamptz' },
        revoked_at: { type: 'timestamptz' },
        created_by_user_id: { type: 'uuid', references: 'users', onDelete: 'set null' },
        note: { type: 'text' },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });
    pgm.createIndex('activation_codes', ['created_at']);
    pgm.createIndex('activation_codes', ['plan_code', 'created_at']);

    pgm.createTable(
        'activation_code_redemptions',
        {
            id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
            activation_code_id: {
                type: 'uuid',
                notNull: true,
                references: 'activation_codes',
                onDelete: 'cascade',
            },
            organization_id: {
                type: 'uuid',
                notNull: true,
                references: 'organizations',
                onDelete: 'cascade',
            },
            user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'cascade' },
            subscription_id: { type: 'uuid', references: 'subscriptions', onDelete: 'set null' },
            redeemed_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
            ip: { type: 'inet' },
            user_agent: { type: 'text' },
        }
    );
    pgm.createIndex('activation_code_redemptions', ['activation_code_id', 'redeemed_at']);
    pgm.createIndex('activation_code_redemptions', ['organization_id', 'redeemed_at']);
    pgm.createIndex('activation_code_redemptions', ['user_id', 'redeemed_at']);
};

exports.down = (pgm) => {
    pgm.dropTable('activation_code_redemptions');
    pgm.dropTable('activation_codes');
};
