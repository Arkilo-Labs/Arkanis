import test from 'node:test';
import assert from 'node:assert/strict';

import { summarizeTranscriptEntry } from './summaryRules.js';

test('summarizeTranscriptEntry: 解析决策 JSON 字段', () => {
    const text = [
        '```json',
        '{',
        '  "consensus": true,',
        '  "signal": "WAIT",',
        '  "direction": null,',
        '  "confidence": 0.61,',
        '  "next_speaker": null',
        '}',
        '```',
    ].join('\n');

    const result = summarizeTranscriptEntry({ role: 'DecisionMaker', text });
    assert.equal(result.title, '决策更新');
    assert.ok(result.highlights.some((line) => line.includes('共识: 已达成')));
    assert.ok(result.highlights.some((line) => line.includes('信号: WAIT')));
});

test('summarizeTranscriptEntry: 提取关键句与争论标签', () => {
    const text = [
        '## 技术分析师',
        '- 立场：SHORT',
        '- 结论：价格靠近阻力位，短线偏空',
        '我不同意风控经理的观点，需要更多成交量验证。',
    ].join('\n');

    const result = summarizeTranscriptEntry({ role: 'TechnicalTrader', text });
    assert.equal(result.title, '技术分析师');
    assert.ok(result.highlights.some((line) => line.includes('立场')));
    assert.equal(result.isDebateNode, true);
    assert.ok(result.tags.includes('争论节点'));
});

test('summarizeTranscriptEntry: 无结构文本也能返回稳定摘要', () => {
    const text = '当前市场波动较大，建议继续等待确认信号。';
    const result = summarizeTranscriptEntry({ role: 'RiskManager', text });
    assert.equal(typeof result.title, 'string');
    assert.ok(Array.isArray(result.highlights));
    assert.ok(Array.isArray(result.tags));
});
