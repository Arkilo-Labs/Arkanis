import { useMemo, useState } from 'react';

function formatConfidence(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return '--';
    return `${(num * 100).toFixed(0)}%`;
}

function normalizeList(value) {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => String(item || '').trim())
        .filter(Boolean);
}

function readPlanValue(plan, keys) {
    for (const key of keys) {
        const value = plan?.[key];
        if (value == null) continue;
        const text = String(value).trim();
        if (text) return text;
    }
    return '--';
}

function stageLabel(stage) {
    if (stage === 'final') return '最终决策';
    if (stage === 'draft') return '讨论草案';
    return '决策更新';
}

function stageBadgeClass(stage) {
    if (stage === 'final') return 'badge-success';
    if (stage === 'draft') return 'badge-accent';
    return 'badge-muted';
}

export default function DecisionResultCard({
    finalDecision,
    draftDecision,
    isRunning,
    processExit,
}) {
    const [showAllRationales, setShowAllRationales] = useState(false);
    const [showAllInvalidIf, setShowAllInvalidIf] = useState(false);

    const activeDecision = useMemo(() => {
        if (finalDecision) return { ...finalDecision, stage: 'final' };
        if (draftDecision) return { ...draftDecision, stage: 'draft' };
        return null;
    }, [draftDecision, finalDecision]);

    if (!activeDecision) {
        if (!isRunning && processExit) {
            return (
                <section className="card card-hover p-6">
                    <div className="flex items-center justify-between gap-2 mb-3">
                        <h2 className="text-sm font-semibold">结果反馈</h2>
                        <span className="badge badge-error">
                            <i className="fas fa-circle-exclamation"></i>
                            未产出决策
                        </span>
                    </div>
                    <div className="text-sm text-text-muted">
                        本次会话已结束，但未收到可解析的最终决策。请查看日志定位原因。
                    </div>
                    <div className="text-xs text-text-muted mt-2">
                        exit code: {processExit.code ?? '--'}
                    </div>
                </section>
            );
        }

        return (
            <section className="card card-hover p-6">
                <div className="flex items-center justify-between gap-2 mb-3">
                    <h2 className="text-sm font-semibold">结果反馈</h2>
                    <span className="badge badge-muted">
                        <i className="fas fa-hourglass-half"></i>
                        等待决策
                    </span>
                </div>
                <div className="text-sm text-text-muted">
                    讨论进行中，系统尚未输出草案或最终决策。
                </div>
            </section>
        );
    }

    const decisionJson = activeDecision.json && typeof activeDecision.json === 'object'
        ? activeDecision.json
        : {};
    const plan = decisionJson.plan && typeof decisionJson.plan === 'object'
        ? decisionJson.plan
        : {};
    const rationale = normalizeList(decisionJson.rationale);
    const invalidIf = normalizeList(plan.invalid_if);

    const shownRationale = showAllRationales ? rationale : rationale.slice(0, 3);
    const shownInvalidIf = showAllInvalidIf ? invalidIf : invalidIf.slice(0, 2);

    const signal = decisionJson.signal != null ? String(decisionJson.signal) : '--';
    const direction = decisionJson.direction != null ? String(decisionJson.direction) : '--';
    const consensus =
        decisionJson.consensus == null ? '--' : decisionJson.consensus ? '是' : '否';

    const entry = readPlanValue(plan, ['entry', 'entry_price']);
    const stopLoss = readPlanValue(plan, ['stop_loss', 'stopLoss']);
    const takeProfit = readPlanValue(plan, ['take_profit', 'takeProfit']);

    return (
        <section className="card card-hover p-6">
            <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                <div>
                    <h2 className="text-sm font-semibold">结果反馈</h2>
                    <div className="text-xs text-text-muted mt-1">
                        清晰展示当前会话最终选择
                    </div>
                </div>
                <span className={['badge', stageBadgeClass(activeDecision.stage)].join(' ')}>
                    <i className="fas fa-gavel"></i>
                    {stageLabel(activeDecision.stage)}
                </span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="rounded-xl border border-border-light/10 bg-black/20 px-3 py-3">
                    <div className="text-xs text-text-muted">信号</div>
                    <div className="text-sm font-semibold mt-1">{signal}</div>
                </div>
                <div className="rounded-xl border border-border-light/10 bg-black/20 px-3 py-3">
                    <div className="text-xs text-text-muted">方向</div>
                    <div className="text-sm font-semibold mt-1">{direction}</div>
                </div>
                <div className="rounded-xl border border-border-light/10 bg-black/20 px-3 py-3">
                    <div className="text-xs text-text-muted">置信度</div>
                    <div className="text-sm font-semibold mt-1">
                        {formatConfidence(decisionJson.confidence)}
                    </div>
                </div>
                <div className="rounded-xl border border-border-light/10 bg-black/20 px-3 py-3">
                    <div className="text-xs text-text-muted">共识</div>
                    <div className="text-sm font-semibold mt-1">{consensus}</div>
                </div>
                <div className="rounded-xl border border-border-light/10 bg-black/20 px-3 py-3">
                    <div className="text-xs text-text-muted">入场</div>
                    <div className="font-mono text-sm mt-1">{entry}</div>
                </div>
                <div className="rounded-xl border border-border-light/10 bg-black/20 px-3 py-3">
                    <div className="text-xs text-text-muted">止损</div>
                    <div className="font-mono text-sm mt-1">{stopLoss}</div>
                </div>
                <div className="rounded-xl border border-border-light/10 bg-black/20 px-3 py-3">
                    <div className="text-xs text-text-muted">止盈</div>
                    <div className="font-mono text-sm mt-1">{takeProfit}</div>
                </div>
            </div>

            <div className="mt-4 space-y-3">
                <div>
                    <div className="text-xs tracking-wide text-text-muted mb-2">结论要点</div>
                    {shownRationale.length ? (
                        <ul className="text-sm space-y-1">
                            {shownRationale.map((line, index) => (
                                <li key={`${index}-${line}`} className="text-text-muted leading-relaxed">
                                    - {line}
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <div className="text-sm text-text-muted italic">暂无要点</div>
                    )}
                    {rationale.length > 3 ? (
                        <button
                            type="button"
                            className="btn btn-secondary btn-sm mt-2"
                            onClick={() => setShowAllRationales((prev) => !prev)}
                        >
                            {showAllRationales ? '收起要点' : '展开全部要点'}
                        </button>
                    ) : null}
                </div>

                <div>
                    <div className="text-xs tracking-wide text-text-muted mb-2">失效条件</div>
                    {shownInvalidIf.length ? (
                        <ul className="text-sm space-y-1">
                            {shownInvalidIf.map((line, index) => (
                                <li key={`${index}-${line}`} className="text-text-muted leading-relaxed">
                                    - {line}
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <div className="text-sm text-text-muted italic">暂无失效条件</div>
                    )}
                    {invalidIf.length > 2 ? (
                        <button
                            type="button"
                            className="btn btn-secondary btn-sm mt-2"
                            onClick={() => setShowAllInvalidIf((prev) => !prev)}
                        >
                            {showAllInvalidIf ? '收起条件' : '展开全部条件'}
                        </button>
                    ) : null}
                </div>
            </div>
        </section>
    );
}

