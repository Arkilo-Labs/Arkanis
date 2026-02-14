import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ChartView from '../components/ChartView.jsx';
import CustomSelect from '../components/CustomSelect.jsx';
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

    const timeframes = useMemo(() => ['1m', '5m', '15m', '30m', '1h', '4h', '1d'], []);
    const timeframeOptions = useMemo(
        () => timeframes.map((tf) => ({ value: tf, label: tf })),
        [timeframes],
    );
    const auxTimeframeOptions = useMemo(
        () => [{ value: '', label: 'Auto' }, ...timeframes.map((tf) => ({ value: tf, label: tf }))],
        [timeframes],
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

        const sessionId = `session_${Date.now()}_${Math.random()
            .toString(36)
            .substr(2, 9)}`;
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
            <div className="glass-card p-8 animate-slide-up">
                <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
                    <div>
                        <span className="text-subtitle-en mb-2 block">
                            AI-Powered Trading Analysis
                        </span>
                        <h1 className="text-hero-cn text-apple-gradient">策略分析</h1>
                    </div>
                    <div className="flex items-center gap-4">
                        {resultJson ? (
                            <div className="text-right">
                                <span className="text-label block mb-1">Confidence</span>
                                <span className="text-big-number text-apple-gradient">
                                    {(resultJson.confidence * 100).toFixed(0)}%
                                </span>
                            </div>
                        ) : null}
                        {!isRunning ? (
                            <button
                                type="button"
                                onClick={runScript}
                                className="btn-glass h-14 px-8"
                            >
                                <i className="fas fa-play"></i>
                                <span className="font-bold">开始分析</span>
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={stopScript}
                                className="btn-glass btn-glass-danger h-14 px-8"
                            >
                                <i className="fas fa-stop"></i>
                                <span className="font-bold">停止</span>
                            </button>
                        )}
                    </div>
                </div>
            </div>

            <div className="bento-grid">
                <div className="bento-md glass-card p-6 animate-slide-up stagger-1">
                    <div className="liquidGlass-content">
                        <h2 className="text-label flex items-center gap-2 mb-6">
                            <i className="fas fa-sliders-h"></i>
                            Configuration
                        </h2>

                        <div className="space-y-5">
                            <div>
                                <label className="text-label block mb-2">
                                    交易对 Symbol
                                </label>
                                <input
                                    value={config.symbol}
                                    onChange={(e) =>
                                        setConfig((prev) => ({
                                            ...prev,
                                            symbol: e.target.value,
                                        }))
                                    }
                                    type="text"
                                    className="input-glass font-mono"
                                    placeholder="BTCUSDT"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-label block mb-2">
                                        周期 Timeframe
                                    </label>
                                    <CustomSelect
                                        value={config.timeframe}
                                        options={timeframeOptions}
                                        onChange={(nextValue) =>
                                            setConfig((prev) => ({
                                                ...prev,
                                                timeframe: nextValue,
                                            }))
                                        }
                                    />
                                </div>
                                <div>
                                    <label className="text-label block mb-2">K线数 Bars</label>
                                    <input
                                        value={config.bars}
                                        onChange={(e) =>
                                            setConfig((prev) => ({
                                                ...prev,
                                                bars: Number(e.target.value || 0),
                                            }))
                                        }
                                        type="number"
                                        className="input-glass font-mono"
                                    />
                                </div>
                            </div>

                            <div className="pt-4 border-t border-white/10">
                                <label className="toggle-glass">
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
                                    <div className="toggle-track"></div>
                                    <div className="toggle-thumb"></div>
                                    <span className="ml-3 text-sm text-white/70">
                                        4x Chart Mode
                                    </span>
                                </label>
                            </div>

                            {config.enable4x ? (
                                <div className="animate-fade-in">
                                    <label className="text-label block mb-2">
                                        辅助周期 Aux Timeframe
                                    </label>
                                    <CustomSelect
                                        value={config.auxTimeframe}
                                        options={auxTimeframeOptions}
                                        onChange={(nextValue) =>
                                            setConfig((prev) => ({
                                                ...prev,
                                                auxTimeframe: nextValue,
                                            }))
                                        }
                                    />
                                </div>
                            ) : null}
                        </div>
                    </div>
                </div>

                <div className="bento-xl glass-card min-h-[500px] animate-slide-up stagger-2">
                    {showChartGallery ? (
                        <div className="w-full h-full p-4">
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                {baseChartData ? (
                                    <div className="space-y-2">
                                        <div className="flex items-center gap-2 px-2">
                                            <i className="fas fa-chart-line text-blue-400 text-xs"></i>
                                            <span className="text-label">
                                                Base Chart ({config.timeframe})
                                            </span>
                                        </div>
                                        <div className="rounded-xl border border-white/10 overflow-hidden">
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
                                            <i className="fas fa-chart-area text-purple-400 text-xs"></i>
                                            <span className="text-label">
                                                4x Chart (Higher Timeframe)
                                            </span>
                                        </div>
                                        <div className="rounded-xl border border-white/10 overflow-hidden">
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
                                            <i className="fas fa-brain text-green-400 text-xs"></i>
                                            <span className="text-label">
                                                VLM Analysis Result
                                            </span>
                                        </div>
                                        <div className="rounded-xl border border-white/10 overflow-hidden">
                                            <ChartView
                                                data={vlmChartData}
                                                title={`${config.symbol} ${config.timeframe} - VLM Analysis`}
                                                height={500}
                                            />
                                        </div>
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    ) : isRunning ? (
                        <div className="w-full h-full flex items-center justify-center p-4">
                            <div className="flex flex-col items-center gap-4">
                                <div className="w-16 h-16 rounded-2xl bg-blue-500/20 flex items-center justify-center">
                                    <svg
                                        className="spinner-custom"
                                        width="32"
                                        height="32"
                                        viewBox="0 0 32 32"
                                        fill="none"
                                        xmlns="http://www.w3.org/2000/svg"
                                    >
                                        <circle
                                            cx="16"
                                            cy="4"
                                            r="2.5"
                                            fill="rgba(255, 255, 255, 0.9)"
                                        />
                                        <circle
                                            cx="23.8"
                                            cy="8.2"
                                            r="2.5"
                                            fill="rgba(255, 255, 255, 0.8)"
                                        />
                                        <circle
                                            cx="27.8"
                                            cy="16"
                                            r="2.5"
                                            fill="rgba(255, 255, 255, 0.7)"
                                        />
                                        <circle
                                            cx="23.8"
                                            cy="23.8"
                                            r="2.5"
                                            fill="rgba(255, 255, 255, 0.6)"
                                        />
                                        <circle
                                            cx="16"
                                            cy="28"
                                            r="2.5"
                                            fill="rgba(255, 255, 255, 0.5)"
                                        />
                                        <circle
                                            cx="8.2"
                                            cy="23.8"
                                            r="2.5"
                                            fill="rgba(255, 255, 255, 0.4)"
                                        />
                                        <circle
                                            cx="4.2"
                                            cy="16"
                                            r="2.5"
                                            fill="rgba(255, 255, 255, 0.3)"
                                        />
                                        <circle
                                            cx="8.2"
                                            cy="8.2"
                                            r="2.5"
                                            fill="rgba(255, 255, 255, 0.2)"
                                        />
                                    </svg>
                                </div>
                                <div className="text-center">
                                    <span className="text-white/80 text-lg font-medium block">
                                        分析中
                                    </span>
                                    <span className="text-white/40 text-sm">
                                        Processing...
                                    </span>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="w-full h-full flex items-center justify-center p-4">
                            <div className="flex flex-col items-center gap-4 opacity-40">
                                <div className="w-20 h-20 rounded-3xl bg-white/5 border border-white/10 flex items-center justify-center">
                                    <i className="fas fa-chart-area text-white/30 text-3xl"></i>
                                </div>
                                <div className="text-center">
                                    <span className="text-white/50 text-lg block">
                                        等待分析
                                    </span>
                                    <span className="text-white/30 text-sm">
                                        Ready to analyze
                                    </span>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {resultJson ? (
                    <div className="bento-md glass-card p-6 animate-slide-up stagger-3">
                        <div className="liquidGlass-content">
                            <h2 className="text-label flex items-center gap-2 mb-6">
                                <i className="fas fa-brain"></i>
                                Decision Result
                            </h2>

                            <div className="mb-6">
                                <span className="text-subtitle-en block mb-2">
                                    Trading Signal
                                </span>
                                <div
                                    className={[
                                        'text-giant-number',
                                        resultJson.enter
                                            ? 'text-green-400'
                                            : 'text-white/30',
                                    ].join(' ')}
                                >
                                    {resultJson.enter ? 'ENTER' : 'WAIT'}
                                </div>
                            </div>

                            {resultJson.enter ? (
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between p-4 rounded-xl bg-white/5 border border-white/10">
                                        <span className="text-label">方向 Direction</span>
                                        <div className="flex items-center gap-2">
                                            <i
                                                className={[
                                                    'fas',
                                                    resultJson.direction === 'long'
                                                        ? 'fa-arrow-up text-green-400'
                                                        : 'fa-arrow-down text-red-400',
                                                ].join(' ')}
                                            ></i>
                                            <span
                                                className={[
                                                    'text-xl font-bold',
                                                    resultJson.direction === 'long'
                                                        ? 'text-green-400'
                                                        : 'text-red-400',
                                                ].join(' ')}
                                            >
                                                {resultJson.direction?.toUpperCase()}
                                            </span>
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-between p-4 rounded-xl bg-white/5 border border-white/10">
                                        <span className="text-label">入场价 Entry</span>
                                        <span className="text-xl font-mono text-white">
                                            {formatPrice(resultJson.entry_price)}
                                        </span>
                                    </div>

                                    <div className="flex items-center justify-between p-4 rounded-xl bg-white/5 border border-white/10">
                                        <span className="text-label">止损 Stop Loss</span>
                                        <span className="text-xl font-mono text-red-400">
                                            {formatPrice(resultJson.stop_loss_price)}
                                        </span>
                                    </div>

                                    <div className="flex items-center justify-between p-4 rounded-xl bg-white/5 border border-white/10">
                                        <span className="text-label">止盈 Take Profit</span>
                                        <span className="text-xl font-mono text-green-400">
                                            {formatPrice(resultJson.take_profit_price)}
                                        </span>
                                    </div>

                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                                            <span className="text-label block mb-1">
                                                仓位 Position
                                            </span>
                                            <span className="text-lg font-mono text-white">
                                                {(resultJson.position_size * 100).toFixed(0)}%
                                            </span>
                                        </div>
                                        <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                                            <span className="text-label block mb-1">
                                                杠杆 Leverage
                                            </span>
                                            <span className="text-lg font-mono text-white">
                                                {resultJson.leverage || 1}x
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            ) : null}

                            <div className="mt-6 pt-6 border-t border-white/10">
                                <span className="text-label flex items-center gap-2 mb-3">
                                    <i className="fas fa-comment-alt"></i>
                                    分析理由 Reasoning
                                </span>
                                <p className="text-sm text-white/60 leading-relaxed max-h-32 overflow-y-auto scrollbar-glass">
                                    {resultJson.reason}
                                </p>
                            </div>

                            {resultJson.indicator_views ? (
                                <div className="mt-6 pt-6 border-t border-white/10">
                                    <IndicatorViewsCard views={resultJson.indicator_views} />
                                </div>
                            ) : null}
                        </div>
                    </div>
                ) : null}

                <div
                    className={[
                        resultJson ? 'bento-xl' : 'bento-full',
                        'glass-card p-6 animate-slide-up stagger-4',
                    ].join(' ')}
                >
                    <h3 className="text-label flex items-center gap-2 mb-4">
                        <i className="fas fa-terminal"></i>
                        日志输出 Logs
                    </h3>
                    <LogTerminal
                        logs={logs}
                        className="min-h-[200px] max-h-[300px]"
                    />
                </div>
            </div>
        </div>
    );
}
