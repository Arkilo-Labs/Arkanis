import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MarkdownView from './MarkdownView.jsx';

const PHASE_LABEL = Object.freeze({
    opening: '开场',
    chair: '主席',
    discussion: '讨论',
    finalize: '收敛',
    summary: '总结',
});

function normalizeTimestamp(value) {
    const ts = Number(value);
    if (Number.isFinite(ts) && ts > 0) return ts;
    return Date.now();
}

function formatTimestamp(value) {
    const ts = normalizeTimestamp(value);
    return new Date(ts).toLocaleTimeString('zh-CN', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
}

function normalizeEntries(entries) {
    const list = Array.isArray(entries) ? entries : [];
    return list
        .map((item, index) => ({
            ...item,
            _index: index,
            timestamp: normalizeTimestamp(item?.timestamp),
        }))
        .sort((left, right) => {
            if (left.timestamp !== right.timestamp) return left.timestamp - right.timestamp;
            return left._index - right._index;
        });
}

function buildEntryKey(entry) {
    return [
        entry.name || 'agent',
        entry.turn ?? 'turn',
        entry.phase || 'phase',
        entry.timestamp || 'time',
        entry._index ?? 'idx',
    ].join('__');
}

export default function TranscriptPanel({ entries, isRunning }) {
    const containerRef = useRef(null);
    const [autoScroll, setAutoScroll] = useState(true);
    const normalizedEntries = useMemo(() => normalizeEntries(entries), [entries]);

    const scrollToBottom = useCallback((behavior = 'auto') => {
        const node = containerRef.current;
        if (!node) return;
        node.scrollTo({ top: node.scrollHeight, behavior });
    }, []);

    const onScroll = useCallback(() => {
        const node = containerRef.current;
        if (!node) return;

        const remain = node.scrollHeight - node.scrollTop - node.clientHeight;
        const nearBottom = remain <= 48;
        setAutoScroll((prev) => {
            if (nearBottom) return true;
            return prev ? false : prev;
        });
    }, []);

    useEffect(() => {
        if (!autoScroll) return;
        scrollToBottom();
    }, [autoScroll, normalizedEntries, scrollToBottom]);

    useEffect(() => {
        if (!normalizedEntries.length) {
            setAutoScroll(true);
        }
    }, [normalizedEntries.length]);

    return (
        <section className="card card-hover p-6">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <div>
                    <h2 className="text-sm font-semibold">发言记录流</h2>
                    <div className="text-xs text-text-muted mt-1">
                        按时间顺序展示 Agent 发言，支持实时追加
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <span className={['badge', autoScroll ? 'badge-success' : 'badge-muted'].join(' ')}>
                        <i
                            className={[
                                'fas',
                                autoScroll ? 'fa-arrows-down-to-line' : 'fa-hand',
                            ].join(' ')}
                        ></i>
                        {autoScroll ? '自动滚动' : '手动查看'}
                    </span>

                    {!autoScroll && normalizedEntries.length ? (
                        <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => {
                                setAutoScroll(true);
                                scrollToBottom('smooth');
                            }}
                        >
                            <i className="fas fa-arrow-down"></i>
                            回到底部
                        </button>
                    ) : null}
                </div>
            </div>

            <div
                ref={containerRef}
                onScroll={onScroll}
                className="rt-transcript-scroll scrollbar"
            >
                {normalizedEntries.length ? (
                    normalizedEntries.map((entry) => {
                        const phase = PHASE_LABEL[entry.phase] || '未知';
                        const provider = String(entry.provider || '').trim() || '未标注';
                        const turnText = Number.isFinite(Number(entry.turn))
                            ? `第 ${Number(entry.turn)} 轮`
                            : '轮次未知';
                        const isFiltered = Boolean(entry.filtered);

                        return (
                            <article key={buildEntryKey(entry)} className="rt-transcript-item">
                                <header className="flex flex-wrap items-start justify-between gap-3">
                                    <div className="space-y-2 min-w-0">
                                        <div className="font-semibold text-sm truncate">
                                            {entry.name || '未知 Agent'}
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
                                            <span>{entry.role || '未设置角色'}</span>
                                            <span className="badge badge-muted">{turnText}</span>
                                            <span className="badge badge-muted">{phase}</span>
                                            <span className="badge badge-muted">{provider}</span>
                                        </div>
                                    </div>

                                    <div className="text-xs text-text-muted font-mono">
                                        {formatTimestamp(entry.timestamp)}
                                    </div>
                                </header>

                                {isFiltered ? (
                                    <div className="rounded-xl border border-accent/20 bg-accent/10 px-4 py-3 text-xs text-text-muted mt-4">
                                        该发言经审计后被过滤，内容不对外展示。
                                    </div>
                                ) : (
                                    <div className="mt-4">
                                        <MarkdownView markdown={entry.text || ''} />
                                    </div>
                                )}
                            </article>
                        );
                    })
                ) : (
                    <div className="h-full flex items-center justify-center text-sm text-text-muted border border-dashed border-border-light/10 rounded-xl">
                        {isRunning ? '等待首条发言...' : '尚未收到发言记录'}
                    </div>
                )}
            </div>
        </section>
    );
}
