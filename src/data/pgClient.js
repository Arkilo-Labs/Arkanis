/**
 * PostgreSQL 连接池封装
 */

import pg from 'pg';
import { databaseConfig } from '../config/index.js';

const { Pool } = pg;

/** @type {Map<string, pg.Pool>} */
const pools = new Map();

/**
 * 创建数据库连接池
 * @param {string} key 连接池标识
 * @param {string} dsn 数据库连接字符串
 * @returns {Promise<pg.Pool>}
 */
export async function createPool(key, dsn) {
    if (pools.has(key)) {
        return pools.get(key);
    }

    const pool = new Pool({
        connectionString: dsn,
        min: databaseConfig.minPoolSize,
        max: databaseConfig.maxPoolSize,
    });

    const client = await pool.connect();
    client.release();

    pools.set(key, pool);
    return pool;
}

/**
 * 获取 Market Data 连接池
 */
export async function getMarketPool() {
    return createPool('market', databaseConfig.marketDsn);
}

/**
 * 获取 Core 连接池
 */
export async function getCorePool() {
    return createPool('core', databaseConfig.coreDsn);
}

/**
 * 关闭全部连接池
 */
export async function closePools() {
    const active = Array.from(pools.entries());
    pools.clear();
    await Promise.all(active.map(([, p]) => p.end()));
}

/**
 * 兼容旧调用：关闭连接池
 */
export async function closePool() {
    await closePools();
}

/**
 * 在 Market Data 执行查询
 * @param {string} sql SQL 语句
 * @param {any[]} params 参数
 * @returns {Promise<pg.QueryResult>}
 */
export async function queryMarket(sql, params = []) {
    const p = await getMarketPool();
    return p.query(sql, params);
}

/**
 * 在 Core 执行查询
 */
export async function queryCore(sql, params = []) {
    const p = await getCorePool();
    return p.query(sql, params);
}

/**
 * 兼容旧调用：默认走 Market Data
 */
export async function query(sql, params = []) {
    return queryMarket(sql, params);
}

/**
 * 获取 Market 连接并执行回调
 * @template T
 * @param {(client: pg.PoolClient) => Promise<T>} callback
 * @returns {Promise<T>}
 */
export async function withMarketConnection(callback) {
    const p = await getMarketPool();
    const client = await p.connect();
    try {
        return await callback(client);
    } finally {
        client.release();
    }
}

/**
 * 获取 Core 连接并执行回调
 * @template T
 * @param {(client: pg.PoolClient) => Promise<T>} callback
 * @returns {Promise<T>}
 */
export async function withCoreConnection(callback) {
    const p = await getCorePool();
    const client = await p.connect();
    try {
        return await callback(client);
    } finally {
        client.release();
    }
}

/**
 * 兼容旧调用：默认走 Market Data
 */
export async function withConnection(callback) {
    return withMarketConnection(callback);
}

export default {
    createPool,
    getMarketPool,
    getCorePool,
    closePool,
    closePools,
    queryMarket,
    queryCore,
    query,
    withMarketConnection,
    withCoreConnection,
    withConnection,
};
