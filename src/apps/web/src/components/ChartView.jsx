import { useEffect, useRef, useState } from 'react';
import { createChart, CrosshairMode, PriceScaleMode } from 'lightweight-charts';

function normalizeNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string') {
        const num = Number(value);
        return Number.isFinite(num) ? num : null;
    }
    return null;
}

function normalizeBarTime(value) {
    if (value instanceof Date && Number.isFinite(value.getTime())) {
        return Math.floor(value.getTime() / 1000);
    }

    if (typeof value === 'number') {
        if (!Number.isFinite(value)) return null;
        if (value > 1e12) return Math.floor(value / 1000);
        return Math.floor(value);
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return null;

        if (/^\d+$/.test(trimmed)) {
            const num = Number(trimmed);
            return normalizeBarTime(num);
        }

        const parsed = Date.parse(trimmed);
        if (!Number.isFinite(parsed)) return null;
        return Math.floor(parsed / 1000);
    }

    return null;
}

function drawOverlays({ data, candlestickSeries }) {
    if (!data?.overlays || !candlestickSeries) return;

    const newMarkers = [];

    data.overlays.forEach((overlay) => {
        try {
            if (overlay.type === 'horizontal_line') {
                const price = normalizeNumber(overlay.price);
                if (price == null) return;
                candlestickSeries.createPriceLine({
                    price,
                    color: overlay.color || 'rgba(0, 122, 255, 0.8)',
                    lineWidth: overlay.width || 2,
                    lineStyle: 2,
                    axisLabelVisible: true,
                    title: overlay.text || '',
                });
            }

            if ((overlay.type === 'marker' || overlay.type === 'label') && overlay.start) {
                const barIndex = overlay.start?.barIndex;
                const bar = typeof barIndex === 'number' ? data.bars?.[barIndex] : null;
                if (bar) {
                    const time = normalizeBarTime(bar.time);
                    if (time == null) return;
                    newMarkers.push({
                        time,
                        position: overlay.position === 'below' ? 'belowBar' : 'aboveBar',
                        color: overlay.color || 'rgba(0, 122, 255, 0.9)',
                        shape: overlay.shape || 'circle',
                        text: overlay.text || '',
                    });
                }
            }

            if (overlay.type === 'trend_line' && overlay.start && overlay.end) {
                const startIndex = overlay.start?.barIndex;
                const endIndex = overlay.end?.barIndex;
                const startBar = typeof startIndex === 'number' ? data.bars?.[startIndex] : null;
                const endBar = typeof endIndex === 'number' ? data.bars?.[endIndex] : null;
                const price = normalizeNumber(overlay.start?.price);
                if (!startBar || !endBar || price == null) return;
                candlestickSeries.createPriceLine({
                    price,
                    color: overlay.color || 'rgba(255, 152, 0, 0.8)',
                    lineWidth: overlay.width || 2,
                    lineStyle: 0,
                    axisLabelVisible: false,
                    title: overlay.text || '',
                });
            }
        } catch (e) {
            console.warn('绘制标注失败:', e);
        }
    });

    if (newMarkers.length > 0) {
        try {
            candlestickSeries.setMarkers(newMarkers);
        } catch (e) {
            console.warn('设置 markers 失败:', e);
        }
    }
}

