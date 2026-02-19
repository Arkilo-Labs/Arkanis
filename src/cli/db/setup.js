import { config as dotenvConfig } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const root = join(dirname(__filename), '..', '..', '..');

dotenvConfig({ path: join(root, '.env') });

// 触发 SQLite 初始化（建表）
import('../../core/data/sqliteClient.js').then(({ getDb }) => {
    getDb();
    console.log('[db] SQLite initialized');
    process.exit(0);
}).catch((err) => {
    console.error(err?.stack || err?.message || String(err));
    process.exit(1);
});
