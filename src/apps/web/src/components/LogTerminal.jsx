import { useEffect, useRef } from 'react';

export default function LogTerminal({ logs = [], className = '' }) {
    const containerRef = useRef(null);

    useEffect(() => {
        if (!containerRef.current) return;
        containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }, [logs.length]);

    return (
        <div
            ref={containerRef}
            className={[
                'terminal p-4 overflow-y-auto h-full min-h-[inherit] scrollbar text-left',
                className,
            ].join(' ')}
        >
            {logs.length === 0 ? (
                <div className="flex items-center gap-2 text-text-muted italic">
                    <i className="fas fa-terminal"></i>
                    <span>Waiting for output...</span>
                </div>
            ) : null}

            {logs.map((log, index) => (
                <div
                    key={index}
                    className="whitespace-pre-wrap break-all mb-1 leading-relaxed flex"
                >
                    <span className="log-time select-none mr-3 flex-shrink-0 tabular-nums">
                        [{new Date(log.timestamp).toLocaleTimeString()}]
                    </span>
                    <span
                        className={
                            log.type === 'stdout'
                                ? 'log-stdout'
                                : log.type === 'stderr'
                                  ? 'log-stderr'
                                  : log.type === 'error'
                                    ? 'log-error'
                                    : ''
                        }
                    >
                        {log.data}
                    </span>
                </div>
            ))}
        </div>
    );
}
