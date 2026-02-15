import { useCallback, useEffect, useMemo, useState } from 'react';
import LogTerminal from '../components/LogTerminal.jsx';
import { authedFetch } from '../composables/useAuth.js';
import { useRoundtable } from '../composables/useRoundtable.js';
import { useSocket } from '../composables/useSocket.js';

function newSessionId() {
    return `rt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

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

    const [pid, setPid] = useState(null);
    const [sessionId, setSessionId] = useState(null);
    const [error, setError] = useState('');

    const roundtable = useRoundtable({ sessionId });

    const isRunning = Boolean(pid) && !roundtable.processExit;

    const timeframes = useMemo(() => ['5m', '15m', '30m', '1h', '4h', '1d'], []);

    const displaySessionId = useMemo(() => {
        if (sessionId) return sessionId;
        if (roundtable.processExit?.sessionId) return roundtable.processExit.sessionId;
        return null;
    }, [roundtable.processExit?.sessionId, sessionId]);

    const displayPid = useMemo(() => {
        if (pid) return pid;
        if (roundtable.processExit?.pid) return roundtable.processExit.pid;
        return null;
    }, [pid, roundtable.processExit?.pid]);

    const lastDecision = useMemo(() => {
        const list = roundtable.decisions || [];
        if (!list.length) return null;
        return list[list.length - 1];
    }, [roundtable.decisions]);

    const decisionPreview = useMemo(() => {
        if (!lastDecision) return '';
        const value = lastDecision?.json;
        if (value && typeof value === 'object') return JSON.stringify(value, null, 2);
        return String(value ?? '');
    }, [lastDecision]);

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
        roundtable.clear();

        const nextSessionId = newSessionId();
        setSessionId(nextSessionId);
        setPid(null);

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

            if (!payload?.pid || !payload?.sessionId) {
                throw new Error('后端返回缺少 pid/sessionId');
            }

            setPid(payload.pid);
            setSessionId(payload.sessionId);
        } catch (caught) {
            setPid(null);
            setSessionId(null);
            setError(caught?.message || String(caught));
        }
    }, [config, isRunning, roundtable]);

    const stopRoundtable = useCallback(() => {
        if (!pid) return;
        socket.emit('kill-process', pid);
    }, [pid, socket]);

    useEffect(() => {
        function onProcessKilled(killedPid) {
            if (!pid) return;
            if (String(killedPid) !== String(pid)) return;
            setPid(null);
        }

        socket.on('process-killed', onProcessKilled);
        return () => socket.off('process-killed', onProcessKilled);
    }, [pid, socket]);

    useEffect(() => {
        if (!roundtable.processExit) return;
        setPid(null);
    }, [roundtable.processExit]);

    const disabled = isRunning;

    return (
        <div className="space-y-6">
            <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
                <div>
                    <div className="text-xs tracking-wide text-text-muted">
                        Trade Roundtable
                    </div>
                    <h1 className="text-2xl md:text-3xl font-bold mt-2">圆桌</h1>

                    <div className="text-xs text-text-muted mt-2 space-y-1">
                        {displaySessionId ? (
                            <div>
                                Session:{' '}
                                <span className="font-mono">{displaySessionId}</span>
                            </div>
                        ) : null}
                        {displayPid ? (
                            <div>
                                PID: <span className="font-mono">{displayPid}</span>
                            </div>
                        ) : null}
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <span
                        className={[
                            'badge',
                            isConnected ? 'badge-success' : 'badge-error',
                        ].join(' ')}
                    >
                        <i className="fas fa-signal"></i>
                        {isConnected ? 'Socket 已连接' : 'Socket 未连接'}
                    </span>

                    <span
                        className={[
                            'badge',
                            isRunning ? 'badge-accent' : 'badge-muted',
                        ].join(' ')}
                    >
                        <i
                            className={[
                                'fas',
                                isRunning ? 'fa-spinner fa-spin' : 'fa-circle',
                            ].join(' ')}
                        ></i>
                        {isRunning ? '运行中' : '空闲'}
                    </span>

                    {roundtable.processExit ? (
                        <span className="badge badge-muted">
                            <i className="fas fa-flag-checkered"></i>
                            exit {roundtable.processExit.code ?? '-'}
                        </span>
                    ) : null}
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="card card-hover p-6">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-sm font-semibold">启动面板</h2>
                        <span className="text-xs text-text-muted">Runner</span>
                    </div>

                    <div className="space-y-4">
                        <div>
                            <label className="form-label">交易对 Symbol</label>
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
                                disabled={disabled}
                            />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className="form-label">主周期 Primary</label>
                                <select
                                    value={config.primary}
                                    onChange={(e) =>
                                        setConfig((prev) => ({
                                            ...prev,
                                            primary: e.target.value,
                                        }))
                                    }
                                    className="form-input font-mono"
                                    disabled={disabled}
                                >
                                    {timeframes.map((tf) => (
                                        <option key={tf} value={tf}>
                                            {tf}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="form-label">辅助周期 Aux</label>
                                <select
                                    value={config.aux}
                                    onChange={(e) =>
                                        setConfig((prev) => ({
                                            ...prev,
                                            aux: e.target.value,
                                        }))
                                    }
                                    className="form-input font-mono"
                                    disabled={disabled}
                                >
                                    {timeframes.map((tf) => (
                                        <option key={tf} value={tf}>
                                            {tf}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div>
                            <label className="form-label">K 线数量 Bars</label>
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
                                disabled={disabled}
                            />
                            <div className="form-hint">范围：50 ~ 5000</div>
                        </div>

                        <div className="pt-4 border-t border-border-light/10 space-y-3">
                            <label
                                className={[
                                    'switch',
                                    disabled ? 'opacity-60 cursor-not-allowed' : '',
                                ].join(' ')}
                            >
                                <input
                                    checked={config.skipNews}
                                    onChange={(e) =>
                                        setConfig((prev) => ({
                                            ...prev,
                                            skipNews: e.target.checked,
                                        }))
                                    }
                                    type="checkbox"
                                    disabled={disabled}
                                />
                                <span className="switch-control">
                                    <span className="switch-track"></span>
                                    <span className="switch-thumb"></span>
                                </span>
                                <span className="text-sm text-text-muted">
                                    跳过新闻
                                </span>
                            </label>

                            <label
                                className={[
                                    'switch',
                                    disabled ? 'opacity-60 cursor-not-allowed' : '',
                                ].join(' ')}
                            >
                                <input
                                    checked={config.skipLlm}
                                    onChange={(e) =>
                                        setConfig((prev) => ({
                                            ...prev,
                                            skipLlm: e.target.checked,
                                        }))
                                    }
                                    type="checkbox"
                                    disabled={disabled}
                                />
                                <span className="switch-control">
                                    <span className="switch-track"></span>
                                    <span className="switch-thumb"></span>
                                </span>
                                <span className="text-sm text-text-muted">
                                    跳过模型调用
                                </span>
                            </label>

                            <label
                                className={[
                                    'switch',
                                    disabled ? 'opacity-60 cursor-not-allowed' : '',
                                ].join(' ')}
                            >
                                <input
                                    checked={config.skipLiquidation}
                                    onChange={(e) =>
                                        setConfig((prev) => ({
                                            ...prev,
                                            skipLiquidation: e.target.checked,
                                        }))
                                    }
                                    type="checkbox"
                                    disabled={disabled}
                                />
                                <span className="switch-control">
                                    <span className="switch-track"></span>
                                    <span className="switch-thumb"></span>
                                </span>
                                <span className="text-sm text-text-muted">
                                    跳过清算地图截图
                                </span>
                            </label>

                            <label
                                className={[
                                    'switch',
                                    disabled ? 'opacity-60 cursor-not-allowed' : '',
                                ].join(' ')}
                            >
                                <input
                                    checked={config.skipMcp}
                                    onChange={(e) =>
                                        setConfig((prev) => ({
                                            ...prev,
                                            skipMcp: e.target.checked,
                                        }))
                                    }
                                    type="checkbox"
                                    disabled={disabled}
                                />
                                <span className="switch-control">
                                    <span className="switch-track"></span>
                                    <span className="switch-thumb"></span>
                                </span>
                                <span className="text-sm text-text-muted">
                                    跳过 MCP
                                </span>
                            </label>
                        </div>

                        {error ? <div className="form-error">{error}</div> : null}

                        <div className="pt-2 flex flex-col sm:flex-row gap-3">
                            <button
                                type="button"
                                className="btn btn-primary"
                                onClick={startRoundtable}
                                disabled={disabled}
                            >
                                <i className="fas fa-play"></i>
                                启动圆桌
                            </button>

                            {pid ? (
                                <button
                                    type="button"
                                    className="btn btn-danger"
                                    onClick={stopRoundtable}
                                >
                                    <i className="fas fa-stop"></i>
                                    终止
                                </button>
                            ) : null}
                        </div>
                    </div>
                </div>

                <div className="space-y-6">
                    <div className="card card-hover p-6">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-sm font-semibold">终端日志</h2>
                            <span className="text-xs text-text-muted">Logs</span>
                        </div>
                        <LogTerminal
                            logs={roundtable.logs}
                            className="h-[360px]"
                        />
                    </div>

                    <div className="card card-hover p-6">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-sm font-semibold">事件概览</h2>
                            <span className="text-xs text-text-muted">Events</span>
                        </div>

                        <div className="flex flex-wrap gap-2 mb-4">
                            <span className="badge badge-muted">
                                <i className="fas fa-user"></i>
                                Agent 发言 {roundtable.agentSpeaks.length}
                            </span>
                            <span className="badge badge-muted">
                                <i className="fas fa-wrench"></i>
                                工具调用 {roundtable.toolCalls.length}
                            </span>
                            <span className="badge badge-muted">
                                <i className="fas fa-chart-line"></i>
                                信念更新 {roundtable.beliefUpdates.length}
                            </span>
                            <span className="badge badge-muted">
                                <i className="fas fa-gavel"></i>
                                决策 {roundtable.decisions.length}
                            </span>
                        </div>

                        {roundtable.processExit ? (
                            <div className="text-xs text-text-muted mb-4">
                                退出时间:{' '}
                                <span className="font-mono">
                                    {new Date(
                                        roundtable.processExit.timestamp,
                                    ).toLocaleString('zh-CN')}
                                </span>
                            </div>
                        ) : null}

                        {lastDecision ? (
                            <div className="space-y-3">
                                <div className="text-xs tracking-wide text-text-muted">
                                    最新决策 JSON
                                </div>
                                <pre className="terminal p-4 overflow-auto scrollbar max-h-[320px] whitespace-pre-wrap break-all">
                                    {decisionPreview || '(empty)'}
                                </pre>
                            </div>
                        ) : (
                            <div className="text-xs text-text-muted italic">
                                暂无决策事件
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