export default function ChartView({ data, title, height = 500 }) {
    const chartContainerRef = useRef(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        const container = chartContainerRef.current;
        const bars = Array.isArray(data?.bars) ? data.bars : null;
        if (!container || !bars || bars.length === 0) return;

        setError(null);

        let chart = null;
        let resizeObserver = null;

        const safeHeight = (() => {
            const num = normalizeNumber(height);
            return num && num > 0 ? num : 500;
        })();

        function getContainerWidth() {
            const width = container.clientWidth || Math.floor(container.getBoundingClientRect().width);
            return Number.isFinite(width) ? width : 0;
        }

        function prepareSeriesData() {
            const candles = [];
            const volumes = [];

            for (const bar of bars) {
                const time = normalizeBarTime(bar?.time);
                const open = normalizeNumber(bar?.open);
                const high = normalizeNumber(bar?.high);
                const low = normalizeNumber(bar?.low);
                const close = normalizeNumber(bar?.close);
                const volume = normalizeNumber(bar?.volume) ?? 0;

                if (time == null || open == null || high == null || low == null || close == null) {
                    return { candles: null, volumes: null };
                }

                candles.push({ time, open, high, low, close });
                volumes.push({
                    time,
                    value: volume,
                    color:
                        close >= open
                            ? 'rgba(38, 166, 154, 0.5)'
                            : 'rgba(239, 83, 80, 0.5)',
                });
            }

            return { candles, volumes };
        }

        function initChart() {
            if (chart) return true;

            const width = getContainerWidth();
            if (!width) return false;

            const { candles, volumes } = prepareSeriesData();
            if (!candles || !volumes) {
                setError('图表数据格式不正确（bars.time/open/high/low/close 必须为有效数字）');
                return false;
            }
            try {
                chart = createChart(container, {
                    width,
                    height: safeHeight,
                    layout: {
                        background: { color: 'rgba(17, 17, 27, 0.95)' },
                        textColor: 'rgba(255, 255, 255, 0.7)',
                    },
                    grid: {
                        vertLines: { color: 'rgba(255, 255, 255, 0.05)' },
                        horzLines: { color: 'rgba(255, 255, 255, 0.05)' },
                    },
                    crosshair: {
                        mode: CrosshairMode.Normal,
                        vertLine: {
                            color: 'rgba(255, 255, 255, 0.3)',
                            labelBackgroundColor: 'rgba(0, 122, 255, 0.8)',
                        },
                        horzLine: {
                            color: 'rgba(255, 255, 255, 0.3)',
                            labelBackgroundColor: 'rgba(0, 122, 255, 0.8)',
                        },
                    },
                    rightPriceScale: {
                        borderColor: 'rgba(255, 255, 255, 0.1)',
                        mode: PriceScaleMode.Normal,
                    },
                    timeScale: {
                        borderColor: 'rgba(255, 255, 255, 0.1)',
                        timeVisible: true,
                        secondsVisible: false,
                    },
                    watermark: {
                        visible: true,
                        text: title || data?.symbol || 'Chart',
                        fontSize: 32,
                        color: 'rgba(255, 255, 255, 0.05)',
                    },
                });

                const candlestickSeries = chart.addCandlestickSeries({
                    upColor: 'rgba(38, 166, 154, 1)',
                    downColor: 'rgba(239, 83, 80, 1)',
                    borderUpColor: 'rgba(38, 166, 154, 1)',
                    borderDownColor: 'rgba(239, 83, 80, 1)',
                    wickUpColor: 'rgba(38, 166, 154, 1)',
                    wickDownColor: 'rgba(239, 83, 80, 1)',
                });

                const volumeSeries = chart.addHistogramSeries({
                    color: 'rgba(76, 175, 254, 0.5)',
                    priceFormat: { type: 'volume' },
                    priceScaleId: '',
                    scaleMargins: {
                        top: 0.8,
                        bottom: 0,
                    },
                });

                candlestickSeries.setData(candles);
                volumeSeries.setData(volumes);

                drawOverlays({ data, candlestickSeries });
                chart.timeScale().fitContent();
                return true;
            } catch (e) {
                try {
                    chart?.remove?.();
                } catch {
                    // 忽略
                }
                chart = null;
                setError(e?.message || String(e));
                return false;
            }
        }

        function safeApplyWidth() {
            if (!chart) return;
            const width = getContainerWidth();
            if (!width) return;
            try {
                chart.applyOptions({ width });
            } catch (e) {
                console.warn('图表 resize 失败:', e);
            }
        }

        function onWindowResize() {
            safeApplyWidth();
        }

        try {
            initChart();

            if (typeof ResizeObserver === 'function') {
                resizeObserver = new ResizeObserver(() => {
                    if (!chart) {
                        try {
                            initChart();
                        } catch (e) {
                            setError(e?.message || String(e));
                        }
                        return;
                    }
                    safeApplyWidth();
                });
                resizeObserver.observe(container);
            }

            window.addEventListener('resize', onWindowResize);
        } catch (e) {
            setError(e?.message || String(e));
        }

        return () => {
            window.removeEventListener('resize', onWindowResize);
            if (resizeObserver) resizeObserver.disconnect();
            if (chart) {
                try {
                    chart.remove();
                } catch {
                    // 忽略
                }
                chart = null;
            }
        };
    }, [data, height, title]);

    return (
        <div className="chart-view chart-container">
            <div ref={chartContainerRef} className="chart-canvas"></div>
            {error ? (
                <div className="absolute inset-0 flex items-center justify-center p-4 bg-black/60">
                    <div className="text-sm text-white/70 text-center">
                        <div className="font-semibold text-white/85 mb-2">
                            图表渲染失败
                        </div>
                        <div className="font-mono break-all">{error}</div>
                    </div>
                </div>
            ) : null}
        </div>
    );
}
