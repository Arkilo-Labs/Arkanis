import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
        const onLog = (msg) => {
            if (msg?.source === 'roundtable') return;
            addLog(msg.type, msg.data);
        };

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
            <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
                <div>
                    <div className="text-xs tracking-wide text-text-muted">
                        Historical Strategy Validation
                    </div>
                    <h1 className="text-2xl md:text-3xl font-bold mt-2">
                        回测系统
                    </h1>
                    {isRunning && pid ? (
                        <div className="text-xs text-text-muted mt-2">
                            PID: <span className="font-mono">{pid}</span>
                        </div>
                    ) : null}
                </div>

                <div className="flex items-center gap-3">
                    {isRunning ? (
                        <span className="badge badge-accent">
                            <i className="fas fa-spinner fa-spin"></i>
                            {config.workers} Workers
                        </span>
                    ) : null}

                    {!isRunning ? (
                        <button
                            type="button"
                            onClick={runBacktest}
                            className="btn btn-primary"
                        >
                            <i className="fas fa-play"></i>
                            开始回测
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={stopBacktest}
                            className="btn btn-danger"
                        >
                            <i className="fas fa-stop"></i>
                            停止
                        </button>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="card card-hover p-6 lg:col-span-2">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-sm font-semibold">回测配置</h2>
                        <span className="text-xs text-text-muted">Backtest Config</span>
                    </div>

                    <div className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                                    disabled={isRunning}
                                />
                            </div>

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
                                    disabled={isRunning}
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
                                    disabled={isRunning}
                                />
                            </div>

                            <div>
                                <label className="form-label">Workers</label>
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
                                    className="form-input font-mono"
                                    disabled={isRunning}
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                            <div>
                                <label className="form-label">开始时间 Start Time</label>
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
                                        className="form-input text-sm"
                                        disabled={isRunning}
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
                                        className="form-input text-sm w-16 text-center font-mono"
                                        disabled={isRunning}
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
                                        className="form-input text-sm w-16 text-center font-mono"
                                        disabled={isRunning}
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="form-label">结束时间 End Time</label>
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
                                        className="form-input text-sm"
                                        disabled={isRunning}
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
                                        className="form-input text-sm w-16 text-center font-mono"
                                        disabled={isRunning}
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
                                        className="form-input text-sm w-16 text-center font-mono"
                                        disabled={isRunning}
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="pt-4 border-t border-border-light/10">
                            <label
                                className={[
                                    'switch',
                                    isRunning ? 'opacity-60 cursor-not-allowed' : '',
                                ].join(' ')}
                            >
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
                                <span className="switch-control">
                                    <span className="switch-track"></span>
                                    <span className="switch-thumb"></span>
                                </span>
                                <span className="text-sm text-text-muted">4x</span>
                            </label>
                        </div>
                    </div>
                </div>

                <div className="space-y-6 lg:col-span-1">
                    <div className="card card-hover p-6">
                        <div className="text-xs tracking-wide text-text-muted">
                            Total Trades
                        </div>
                        <div className="text-4xl font-bold mt-2">--</div>
                        <div className="text-xs text-text-muted mt-2">交易次数</div>
                    </div>

                    <div className="card card-hover p-6">
                        <div className="text-xs tracking-wide text-text-muted">
                            Win Rate
                        </div>
                        <div className="text-4xl font-bold mt-2 text-success">--%</div>
                        <div className="text-xs text-text-muted mt-2">胜率</div>
                    </div>

                    <div className="card card-hover p-6">
                        <div className="text-xs tracking-wide text-text-muted">
                            Profit Factor
                        </div>
                        <div className="text-4xl font-bold mt-2">--</div>
                        <div className="text-xs text-text-muted mt-2">盈亏比</div>
                    </div>
                </div>

                <div className="card card-hover p-6 lg:col-span-3">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-sm font-semibold">回测日志</h3>
                        <span className="text-xs text-text-muted">Backtest Logs</span>
                    </div>
                    <LogTerminal logs={logs} className="min-h-[420px]" />
                </div>
            </div>
        </div>
    );
}
