import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CustomSelect from '../components/CustomSelect.jsx';
import LogTerminal from '../components/LogTerminal.jsx';
import { authedFetch } from '../composables/useAuth.js';
import { useSocket } from '../composables/useSocket.js';

const padZero = (val) => String(val).padStart(2, '0');

export default function BacktestTab() {
    const { socket } = useSocket();

    const [config, setConfig] = useState({
        symbol: 'BTCUSDT',
        timeframe: '5m',
        bars: 200,
        startDate: '2024-12-01',
        startHour: '00',
        startMinute: '00',
        endDate: '2024-12-02',
        endHour: '23',
        endMinute: '59',
        workers: 4,
        enable4x: false,
    });

    const startTime = useMemo(
        () => `${config.startDate} ${padZero(config.startHour)}:${padZero(config.startMinute)}`,
        [config.startDate, config.startHour, config.startMinute],
    );

    const endTime = useMemo(
        () => `${config.endDate} ${padZero(config.endHour)}:${padZero(config.endMinute)}`,
        [config.endDate, config.endHour, config.endMinute],
    );

    const [isRunning, setIsRunning] = useState(false);
    const [logs, setLogs] = useState([]);
    const [pid, setPid] = useState(null);
    const pidRef = useRef(null);

    const timeframes = useMemo(() => ['5m', '15m', '1h', '4h'], []);
    const timeframeOptions = useMemo(
        () => timeframes.map((tf) => ({ value: tf, label: tf })),
        [timeframes],
    );

    const addLog = useCallback((type, data) => {
        setLogs((prev) => [...prev, { type, data, timestamp: Date.now() }]);
    }, []);

    const normalizeHour = useCallback((value) => {
        let val = parseInt(value, 10) || 0;
        if (val < 0) val = 0;
        if (val > 23) val = 23;
        return padZero(val);
    }, []);

    const normalizeMinute = useCallback((value) => {
        let val = parseInt(value, 10) || 0;
        if (val < 0) val = 0;
        if (val > 59) val = 59;
        return padZero(val);
    }, []);

    const runBacktest = useCallback(() => {
        setIsRunning(true);
        setLogs([]);
        setPid(null);
        pidRef.current = null;

        const args = [
            '--symbol',
            config.symbol,
            '--timeframe',
            config.timeframe,
            '--bars',
            String(config.bars),
            '--start-time',
            startTime,
            '--workers',
            String(config.workers),
            '--wait',
            '500',
        ];

        if (endTime) args.push('--end-time', endTime);
        if (config.enable4x) args.push('--enable-4x-chart');

        addLog('stdout', `Starting backtest.js with args: ${args.join(' ')}`);

        authedFetch('/api/run-script', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ script: 'backtest', args }),
        })
            .then((res) => res.json())
            .then((data) => {
                if (data.pid) {
                    setPid(data.pid);
                    pidRef.current = data.pid;
                    addLog('stdout', `Started with PID: ${data.pid}`);
                    return;
                }

                if (data.error) addLog('error', `Failed: ${data.error}`);
                setIsRunning(false);
            })
            .catch((err) => {
                addLog('error', `Error: ${err.message}`);
                setIsRunning(false);
            });
    }, [addLog, config, endTime, startTime]);

    const stopBacktest = useCallback(() => {
        if (pidRef.current) socket.emit('kill-process', pidRef.current);
    }, [socket]);

    useEffect(() => {
        const onLog = (msg) => addLog(msg.type, msg.data);

        const onProcessExit = (msg) => {
            if (!pidRef.current || msg.pid !== pidRef.current) return;
            addLog('stdout', `Exited with code ${msg.code}`);
            setIsRunning(false);
            setPid(null);
            pidRef.current = null;
            if (msg.code === 0) addLog('stdout', 'Complete. Check outputs/backtest.');
        };

        const onProcessKilled = (killedPid) => {
            if (!pidRef.current || killedPid !== pidRef.current) return;
            addLog('stderr', 'Terminated.');
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

    return (
        <div className="space-y-6">
            <div className="glass-card p-8 animate-slide-up">
                <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
                    <div>
                        <span className="text-subtitle-en mb-2 block">
                            Historical Strategy Validation
                        </span>
                        <h1 className="text-hero-cn text-apple-gradient">回测系统</h1>
                    </div>
                    <div className="flex items-center gap-4">
                        {isRunning ? (
                            <div className="badge-blue flex items-center gap-2">
                                <i className="fas fa-spinner fa-spin"></i>
                                {config.workers} Workers
                            </div>
                        ) : null}

                        {!isRunning ? (
                            <button
                                type="button"
                                onClick={runBacktest}
                                className="btn-glass h-14 px-8"
                            >
                                <i className="fas fa-play"></i>
                                <span className="font-bold">开始回测</span>
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={stopBacktest}
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
                    <h2 className="text-label flex items-center gap-2 mb-6">
                        <i className="fas fa-calendar-alt"></i>
                        Backtest Config
                    </h2>

                    <div className="space-y-5">
                        <div>
                            <label className="text-label block mb-2">交易对 Symbol</label>
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
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-label block mb-2">周期 Timeframe</label>
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

                        <div>
                            <label className="text-label block mb-2">开始时间 Start Time</label>
                            <div className="grid grid-cols-[1fr_auto_auto] gap-2">
                                <input
                                    value={config.startDate}
                                    onChange={(e) =>
                                        setConfig((prev) => ({
                                            ...prev,
                                            startDate: e.target.value,
                                        }))
                                    }
                                    type="date"
                                    className="input-glass text-sm"
                                />
                                <input
                                    value={config.startHour}
                                    onChange={(e) =>
                                        setConfig((prev) => ({
                                            ...prev,
                                            startHour: e.target.value,
                                        }))
                                    }
                                    onBlur={(e) =>
                                        setConfig((prev) => ({
                                            ...prev,
                                            startHour: normalizeHour(e.target.value),
                                        }))
                                    }
                                    type="text"
                                    maxLength={2}
                                    placeholder="00"
                                    className="input-glass text-sm w-16 text-center font-mono"
                                />
                                <input
                                    value={config.startMinute}
                                    onChange={(e) =>
                                        setConfig((prev) => ({
                                            ...prev,
                                            startMinute: e.target.value,
                                        }))
                                    }
                                    onBlur={(e) =>
                                        setConfig((prev) => ({
                                            ...prev,
                                            startMinute: normalizeMinute(e.target.value),
                                        }))
                                    }
                                    type="text"
                                    maxLength={2}
                                    placeholder="00"
                                    className="input-glass text-sm w-16 text-center font-mono"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="text-label block mb-2">结束时间 End Time</label>
                            <div className="grid grid-cols-[1fr_auto_auto] gap-2">
                                <input
                                    value={config.endDate}
                                    onChange={(e) =>
                                        setConfig((prev) => ({
                                            ...prev,
                                            endDate: e.target.value,
                                        }))
                                    }
                                    type="date"
                                    className="input-glass text-sm"
                                />
                                <input
                                    value={config.endHour}
                                    onChange={(e) =>
                                        setConfig((prev) => ({
                                            ...prev,
                                            endHour: e.target.value,
                                        }))
                                    }
                                    onBlur={(e) =>
                                        setConfig((prev) => ({
                                            ...prev,
                                            endHour: normalizeHour(e.target.value),
                                        }))
                                    }
                                    type="text"
                                    maxLength={2}
                                    placeholder="23"
                                    className="input-glass text-sm w-16 text-center font-mono"
                                />
                                <input
                                    value={config.endMinute}
                                    onChange={(e) =>
                                        setConfig((prev) => ({
                                            ...prev,
                                            endMinute: e.target.value,
                                        }))
                                    }
                                    onBlur={(e) =>
                                        setConfig((prev) => ({
                                            ...prev,
                                            endMinute: normalizeMinute(e.target.value),
                                        }))
                                    }
                                    type="text"
                                    maxLength={2}
                                    placeholder="59"
                                    className="input-glass text-sm w-16 text-center font-mono"
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3 pt-4 border-t border-white/10">
                            <div>
                                <label className="text-label flex items-center gap-1 mb-2">
                                    <i className="fas fa-microchip text-[10px]"></i>
                                    Workers
                                </label>
                                <input
                                    value={config.workers}
                                    onChange={(e) =>
                                        setConfig((prev) => ({
                                            ...prev,
                                            workers: Number(e.target.value || 0),
                                        }))
                                    }
                                    type="number"
                                    min="1"
                                    max="10"
                                    className="input-glass font-mono"
                                />
                            </div>
                            <div className="flex items-end pb-2">
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
                                    <span className="ml-3 text-xs text-white/70">4x</span>
                                </label>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="bento-sm glass-card p-6 flex flex-col justify-center animate-slide-up stagger-2">
                    <span className="text-subtitle-en mb-2">Total Trades</span>
                    <span className="text-giant-number text-white">--</span>
                    <span className="text-label mt-2">交易次数</span>
                </div>

                <div className="bento-sm glass-card p-6 flex flex-col justify-center animate-slide-up stagger-3">
                    <span className="text-subtitle-en mb-2">Win Rate</span>
                    <span className="text-giant-number text-green-400">--%</span>
                    <span className="text-label mt-2">胜率</span>
                </div>

                <div className="bento-sm glass-card p-6 flex flex-col justify-center animate-slide-up stagger-4">
                    <span className="text-subtitle-en mb-2">Profit Factor</span>
                    <span className="text-giant-number text-apple-gradient">--</span>
                    <span className="text-label mt-2">盈亏比</span>
                </div>

                <div className="bento-full glass-card p-6 animate-slide-up">
                    <h3 className="text-label flex items-center gap-2 mb-4">
                        <i className="fas fa-terminal"></i>
                        回测日志 Backtest Logs
                    </h3>
                    <LogTerminal logs={logs} className="min-h-[400px]" />
                </div>
            </div>
        </div>
    );
}
