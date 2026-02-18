import { validateRR, formatRRReport } from './rrValidator.js';

/**
 * RR 校验模块单元测试
 */

function test(name, fn) {
    try {
        fn();
        console.log(`[PASS] ${name}`);
    } catch (e) {
        console.error(`[FAIL] ${name}: ${e.message}`);
        process.exitCode = 1;
    }
}

function assertEqual(actual, expected, msg = '') {
    if (actual !== expected) {
        throw new Error(`${msg} Expected ${expected}, got ${actual}`);
    }
}

function assertTrue(condition, msg = '') {
    if (!condition) {
        throw new Error(`${msg} Expected true, got false`);
    }
}

function assertFalse(condition, msg = '') {
    if (condition) {
        throw new Error(`${msg} Expected false, got true`);
    }
}

// 测试用例

test('非 ENTER 信号跳过校验', () => {
    const result = validateRR({ signal: 'WAIT', direction: null });
    assertTrue(result.valid);
    assertTrue(result.skipped);
});

test('LONG 方向 RR 计算正确', () => {
    const result = validateRR({
        signal: 'ENTER',
        direction: 'LONG',
        plan: {
            entry: 'limit@100',
            stop_loss: '90',
            take_profit: '120',
        },
    });
    assertTrue(result.valid);
    assertEqual(result.rr, 2); // (120-100) / (100-90) = 2
});

test('SHORT 方向 RR 计算正确', () => {
    const result = validateRR({
        signal: 'ENTER',
        direction: 'SHORT',
        plan: {
            entry: 100,
            stop_loss: 110,
            take_profit: 85,
        },
    });
    assertTrue(result.valid);
    assertEqual(result.rr, 1.5); // (100-85) / (110-100) = 1.5
});

test('RR 不合格时返回 valid=false', () => {
    const result = validateRR({
        signal: 'ENTER',
        direction: 'LONG',
        plan: {
            entry: 100,
            stop_loss: 90,
            take_profit: 105,
        },
    });
    assertFalse(result.valid);
    assertEqual(result.rr, 0.5); // (105-100) / (100-90) = 0.5
});

test('RR 不合格时提供修正建议', () => {
    const result = validateRR({
        signal: 'ENTER',
        direction: 'LONG',
        plan: {
            entry: 100,
            stop_loss: 90,
            take_profit: 110,
        },
    }, { minRR: 1.5 });

    assertFalse(result.valid);
    assertTrue(result.suggestion !== null);
    assertTrue(result.suggestion.adjustedEntry < 100); // 建议更低的入场价
});

test('Market 订单返回警告', () => {
    const result = validateRR({
        signal: 'ENTER',
        direction: 'LONG',
        plan: {
            entry: 'market',
            stop_loss: 90,
            take_profit: 120,
        },
    });
    assertFalse(result.valid);
    assertTrue(result.warning);
});

test('缺失价格返回错误', () => {
    const result = validateRR({
        signal: 'ENTER',
        direction: 'LONG',
        plan: {
            entry: 100,
            stop_loss: null,
            take_profit: 120,
        },
    });
    assertFalse(result.valid);
    assertTrue(result.reason.includes('止损'));
});

test('自定义 minRR 参数', () => {
    const result = validateRR({
        signal: 'ENTER',
        direction: 'LONG',
        plan: {
            entry: 100,
            stop_loss: 90,
            take_profit: 115,
        },
    }, { minRR: 2.0 });

    assertFalse(result.valid); // RR = 1.5, 不满足 minRR = 2.0
    assertEqual(result.minRR, 2.0);
});

test('formatRRReport 生成 Markdown', () => {
    const result = validateRR({
        signal: 'ENTER',
        direction: 'LONG',
        plan: {
            entry: 100,
            stop_loss: 90,
            take_profit: 105,
        },
    });

    const report = formatRRReport(result);
    assertTrue(report.includes('盈亏比'));
    assertTrue(report.includes('WARNING'));
});

console.log('\n所有测试完成');
