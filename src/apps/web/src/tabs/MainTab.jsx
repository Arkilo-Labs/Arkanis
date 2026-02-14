import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ChartView from '../components/ChartView.jsx';
import IndicatorViewsCard from '../components/IndicatorViewsCard.jsx';
import LogTerminal from '../components/LogTerminal.jsx';
import { authedFetch } from '../composables/useAuth.js';
import { useSocket } from '../composables/useSocket.js';

export default function MainTab() {
    const { socket } = useSocket();

    const [config, setConfig] = useState({
        symbol: 'BTCUSDT',
        timeframe: '1h',
        bars: 200,
        enable4x: false,
        auxTimeframe: '',
    });

    const [isRunning, setIsRunning] = useState(false);
    const [logs, setLogs] = useState([]);
    const [pid, setPid] = useState(null);
    const pidRef = useRef(null);
    const sessionIdRef = useRef(null);

    const [baseChartData, setBaseChartData] = useState(null);
    const [auxChartData, setAuxChartData] = useState(null);
    const [vlmChartData, setVlmChartData] = useState(null);
    const [resultJson, setResultJson] = useState(null);
    const [showChartGallery, setShowChartGallery] = useState(false);

    const timeframes = useMemo(
        () => ['1m', '5m', '15m', '30m', '1h', '4h', '1d'],
        [],
    );

    const addLog = useCallback((type, data) => {
        setLogs((prev) => [...prev, { type, data, timestamp: Date.now() }]);
    }, []);

    const runScript = useCallback(() => {
        setIsRunning(true);
        setLogs([]);
        setBaseChartData(null);
        setAuxChartData(null);
        setVlmChartData(null);
        setResultJson(null);
        setShowChartGallery(false);
        setPid(null);
        pidRef.current = null;

        const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
        sessionIdRef.current = sessionId;

        const args = [
            '--symbol',
            config.symbol,
            '--timeframe',
            config.timeframe,
            '--bars',
            String(config.bars),
            '--wait',
            '1000',
            '--session-id',
            sessionId,
        ];

        if (config.enable4x) {
            args.push('--enable-4x-chart');
            if (config.auxTimeframe) args.push('--aux-timeframe', config.auxTimeframe);
        }

        addLog('stdout', `Starting main.js with args: ${args.join(' ')}`);

        authedFetch('/api/run-script', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ script: 'main', args }),
        })
            .then((res) => res.json())
            .then((data) => {
                if (data.pid) {
                    setPid(data.pid);
                    pidRef.current = data.pid;
                    addLog('stdout', `Process started with PID: ${data.pid}`);
                    return;
                }

                if (data.error) addLog('error', `Failed to start: ${data.error}`);
                setIsRunning(false);
            })
            .catch((err) => {
                addLog('error', `API Error: ${err.message}`);
                setIsRunning(false);
            });
    }, [addLog, config]);

    const stopScript = useCallback(() => {
        if (pidRef.current) socket.emit('kill-process', pidRef.current);
    }, [socket]);

    useEffect(() => {
        const onLog = (msg) => addLog(msg.type, msg.data);

        const onProcessExit = (msg) => {
            if (!pidRef.current || msg.pid !== pidRef.current) return;

            addLog('stdout', `Process exited with code ${msg.code}`);
            setIsRunning(false);
            setPid(null);
            pidRef.current = null;

            const sessionId = sessionIdRef.current;
            if (msg.code !== 0 || !sessionId) return;

            authedFetch(`/api/chart-data/${sessionId}`)
                .then((r) => {
                    if (!r.ok) throw new Error('Failed to fetch chart data');
                    return r.json();
                })
                .then((data) => {
                    setBaseChartData(data.base);
                    setAuxChartData(data.aux);
                    setVlmChartData(data.vlm);
                    setResultJson(data.decision);
                    setShowChartGallery(true);
                    addLog('stdout', 'Chart data loaded successfully');
                })
                .catch((e) => {
                    console.error('Load chart data error:', e);
                    addLog('error', `Failed to load chart data: ${e.message}`);
                });
        };

        const onProcessKilled = (killedPid) => {
            if (!pidRef.current || killedPid !== pidRef.current) return;
            addLog('stderr', 'Process terminated.');
            setIsRunning(false);
            setPid(null);
            pidRef.current = null;
        };

        socket.on('log', onLog);
        socket.on('process-exit', onProcessExit);
        socket.on('process-killed', onProcessKilled);

        return () => {
            socket.off('log', onLog);
            socket.off('process-exit', onProcessExit);
            socket.off('process-killed', onProcessKilled);
        };
    }, [addLog, socket]);

    function formatPrice(value) {
        if (value === null || value === undefined || value === 0) return '-';
        if (value === 'market') return '市价';
        const num = Number(value);
        if (!Number.isFinite(num)) return '-';
        return num.toFixed(6);
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
                <div>
                    <div className="text-xs tracking-wide text-text-muted">
                        AI-Powered Trading Analysis
                    </div>
                    <h1 className="text-2xl md:text-3xl font-bold mt-2">
                        策略分析
                    </h1>
                    {pid ? (
                        <div className="text-xs text-text-muted mt-2">
                            PID: <span className="font-mono">{pid}</span>
                        </div>
                    ) : null}
                </div>

                <div className="flex items-center gap-3">
                    {resultJson ? (
                        <div className="hidden sm:block text-right mr-2">
                            <div className="text-xs tracking-wide text-text-muted">
                                Confidence
                            </div>
                            <div className="text-2xl font-bold">
                                {(resultJson.confidence * 100).toFixed(0)}%
                            </div>
                        </div>
                    ) : null}

                    {!isRunning ? (
                        <button
                            type="button"
                            onClick={runScript}
                            className="btn btn-primary"
                        >
                            <i className="fas fa-play"></i>
                            开始分析
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={stopScript}
                            className="btn btn-danger"
                        >
                            <i className="fas fa-stop"></i>
                            停止
                        </button>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="card card-hover p-6 lg:col-span-1">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-sm font-semibold">参数配置</h2>
                        <span className="text-xs text-text-muted">Configuration</span>
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
                            />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className="form-label">周期 Timeframe</label>
                                <select
                                    value={config.timeframe}
                                    onChange={(e) =>
                                        setConfig((prev) => ({
                                            ...prev,
                                            timeframe: e.target.value,
                                        }))
                                    }
                                    className="form-input font-mono"
                                >
                                    {timeframes.map((tf) => (
                                        <option key={tf} value={tf}>
                                            {tf}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="form-label">K线数 Bars</label>
                                <input
                                    value={config.bars}
                                    onChange={(e) =>
                                        setConfig((prev) => ({
                                            ...prev,
                                            bars: Number(e.target.value || 0),
                                        }))
                                    }
                                    type="number"
                                    className="form-input font-mono"
                                />
                            </div>
                        </div>

                        <div className="pt-4 border-t border-border-light/10">
                            <label className="switch">
                                <input
                                    checked={config.enable4x}
                                    onChange={(e) =>
                                        setConfig((prev) => ({
                                            ...prev,
                                            enable4x: e.target.checked,
                                        }))
                                    }
                                    type="checkbox"
                                />
                                <span className="switch-control">
                                    <span className="switch-track"></span>
                                    <span className="switch-thumb"></span>
                                </span>
                                <span className="text-sm text-text-muted">
                                    4x Chart Mode
                                </span>
                            </label>
                        </div>

                        {config.enable4x ? (
                            <div>
                                <label className="form-label">
                                    辅助周期 Aux Timeframe
                                </label>
                                <select
                                    value={config.auxTimeframe}
                                    onChange={(e) =>
                                        setConfig((prev) => ({
                                            ...prev,
                                            auxTimeframe: e.target.value,
                                        }))
                                    }
                                    className="form-input font-mono"
                                >
                                    <option value="">Auto</option>
                                    {timeframes.map((tf) => (
                                        <option key={tf} value={tf}>
                                            {tf}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        ) : null}
                    </div>
                </div>

                <div className="card card-hover p-4 lg:col-span-2 min-h-[520px]">
                    {showChartGallery ? (
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                            {baseChartData ? (
                                <div className="space-y-2">
                                    <div className="flex items-center gap-2 px-2">
                                        <i className="fas fa-chart-line text-accent-light text-xs"></i>
                                        <span className="text-xs text-text-muted">
                                            Base Chart ({config.timeframe})
                                        </span>
                                    </div>
                                    <div className="rounded-xl border border-border-light/10 overflow-hidden">
                                        <ChartView
                                            data={baseChartData}
                                            title={`${config.symbol} ${config.timeframe}`}
                                            height={400}
                                        />
                                    </div>
                                </div>
                            ) : null}

                            {auxChartData ? (
                                <div className="space-y-2">
                                    <div className="flex items-center gap-2 px-2">
                                        <i className="fas fa-chart-area text-accent-light text-xs"></i>
                                        <span className="text-xs text-text-muted">
                                            4x Chart (Higher Timeframe)
                                        </span>
                                    </div>
                                    <div className="rounded-xl border border-border-light/10 overflow-hidden">
                                        <ChartView
                                            data={auxChartData}
                                            title={`${config.symbol} ${auxChartData.timeframe || '4x'}`}
                                            height={400}
                                        />
                                    </div>
                                </div>
                            ) : null}

                            {vlmChartData ? (
                                <div className="space-y-2 lg:col-span-2">
                                    <div className="flex items-center gap-2 px-2">
                                        <i className="fas fa-brain text-success text-xs"></i>
                                        <span className="text-xs text-text-muted">
                                            VLM Analysis Result
                                        </span>
                                    </div>
                                    <div className="rounded-xl border border-border-light/10 overflow-hidden">
                                        <ChartView
                                            data={vlmChartData}
                                            title={`${config.symbol} ${config.timeframe} - VLM Analysis`}
                                            height={500}
                                        />
                                    </div>
                                </div>
                            ) : null}
                        </div>
                    ) : isRunning ? (
                        <div className="w-full h-full flex items-center justify-center p-8">
                            <div className="flex flex-col items-center gap-4">
                                <i className="fas fa-spinner fa-spin text-3xl text-accent-light"></i>
                                <div className="text-center">
                                    <div className="text-sm font-medium">分析中</div>
                                    <div className="text-xs text-text-muted mt-1">
                                        Processing...
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="w-full h-full flex items-center justify-center p-8">
                            <div className="flex flex-col items-center gap-4 opacity-70">
                                <div className="w-20 h-20 rounded-2xl bg-white/5 border border-border-light/10 flex items-center justify-center">
                                    <i className="fas fa-chart-area text-white/40 text-3xl"></i>
                                </div>
                                <div className="text-center">
                                    <div className="text-sm font-medium">等待分析</div>
                                    <div className="text-xs text-text-muted mt-1">
                                        Ready to analyze
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {resultJson ? (
                    <div className="card card-hover p-6 lg:col-span-1">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-sm font-semibold">决策结果</h2>
                            <span className="text-xs text-text-muted">Decision</span>
                        </div>

                        <div className="mb-6">
                            <div className="text-xs tracking-wide text-text-muted">
                                Trading Signal
                            </div>
                            <div
                                className={[
                                    'mt-2 text-4xl font-extrabold tracking-tight',
                                    resultJson.enter ? 'text-success' : 'text-white/40',
                                ].join(' ')}
                            >
                                {resultJson.enter ? 'ENTER' : 'WAIT'}
                            </div>
                        </div>

                        {resultJson.enter ? (
                            <div className="space-y-3">
                                <div className="flex items-center justify-between p-4 rounded-xl bg-white/5 border border-border-light/10">
                                    <span className="text-xs text-text-muted">
                                        方向 Direction
                                    </span>
                                    <div className="flex items-center gap-2">
                                        <i
                                            className={[
                                                'fas',
                                                resultJson.direction === 'long'
                                                    ? 'fa-arrow-up text-success'
                                                    : 'fa-arrow-down text-error',
                                            ].join(' ')}
                                        ></i>
                                        <span
                                            className={[
                                                'text-sm font-bold',
                                                resultJson.direction === 'long'
                                                    ? 'text-success'
                                                    : 'text-error',
                                            ].join(' ')}
                                        >
                                            {resultJson.direction?.toUpperCase()}
                                        </span>
                                    </div>
                                </div>

                                <div className="flex items-center justify-between p-4 rounded-xl bg-white/5 border border-border-light/10">
                                    <span className="text-xs text-text-muted">
                                        入场价 Entry
                                    </span>
                                    <span className="text-sm font-mono">
                                        {formatPrice(resultJson.entry_price)}
                                    </span>
                                </div>

                                <div className="flex items-center justify-between p-4 rounded-xl bg-white/5 border border-border-light/10">
                                    <span className="text-xs text-text-muted">
                                        止损 Stop Loss
                                    </span>
                                    <span className="text-sm font-mono text-error">
                                        {formatPrice(resultJson.stop_loss_price)}
                                    </span>
                                </div>

                                <div className="flex items-center justify-between p-4 rounded-xl bg-white/5 border border-border-light/10">
                                    <span className="text-xs text-text-muted">
                                        止盈 Take Profit
                                    </span>
                                    <span className="text-sm font-mono text-success">
                                        {formatPrice(resultJson.take_profit_price)}
                                    </span>
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    <div className="p-4 rounded-xl bg-white/5 border border-border-light/10">
                                        <span className="text-xs text-text-muted block mb-1">
                                            仓位 Position
                                        </span>
                                        <span className="text-sm font-mono">
                                            {(resultJson.position_size * 100).toFixed(0)}%
                                        </span>
                                    </div>
                                    <div className="p-4 rounded-xl bg-white/5 border border-border-light/10">
                                        <span className="text-xs text-text-muted block mb-1">
                                            杠杆 Leverage
                                        </span>
                                        <span className="text-sm font-mono">
                                            {resultJson.leverage || 1}x
                                        </span>
                                    </div>
                                </div>
                            </div>
                        ) : null}

                        <div className="mt-6 pt-6 border-t border-border-light/10">
                            <div className="flex items-center gap-2 mb-3">
                                <i className="fas fa-comment-alt text-white/50 text-xs"></i>
                                <span className="text-xs tracking-wide text-text-muted">
                                    分析理由 Reasoning
                                </span>
                            </div>
                            <p className="text-sm text-white/75 leading-relaxed max-h-32 overflow-y-auto scrollbar">
                                {resultJson.reason}
                            </p>
                        </div>

                        {resultJson.indicator_views ? (
                            <div className="mt-6 pt-6 border-t border-border-light/10">
                                <IndicatorViewsCard views={resultJson.indicator_views} />
                            </div>
                        ) : null}
                    </div>
                ) : null}

                <div className={resultJson ? 'lg:col-span-2' : 'lg:col-span-3'}>
                    <div className="card card-hover p-6">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-sm font-semibold">日志输出</h3>
                            <span className="text-xs text-text-muted">Logs</span>
                        </div>
                        <LogTerminal
                            logs={logs}
                            className="min-h-[220px] max-h-[320px]"
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
