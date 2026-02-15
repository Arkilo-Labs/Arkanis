const STATUS_META = Object.freeze({
    waiting: {
        label: '等待',
        icon: 'fa-hourglass-half',
        className: 'badge-muted',
    },
    speaking: {
        label: '发言中',
        icon: 'fa-spinner fa-spin',
        className: 'badge-accent',
    },
    done: {
        label: '完成',
        icon: 'fa-check',
        className: 'badge-success',
    },
});

const PHASE_LABEL = Object.freeze({
    opening: '开场',
    chair: '主席',
    discussion: '讨论',
    finalize: '收敛',
    summary: '总结',
    history: '历史',
});

function formatLastTime(timestamp) {
    const value = Number(timestamp);
    if (!Number.isFinite(value) || value <= 0) return '--';
    return new Date(value).toLocaleTimeString('zh-CN', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
}

export default function AgentCard({
    name,
    role,
    provider,
    status,
    speakCount,
    lastTurn,
    lastPhase,
    lastTimestamp,
}) {
    const meta = STATUS_META[status] || STATUS_META.waiting;
    const providerLabel = String(provider || '').trim() || '未标注';
    const phaseKey = String(lastPhase || '').trim();
    const phaseLabel = phaseKey ? PHASE_LABEL[phaseKey] || phaseKey : '--';

    return (
        <article className="rounded-xl border border-border-light/10 bg-black/20 px-4 py-3 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="text-sm font-semibold truncate">{name || '-'}</div>
                    <div className="text-xs text-text-muted mt-1 truncate">{role || '未设置角色'}</div>
                </div>

                <span className={['badge', meta.className].join(' ')}>
                    <i className={['fas', meta.icon].join(' ')}></i>
                    {meta.label}
                </span>
            </div>

            <div className="flex flex-wrap gap-2">
                <span className="badge badge-muted">
                    <i className="fas fa-plug"></i>
                    {providerLabel}
                </span>
                <span className="badge badge-muted">
                    <i className="fas fa-comment-dots"></i>
                    {speakCount}
                </span>
                <span className="badge badge-muted">
                    <i className="fas fa-hashtag"></i>
                    {Number.isFinite(Number(lastTurn)) ? `#${Number(lastTurn)}` : '--'}
                </span>
                <span className="badge badge-muted">
                    <i className="fas fa-layer-group"></i>
                    {phaseLabel}
                </span>
            </div>

            <div className="text-xs text-text-muted font-mono">
                最近时间 {formatLastTime(lastTimestamp)}
            </div>
        </article>
    );
}
