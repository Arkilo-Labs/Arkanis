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

/**
 * 以下函数在迁移后不再有效，显式 throw 防止误用后静默错误
 * 若有新的持久化需求，请直接使用 sqliteClient 或 KlinesRepository
 */
function _removed(name) {
    throw new Error(
        `[pgClient] ${name}() 已废弃：数据层已迁移至 SQLite + 内存缓存，请使用 sqliteClient 或 KlinesRepository`,
    );
}

export async function createPool()             { _removed('createPool'); }
export async function getMarketPool()          { _removed('getMarketPool'); }
export async function getCorePool()            { _removed('getCorePool'); }
export async function queryMarket()            { _removed('queryMarket'); }
export async function queryCore()              { _removed('queryCore'); }
export async function query()                  { _removed('query'); }
export async function withMarketConnection()   { _removed('withMarketConnection'); }
export async function withCoreConnection()     { _removed('withCoreConnection'); }
export async function withConnection()         { _removed('withConnection'); }

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
