/**
 * 结构化上下文管理器
 * 用于高效管理圆桌会议中的信息传递，避免重复和冗余
 */

export class StructuredContext {
    constructor() {
        this.facts = [];
        this.opinions = [];
        this.conflicts = [];
        this.resolved = [];
        this.pendingQuestions = [];
        this._factIdCounter = 0;
        this._opinionIdCounter = 0;
        this._conflictIdCounter = 0;
    }

    addFact({ source, content, confidence = 0.5, category = 'general' }) {
        const id = `f${++this._factIdCounter}`;
        const fact = {
            id,
            source,
            content: String(content || '').trim(),
            confidence: Math.max(0, Math.min(1, Number(confidence) || 0.5)),
            category,
            timestamp: Date.now(),
        };

        // 检查是否已存在相似事实
        const existing = this._findSimilarFact(fact);
        if (existing) {
            // 更新置信度（取较高值）
            existing.confidence = Math.max(existing.confidence, fact.confidence);
            existing.sources = existing.sources || [existing.source];
            if (!existing.sources.includes(source)) {
                existing.sources.push(source);
            }
            return existing;
        }

        this.facts.push(fact);
        return fact;
    }

    addOpinion({ source, direction, reason, confidence = 0.5, priceTargets = null }) {
        const id = `o${++this._opinionIdCounter}`;
        const opinion = {
            id,
            source,
            direction: String(direction || '').toUpperCase(),
            reason: String(reason || '').trim(),
            confidence: Math.max(0, Math.min(1, Number(confidence) || 0.5)),
            priceTargets,
            timestamp: Date.now(),
        };
        this.opinions.push(opinion);
        return opinion;
    }

    addConflict({ factIds = [], opinionIds = [], description, severity = 'medium' }) {
        const id = `c${++this._conflictIdCounter}`;
        const conflict = {
            id,
            factIds: Array.isArray(factIds) ? factIds : [],
            opinionIds: Array.isArray(opinionIds) ? opinionIds : [],
            description: String(description || '').trim(),
            severity,
            resolved: false,
            resolution: null,
            timestamp: Date.now(),
        };
        this.conflicts.push(conflict);
        return conflict;
    }

    resolveConflict(conflictId, resolution) {
        const conflict = this.conflicts.find(c => c.id === conflictId);
        if (conflict) {
            conflict.resolved = true;
            conflict.resolution = String(resolution || '').trim();
            conflict.resolvedAt = Date.now();
            this.resolved.push(conflict);
        }
        return conflict;
    }

    addQuestion(question, askedBy = null) {
        const q = {
            question: String(question || '').trim(),
            askedBy,
            timestamp: Date.now(),
            answered: false,
            answer: null,
        };
        this.pendingQuestions.push(q);
        return q;
    }

    answerQuestion(questionIndex, answer, answeredBy = null) {
        if (questionIndex >= 0 && questionIndex < this.pendingQuestions.length) {
            const q = this.pendingQuestions[questionIndex];
            q.answered = true;
            q.answer = String(answer || '').trim();
            q.answeredBy = answeredBy;
            q.answeredAt = Date.now();
        }
    }

    _findSimilarFact(newFact) {
        const newContent = newFact.content.toLowerCase();
        for (const fact of this.facts) {
            const existingContent = fact.content.toLowerCase();
            // 简单相似度检查：内容包含或高度重叠
            if (existingContent.includes(newContent) || newContent.includes(existingContent)) {
                return fact;
            }
            // 检查关键数值是否相同
            const newNumbers = newContent.match(/[\d.]+/g) || [];
            const existingNumbers = existingContent.match(/[\d.]+/g) || [];
            if (newNumbers.length > 0 && existingNumbers.length > 0) {
                const overlap = newNumbers.filter(n => existingNumbers.includes(n));
                if (overlap.length >= Math.min(newNumbers.length, existingNumbers.length) * 0.8) {
                    return fact;
                }
            }
        }
        return null;
    }

    getUnresolvedConflicts() {
        return this.conflicts.filter(c => !c.resolved);
    }

    getOpinionsByDirection(direction) {
        const dir = String(direction || '').toUpperCase();
        return this.opinions.filter(o => o.direction === dir);
    }

