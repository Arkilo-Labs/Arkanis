import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CustomSelect from '../components/CustomSelect.jsx';
import IndicatorViewsCard from '../components/IndicatorViewsCard.jsx';
import LogTerminal from '../components/LogTerminal.jsx';
import { authedFetch } from '../composables/useAuth.js';
import { useSocket } from '../composables/useSocket.js';

export default function RunTab() {
    const { socket } = useSocket();

    const [config, setConfig] = useState({
        symbol: 'BTCUSDT',
        timeframe: '1h',
        bars: 200,
        enable4x: false,
        auxTimeframe: '',
        intervalMinutes: 15,
        enableTelegram: true,
    });

    const [isRunning, setIsRunning] = useState(false);
    const isRunningRef = useRef(false);
    const [logs, setLogs] = useState([]);
    const [pid, setPid] = useState(null);
    const pidRef = useRef(null);
    const sessionIdRef = useRef(null);
    const [history, setHistory] = useState([]);
    const timerRef = useRef(null);
    const [nextRunTime, setNextRunTime] = useState(null);
    const [currentTime, setCurrentTime] = useState(Date.now());

    useEffect(() => {
        isRunningRef.current = isRunning;
    }, [isRunning]);

    const timeframes = useMemo(() => ['1m', '5m', '15m', '30m', '1h', '4h', '1d'], []);
    const timeframeOptions = useMemo(
        () => timeframes.map((tf) => ({ value: tf, label: tf })),
        [timeframes],
    );
    const auxTimeframeOptions = useMemo(
        () => [{ value: '', label: 'Auto' }, ...timeframes.map((tf) => ({ value: tf, label: tf }))],
        [timeframes],
    );

    const countdown = useMemo(() => {
        if (!nextRunTime) return '-';
        const remaining = Math.max(0, nextRunTime - currentTime);
        const minutes = Math.floor(remaining / 60000);
        const seconds = Math.floor((remaining % 60000) / 1000);
        return `${minutes}:${String(seconds).padStart(2, '0')}`;
    }, [currentTime, nextRunTime]);

    const addLog = useCallback((type, data) => {
        setLogs((prev) => [...prev, { type, data, timestamp: Date.now() }]);
    }, []);

    const addToHistory = useCallback((item) => {
        setHistory((prev) => {
            const next = [{ ...item, timestamp: Date.now() }, ...prev];
            if (next.length > 50) next.pop();
            return next;
        });
    }, []);

    const sendToTelegram = useCallback(
        async (decision, retryCount = 3) => {
            if (!config.enableTelegram) return;

            const fullDecision = { ...decision, symbol: config.symbol, timeframe: config.timeframe };

            for (let attempt = 1; attempt <= retryCount; attempt += 1) {
                try {
                    const response = await authedFetch('/api/send-telegram', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ decision: fullDecision }),
                    });

                    if (!response.ok) throw new Error(`HTTP ${response.status}`);

                    addLog('stdout', `入场信号已发送到 Telegram (${config.symbol} ${config.timeframe})`);
                    return;
                } catch (err) {
                    if (attempt < retryCount) {
                        addLog(
                            'stdout',
                            `Telegram 发送失败 (尝试 ${attempt}/${retryCount})，${2 * attempt} 秒后重试...`,
                        );
                        await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
                        continue;
                    }
                    addLog('error', `Telegram 发送失败，已重试 ${retryCount} 次: ${err.message}`);
                }
            }
        },
        [addLog, config.enableTelegram, config.symbol, config.timeframe],
    );

    const scheduleNextRun = useCallback(() => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }

        if (!isRunningRef.current) {
            setNextRunTime(null);
            return;
        }

        const intervalMs = config.intervalMinutes * 60 * 1000;
        setNextRunTime(Date.now() + intervalMs);
        timerRef.current = setTimeout(() => {
            runSingleAnalysisRef.current?.();
        }, intervalMs);
    }, [config.intervalMinutes]);

    const runSingleAnalysisRef = useRef(null);

    const runSingleAnalysis = useCallback(() => {
        if (pidRef.current) {
            addLog('error', '已有任务正在运行，请等待完成');
            return;
        }

        setLogs([]);
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

        addLog('stdout', `运行策略分析: ${config.symbol} ${config.timeframe}`);

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
                    addLog('stdout', `进程已启动 PID: ${data.pid}`);
                    return;
                }

                if (data.error) addLog('error', `启动失败: ${data.error}`);
                setPid(null);
                pidRef.current = null;
            })
            .catch((err) => {
                addLog('error', `API 错误: ${err.message}`);
                setPid(null);
                pidRef.current = null;
            });
    }, [addLog, config]);

    useEffect(() => {
        runSingleAnalysisRef.current = runSingleAnalysis;
    }, [runSingleAnalysis]);

    const startAutoRun = useCallback(() => {
        if (isRunningRef.current) return;

        setIsRunning(true);
        isRunningRef.current = true;
        addLog('stdout', `启动定时运行，间隔: ${config.intervalMinutes} 分钟`);
        runSingleAnalysisRef.current?.();
    }, [addLog, config.intervalMinutes]);

    const stopAutoRun = useCallback(() => {
        setIsRunning(false);
        isRunningRef.current = false;
        setNextRunTime(null);

        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }

        if (pidRef.current) socket.emit('kill-process', pidRef.current);

        addLog('stdout', '定时运行已停止');
    }, [addLog, socket]);

    const formatTime = useCallback((timestamp) => {
        const date = new Date(timestamp);
        return date.toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        });
    }, []);

    useEffect(() => {
        const interval = setInterval(() => {
            setCurrentTime(Date.now());
        }, 1000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        const onLog = (msg) => addLog(msg.type, msg.data);

        const onProcessExit = async (msg) => {
            if (!pidRef.current || msg.pid !== pidRef.current) return;

            addLog('stdout', `进程退出 code ${msg.code}`);
            setPid(null);
            pidRef.current = null;

            const sessionId = sessionIdRef.current;

            if (msg.code === 0 && sessionId) {
                try {
                    const response = await authedFetch(`/api/chart-data/${sessionId}`);
                    if (!response.ok) throw new Error('获取图表数据失败');

                    const data = await response.json();
                    const decision = data.decision;

                    addToHistory({
                        symbol: config.symbol,
                        timeframe: config.timeframe,
                        enter: decision?.enter || false,
                        direction: decision?.direction || '',
                        confidence: decision?.confidence || 0,
                        entry_price: decision?.entry_price,
                        reason: decision?.reason || '',
                        indicator_views: decision?.indicator_views,
                    });

                    if (decision?.enter) {
                        addLog('stdout', `检测到入场信号: ${decision.direction?.toUpperCase()}`);
                        await sendToTelegram(decision);
                    }

                    addLog('stdout', '分析完成');
                } catch (e) {
                    console.error('处理结果错误:', e);
                    addLog('error', `处理结果失败: ${e.message}`);

                    addToHistory({
                        symbol: config.symbol,
                        timeframe: config.timeframe,
                        enter: false,
                        error: e.message,
                    });
                }
            } else if (msg.code !== 0) {
                addToHistory({
                    symbol: config.symbol,
                    timeframe: config.timeframe,
                    enter: false,
                    error: `退出码: ${msg.code}`,
                });
            }

            if (isRunningRef.current) scheduleNextRun();
        };

        const onProcessKilled = (killedPid) => {
            if (!pidRef.current || killedPid !== pidRef.current) return;
            addLog('stderr', '进程已终止');
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
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, [addLog, addToHistory, config, scheduleNextRun, sendToTelegram, socket]);

    function formatPrice(value) {
        if (value === null || value === undefined || value === 0) return '-';
        if (value === 'market') return '市价';
        const num = Number(value);
        if (!Number.isFinite(num)) return '-';
        return num.toFixed(6);
    }

    return (
        <div className="run-tab space-y-6">
            <div className="glass-card p-8 animate-slide-up">
                <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
                    <div>
                        <span className="text-subtitle-en mb-2 block">
                            Automated Trading Analysis
                        </span>
                        <h1 className="text-hero-cn text-apple-gradient">自动运行</h1>
                    </div>
                    <div className="flex items-center gap-4">
                        {isRunning && nextRunTime ? (
                            <div className="text-right">
                                <span className="text-label block mb-1">下次运行</span>
                                <span className="text-big-number text-apple-gradient">
                                    {countdown}
                                </span>
                            </div>
                        ) : null}

                        {!isRunning ? (
                            <button
                                type="button"
                                onClick={startAutoRun}
                                className="btn-glass h-14 px-8"
                            >
                                <i className="fas fa-play"></i>
                                <span className="font-bold">启动自动运行</span>
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={stopAutoRun}
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
                                    disabled={isRunning}
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
                                        disabled={isRunning}
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
                                        disabled={isRunning}
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="text-label block mb-2">
                                    运行间隔 (分钟)
                                </label>
                                <input
                                    value={config.intervalMinutes}
                                    onChange={(e) =>
                                        setConfig((prev) => ({
                                            ...prev,
                                            intervalMinutes: Number(e.target.value || 0),
                                        }))
                                    }
                                    type="number"
                                    min="1"
                                    className="input-glass font-mono"
                                    disabled={isRunning}
                                />
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
                                        disabled={isRunning}
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
                                        disabled={isRunning}
                                    />
                                </div>
                            ) : null}

                            <div className="pt-4 border-t border-white/10">
                                <label className="toggle-glass">
                                    <input
                                        checked={config.enableTelegram}
                                        onChange={(e) =>
                                            setConfig((prev) => ({
                                                ...prev,
                                                enableTelegram: e.target.checked,
                                            }))
                                        }
                                        type="checkbox"
                                    />
                                    <div className="toggle-track"></div>
                                    <div className="toggle-thumb"></div>
                                    <span className="ml-3 text-sm text-white/70">
                                        入场时发送 Telegram 通知
                                    </span>
                                </label>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="bento-lg glass-card p-6 animate-slide-up stagger-2">
                    <h3 className="text-label flex items-center gap-2 mb-4">
                        <i className="fas fa-history"></i>
                        运行历史 History
                    </h3>

                    <div className="space-y-2 max-h-[400px] overflow-y-auto scrollbar-glass">
                        {history.map((item, index) => (
                            <div
                                key={index}
                                className="p-4 rounded-xl bg-white/5 border border-white/10 hover:bg-white/[0.07] transition-colors"
                            >
                                <div className="flex items-start justify-between mb-2">
                                    <div className="flex items-center gap-3">
                                        <span className="text-xs text-white/40">
                                            {formatTime(item.timestamp)}
                                        </span>
                                        <span className="text-sm font-mono text-white/70">
                                            {item.symbol} {item.timeframe}
                                        </span>
                                    </div>
                                    {item.enter ? (
                                        <div className="flex items-center gap-2">
                                            <i
                                                className={[
                                                    'fas text-sm',
                                                    item.direction === 'long'
                                                        ? 'fa-arrow-up text-green-400'
                                                        : 'fa-arrow-down text-red-400',
                                                ].join(' ')}
                                            ></i>
                                            <span
                                                className={[
                                                    'text-sm font-bold',
                                                    item.direction === 'long'
                                                        ? 'text-green-400'
                                                        : 'text-red-400',
                                                ].join(' ')}
                                            >
                                                {item.direction?.toUpperCase()}
                                            </span>
                                            <span className="text-xs text-white/50 ml-2">
                                                {(item.confidence * 100).toFixed(0)}%
                                            </span>
                                        </div>
                                    ) : (
                                        <span className="text-xs text-white/30">WAIT</span>
                                    )}
                                </div>

                                {item.enter && item.entry_price ? (
                                    <div className="text-xs text-white/50 font-mono">
                                        入场: {formatPrice(item.entry_price)}
                                    </div>
                                ) : null}

                                {item.error ? (
                                    <div className="text-xs text-red-400 mt-2">
                                        错误: {item.error}
                                    </div>
                                ) : null}

                                {item.reason ? (
                                    <div className="text-xs text-white/40 mt-2 line-clamp-2">
                                        {item.reason}
                                    </div>
                                ) : null}

                                {item.indicator_views ? (
                                    <div className="mt-3">
                                        <IndicatorViewsCard
                                            views={item.indicator_views}
                                            title="指标观点（本次）"
                                        />
                                    </div>
                                ) : null}
                            </div>
                        ))}

                        {history.length === 0 ? (
                            <div className="py-12 text-center">
                                <div className="flex flex-col items-center gap-4 opacity-40">
                                    <i className="fas fa-inbox text-white/30 text-3xl"></i>
                                    <span className="text-white/50 text-sm">
                                        暂无运行记录
                                    </span>
                                </div>
                            </div>
                        ) : null}
                    </div>
                </div>

                <div className="bento-full glass-card p-6 animate-slide-up stagger-3">
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
