/**
 * PostgreSQL 连接池封装
 */

import pg from 'pg';
import { databaseConfig } from '../config/index.js';

const { Pool } = pg;

/** @type {pg.Pool | null} */
let pool = null;

/**
 * 创建数据库连接池
 * @param {string} [dsn] 数据库连接字符串
 * @returns {Promise<pg.Pool>}
 */
export async function createPool(dsn = null) {
    if (pool !== null) {
        return pool;
    }

    const config = dsn
        ? { connectionString: dsn }
        : {
            host: databaseConfig.host,
            port: databaseConfig.port,
            user: databaseConfig.user,
            password: databaseConfig.password,
            database: databaseConfig.database,
            min: databaseConfig.minPoolSize,
            max: databaseConfig.maxPoolSize,
        };

    pool = new Pool(config);

    // 测试连接
    const client = await pool.connect();
    client.release();

    return pool;
}

/**
 * 获取全局连接池
 * @returns {Promise<pg.Pool>}
 */
export async function getPool() {
    if (pool === null) {
        await createPool();
    }
    return pool;
}

/**
 * 关闭连接池
 */
export async function closePool() {
    if (pool !== null) {
        await pool.end();
        pool = null;
    }
}

/**
 * 执行查询
 * @param {string} sql SQL 语句
 * @param {any[]} params 参数
 * @returns {Promise<pg.QueryResult>}
 */
export async function query(sql, params = []) {
    const p = await getPool();
    return p.query(sql, params);
}

/**
 * 获取连接并执行回调
 * @template T
 * @param {(client: pg.PoolClient) => Promise<T>} callback
 * @returns {Promise<T>}
 */
export async function withConnection(callback) {
    const p = await getPool();
    const client = await p.connect();
    try {
        return await callback(client);
    } finally {
        client.release();
    }
}

export default {
    createPool,
    getPool,
    closePool,
    query,
    withConnection,
};
