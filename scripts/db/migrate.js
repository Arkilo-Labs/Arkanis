import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

function getRootDir() {
    const __filename = fileURLToPath(import.meta.url);
    return join(dirname(__filename), '..', '..');
}

function getNodePgMigrateBin() {
    const root = getRootDir();
    const binName = process.platform === 'win32' ? 'node-pg-migrate.cmd' : 'node-pg-migrate';
    const binPath = join(root, 'node_modules', '.bin', binName);
    if (!existsSync(binPath)) {
        throw new Error(`未找到 node-pg-migrate 可执行文件: ${binPath}，请先运行 pnpm install`);
    }
    return binPath;
}

function getDbEnv() {
    const host = process.env.DB_HOST || 'localhost';
    const port = Number.parseInt(process.env.DB_PORT || '5432', 10);
    const user = process.env.DB_USER || 'postgres';
    const password = String(process.env.DB_PASSWORD ?? '');

    const coreDb = (process.env.DB_CORE_DATABASE || 'arkilo_core').trim();
    const marketDb = (process.env.DB_MARKET_DATABASE || process.env.DB_DATABASE || 'arkilo_market_data').trim();

    return { host, port, user, password, coreDb, marketDb };
}

function buildPostgresDsn({ host, port, user, password, database }) {
    const u = encodeURIComponent(String(user ?? ''));
    const p = encodeURIComponent(String(password ?? ''));
    const db = encodeURIComponent(String(database ?? ''));
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

    const binPath = getNodePgMigrateBin();
    const migrationsDir = resolveMigrationsDir(role);

    await new Promise((resolve, reject) => {
        const child = spawn(
            binPath,
            ['--migrations-dir', migrationsDir, 'up'],
            {
                stdio: 'inherit',
                shell: process.platform === 'win32',
                env: { ...process.env, DATABASE_URL: dsn },
            }
        );

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
