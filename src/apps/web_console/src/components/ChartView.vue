<template>
    <div class="chart">
        <div ref="chartContainer" class="chart-canvas"></div>
    </div>
</template>

<script setup>
import { createChart, CrosshairMode, PriceScaleMode } from 'lightweight-charts';
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue';

const props = defineProps({
    data: { type: Object, default: null },
    title: { type: String, default: '' },
    height: { type: Number, default: 420 },
});

const chartContainer = ref(null);
let chart = null;
let candles = null;
let volume = null;

function destroy() {
    if (!chart) return;
    chart.remove();
    chart = null;
    candles = null;
    volume = null;
}

function drawOverlays() {
    if (!props.data?.overlays || !candles) return;
    const markers = [];

    for (const overlay of props.data.overlays) {
        try {
            if (overlay.type === 'horizontal_line' && overlay.price) {
                candles.createPriceLine({
                    price: overlay.price,
                    color: overlay.color || 'rgba(0, 122, 255, 0.8)',
                    lineWidth: overlay.width || 2,
                    lineStyle: 2,
                    axisLabelVisible: true,
                    title: overlay.text || '',
                });
            }

            if ((overlay.type === 'marker' || overlay.type === 'label') && overlay.start) {
                const bar = props.data.bars?.[overlay.start.barIndex];
                if (!bar) continue;
                markers.push({
                    time: bar.time,
                    position: overlay.position === 'below' ? 'belowBar' : 'aboveBar',
                    color: overlay.color || 'rgba(0, 122, 255, 0.9)',
                    shape: overlay.shape || 'circle',
                    text: overlay.text || '',
                });
            }
        } catch {
            // 这里忽略单条 overlay 的绘制异常，避免影响整体渲染
        }
    }

    if (markers.length) candles.setMarkers(markers);
}

function initChart() {
    if (!chartContainer.value || !props.data?.bars?.length) return;

    const width = chartContainer.value.clientWidth;
    chart = createChart(chartContainer.value, {
        width,
        height: props.height,
        layout: { background: { color: 'rgba(0, 0, 0, 0.85)' }, textColor: 'rgba(255, 255, 255, 0.75)' },
        grid: { vertLines: { color: 'rgba(255, 255, 255, 0.06)' }, horzLines: { color: 'rgba(255, 255, 255, 0.06)' } },
        crosshair: { mode: CrosshairMode.Normal },
        rightPriceScale: { borderColor: 'rgba(255, 255, 255, 0.12)', mode: PriceScaleMode.Normal },
        timeScale: { borderColor: 'rgba(255, 255, 255, 0.12)', timeVisible: true, secondsVisible: false },
        watermark: {
            visible: true,
            text: props.title || props.data?.symbol || 'Chart',
            fontSize: 28,
            color: 'rgba(255, 255, 255, 0.06)',
        },
    });

    candles = chart.addCandlestickSeries({
        upColor: 'rgba(38, 166, 154, 1)',
        downColor: 'rgba(239, 83, 80, 1)',
        borderUpColor: 'rgba(38, 166, 154, 1)',
        borderDownColor: 'rgba(239, 83, 80, 1)',
        wickUpColor: 'rgba(38, 166, 154, 1)',
        wickDownColor: 'rgba(239, 83, 80, 1)',
    });

    volume = chart.addHistogramSeries({
        priceFormat: { type: 'volume' },
        priceScaleId: '',
        scaleMargins: { top: 0.82, bottom: 0 },
    });

    const candleData = props.data.bars.map((b) => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close }));
    const volumeData = props.data.bars.map((b) => ({
        time: b.time,
        value: b.volume,
        color: b.close >= b.open ? 'rgba(38, 166, 154, 0.45)' : 'rgba(239, 83, 80, 0.45)',
    }));

    candles.setData(candleData);
    volume.setData(volumeData);
    drawOverlays();
    chart.timeScale().fitContent();
}

function resize() {
    if (!chart || !chartContainer.value) return;
    chart.applyOptions({ width: chartContainer.value.clientWidth });
}

onMounted(() => {
    nextTick(initChart);
    window.addEventListener('resize', resize);
});

onUnmounted(() => {
    window.removeEventListener('resize', resize);
    destroy();
});

watch(
    () => props.data,
    async () => {
        destroy();
        await nextTick();
        initChart();
    },
    { deep: true }
);
</script>

<style scoped>
.chart {
    width: 100%;
    border-radius: 1rem;
    overflow: hidden;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(0, 0, 0, 0.4);
}

.chart-canvas {
    width: 100%;
}
</style>