    getConsensusDirection() {
        const directionCounts = {};
        let totalWeight = 0;

        for (const opinion of this.opinions) {
            const dir = opinion.direction;
            if (!directionCounts[dir]) {
                directionCounts[dir] = 0;
            }
            directionCounts[dir] += opinion.confidence;
            totalWeight += opinion.confidence;
        }

        if (totalWeight === 0) return null;

        let maxDir = null;
        let maxWeight = 0;
        for (const [dir, weight] of Object.entries(directionCounts)) {
            if (weight > maxWeight) {
                maxWeight = weight;
                maxDir = dir;
            }
        }

        return {
            direction: maxDir,
            weight: maxWeight,
            ratio: maxWeight / totalWeight,
            isConsensus: maxWeight / totalWeight > 0.6,
        };
    }

    toJSON() {
        return {
            facts: this.facts,
            opinions: this.opinions,
            conflicts: this.conflicts,
            resolved: this.resolved,
            pending_questions: this.pendingQuestions,
            summary: {
                factCount: this.facts.length,
                opinionCount: this.opinions.length,
                unresolvedConflicts: this.getUnresolvedConflicts().length,
                consensus: this.getConsensusDirection(),
            },
        };
    }

    toCompactString() {
        const parts = [];

        if (this.facts.length > 0) {
            parts.push('# 已确认事实');
            for (const f of this.facts) {
                const sources = f.sources ? f.sources.join(',') : f.source;
                parts.push(`- [${f.id}] ${f.content} (来源:${sources}, 置信度:${f.confidence.toFixed(2)})`);
            }
        }

        if (this.opinions.length > 0) {
            parts.push('\n# 各方观点');
            for (const o of this.opinions) {
                const targets = o.priceTargets ? ` 目标:${JSON.stringify(o.priceTargets)}` : '';
                parts.push(`- [${o.id}] ${o.source}: ${o.direction} (置信度:${o.confidence.toFixed(2)})${targets}`);
                if (o.reason) parts.push(`  理由: ${o.reason}`);
            }
        }

        const unresolvedConflicts = this.getUnresolvedConflicts();
        if (unresolvedConflicts.length > 0) {
            parts.push('\n# 未解决分歧');
            for (const c of unresolvedConflicts) {
                parts.push(`- [${c.id}] ${c.description} (严重程度:${c.severity})`);
            }
        }

        if (this.resolved.length > 0) {
            parts.push('\n# 已解决分歧');
            for (const c of this.resolved) {
                parts.push(`- [${c.id}] ${c.description} -> ${c.resolution}`);
            }
        }

        const unanswered = this.pendingQuestions.filter(q => !q.answered);
        if (unanswered.length > 0) {
            parts.push('\n# 待回答问题');
            for (const q of unanswered) {
                parts.push(`- ${q.question}${q.askedBy ? ` (${q.askedBy}提问)` : ''}`);
            }
        }

        return parts.join('\n');
    }

    static fromTranscript(transcript) {
        const ctx = new StructuredContext();
        // 从发言记录中提取结构化信息（简化实现）
        for (const turn of transcript || []) {
            if (!turn.text) continue;
            ctx._extractFromText(turn.text, turn.name);
        }
        return ctx;
    }

    _extractFromText(text, source) {
        // 提取方向性观点
        const directionPatterns = [
            { pattern: /看多|做多|LONG|买入|上涨/i, direction: 'LONG' },
            { pattern: /看空|做空|SHORT|卖出|下跌/i, direction: 'SHORT' },
            { pattern: /观望|等待|WAIT|不操作/i, direction: 'WAIT' },
        ];

        for (const { pattern, direction } of directionPatterns) {
            if (pattern.test(text)) {
                // 尝试提取置信度
                const confMatch = text.match(/置信度[：:]\s*([\d.]+)/);
                const confidence = confMatch ? parseFloat(confMatch[1]) : 0.5;
                this.addOpinion({ source, direction, reason: '', confidence });
                break;
            }
        }

        // 提取数值事实（RSI、价格等）
        const factPatterns = [
            { pattern: /RSI[=：:]\s*([\d.]+)/i, category: 'indicator' },
            { pattern: /MACD[=：:]\s*([\d.-]+)/i, category: 'indicator' },
            { pattern: /支撑位?[=：:]\s*([\d.]+)/i, category: 'price_level' },
            { pattern: /阻力位?[=：:]\s*([\d.]+)/i, category: 'price_level' },
            { pattern: /止损[=：:]\s*([\d.]+)/i, category: 'price_level' },
            { pattern: /止盈[=：:]\s*([\d.]+)/i, category: 'price_level' },
        ];

        for (const { pattern, category } of factPatterns) {
            const match = text.match(pattern);
            if (match) {
                this.addFact({
                    source,
                    content: match[0],
                    category,
                    confidence: 0.8,
                });
            }
        }
    }
}
