/**
 * K 线数据仓储
 * 当本地数据不足时，自动从交易所获取并存储
 */

import { marketDataConfig } from '../config/index.js';
import { Bar, RawBar } from './models.js';
import { query, withConnection } from './pgClient.js';
import { getExchangeClient } from './exchangeClient.js';
import logger from '../utils/logger.js';

// 时间周期到分钟数的映射
export const TIMEFRAME_MINUTES = {
    '1m': 1,
    '3m': 3,
    '5m': 5,
    '15m': 15,
    '30m': 30,
    '1h': 60,
    '2h': 120,
    '4h': 240,
    '6h': 360,
    '8h': 480,
    '12h': 720,
    '1d': 1440,
};

/**
 * K 线数据仓储
 */
export class KlinesRepository {
    /**
     * @param {Object} options
     * @param {string} [options.tableName] 数据表名
     * @param {boolean} [options.autoFill] 是否自动从交易所补全数据
     */
    constructor({ tableName = null, autoFill = true } = {}) {
        this.tableName = tableName || marketDataConfig.tableName;
        this.cfg = marketDataConfig;
        this.autoFill = autoFill;
    }

    /**
     * 获取 K 线数据
     * @param {Object} params
     * @param {string} params.symbol 交易对
     * @param {string} params.timeframe 时间周期
     * @param {Date} [params.endTime] 结束时间
     * @param {number} [params.limit] K 线数量
     * @param {boolean} [params.forceUpdate] 强制更新最新数据
     * @returns {Promise<Bar[]>}
     */
    async getBars({ symbol, timeframe, endTime = null, limit = 200, forceUpdate = false }) {
        if (!TIMEFRAME_MINUTES[timeframe]) {
            throw new Error(`不支持的 timeframe: ${timeframe}，可选: ${Object.keys(TIMEFRAME_MINUTES).join(', ')}`);
        }

        const tfMinutes = TIMEFRAME_MINUTES[timeframe];

        // 统一按 UTC 处理
        const actualEndTime = endTime ? new Date(endTime) : new Date();
        const requiredStart = new Date(actualEndTime.getTime() - limit * tfMinutes * 60 * 1000);

        // 如果启用forceUpdate且没有指定endTime，强制拉取最新数据
        if (forceUpdate && !endTime && this.autoFill) {
            const now = new Date();
            const updateStartTime = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 最近24小时
            
            logger.info(`强制从交易所更新 ${symbol} 最近24小时数据...`);
            await this._fillFromExchange(symbol, timeframe, updateStartTime, now);
        }

        // 使用时间范围查询
        let rawBars = await this._fetchRawBarsByRange(symbol, requiredStart, actualEndTime);
        let resampled = rawBars.length ? this._resample(rawBars, tfMinutes) : [];

        // 检查是否数据不足
        if (resampled.length < limit && this.autoFill) {
            logger.info(`${symbol} ${timeframe} 数据不足: ${resampled.length}/${limit}，尝试从交易所补全`);

            await this._fillFromExchange(symbol, timeframe, requiredStart, actualEndTime);

            rawBars = await this._fetchRawBarsByRange(symbol, requiredStart, actualEndTime);
            resampled = rawBars.length ? this._resample(rawBars, tfMinutes) : [];
        }

        return resampled.length > limit ? resampled.slice(-limit) : resampled;
    }

    /**
     * 按时间范围获取 K 线数据
     * @param {Object} params
     * @param {string} params.symbol 交易对
     * @param {string} params.timeframe 时间周期
     * @param {Date} params.startTime 开始时间
     * @param {Date} params.endTime 结束时间
     * @returns {Promise<Bar[]>}
     */
    async getBarsByRange({ symbol, timeframe, startTime, endTime }) {
        if (!TIMEFRAME_MINUTES[timeframe]) {
            throw new Error(`不支持的 timeframe: ${timeframe}`);
        }

        const tfMinutes = TIMEFRAME_MINUTES[timeframe];

        let rawBars = await this._fetchRawBarsByRange(symbol, startTime, endTime);

        if (!rawBars.length && this.autoFill) {
            logger.info(`${symbol} ${timeframe} 时间范围内无数据，尝试从交易所补全`);
            await this._fillFromExchange(symbol, timeframe, startTime, endTime);
            rawBars = await this._fetchRawBarsByRange(symbol, startTime, endTime);
        }

        if (!rawBars.length) {
            return [];
        }

        return this._resample(rawBars, tfMinutes);
    }

    /**
     * 从交易所获取数据并存入数据库
     * @private
     */
    async _fillFromExchange(symbol, timeframe, startTime, endTime) {
        try {
            const client = getExchangeClient();
            const startMs = startTime.getTime();
            const endMs = endTime.getTime();

            // 使用 1m 数据存储
            const bars = await client.fetchKlines({
                symbol,
                interval: '1m',
                startMs,
                endMs,
            });

            if (bars.length) {
                await this._saveBarsToDb(symbol, bars);
                logger.info(`成功从交易所补全 ${symbol} ${bars.length} 条 1m K 线`);
            }
        } catch (error) {
            logger.error(`从交易所补全数据失败: ${error.message}`);
        }
    }

