exports.shorthands = undefined;

exports.up = (pgm) => {
    pgm.createExtension('pgcrypto', { ifNotExists: true });
    pgm.createExtension('citext', { ifNotExists: true });

    pgm.createTable(
        'instruments',
        {
            id: 'bigserial',
            exchange: { type: 'text', notNull: true },
            market: { type: 'text', notNull: true, default: 'futures' },
            symbol: { type: 'citext', notNull: true },
            base_asset: { type: 'text' },
            quote_asset: { type: 'text' },
            status: { type: 'text', notNull: true, default: 'active' },
            created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
            updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        },
        {
            constraints: {
                primaryKey: 'id',
                unique: ['exchange', 'market', 'symbol'],
            },
        }
    );

    pgm.createIndex('instruments', ['exchange', 'market']);
    pgm.createIndex('instruments', ['symbol']);

    pgm.createTable(
        'klines_1m',
        {
            instrument_id: {
                type: 'bigint',
                notNull: true,
                references: 'instruments',
                onDelete: 'cascade',
            },
            open_time_ms: { type: 'bigint', notNull: true },
            close_time_ms: { type: 'bigint', notNull: true },
            open: { type: 'numeric', notNull: true },
            high: { type: 'numeric', notNull: true },
            low: { type: 'numeric', notNull: true },
            close: { type: 'numeric', notNull: true },
            volume: { type: 'numeric', notNull: true },
            quote_volume: { type: 'numeric' },
            trades_count: { type: 'integer' },
            taker_buy_base_volume: { type: 'numeric' },
            taker_buy_quote_volume: { type: 'numeric' },
            is_final: { type: 'boolean', notNull: true, default: true },
            source: { type: 'text', notNull: true, default: 'binance' },
            created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        },
        { constraints: { primaryKey: ['instrument_id', 'open_time_ms'] } }
    );

    pgm.addConstraint(
        'klines_1m',
        'klines_1m_time_order_chk',
        'CHECK (open_time_ms < close_time_ms)'
    );

    pgm.createIndex('klines_1m', ['open_time_ms']);
    pgm.createIndex('klines_1m', ['instrument_id', 'open_time_ms']);
};

exports.down = (pgm) => {
    pgm.dropTable('klines_1m');
    pgm.dropTable('instruments');
};

