/**
 * 币安交易所 API 客户端
 */

import axios from 'axios';
import { RawBar } from './models.js';
import logger from '../utils/logger.js';

// 时间周期到 API interval 字符串的映射
export const TIMEFRAME_TO_INTERVAL = {
    '1m': '1m',
    '3m': '3m',
    '5m': '5m',
    '15m': '15m',
    '30m': '30m',
    '1h': '1h',
    '2h': '2h',
    '4h': '4h',
    '6h': '6h',
    '8h': '8h',
    '12h': '12h',
    '1d': '1d',
};

/**
 * 币安交易所 API 客户端
 */
export class ExchangeClient {
    /**
     * @param {Object} options
     * @param {string} [options.baseUrl] 基础 URL
     * @param {string} [options.klinesEndpoint] K 线接口路径
     * @param {number} [options.timeout] 超时时间 (毫秒)
     */
    constructor({
        baseUrl = 'https://fapi.binance.com',
        klinesEndpoint = '/fapi/v1/klines',
        timeout = 20000,
    } = {}) {
        this.baseUrl = baseUrl;
        this.klinesEndpoint = klinesEndpoint;
        this.client = axios.create({
            baseURL: baseUrl,
            timeout,
        });
    }

    /**
     * 从币安获取 K 线数据
     * @param {Object} params
     * @param {string} params.symbol 交易对
     * @param {string} params.interval K 线周期
     * @param {number} params.startMs 开始时间 (毫秒)
     * @param {number} [params.endMs] 结束时间 (毫秒)
     * @param {number} [params.limit] 每次请求数量
     * @returns {Promise<RawBar[]>}
     */
    async fetchKlines({ symbol, interval, startMs, endMs = null, limit = 1000 }) {
        if (!TIMEFRAME_TO_INTERVAL[interval]) {
            throw new Error(`不支持的时间周期: ${interval}`);
        }

        const url = this.klinesEndpoint;
        const allBars = [];
        let currentStart = startMs;

        while (true) {
            const params = {
                symbol: symbol.toUpperCase(),
                interval,
                startTime: currentStart,
                limit: Math.min(limit, 1000),
            };

            if (endMs !== null) {
                params.endTime = endMs;
            }

            try {
                const response = await this.client.get(url, { params });
                const klines = response.data;

                if (!klines || klines.length === 0) {
                    break;
                }

                // 币安 K 线格式: [开盘时间, 开, 高, 低, 收, 成交量, 收盘时间, ...]
                for (const k of klines) {
                    const bar = new RawBar({
                        tsMs: k[0],
                        open: parseFloat(k[1]),
                        high: parseFloat(k[2]),
                        low: parseFloat(k[3]),
                        close: parseFloat(k[4]),
                        volume: parseFloat(k[5]),
                    });
                    allBars.push(bar);
                }

                const lastOpenTime = klines[klines.length - 1][0];

                // 检查是否还需要继续获取
                if (klines.length < limit) {
                    break;
                }
                if (endMs !== null && lastOpenTime >= endMs) {
                    break;
                }

                // 下一批从最后一条之后开始
                currentStart = lastOpenTime + 1;
            } catch (error) {
                logger.error(`获取 K 线数据失败: ${error.message}`);
                break;
            }
        }

        logger.info(`从币安获取 ${symbol} ${interval} K 线 ${allBars.length} 条`);
        return allBars;
    }
}

// 全局客户端实例
let exchangeClient = null;

function resolveBinanceApiConfig() {
    const market = String(process.env.BINANCE_MARKET || 'futures').trim().toLowerCase();
    if (market === 'spot') {
        return { baseUrl: 'https://api.binance.com', klinesEndpoint: '/api/v3/klines' };
    }
    return { baseUrl: 'https://fapi.binance.com', klinesEndpoint: '/fapi/v1/klines' };
}

/**
 * 获取全局交易所客户端
 * @returns {ExchangeClient}
 */
export function getExchangeClient() {
    if (exchangeClient === null) {
        const { baseUrl, klinesEndpoint } = resolveBinanceApiConfig();
        exchangeClient = new ExchangeClient({ baseUrl, klinesEndpoint });
    }
    return exchangeClient;
}

/**
 * 关闭全局交易所客户端
 */
export function closeExchangeClient() {
    exchangeClient = null;
}

export default {
    ExchangeClient,
    getExchangeClient,
    closeExchangeClient,
    TIMEFRAME_TO_INTERVAL,
};
