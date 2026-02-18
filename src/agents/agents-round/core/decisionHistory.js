import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

/**
 * 历史决策记录管理器
 * 用于记录、存储和分析历史交易决策
 */
export class DecisionHistory {
    constructor({ historyDir, maxRecords = 1000 } = {}) {
        this.historyDir = historyDir;
        this.maxRecords = maxRecords;
        this.records = [];
        this._loaded = false;
    }

    _ensureDir() {
        if (this.historyDir && !existsSync(this.historyDir)) {
            mkdirSync(this.historyDir, { recursive: true });
        }
    }

    _getHistoryFilePath() {
        return this.historyDir ? join(this.historyDir, 'decision_history.json') : null;
    }

    load() {
        if (this._loaded) return this.records;

        const filePath = this._getHistoryFilePath();
        if (!filePath || !existsSync(filePath)) {
            this._loaded = true;
            return this.records;
        }

        try {
            const content = readFileSync(filePath, 'utf-8');
            const data = JSON.parse(content);
            this.records = Array.isArray(data.records) ? data.records : [];
            this._loaded = true;
        } catch (e) {
            this.records = [];
            this._loaded = true;
        }

        return this.records;
    }

    save() {
        const filePath = this._getHistoryFilePath();
        if (!filePath) return false;

        this._ensureDir();

        // 限制记录数量
        if (this.records.length > this.maxRecords) {
            this.records = this.records.slice(-this.maxRecords);
        }

        try {
            const data = {
                version: 1,
                updated_at: new Date().toISOString(),
                record_count: this.records.length,
                records: this.records,
            };
            writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
            return true;
        } catch (e) {
            return false;
        }
    }

    addRecord({
        sessionId,
        symbol,
        timeframe,
        decision,
        agentContributions,
        beliefState,
        structuredContext,
        transcript: _transcript,
    }) {
        this.load();

        const record = {
            session_id: sessionId,
            symbol,
            timeframe,
            created_at: new Date().toISOString(),
            decision: {
                signal: decision?.signal ?? null,
                direction: decision?.direction ?? null,
                entry: decision?.entry ?? null,
                stop_loss: decision?.stop_loss ?? decision?.stopLoss ?? null,
                take_profit: decision?.take_profit ?? decision?.takeProfit ?? null,
                confidence: decision?.confidence ?? null,
                rr_ratio: decision?.rr_ratio ?? null,
            },
            agent_contributions: agentContributions ?? {},
            belief_state: beliefState ?? null,
            structured_summary: structuredContext ?? null,
            outcome: null,
            outcome_updated_at: null,
        };

        this.records.push(record);
        this.save();

        return record;
    }

    updateOutcome(sessionId, outcome) {
        this.load();

        const record = this.records.find(r => r.session_id === sessionId);
        if (!record) return null;

        record.outcome = {
            actual_high: outcome.actual_high ?? null,
            actual_low: outcome.actual_low ?? null,
            actual_close: outcome.actual_close ?? null,
            hit_tp: outcome.hit_tp ?? null,
            hit_sl: outcome.hit_sl ?? null,
            pnl_percent: outcome.pnl_percent ?? null,
            actual_direction: outcome.actual_direction ?? null,
            notes: outcome.notes ?? null,
        };
        record.outcome_updated_at = new Date().toISOString();

        this.save();
        return record;
    }

    getRecordsBySymbol(symbol) {
        this.load();
        return this.records.filter(r => r.symbol === symbol);
    }

    getRecentRecords(count = 10) {
        this.load();
        return this.records.slice(-count);
    }

