/**
 * 贝叶斯信念追踪器
 * 用于校准各 Agent 的置信度，量化决策过程中的不确定性
 */

export class BeliefTracker {
    constructor({ agentAccuracy = {} } = {}) {
        // 初始先验概率
        this.priors = {
            LONG: 0.33,
            SHORT: 0.33,
            WAIT: 0.34,
        };
        // 当前后验概率
        this.posteriors = { ...this.priors };
        // Agent 历史准确率（从历史数据加载或使用默认值）
        this.agentAccuracy = agentAccuracy;
        // 更新历史记录
        this.updateHistory = [];
    }

    _getAgentAccuracy(agentName, direction) {
        const agentData = this.agentAccuracy[agentName];
        if (!agentData) return 0.5;
        return agentData[direction] ?? agentData.default ?? 0.5;
    }

    _normalize(beliefs) {
        const total = Object.values(beliefs).reduce((sum, v) => sum + v, 0);
        if (total === 0) return beliefs;
        const normalized = {};
        for (const [key, value] of Object.entries(beliefs)) {
            normalized[key] = value / total;
        }
        return normalized;
    }

    update(agentName, direction, confidence) {
        const dir = String(direction || '').toUpperCase();
        if (!['LONG', 'SHORT', 'WAIT'].includes(dir)) return;

        const conf = Math.max(0.1, Math.min(0.95, Number(confidence) || 0.5));
        const accuracy = this._getAgentAccuracy(agentName, dir);

        // 贝叶斯更新
        // P(direction|evidence) = P(evidence|direction) * P(direction) / P(evidence)
        const newBeliefs = {};

        for (const [d, prior] of Object.entries(this.posteriors)) {
            if (d === dir) {
                // Agent 预测的方向：likelihood = accuracy * confidence
                const likelihood = accuracy * conf + (1 - accuracy) * (1 - conf);
                newBeliefs[d] = likelihood * prior;
            } else {
                // 其他方向：likelihood = (1 - accuracy) * (1 - confidence) / 2
                const likelihood = (1 - accuracy * conf) / 2;
                newBeliefs[d] = likelihood * prior;
            }
        }

        this.posteriors = this._normalize(newBeliefs);

        this.updateHistory.push({
            agent: agentName,
            direction: dir,
            confidence: conf,
            accuracy,
            posteriors: { ...this.posteriors },
            timestamp: Date.now(),
        });

        return this.posteriors;
    }

    getPosterior() {
        return { ...this.posteriors };
    }

    getMostLikelyDirection() {
        let maxDir = null;
        let maxProb = 0;

        for (const [dir, prob] of Object.entries(this.posteriors)) {
            if (prob > maxProb) {
                maxProb = prob;
                maxDir = dir;
            }
        }

        return {
            direction: maxDir,
            probability: maxProb,
            isConfident: maxProb > 0.6,
            isHighConfidence: maxProb > 0.75,
        };
    }

    getConsensusStrength() {
        const probs = Object.values(this.posteriors);
        const max = Math.max(...probs);
        // 共识强度：最大概率与平均概率的差距
        const avg = probs.reduce((a, b) => a + b, 0) / probs.length;
        return {
            strength: max - avg,
            entropy: this._calculateEntropy(probs),
            isConsensus: max > 0.5,
        };
    }

    _calculateEntropy(probs) {
        let entropy = 0;
        for (const p of probs) {
            if (p > 0) {
                entropy -= p * Math.log2(p);
            }
        }
        return entropy;
    }

    calibrateConfidence(agentName, rawConfidence, direction) {
        const accuracy = this._getAgentAccuracy(agentName, direction);
        // 校准公式：考虑 Agent 历史准确率
        // 如果 Agent 历史上过于自信（准确率低于置信度），则降低置信度
        const calibrationFactor = accuracy / 0.5;
        const calibrated = rawConfidence * Math.min(1, calibrationFactor);
        return Math.max(0.1, Math.min(0.95, calibrated));
    }

    toJSON() {
        return {
            priors: this.priors,
            posteriors: this.posteriors,
            mostLikely: this.getMostLikelyDirection(),
            consensus: this.getConsensusStrength(),
            updateCount: this.updateHistory.length,
            history: this.updateHistory.slice(-10),
        };
    }

    toSummaryString() {
        const { direction, probability, isConfident } = this.getMostLikelyDirection();
        const { strength, isConsensus } = this.getConsensusStrength();

        const lines = [
            `# 贝叶斯信念状态`,
            `- 最可能方向: ${direction} (${(probability * 100).toFixed(1)}%)`,
            `- 置信水平: ${isConfident ? '高' : '低'}`,
            `- 共识强度: ${(strength * 100).toFixed(1)}% (${isConsensus ? '已形成共识' : '分歧较大'})`,
            ``,
            `# 各方向概率`,
            `- LONG: ${(this.posteriors.LONG * 100).toFixed(1)}%`,
            `- SHORT: ${(this.posteriors.SHORT * 100).toFixed(1)}%`,
            `- WAIT: ${(this.posteriors.WAIT * 100).toFixed(1)}%`,
        ];

        return lines.join('\n');
    }

    reset() {
        this.posteriors = { ...this.priors };
        this.updateHistory = [];
    }

    static loadAgentAccuracy(historyData) {
        // 从历史决策数据计算各 Agent 的准确率
        const accuracy = {};

        for (const record of historyData || []) {
            const contributions = record.agent_contributions || {};
            const actualDirection = record.outcome?.actual_direction;

            if (!actualDirection) continue;

            for (const [agentName, contrib] of Object.entries(contributions)) {
                if (!accuracy[agentName]) {
                    accuracy[agentName] = {
                        LONG: { correct: 0, total: 0 },
                        SHORT: { correct: 0, total: 0 },
                        WAIT: { correct: 0, total: 0 },
                    };
                }

                const predicted = contrib.prediction;
                if (predicted && accuracy[agentName][predicted]) {
                    accuracy[agentName][predicted].total++;
                    if (predicted === actualDirection) {
                        accuracy[agentName][predicted].correct++;
                    }
                }
            }
        }

        // 转换为准确率
        const result = {};
        for (const [agentName, dirs] of Object.entries(accuracy)) {
            result[agentName] = {};
            for (const [dir, stats] of Object.entries(dirs)) {
                if (stats.total > 0) {
                    result[agentName][dir] = stats.correct / stats.total;
                } else {
                    result[agentName][dir] = 0.5;
                }
            }
        }

        return result;
    }
}
