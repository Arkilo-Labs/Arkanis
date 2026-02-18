import { useCallback, useEffect, useMemo, useState } from 'react';

import DecisionResultCard from '../components/roundtable/DecisionResultCard.jsx';
import RoundtableBattlefield from '../components/roundtable/RoundtableBattlefield.jsx';
import { authedFetch } from '../composables/useAuth.js';
import { useRoundtable } from '../composables/useRoundtable.js';
import { useSocket } from '../composables/useSocket.js';

const CONFIG_STORAGE_KEY = 'arkanis:roundtable:config';

function loadStoredConfig() {
    try {
        const raw = localStorage.getItem(CONFIG_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        return parsed;
    } catch {
        return null;
    }
}

function saveConfig(config) {
    try {
        localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
    } catch {
        // localStorage 不可用时静默忽略
    }
}

function makeSessionId(symbol) {
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    const rand = Math.random().toString(36).slice(2, 5);
    const sym = String(symbol || 'XX').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
    return `rt-${sym}-${mm}${dd}-${hh}${min}-${rand}`;
}

// 从 session ID 或 createdAt 提取可读标签
function parseSessionLabel(id, createdAt) {
    if (createdAt) {
        const d = new Date(createdAt);
        if (!Number.isNaN(d.getTime())) {
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            const hh = String(d.getHours()).padStart(2, '0');
            const min = String(d.getMinutes()).padStart(2, '0');
            // 尝试从 ID 提取 symbol
            const m = String(id || '').match(/^rt-([A-Z0-9]+)-/);
            const sym = m ? m[1] : '';
            return sym ? `${sym} ${mm}/${dd} ${hh}:${min}` : `${mm}/${dd} ${hh}:${min}`;
        }
    }
    // 回退：解析新格式 ID
    const m = String(id || '').match(/^rt-([A-Z0-9]+)-(\d{2})(\d{2})-(\d{2})(\d{2})/);
    if (m) return `${m[1]} ${m[2]}/${m[3]} ${m[4]}:${m[5]}`;
    return id || '--';
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

    const [config, setConfig] = useState(() => {
        const stored = loadStoredConfig();
        return {
            symbol: stored?.symbol ?? 'BTCUSDT',
            bars: stored?.bars ?? 250,
            primary: stored?.primary ?? '15m',
            aux: stored?.aux ?? '1h',
            skipNews: stored?.skipNews ?? false,
            skipLlm: stored?.skipLlm ?? false,
            skipLiquidation: stored?.skipLiquidation ?? false,
            skipMcp: stored?.skipMcp ?? false,
        };
    });
    const [error, setError] = useState('');
    const [isStarting, setIsStarting] = useState(false);

    const roundtable = useRoundtable();
    const timeframes = useMemo(() => ['5m', '15m', '30m', '1h', '4h', '1d'], []);

    const isRunning = roundtable.isSessionRunning;
    const activeSessionId = roundtable.selectedSessionId;
    const activePid = roundtable.sessionMeta?.pid || null;

    const [showLaunchOverlay, setShowLaunchOverlay] = useState(() => !activeSessionId);

    // 选中 session 后自动收起启动表单
    useEffect(() => {
        if (activeSessionId) setShowLaunchOverlay(false);
    }, [activeSessionId]);

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
        ].filter(Boolean).join('  ');
    }, [config]);

    const handleConfigChange = useCallback((updates) => {
        setConfig((prev) => {
            const next = { ...prev, ...updates };
            saveConfig(next);
            return next;
        });
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

        const nextSessionId = makeSessionId(config.symbol);

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
        if (!window.confirm('确认终止当前运行中的圆桌？此操作不可撤销。')) return;
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
                    {!isConnected ? (
                        <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => socket.connect()}
                        >
                            <i className="fas fa-rotate-right"></i>
                            重连
                        </button>
                    ) : null}

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
                <div className="card p-4 flex flex-col max-h-[600px]">
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
                            {isRunning ? (
                                <button
                                    type="button"
                                    className="btn btn-sm"
                                    style={{ borderColor: 'rgb(239 68 68 / 0.5)', color: 'rgb(239 68 68)' }}
                                    onClick={stopRoundtable}
                                    disabled={!activePid}
                                >
                                    <i className="fas fa-stop"></i>
                                    停止
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => {
                                        setError('');
                                        setShowLaunchOverlay(true);
                                    }}
                                >
                                    <i className="fas fa-plus"></i>
                                    新建
                                </button>
                            )}
                        </div>
                    </div>

                    <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-1.5 scrollbar">
                        {roundtable.sessions.length ? (
                            roundtable.sessions.map((item) => {
                                const meta =
                                    SESSION_STATUS_META[item?.status] ||
                                    SESSION_STATUS_META.incomplete;
                                const selected = item.id && item.id === activeSessionId;
                                const label = parseSessionLabel(item.id, item.createdAt);

                                return (
                                    <button
                                        key={item.id}
                                        type="button"
                                        title={item.id}
                                        className={[
                                            'w-full rounded-xl border px-3 py-2 text-left transition',
                                            selected
                                                ? 'border-accent/40 bg-accent/8'
                                                : 'border-border-light/10 bg-black/15 hover:border-white/15 hover:bg-white/5',
                                        ].join(' ')}
                                        onClick={() => {
                                            if (!item.id) return;
                                            setShowLaunchOverlay(false);
                                            void roundtable.selectSession(item.id, { replace: true }).catch((caught) => {
                                                setError(caught?.message || String(caught));
                                            });
                                        }}
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="text-xs font-semibold truncate min-w-0">{label}</span>
                                            <span className={['badge flex-shrink-0', meta.className].join(' ')}>
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

                    {activeSessionId ? (
                        <div className="mt-3 text-[11px] text-text-muted font-mono leading-relaxed border-t border-border-light/8 pt-2 space-y-0.5">
                            <div className="truncate text-text">{activeSessionId}</div>
                            <div className="flex gap-x-3">
                                <span>pid={activePid || '--'}</span>
                                <span>seq={roundtable.lastSeq}</span>
                            </div>
                        </div>
                    ) : null}
                </div>

                {showLaunchOverlay && !isRunning ? (
                    <div className="card p-5 flex flex-col">
                        <div className="text-sm font-semibold mb-4">启动新会话</div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                            <div>
                                <label className="form-label">交易对</label>
                                <input
                                    value={config.symbol}
                                    onChange={(e) => handleConfigChange({ symbol: e.target.value })}
                                    type="text"
                                    className="form-input font-mono"
                                    placeholder="BTCUSDT"
                                    disabled={isStarting}
                                />
                            </div>
                            <div>
                                <label className="form-label">Bars</label>
                                <input
                                    value={config.bars}
                                    onChange={(e) => handleConfigChange({ bars: Number(e.target.value || 0) })}
                                    type="number"
                                    min="50"
                                    max="5000"
                                    className="form-input font-mono"
                                    disabled={isStarting}
                                />
                            </div>
                            <div>
                                <label className="form-label">Primary</label>
                                <select
                                    value={config.primary}
                                    onChange={(e) => handleConfigChange({ primary: e.target.value })}
                                    className="form-input font-mono"
                                    disabled={isStarting}
                                >
                                    {timeframes.map((tf) => (
                                        <option key={tf} value={tf}>{tf}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="form-label">Aux</label>
                                <select
                                    value={config.aux}
                                    onChange={(e) => handleConfigChange({ aux: e.target.value })}
                                    className="form-input font-mono"
                                    disabled={isStarting}
                                >
                                    {timeframes.map((tf) => (
                                        <option key={tf} value={tf}>{tf}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                            <label className="switch">
                                <input checked={config.skipNews} onChange={(e) => handleConfigChange({ skipNews: e.target.checked })} type="checkbox" disabled={isStarting} />
                                <span className="switch-control"><span className="switch-track"></span><span className="switch-thumb"></span></span>
                                <span className="text-sm text-text-muted">跳过新闻</span>
                            </label>
                            <label className="switch">
                                <input checked={config.skipLlm} onChange={(e) => handleConfigChange({ skipLlm: e.target.checked })} type="checkbox" disabled={isStarting} />
                                <span className="switch-control"><span className="switch-track"></span><span className="switch-thumb"></span></span>
                                <span className="text-sm text-text-muted">跳过模型</span>
                            </label>
                            <label className="switch">
                                <input checked={config.skipLiquidation} onChange={(e) => handleConfigChange({ skipLiquidation: e.target.checked })} type="checkbox" disabled={isStarting} />
                                <span className="switch-control"><span className="switch-track"></span><span className="switch-thumb"></span></span>
                                <span className="text-sm text-text-muted">跳过清算</span>
                            </label>
                            <label className="switch">
                                <input checked={config.skipMcp} onChange={(e) => handleConfigChange({ skipMcp: e.target.checked })} type="checkbox" disabled={isStarting} />
                                <span className="switch-control"><span className="switch-track"></span><span className="switch-thumb"></span></span>
                                <span className="text-sm text-text-muted">跳过 MCP</span>
                            </label>
                        </div>

                        {configSummary ? (
                            <div className="rounded-xl border border-border-light/10 bg-black/20 px-3 py-2 text-xs text-text-muted font-mono whitespace-pre-wrap break-all mb-4">
                                {configSummary}
                            </div>
                        ) : null}

                        {error ? (
                            <div className="form-error mb-4">{error}</div>
                        ) : null}

                        <div className="flex items-center gap-3 mt-auto">
                            <button
                                type="button"
                                className="btn btn-primary"
                                onClick={startRoundtable}
                                disabled={isStarting}
                            >
                                <i className={['fas', isStarting ? 'fa-spinner fa-spin' : 'fa-play'].join(' ')}></i>
                                启动
                            </button>
                            {activeSessionId ? (
                                <button
                                    type="button"
                                    className="btn btn-secondary"
                                    onClick={() => setShowLaunchOverlay(false)}
                                    disabled={isStarting}
                                >
                                    返回
                                </button>
                            ) : null}
                        </div>
                    </div>
                ) : !activeSessionId && !roundtable.sessions.length ? (
                    <div className="card p-6 flex flex-col justify-center">
                        <div className="text-xs tracking-wide text-text-muted mb-4">Getting Started</div>
                        <div className="space-y-3 text-sm text-text-muted">
                            <div className="flex items-start gap-3">
                                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold">1</span>
                                <span>确保后端已启动：<span className="font-mono text-text">pnpm dev:server</span></span>
                            </div>
                            <div className="flex items-start gap-3">
                                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold">2</span>
                                <span>在「AI Providers」页面配置至少一个模型</span>
                            </div>
                            <div className="flex items-start gap-3">
                                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold">3</span>
                                <span>点击左侧「新建」，设置交易对和参数后启动圆桌</span>
                            </div>
                        </div>
                        <button
                            type="button"
                            className="btn btn-primary mt-6 w-fit"
                            onClick={() => setShowLaunchOverlay(true)}
                        >
                            <i className="fas fa-plus"></i>
                            新建会话
                        </button>
                    </div>
                ) : (
                    <DecisionResultCard
                        finalDecision={finalDecision}
                        draftDecision={draftDecision}
                        processExit={roundtable.processExit}
                        isRunning={isRunning}
                    />
                )}
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
            />
        </div>
    );
}
