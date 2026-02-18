import { useCallback, useEffect, useMemo, useState } from 'react';

import DecisionResultCard from '../components/roundtable/DecisionResultCard.jsx';
import RoundtableBattlefield from '../components/roundtable/RoundtableBattlefield.jsx';
import { authedFetch } from '../composables/useAuth.js';
import { useRoundtable } from '../composables/useRoundtable.js';
import { useSocket } from '../composables/useSocket.js';

function newSessionId() {
    return `rt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeTimestamp(value) {
    const timestamp = Number(value);
    if (Number.isFinite(timestamp) && timestamp > 0) return timestamp;
    return Date.now();
}

const SESSION_STATUS_META = Object.freeze({
    running: { label: '运行中', className: 'badge-accent', icon: 'fa-spinner fa-spin' },
    completed: { label: '已完成', className: 'badge-success', icon: 'fa-circle-check' },
    failed: { label: '失败', className: 'badge-error', icon: 'fa-circle-xmark' },
    killed: { label: '已终止', className: 'badge-muted', icon: 'fa-hand' },
    incomplete: { label: '不完整', className: 'badge-muted', icon: 'fa-circle-question' },
});

export default function RoundtableTab() {
    const { socket, isConnected } = useSocket();

    const [config, setConfig] = useState({
        symbol: 'BTCUSDT',
        bars: 250,
        primary: '15m',
        aux: '1h',
        skipNews: false,
        skipLlm: false,
        skipLiquidation: false,
        skipMcp: false,
    });
    const [error, setError] = useState('');
    const [isStarting, setIsStarting] = useState(false);
    const [newSessionTick, setNewSessionTick] = useState(0);

    const roundtable = useRoundtable();
    const timeframes = useMemo(() => ['5m', '15m', '30m', '1h', '4h', '1d'], []);

    const isRunning = roundtable.isSessionRunning;
    const activeSessionId = roundtable.selectedSessionId;
    const activePid = roundtable.sessionMeta?.pid || null;

    const statusMeta =
        SESSION_STATUS_META[roundtable.sessionMeta?.status] ||
        SESSION_STATUS_META.incomplete;

    const transcriptEntries = useMemo(() => {
        const source = Array.isArray(roundtable.agentSpeaks) ? roundtable.agentSpeaks : [];
        return source
            .map((item, index) => ({
                ...item,
                _index: index,
                timestamp: normalizeTimestamp(item?.timestamp),
            }))
            .sort((left, right) => {
                if (left.timestamp !== right.timestamp) return left.timestamp - right.timestamp;
                return left._index - right._index;
            });
    }, [roundtable.agentSpeaks]);

    const finalDecision = useMemo(() => {
        for (let i = roundtable.decisions.length - 1; i >= 0; i -= 1) {
            const item = roundtable.decisions[i];
            if (String(item?.stage || '').trim() === 'final') return item;
        }
        return null;
    }, [roundtable.decisions]);

    const draftDecision = useMemo(() => {
        if (finalDecision) return null;
        for (let i = roundtable.decisions.length - 1; i >= 0; i -= 1) {
            const item = roundtable.decisions[i];
            if (String(item?.stage || '').trim() === 'draft') return item;
        }
        return null;
    }, [finalDecision, roundtable.decisions]);

    const counts = useMemo(() => ({
        speaks: roundtable.agentSpeaks.length,
        tools: roundtable.toolCalls.length,
        beliefs: roundtable.beliefUpdates.length,
        decisions: roundtable.decisions.length,
    }), [
        roundtable.agentSpeaks.length,
        roundtable.toolCalls.length,
        roundtable.beliefUpdates.length,
        roundtable.decisions.length,
    ]);

    const handleConfigChange = useCallback((updates) => {
        setConfig((prev) => ({ ...prev, ...updates }));
    }, []);

    const handleSelectSession = useCallback((id) => {
        if (!id) return;
        void roundtable.selectSession(id, { replace: true }).catch((caught) => {
            setError(caught?.message || String(caught));
        });
    }, [roundtable]);

    const startRoundtable = useCallback(async () => {
        if (isRunning) {
            setError('已有圆桌在运行，请先终止或等待结束');
            return;
        }

        const bars = Number(config.bars || 0);
        if (!Number.isFinite(bars) || bars < 50 || bars > 5000) {
            setError('bars 必须在 50 ~ 5000 之间');
            return;
        }

        setError('');
        setIsStarting(true);

        const nextSessionId = newSessionId();

        try {
            const response = await authedFetch('/api/roundtable/run', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionId: nextSessionId,
                    symbol: String(config.symbol || '').trim(),
                    bars,
                    primary: config.primary,
                    aux: config.aux,
                    skipNews: Boolean(config.skipNews),
                    skipLlm: Boolean(config.skipLlm),
                    skipLiquidation: Boolean(config.skipLiquidation),
                    skipMcp: Boolean(config.skipMcp),
                }),
            });

            const payload = await response.json().catch(() => null);
            if (!response.ok) {
                const msg =
                    payload && typeof payload === 'object' && payload.error
                        ? String(payload.error)
                        : `请求失败: ${response.status}`;
                throw new Error(msg);
            }

            if (!payload?.sessionId) {
                throw new Error('后端返回缺少 sessionId');
            }

            await roundtable.loadSessions().catch(() => null);
            await roundtable.selectSession(payload.sessionId, { replace: true });
        } catch (caught) {
            setError(caught?.message || String(caught));
        } finally {
            setIsStarting(false);
        }
    }, [config, isRunning, roundtable]);

    const stopRoundtable = useCallback(() => {
        if (!activePid) return;
        socket.emit('kill-process', activePid);
    }, [activePid, socket]);

    const refreshSessions = useCallback(async () => {
        setError('');
        await roundtable.loadSessions();
        if (activeSessionId) {
            await roundtable.replayFrom(roundtable.lastSeq, {
                sessionId: activeSessionId,
                replace: false,
                includeFallback: false,
            });
        }
    }, [activeSessionId, roundtable]);

    useEffect(() => {
        function onProcessKilled(killedPid) {
            if (!activePid) return;
            if (String(killedPid) !== String(activePid)) return;
            void refreshSessions().catch(() => null);
        }

        socket.on('process-killed', onProcessKilled);
        return () => socket.off('process-killed', onProcessKilled);
    }, [activePid, refreshSessions, socket]);

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <div className="text-xs tracking-wide text-text-muted">Trade Roundtable</div>
                    <h1 className="text-2xl font-bold mt-1">圆桌</h1>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <span className={['badge', isConnected ? 'badge-success' : 'badge-error'].join(' ')}>
                        <i className="fas fa-signal"></i>
                        {isConnected ? 'Socket 已连接' : 'Socket 未连接'}
                    </span>

                    <span className={['badge', statusMeta.className].join(' ')}>
                        <i className={['fas', statusMeta.icon].join(' ')}></i>
                        {statusMeta.label}
                    </span>

                    {roundtable.isReplaying ? (
                        <span className="badge badge-muted">
                            <i className="fas fa-rotate fa-spin"></i>
                            回放中
                        </span>
                    ) : null}
                </div>
            </div>

            <section className="grid grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)] gap-4">
                <div className="card p-4 flex flex-col">
                    <div className="flex items-center justify-between gap-2 mb-3">
                        <h2 className="text-sm font-semibold">Sessions</h2>
                        <div className="flex items-center gap-1.5">
                            <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={() => {
                                    void refreshSessions().catch((caught) => {
                                        setError(caught?.message || String(caught));
                                    });
                                }}
                            >
                                <i className="fas fa-rotate-right"></i>
                            </button>
                            <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                disabled={isRunning}
                                onClick={() => {
                                    setError('');
                                    setNewSessionTick((prev) => prev + 1);
                                }}
                            >
                                <i className="fas fa-plus"></i>
                                新建
                            </button>
                        </div>
                    </div>

                    <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-1.5 scrollbar">
                        {roundtable.sessions.length ? (
                            roundtable.sessions.map((item) => {
                                const meta =
                                    SESSION_STATUS_META[item?.status] ||
                                    SESSION_STATUS_META.incomplete;
                                const selected = item.id && item.id === activeSessionId;
                                const seqValue =
                                    item?.lastSeq == null ? '--' : String(item.lastSeq);
                                const pidValue =
                                    item?.pid == null ? '--' : String(item.pid);

                                return (
                                    <button
                                        key={item.id}
                                        type="button"
                                        className={[
                                            'w-full rounded-xl border px-3 py-2 text-left transition',
                                            selected
                                                ? 'border-accent/40 bg-accent/8'
                                                : 'border-border-light/10 bg-black/15 hover:border-white/15 hover:bg-white/5',
                                        ].join(' ')}
                                        onClick={() => {
                                            if (!item.id) return;
                                            void roundtable.selectSession(item.id, { replace: true }).catch((caught) => {
                                                setError(caught?.message || String(caught));
                                            });
                                        }}
                                    >
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0">
                                                <div className="font-mono text-xs truncate">{item.id}</div>
                                                <div className="text-[11px] text-text-muted mt-0.5 flex gap-x-2">
                                                    <span>pid {pidValue}</span>
                                                    <span>seq {seqValue}</span>
                                                </div>
                                            </div>
                                            <span className={['badge', meta.className].join(' ')}>
                                                <i className={['fas', meta.icon].join(' ')}></i>
                                                {meta.label}
                                            </span>
                                        </div>
                                    </button>
                                );
                            })
                        ) : (
                            <div className="text-sm text-text-muted italic rounded-xl border border-dashed border-border-light/10 px-4 py-5 text-center">
                                暂无会话
                            </div>
                        )}
                    </div>

                    <div className="mt-3 text-[11px] text-text-muted font-mono break-all leading-relaxed border-t border-border-light/8 pt-2">
                        {activeSessionId || '--'}<br />
                        pid={activePid || '--'} seq={roundtable.lastSeq}
                    </div>
                </div>

                <DecisionResultCard
                    finalDecision={finalDecision}
                    draftDecision={draftDecision}
                    processExit={roundtable.processExit}
                    isRunning={isRunning}
                />
            </section>

            <RoundtableBattlefield
                entries={transcriptEntries}
                beliefUpdates={roundtable.beliefUpdates}
                toolCalls={roundtable.toolCalls}
                decisions={roundtable.decisions}
                processExit={roundtable.processExit}
                logs={roundtable.logs}
                isRunning={isRunning}
                finalDecision={finalDecision}
                draftDecision={draftDecision}
                counts={counts}
                activeSessionId={activeSessionId}
                newSessionTick={newSessionTick}
                config={config}
                onConfigChange={handleConfigChange}
                isStarting={isStarting}
                onStart={startRoundtable}
                onStop={stopRoundtable}
                activePid={activePid}
                launchError={error}
                timeframes={timeframes}
            />
        </div>
    );
}
