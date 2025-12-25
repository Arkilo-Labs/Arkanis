import test from 'node:test';
import assert from 'node:assert/strict';
import { splitCompactSymbolToCcxtSymbol } from './exchangeClient.js';

test('exchangeClient: compact symbol -> ccxt symbol（常见 quote）', () => {
    assert.equal(splitCompactSymbolToCcxtSymbol('BTCUSDT'), 'BTC/USDT');
    assert.equal(splitCompactSymbolToCcxtSymbol('ethusdc'), 'ETH/USDC');
    assert.equal(splitCompactSymbolToCcxtSymbol('XAUUSD'), 'XAU/USD');
});

test('exchangeClient: 已是 ccxt symbol 时原样返回（仅做规范化）', () => {
    assert.equal(splitCompactSymbolToCcxtSymbol('BTC/USDT'), 'BTC/USDT');
});

test('exchangeClient: 不可识别时返回 null（避免盲猜）', () => {
    assert.equal(splitCompactSymbolToCcxtSymbol('BTCFOO'), null);
    assert.equal(splitCompactSymbolToCcxtSymbol(''), null);
});

