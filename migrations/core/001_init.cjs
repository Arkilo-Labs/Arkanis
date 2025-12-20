exports.shorthands = undefined;

exports.up = (pgm) => {
    pgm.createExtension('pgcrypto', { ifNotExists: true });
    pgm.createExtension('citext', { ifNotExists: true });

    pgm.createTable('users', {
        id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
        email: { type: 'citext', notNull: true, unique: true },
        password_hash: { type: 'text' },
        display_name: { type: 'text' },
        status: { type: 'text', notNull: true, default: 'active' },
        email_verified_at: { type: 'timestamptz' },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });

    pgm.createTable('organizations', {
        id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
        name: { type: 'text', notNull: true },
        slug: { type: 'citext', notNull: true, unique: true },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });

    pgm.createTable(
        'organization_members',
        {
            organization_id: {
                type: 'uuid',
                notNull: true,
                references: 'organizations',
                onDelete: 'cascade',
            },
            user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'cascade' },
            role: { type: 'text', notNull: true, default: 'member' },
            created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        },
        { constraints: { primaryKey: ['organization_id', 'user_id'] } }
    );

    pgm.createTable('user_email_verifications', {
        id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
        user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'cascade' },
        email: { type: 'citext', notNull: true },
        token_hash: { type: 'text', notNull: true, unique: true },
        expires_at: { type: 'timestamptz', notNull: true },
        used_at: { type: 'timestamptz' },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });
    pgm.createIndex('user_email_verifications', ['user_id', 'created_at']);

    pgm.createTable('user_sessions', {
        id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
        user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'cascade' },
        refresh_token_hash: { type: 'text', notNull: true, unique: true },
        expires_at: { type: 'timestamptz', notNull: true },
        revoked_at: { type: 'timestamptz' },
        ip: { type: 'inet' },
        user_agent: { type: 'text' },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });
    pgm.createIndex('user_sessions', ['user_id', 'created_at']);

    pgm.createTable('billing_customers', {
        id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
        organization_id: {
            type: 'uuid',
            notNull: true,
            references: 'organizations',
            onDelete: 'cascade',
        },
        provider: { type: 'text', notNull: true },
        provider_customer_id: { type: 'text', notNull: true, unique: true },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });

    pgm.createTable('subscriptions', {
        id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
        organization_id: {
            type: 'uuid',
            notNull: true,
            references: 'organizations',
            onDelete: 'cascade',
        },
        provider: { type: 'text', notNull: true },
        provider_subscription_id: { type: 'text', notNull: true, unique: true },
        plan_code: { type: 'text', notNull: true },
        status: { type: 'text', notNull: true },
        current_period_start: { type: 'timestamptz' },
        current_period_end: { type: 'timestamptz' },
        cancel_at_period_end: { type: 'boolean', notNull: true, default: false },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });
    pgm.createIndex('subscriptions', ['organization_id', 'status']);
};

exports.down = (pgm) => {
    pgm.dropTable('subscriptions');
    pgm.dropTable('billing_customers');
    pgm.dropTable('user_sessions');
    pgm.dropTable('user_email_verifications');
    pgm.dropTable('organization_members');
    pgm.dropTable('organizations');
    pgm.dropTable('users');
};

