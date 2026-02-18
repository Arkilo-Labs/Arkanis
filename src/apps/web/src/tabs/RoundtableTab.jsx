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

    const roundtable = useRoundtable();
    const timeframes = useMemo(() => ['5m', '15m', '30m', '1h', '4h', '1d'], []);

    const isRunning = roundtable.isSessionRunning;
    const activeSessionId = roundtable.selectedSessionId;
    const activePid = roundtable.sessionMeta?.pid || null;

    const statusMeta =
        SESSION_STATUS_META[roundtable.sessionMeta?.status] ||
        SESSION_STATUS_META.incomplete;

    const transcriptEntries = useMemo(() => {
        const source = Array.isArray(roundtable.agentSpeaks)
            ? roundtable.agentSpeaks
            : [];

        return source
            .map((item, index) => ({
                ...item,
                _index: index,
                timestamp: normalizeTimestamp(item?.timestamp),
            }))
            .sort((left, right) => {
                if (left.timestamp !== right.timestamp) {
                    return left.timestamp - right.timestamp;
                }
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

    const configSummary = useMemo(() => {
        return [
            `symbol=${config.symbol}`,
            `bars=${config.bars}`,
            `primary=${config.primary}`,
            `aux=${config.aux}`,
            config.skipNews ? 'skipNews=1' : null,
            config.skipLlm ? 'skipLlm=1' : null,
            config.skipLiquidation ? 'skipLiquidation=1' : null,
            config.skipMcp ? 'skipMcp=1' : null,
        ]
            .filter(Boolean)
            .join('  ');
    }, [config]);

    const counts = useMemo(() => {
        return {
            speaks: roundtable.agentSpeaks.length,
            tools: roundtable.toolCalls.length,
            beliefs: roundtable.beliefUpdates.length,
            decisions: roundtable.decisions.length,
        };
    }, [
        roundtable.agentSpeaks.length,
        roundtable.toolCalls.length,
        roundtable.beliefUpdates.length,
        roundtable.decisions.length,
    ]);

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
        <div className="space-y-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                    <div className="text-xs tracking-wide text-text-muted">Trade Roundtable</div>
                    <h1 className="text-2xl md:text-3xl font-bold mt-2">圆桌</h1>
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

            <section className="grid grid-cols-1 xl:grid-cols-[360px_minmax(0,1fr)] gap-6">
                <div className="card card-hover p-5">
                    <div className="flex items-start justify-between gap-3 mb-4">
                        <div>
                            <h2 className="text-sm font-semibold">Sessions</h2>
                            <div className="text-xs text-text-muted mt-1">
                                最近会话，点击即可回放
                            </div>
                        </div>

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
                            刷新
                        </button>
                    </div>

                    <div className="max-h-[420px] overflow-y-auto pr-1 space-y-2 scrollbar">
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
                                            'w-full rounded-2xl border px-4 py-3 text-left transition',
                                            selected
                                                ? 'border-accent/40 bg-accent/10'
                                                : 'border-border-light/10 bg-black/15 hover:border-white/15 hover:bg-white/5',
                                        ].join(' ')}
                                        onClick={() => {
                                            if (!item.id) return;
                                            void roundtable.selectSession(item.id, { replace: true }).catch((caught) => {
                                                setError(caught?.message || String(caught));
                                            });
                                        }}
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <div className="font-mono text-xs truncate">
                                                    {item.id}
                                                </div>
                                                <div className="text-xs text-text-muted mt-1 flex flex-wrap gap-x-3 gap-y-1">
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
                            <div className="text-sm text-text-muted italic rounded-xl border border-dashed border-border-light/10 px-4 py-6 text-center">
                                暂无会话
                            </div>
                        )}
                    </div>

                    <div className="mt-4 rounded-xl border border-border-light/10 bg-black/20 px-4 py-3 text-xs text-text-muted font-mono whitespace-pre-wrap break-all">
                        session={activeSessionId || '--'} pid={activePid || '--'} seq={roundtable.lastSeq}
                    </div>
                </div>

                <div className="card card-hover p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <h2 className="text-sm font-semibold">启动面板</h2>
                            <div className="text-xs text-text-muted mt-1">
                                右侧参数用于启动新会话（启动后自动切换到新 session）
                            </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                            <button
                                type="button"
                                className="btn btn-primary"
                                onClick={startRoundtable}
                                disabled={isRunning || isStarting}
                            >
                                <i className={['fas', isStarting ? 'fa-spinner fa-spin' : 'fa-play'].join(' ')}></i>
                                启动
                            </button>

                            <button
                                type="button"
                                className="btn btn-danger"
                                onClick={stopRoundtable}
                                disabled={!isRunning || !activePid}
                            >
                                <i className="fas fa-stop"></i>
                                终止
                            </button>
                        </div>
                    </div>

                    <div className="mt-4 grid grid-cols-1 lg:grid-cols-4 gap-3">
                        <div>
                            <label className="form-label">交易对</label>
                            <input
                                value={config.symbol}
                                onChange={(e) =>
                                    setConfig((prev) => ({
                                        ...prev,
                                        symbol: e.target.value,
                                    }))
                                }
                                type="text"
                                className="form-input font-mono"
                                placeholder="BTCUSDT"
                                disabled={isRunning || isStarting}
                            />
                        </div>

                        <div>
                            <label className="form-label">Bars</label>
                            <input
                                value={config.bars}
                                onChange={(e) =>
                                    setConfig((prev) => ({
                                        ...prev,
                                        bars: Number(e.target.value || 0),
                                    }))
                                }
                                type="number"
                                min="50"
                                max="5000"
                                className="form-input font-mono"
                                disabled={isRunning || isStarting}
                            />
                        </div>

                        <div>
                            <label className="form-label">Primary</label>
                            <select
                                value={config.primary}
                                onChange={(e) =>
                                    setConfig((prev) => ({
                                        ...prev,
                                        primary: e.target.value,
                                    }))
                                }
                                className="form-input font-mono"
                                disabled={isRunning || isStarting}
                            >
                                {timeframes.map((tf) => (
                                    <option key={tf} value={tf}>
                                        {tf}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className="form-label">Aux</label>
                            <select
                                value={config.aux}
                                onChange={(e) =>
                                    setConfig((prev) => ({
                                        ...prev,
                                        aux: e.target.value,
                                    }))
                                }
                                className="form-input font-mono"
                                disabled={isRunning || isStarting}
                            >
                                {timeframes.map((tf) => (
                                    <option key={tf} value={tf}>
                                        {tf}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 mt-4">
                        <label className="switch">
                            <input
                                checked={config.skipNews}
                                onChange={(e) =>
                                    setConfig((prev) => ({
                                        ...prev,
                                        skipNews: e.target.checked,
                                    }))
                                }
                                type="checkbox"
                                disabled={isRunning || isStarting}
                            />
                            <span className="switch-control">
                                <span className="switch-track"></span>
                                <span className="switch-thumb"></span>
                            </span>
                            <span className="text-sm text-text-muted">跳过新闻</span>
                        </label>

                        <label className="switch">
                            <input
                                checked={config.skipLlm}
                                onChange={(e) =>
                                    setConfig((prev) => ({
                                        ...prev,
                                        skipLlm: e.target.checked,
                                    }))
                                }
                                type="checkbox"
                                disabled={isRunning || isStarting}
                            />
                            <span className="switch-control">
                                <span className="switch-track"></span>
                                <span className="switch-thumb"></span>
                            </span>
                            <span className="text-sm text-text-muted">跳过模型</span>
                        </label>

                        <label className="switch">
                            <input
                                checked={config.skipLiquidation}
                                onChange={(e) =>
                                    setConfig((prev) => ({
                                        ...prev,
                                        skipLiquidation: e.target.checked,
                                    }))
                                }
                                type="checkbox"
                                disabled={isRunning || isStarting}
                            />
                            <span className="switch-control">
                                <span className="switch-track"></span>
                                <span className="switch-thumb"></span>
                            </span>
                            <span className="text-sm text-text-muted">跳过清算</span>
                        </label>

                        <label className="switch">
                            <input
                                checked={config.skipMcp}
                                onChange={(e) =>
                                    setConfig((prev) => ({
                                        ...prev,
                                        skipMcp: e.target.checked,
                                    }))
                                }
                                type="checkbox"
                                disabled={isRunning || isStarting}
                            />
                            <span className="switch-control">
                                <span className="switch-track"></span>
                                <span className="switch-thumb"></span>
                            </span>
                            <span className="text-sm text-text-muted">跳过 MCP</span>
                        </label>
                    </div>

                    <div className="mt-4 rounded-xl border border-border-light/10 bg-black/20 px-4 py-3 text-xs text-text-muted font-mono whitespace-pre-wrap break-all">
                        {configSummary}
                    </div>

                    {error ? <div className="form-error mt-4">{error}</div> : null}
                </div>
            </section>

            <DecisionResultCard
                finalDecision={finalDecision}
                draftDecision={draftDecision}
                processExit={roundtable.processExit}
                isRunning={isRunning}
            />

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
            />
        </div>
    );
}