    computeAgentAccuracy() {
        this.load();

        const accuracy = {};
        const recordsWithOutcome = this.records.filter(r => r.outcome?.actual_direction);

        for (const record of recordsWithOutcome) {
            const actualDir = record.outcome.actual_direction;
            const contributions = record.agent_contributions || {};

            for (const [agentName, contrib] of Object.entries(contributions)) {
                if (!accuracy[agentName]) {
                    accuracy[agentName] = {
                        LONG: { correct: 0, total: 0 },
                        SHORT: { correct: 0, total: 0 },
                        WAIT: { correct: 0, total: 0 },
                        overall: { correct: 0, total: 0 },
                    };
                }

                const predicted = contrib.direction || contrib.prediction;
                if (predicted) {
                    accuracy[agentName].overall.total++;
                    if (accuracy[agentName][predicted]) {
                        accuracy[agentName][predicted].total++;
                    }

                    if (predicted === actualDir) {
                        accuracy[agentName].overall.correct++;
                        if (accuracy[agentName][predicted]) {
                            accuracy[agentName][predicted].correct++;
                        }
                    }
                }
            }
        }

        // 转换为准确率
        const result = {};
        for (const [agentName, dirs] of Object.entries(accuracy)) {
            result[agentName] = {
                overall: dirs.overall.total > 0
                    ? (dirs.overall.correct / dirs.overall.total).toFixed(3)
                    : null,
                LONG: dirs.LONG.total > 0
                    ? (dirs.LONG.correct / dirs.LONG.total).toFixed(3)
                    : null,
                SHORT: dirs.SHORT.total > 0
                    ? (dirs.SHORT.correct / dirs.SHORT.total).toFixed(3)
                    : null,
                WAIT: dirs.WAIT.total > 0
                    ? (dirs.WAIT.correct / dirs.WAIT.total).toFixed(3)
                    : null,
                sample_size: dirs.overall.total,
            };
        }

        return result;
    }

    computeOverallStats() {
        this.load();

        const total = this.records.length;
        const withOutcome = this.records.filter(r => r.outcome).length;
        const profitable = this.records.filter(r =>
            r.outcome?.pnl_percent != null && r.outcome.pnl_percent > 0
        ).length;
        const hitTp = this.records.filter(r => r.outcome?.hit_tp === true).length;
        const hitSl = this.records.filter(r => r.outcome?.hit_sl === true).length;

        const pnlValues = this.records
            .filter(r => r.outcome?.pnl_percent != null)
            .map(r => r.outcome.pnl_percent);

        const avgPnl = pnlValues.length > 0
            ? pnlValues.reduce((a, b) => a + b, 0) / pnlValues.length
            : null;

        const signalCounts = {};
        for (const r of this.records) {
            const signal = r.decision?.signal || 'UNKNOWN';
            signalCounts[signal] = (signalCounts[signal] || 0) + 1;
        }

        return {
            total_records: total,
            records_with_outcome: withOutcome,
            profitable_trades: profitable,
            win_rate: withOutcome > 0 ? (profitable / withOutcome).toFixed(3) : null,
            hit_tp_count: hitTp,
            hit_sl_count: hitSl,
            average_pnl_percent: avgPnl?.toFixed(2) ?? null,
            signal_distribution: signalCounts,
            agent_accuracy: this.computeAgentAccuracy(),
        };
    }

    generateReport() {
        const stats = this.computeOverallStats();
        const lines = [
            `# 历史决策统计报告`,
            ``,
            `## 总体统计`,
            `- 总记录数: ${stats.total_records}`,
            `- 已回填结果: ${stats.records_with_outcome}`,
            `- 盈利交易: ${stats.profitable_trades}`,
            `- 胜率: ${stats.win_rate ? (parseFloat(stats.win_rate) * 100).toFixed(1) + '%' : 'N/A'}`,
            `- 平均盈亏: ${stats.average_pnl_percent ? stats.average_pnl_percent + '%' : 'N/A'}`,
            `- 触及止盈: ${stats.hit_tp_count}`,
            `- 触及止损: ${stats.hit_sl_count}`,
            ``,
            `## 信号分布`,
        ];

        for (const [signal, count] of Object.entries(stats.signal_distribution)) {
            lines.push(`- ${signal}: ${count}`);
        }

        lines.push(``, `## Agent 准确率`);
        for (const [agent, acc] of Object.entries(stats.agent_accuracy)) {
            const overall = acc.overall ? (parseFloat(acc.overall) * 100).toFixed(1) + '%' : 'N/A';
            lines.push(`- ${agent}: ${overall} (样本: ${acc.sample_size})`);
        }

        return lines.join('\n');
    }
}
