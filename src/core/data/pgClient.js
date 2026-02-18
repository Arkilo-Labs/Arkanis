/**
 * 兼容层：原 PostgreSQL 接口，现在路由到 SQLite / 内存实现
 * 外部调用方（roundtable、lens 等）通过此文件导入 closePools / closePool，无需修改
 */

import { closeDb } from './sqliteClient.js';

export async function closePools() {
    await closeDb();
}

export async function closePool() {
    await closeDb();
}

// 以下函数在迁移后不再被调用，保留签名以防第三方或未来使用
export async function createPool() {}
export async function getMarketPool() { return null; }
export async function getCorePool() { return null; }
export async function queryMarket() { return { rows: [] }; }
export async function queryCore() { return { rows: [] }; }
export async function query() { return { rows: [] }; }
export async function withMarketConnection(callback) { return callback(null); }
export async function withCoreConnection(callback) { return callback(null); }
export async function withConnection(callback) { return callback(null); }

export default {
    closePools,
    closePool,
    createPool,
    getMarketPool,
    getCorePool,
    queryMarket,
    queryCore,
    query,
    withMarketConnection,
    withCoreConnection,
    withConnection,
};
