import { config as dotenvConfig } from 'dotenv';
import pg from 'pg';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { runMigrations } from './migrate.js';

const { Client } = pg;

function getRootDir() {
    const __filename = fileURLToPath(import.meta.url);
    return join(dirname(__filename), '..', '..');
}

function loadEnv() {
    const root = getRootDir();
    dotenvConfig({ path: join(root, '.env') });
}

function getDbEnv() {
    const host = process.env.DB_HOST || 'localhost';
    const port = Number.parseInt(process.env.DB_PORT || '5432', 10);
    const user = process.env.DB_USER || 'postgres';
    const password = String(process.env.DB_PASSWORD ?? '');

    const adminDb = (process.env.DB_ADMIN_DATABASE || 'postgres').trim();
    const coreDb = (process.env.DB_CORE_DATABASE || 'arkilo_core').trim();
    const marketDb = (process.env.DB_MARKET_DATABASE || process.env.DB_DATABASE || 'arkilo_market_data').trim();

    return { host, port, user, password, adminDb, coreDb, marketDb };
}

function assertSafeIdentifier(name, label) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
        throw new Error(`${label} 不是安全的 Postgres 标识符: ${name}`);
    }
}

function quoteIdent(name) {
    return `"${name.replace(/"/g, '""')}"`;
}

async function ensureDatabaseExists({ host, port, user, password, adminDb, targetDb }) {
    assertSafeIdentifier(adminDb, 'DB_ADMIN_DATABASE');
    assertSafeIdentifier(targetDb, '数据库名');

    const client = new Client({
        host,
        port,
        user,
        password,
        database: adminDb,
    });

    await client.connect();
    try {
        const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [targetDb]);
        if (exists.rowCount > 0) return;

        const createSql = `CREATE DATABASE ${quoteIdent(targetDb)} OWNER ${quoteIdent(user)}`;
        await client.query(createSql);
        console.log(`[db] 已创建数据库: ${targetDb}`);
    } finally {
        await client.end();
    }
}

async function main() {
    loadEnv();

    const { host, port, user, password, adminDb, coreDb, marketDb } = getDbEnv();

    await ensureDatabaseExists({ host, port, user, password, adminDb, targetDb: coreDb });
    await ensureDatabaseExists({ host, port, user, password, adminDb, targetDb: marketDb });

    await runMigrations({ role: 'core' });
    await runMigrations({ role: 'market' });

    console.log('[db] 完成');
}

main().catch((err) => {
    console.error(err?.stack || err?.message || String(err));
    process.exit(1);
});
