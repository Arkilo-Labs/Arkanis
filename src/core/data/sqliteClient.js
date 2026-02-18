/**
 * SQLite 客户端单例
 * 提供 app_kv 持久化存储，替代 PostgreSQL
 */

import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** @type {Database.Database|null} */
let _db = null;

function resolveDbPath() {
    const envPath = process.env.DB_PATH;
    if (envPath) return resolve(envPath);
    // 默认：项目根目录 data/arkanis.db
    return resolve(__dirname, '..', '..', '..', 'data', 'arkanis.db');
}

function initSchema(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS app_kv (
            key        TEXT    PRIMARY KEY,
            value      TEXT    NOT NULL,
            updated_at INTEGER NOT NULL DEFAULT (unixepoch())
        )
    `);
}

/**
 * 获取 SQLite 数据库实例（懒初始化）
 * @returns {Database.Database}
 */
export function getDb() {
    if (_db) return _db;

    const dbPath = resolveDbPath();
    mkdirSync(dirname(dbPath), { recursive: true });

    _db = new Database(dbPath);
    _db.pragma('journal_mode = WAL');
    _db.pragma('synchronous = NORMAL');
    initSchema(_db);
    return _db;
}

/**
 * 关闭数据库连接
 */
export async function closeDb() {
    if (_db) {
        _db.close();
        _db = null;
    }
}

/**
 * 读取 KV 条目
 * @param {string} key
 * @returns {any|null}
 */
export function queryKv(key) {
    const row = getDb().prepare('SELECT value FROM app_kv WHERE key = ?').get(key);
    if (!row) return null;
    try {
        return JSON.parse(row.value);
    } catch {
        return row.value;
    }
}

/**
 * 写入/更新 KV 条目
 * @param {string} key
 * @param {any} value
 */
export function upsertKv(key, value) {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    getDb()
        .prepare(`
            INSERT INTO app_kv (key, value, updated_at)
            VALUES (?, ?, unixepoch())
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = unixepoch()
        `)
        .run(key, serialized);
}

export default { getDb, closeDb, queryKv, upsertKv };
