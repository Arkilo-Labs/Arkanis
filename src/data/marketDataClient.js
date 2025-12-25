/**
 * 统一市场数据客户端
 *
 * 根据 assetClass 自动路由到对应的数据源：
 * - crypto -> ccxt (ExchangeClient)
 * - stock/forex/commodity -> yahoo-finance2 (YahooFinanceClient)
 */

import { getExchangeClient, closeExchangeClient } from './exchangeClient.js';
import { getYahooFinanceClient, closeYahooFinanceClient, normalizeToYahooSymbol } from './yahooFinanceClient.js';

// 资产类型列表
const CRYPTO_ASSET_CLASS = 'crypto';
const YAHOO_ASSET_CLASSES = ['stock', 'forex', 'commodity', 'index'];

// Symbol 到资产类型的自动检测规则
const COMMODITY_SYMBOLS = ['XAUUSD', 'XAGUSD', 'XPTUSD', 'XPDUSD', 'WTIUSD', 'BRENTUSD'];
const FOREX_PREFIXES = ['EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD', 'CNY', 'HKD'];

/**
 * 自动检测 symbol 对应的资产类型
 */
export function detectAssetClass(symbol) {
    const s = String(symbol || '').trim().toUpperCase();
    if (!s) return CRYPTO_ASSET_CLASS;

    // 贵金属/商品期货
    if (COMMODITY_SYMBOLS.includes(s)) {
        return 'commodity';
    }

    // 外汇检测
    for (const currency of FOREX_PREFIXES) {
        if ((s.startsWith(currency) && s.endsWith('USD') && s.length === 6) ||
            (s.startsWith('USD') && s.endsWith(currency) && s.length === 6)) {
            return 'forex';
        }
    }

    // A股/港股检测（纯数字）
    if (/^\d{4,6}$/.test(s)) {
        return 'stock';
    }

    // 常见 crypto 交易对后缀
    const cryptoQuotes = ['USDT', 'USDC', 'USD', 'BUSD', 'BTC', 'ETH'];
    for (const quote of cryptoQuotes) {
        if (s.endsWith(quote) && s.length > quote.length) {
            return CRYPTO_ASSET_CLASS;
        }
    }

    // 默认当作股票（美股等）
    if (/^[A-Z]{1,5}$/.test(s)) {
        return 'stock';
    }

    return CRYPTO_ASSET_CLASS;
}

/**
 * 获取统一的市场数据客户端
 *
 * @param {Object} options
 * @param {string} [options.symbol] 用于自动检测资产类型
 * @param {string} [options.assetClass] 资产类型：crypto|stock|forex|commodity
 * @param {string} [options.exchangeId] 交易所 ID（仅 crypto 有效）
 * @param {string} [options.marketType] 市场类型（仅 crypto 有效）
 * @param {string[]} [options.fallbackExchangeIds] 备用交易所（仅 crypto 有效）
 * @param {Object} [options.logger]
 * @returns {ExchangeClient|YahooFinanceClient}
 */
export function getMarketDataClient(options = {}) {
    let assetClass = options.assetClass;

    // 如果未指定 assetClass，根据 symbol 自动检测
    if (!assetClass && options.symbol) {
        assetClass = detectAssetClass(options.symbol);
    }

    assetClass = String(assetClass || CRYPTO_ASSET_CLASS).toLowerCase();

    // Yahoo 数据源
    if (YAHOO_ASSET_CLASSES.includes(assetClass)) {
        return getYahooFinanceClient({
            assetClass,
            logger: options.logger,
        });
    }

    // Crypto 数据源 (ccxt)
    return getExchangeClient({
        exchangeId: options.exchangeId,
        assetClass,
        marketType: options.marketType,
        fallbackExchangeIds: options.fallbackExchangeIds,
        logger: options.logger,
    });
}

/**
 * 关闭所有市场数据客户端
 */
export async function closeAllMarketDataClients() {
    await Promise.allSettled([
        closeExchangeClient(),
        closeYahooFinanceClient(),
    ]);
}

export default {
    getMarketDataClient,
    closeAllMarketDataClients,
    detectAssetClass,
};
