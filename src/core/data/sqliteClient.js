/**
 * SQLite 客户端单例
 * 提供 app_kv 持久化存储（SQLite）
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { dirname, isAbsolute, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = resolve(dirname(__filename), '..', '..', '..');

/** @type {Database.Database|null} */
let _db = null;

/**
 * 解析 DB 路径规则（优先级从高到低）：
 * 1. DB_PATH=:memory:        → 原样保留，使用内存数据库
 * 2. DB_PATH=/absolute/path  → 绝对路径，直接使用
 * 3. DB_PATH=./rel/path      → 相对路径，按项目根解析（非 cwd）
 * 4. 未设置 DB_PATH          → ARKANIS_DATA_DIR/arkanis.db（或 projectRoot/data/arkanis.db）
 */
function resolveDbPath() {
    const envPath = String(process.env.DB_PATH || '').trim();

    if (envPath) {
        if (envPath === ':memory:') return ':memory:';
        return isAbsolute(envPath) ? envPath : resolve(PROJECT_ROOT, envPath);
    }

    const rawDataDir = String(process.env.ARKANIS_DATA_DIR || '').trim();
    const dataDir = rawDataDir
        ? (isAbsolute(rawDataDir) ? rawDataDir : resolve(PROJECT_ROOT, rawDataDir))
        : (existsSync('/data') ? '/data' : resolve(PROJECT_ROOT, 'data'));

    return resolve(dataDir, 'arkanis.db');
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
    if (dbPath !== ':memory:') {
        mkdirSync(dirname(dbPath), { recursive: true });
    }

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
 * 读取 KV 条目，统一 JSON 反序列化
 * @param {string} key
 * @returns {any|null}
 */
export function queryKv(key) {
    if (!key) throw new Error('queryKv: key 不能为空');
    const row = getDb().prepare('SELECT value FROM app_kv WHERE key = ?').get(key);
    if (!row) return null;
    try {
        return JSON.parse(row.value);
    } catch {
        // 兼容历史非 JSON 数据
        return row.value;
    }
}

/**
 * 写入/更新 KV 条目，统一 JSON 序列化避免类型漂移
 * @param {string} key
 * @param {any} value
 */
export function upsertKv(key, value) {
    if (!key) throw new Error('upsertKv: key 不能为空');
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
        throw new Error('upsertKv: value 无法序列化为 JSON（请避免 undefined/function/symbol）');
    }
    getDb()
        .prepare(`
            INSERT INTO app_kv (key, value, updated_at)
            VALUES (?, ?, unixepoch())
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = unixepoch()
        `)
        .run(key, serialized);
}

export default { getDb, closeDb, queryKv, upsertKv };