    /**
     * 批量保存 K 线到数据库
     * @private
     */
    async _saveBarsToDb(symbol, bars) {
        if (!bars.length) return;

        const cfg = this.cfg;
        const intervalMs = 60 * 1000; // 1分钟

        // 使用事务批量插入
        await withConnection(async (client) => {
            const sql = `
        INSERT INTO ${this.tableName} 
          (${cfg.symbolCol}, ${cfg.timeCol}, kline_close_time, 
           ${cfg.openCol}, ${cfg.highCol}, ${cfg.lowCol}, ${cfg.closeCol}, 
           ${cfg.volumeCol}, is_kline_closed)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (${cfg.symbolCol}, ${cfg.timeCol}) DO NOTHING
      `;

            for (const bar of bars) {
                await client.query(sql, [
                    symbol.toUpperCase(),
                    bar.tsMs,
                    bar.tsMs + intervalMs - 1,
                    bar.open,
                    bar.high,
                    bar.low,
                    bar.close,
                    bar.volume,
                    1,
                ]);
            }
        });
    }

    /**
     * 按时间范围获取原始 K 线数据
     * @private
     */
    async _fetchRawBarsByRange(symbol, startTime, endTime) {
        const cfg = this.cfg;
        const startTsMs = startTime.getTime();
        const endTsMs = endTime.getTime();

        const sql = `
      SELECT ${cfg.timeCol}, ${cfg.openCol}, ${cfg.highCol}, 
             ${cfg.lowCol}, ${cfg.closeCol}, ${cfg.volumeCol}
      FROM ${this.tableName}
      WHERE ${cfg.symbolCol} = $1 
        AND ${cfg.timeCol} >= $2 
        AND ${cfg.timeCol} <= $3
      ORDER BY ${cfg.timeCol} ASC
    `;

        const result = await query(sql, [symbol, startTsMs, endTsMs]);

        return result.rows.map(
            (row) =>
                new RawBar({
                    tsMs: parseInt(row[cfg.timeCol], 10),
                    open: parseFloat(row[cfg.openCol]),
                    high: parseFloat(row[cfg.highCol]),
                    low: parseFloat(row[cfg.lowCol]),
                    close: parseFloat(row[cfg.closeCol]),
                    volume: parseFloat(row[cfg.volumeCol]),
                })
        );
    }

    /**
     * 将分钟级原始数据重采样为指定周期
     * @private
     * @param {RawBar[]} rawBars 原始 K 线数据
     * @param {number} tfMinutes 目标时间周期 (分钟)
     * @returns {Bar[]}
     */
    _resample(rawBars, tfMinutes) {
        if (!rawBars.length) return [];

        // 1分钟数据直接返回
        if (tfMinutes === 1) {
            return rawBars.map((bar) => bar.toBar());
        }

        const tfMs = tfMinutes * 60 * 1000;

        // 按时间周期分组
        const groups = new Map();
        for (const bar of rawBars) {
            // 对齐到时间周期的起始点
            const bucket = Math.floor(bar.tsMs / tfMs) * tfMs;
            if (!groups.has(bucket)) {
                groups.set(bucket, []);
            }
            groups.get(bucket).push(bar);
        }

        // 聚合每个分组
        const result = [];
        const sortedBuckets = Array.from(groups.keys()).sort((a, b) => a - b);

        for (const bucketTs of sortedBuckets) {
            const barsInBucket = groups.get(bucketTs);

            // OHLCV 聚合
            const aggBar = new Bar({
                ts: new Date(bucketTs),
                open: barsInBucket[0].open,
                high: Math.max(...barsInBucket.map((b) => b.high)),
                low: Math.min(...barsInBucket.map((b) => b.low)),
                close: barsInBucket[barsInBucket.length - 1].close,
                volume: barsInBucket.reduce((sum, b) => sum + b.volume, 0),
            });
            result.push(aggBar);
        }

        return result;
    }

    /**
     * 获取数据库中可用的交易对列表
     * @param {number} [limit] 返回数量限制
     * @returns {Promise<string[]>}
     */
    async getAvailableSymbols(limit = 100) {
        const cfg = this.cfg;
        const sql = `
      SELECT ${cfg.symbolCol}, COUNT(*) as cnt
      FROM ${this.tableName}
      GROUP BY ${cfg.symbolCol}
      ORDER BY cnt DESC
      LIMIT $1
    `;

        const result = await query(sql, [limit]);
        return result.rows.map((row) => row[cfg.symbolCol]);
    }
}

export default KlinesRepository;
