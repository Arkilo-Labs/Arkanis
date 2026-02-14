import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { config as dotenvConfig } from 'dotenv';

function getRootDir() {
    const __filename = fileURLToPath(import.meta.url);
    return join(dirname(__filename), '..', '..', '..');
}

let envLoaded = false;
function ensureEnvLoaded() {
    if (envLoaded) return;
    const root = getRootDir();
    dotenvConfig({ path: join(root, '.env') });
    envLoaded = true;
}

function getNodePgMigrateBin() {
    const require = createRequire(import.meta.url);
    try {
        return require.resolve('node-pg-migrate/bin/node-pg-migrate');
    } catch (e) {
        const root = getRootDir();
        throw new Error(`未找到 node-pg-migrate（请在 ${root} 执行 pnpm install）：${e?.message || String(e)}`);
    }
}

function getDbEnv() {
    ensureEnvLoaded();
    const host = process.env.DB_HOST || 'localhost';
    const port = Number.parseInt(process.env.DB_PORT || '5432', 10);
    const user = process.env.DB_USER || 'postgres';
    const password = String(process.env.DB_PASSWORD ?? '');

    const coreDb = (process.env.DB_CORE_DATABASE || 'arkanis_core').trim();
    const marketDb = (process.env.DB_MARKET_DATABASE || process.env.DB_DATABASE || 'arkanis_market_data').trim();

    return { host, port, user, password, coreDb, marketDb };
}

function buildPostgresDsn({ host, port, user, password, database }) {
    const u = encodeURIComponent(String(user ?? ''));
    const db = encodeURIComponent(String(database ?? ''));
    const plainPassword = String(password ?? '');
    if (!plainPassword) {
        return `postgresql://${u}@${host}:${port}/${db}`;
    }
    const p = encodeURIComponent(plainPassword);
    return `postgresql://${u}:${p}@${host}:${port}/${db}`;
}

function resolveMigrationsDir(role) {
    const root = getRootDir();
    if (role === 'core') return join(root, 'migrations', 'core');
    if (role === 'market') return join(root, 'migrations', 'market_data');
    throw new Error(`未知 role: ${role}，仅支持 core / market`);
}

export async function runMigrations({ role }) {
    const { host, port, user, password, coreDb, marketDb } = getDbEnv();
    const database = role === 'core' ? coreDb : marketDb;
    const dsn = buildPostgresDsn({ host, port, user, password, database });

    const entryScriptPath = getNodePgMigrateBin();
    const migrationsDir = resolveMigrationsDir(role);

    await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [entryScriptPath, '--migrations-dir', migrationsDir, 'up'], {
            stdio: 'inherit',
            shell: false,
            env: { ...process.env, DATABASE_URL: dsn },
        });

        child.on('error', reject);
        child.on('exit', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`迁移执行失败 (role=${role})，退出码: ${code}`));
        });
    });
}

async function main() {
    const role = (process.argv[2] || '').trim();
    if (!role) {
        throw new Error('缺少参数: role（core / market）');
    }
    await runMigrations({ role });
}

function isDirectRun() {
    const thisFile = fileURLToPath(import.meta.url);
    const argvFile = process.argv[1];
    if (!argvFile) return false;
    if (argvFile === thisFile) return true;
    const resolved = join(process.cwd(), argvFile);
    return resolved === thisFile;
}

if (isDirectRun()) {
    main().catch((err) => {
        // 这里直接输出错误，方便 CI/本地定位
        console.error(err?.stack || err?.message || String(err));
        process.exit(1);
    });
}
