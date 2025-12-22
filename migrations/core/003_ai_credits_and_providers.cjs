exports.shorthands = undefined;

exports.up = (pgm) => {
    pgm.createTable('ai_provider_definitions', {
        id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
        code: { type: 'citext', notNull: true, unique: true },
        display_name: { type: 'text', notNull: true },
        base_url: { type: 'text' },
        model_name: { type: 'text', notNull: true },
        thinking_mode: { type: 'text', notNull: true, default: 'none' },
        max_tokens: { type: 'integer', notNull: true, default: 8192 },
        temperature_x100: { type: 'integer', notNull: true, default: 20 }, // 0.20
        multiplier_x100: { type: 'integer', notNull: true, default: 100 }, // 1.00
        is_active: { type: 'boolean', notNull: true, default: true },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });
    pgm.createIndex('ai_provider_definitions', ['is_active', 'created_at']);

    pgm.createTable(
        'organization_ai_provider_secrets',
        {
            organization_id: {
                type: 'uuid',
                notNull: true,
                references: 'organizations',
                onDelete: 'cascade',
            },
            provider_definition_id: {
                type: 'uuid',
                notNull: true,
                references: 'ai_provider_definitions',
                onDelete: 'cascade',
            },
            api_key_enc: { type: 'bytea', notNull: true },
            created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
            updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        },
        { constraints: { primaryKey: ['organization_id', 'provider_definition_id'] } }
    );

    pgm.createTable('organization_ai_provider_selection', {
        organization_id: {
            type: 'uuid',
            primaryKey: true,
            references: 'organizations',
            onDelete: 'cascade',
        },
        provider_definition_id: {
            type: 'uuid',
            notNull: true,
            references: 'ai_provider_definitions',
            onDelete: 'restrict',
        },
        updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });

    pgm.createTable('subscription_ai_credit_state', {
        subscription_id: {
            type: 'uuid',
            primaryKey: true,
            references: 'subscriptions',
            onDelete: 'cascade',
        },
        organization_id: {
            type: 'uuid',
            notNull: true,
            references: 'organizations',
            onDelete: 'cascade',
        },
        anchor_day: { type: 'integer', notNull: true },
        period_start: { type: 'timestamptz', notNull: true },
        period_end: { type: 'timestamptz', notNull: true },
        allowance_units: { type: 'integer', notNull: true },
        used_units: { type: 'integer', notNull: true, default: 0 },
        updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });
    pgm.createIndex('subscription_ai_credit_state', ['organization_id', 'period_end']);

    pgm.createTable('ai_credit_ledger', {
        id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
        organization_id: {
            type: 'uuid',
            notNull: true,
            references: 'organizations',
            onDelete: 'cascade',
        },
        user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'cascade' },
        subscription_id: { type: 'uuid', notNull: true, references: 'subscriptions', onDelete: 'cascade' },
        provider_definition_id: { type: 'uuid', references: 'ai_provider_definitions', onDelete: 'set null' },
        units: { type: 'integer', notNull: true },
        multiplier_x100: { type: 'integer', notNull: true },
        reason: { type: 'text', notNull: true },
        meta: { type: 'jsonb' },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });
    pgm.createIndex('ai_credit_ledger', ['organization_id', 'created_at']);
    pgm.createIndex('ai_credit_ledger', ['subscription_id', 'created_at']);
};

exports.down = (pgm) => {
    pgm.dropTable('ai_credit_ledger');
    pgm.dropTable('subscription_ai_credit_state');
    pgm.dropTable('organization_ai_provider_selection');
    pgm.dropTable('organization_ai_provider_secrets');
    pgm.dropTable('ai_provider_definitions');
};

