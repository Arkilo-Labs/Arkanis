exports.shorthands = undefined;

exports.up = (pgm) => {
    pgm.createIndex('billing_customers', ['organization_id', 'provider'], {
        unique: true,
        name: 'billing_customers_org_provider_unique',
    });

    pgm.createTable('stripe_webhook_events', {
        event_id: { type: 'text', primaryKey: true },
        type: { type: 'text', notNull: true },
        received_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        processed_at: { type: 'timestamptz' },
        last_error: { type: 'text' },
    });
    pgm.createIndex('stripe_webhook_events', ['received_at']);
};

exports.down = (pgm) => {
    pgm.dropTable('stripe_webhook_events');
    pgm.dropIndex('billing_customers', ['organization_id', 'provider'], {
        name: 'billing_customers_org_provider_unique',
    });
};

