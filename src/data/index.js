/**
 * 数据层模块入口
 */

export { Bar, RawBar } from './models.js';
export {
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
} from './pgClient.js';
export { KlinesRepository, TIMEFRAME_MINUTES } from './klinesRepository.js';
export {
    aggregateBarsByFactor,
    aggregateBarsToHigherTimeframe,
    formatMinutesAsTimeframe,
} from './aggregateBars.js';
export {
    ExchangeClient,
    getExchangeClient,
    closeExchangeClient,
    TIMEFRAME_TO_INTERVAL,
} from './exchangeClient.js';

export { getPrimaryOrganizationForUserId } from './orgRepository.js';
export {
    insertActivationCode,
    lockActivationCodeByHash,
    incrementActivationCodeRedeemedCount,
    insertActivationCodeRedemption,
    listActivationCodes,
    revokeActivationCodeById,
} from './activationCodeRepository.js';
export {
    lockActivationCodeSubscriptionForOrg,
    insertActivationCodeSubscription,
    updateSubscriptionPeriodEnd,
    getSubscriptionById,
    getLatestSubscriptionForOrganizationId,
} from './subscriptionRepository.js';
