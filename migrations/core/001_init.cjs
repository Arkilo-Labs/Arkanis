exports.shorthands = undefined;

exports.up = (pgm) => {
    pgm.createExtension('pgcrypto', { ifNotExists: true });

    // 开源版 core 库：只保留最小的“应用级状态”承载。
    // 账号体系/订阅/邮件验证等 SaaS 相关表已移除。
    pgm.createTable('app_kv', {
        key: { type: 'text', primaryKey: true },
        value: { type: 'jsonb', notNull: true },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });
};

exports.down = (pgm) => {
    pgm.dropTable('app_kv');
};
