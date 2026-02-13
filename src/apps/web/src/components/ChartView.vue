<script setup>
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { createChart, CrosshairMode, PriceScaleMode } from 'lightweight-charts';

const props = defineProps({
  data: Object,
  title: String,
  height: {
    type: Number,
    default: 500
  }
});

const chartContainer = ref(null);
let chart = null;
let candlestickSeries = null;
let volumeSeries = null;
const markers = ref([]);

function initChart() {
  if (!chartContainer.value || !props.data?.bars) return;

  const containerWidth = chartContainer.value.clientWidth;

  chart = createChart(chartContainer.value, {
    width: containerWidth,
    height: props.height,
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
      text: props.title || props.data?.symbol || 'Chart',
      fontSize: 32,
      color: 'rgba(255, 255, 255, 0.05)',
    },
  });

  // 主图K线
  candlestickSeries = chart.addCandlestickSeries({
    upColor: 'rgba(38, 166, 154, 1)',
    downColor: 'rgba(239, 83, 80, 1)',
    borderUpColor: 'rgba(38, 166, 154, 1)',
    borderDownColor: 'rgba(239, 83, 80, 1)',
    wickUpColor: 'rgba(38, 166, 154, 1)',
    wickDownColor: 'rgba(239, 83, 80, 1)',
  });

  // 成交量
  volumeSeries = chart.addHistogramSeries({
    color: 'rgba(76, 175, 254, 0.5)',
    priceFormat: {
      type: 'volume',
    },
    priceScaleId: '',
    scaleMargins: {
      top: 0.8,
      bottom: 0,
    },
  });

  // 设置数据
  const chartData = props.data.bars.map(bar => ({
    time: bar.time,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
  }));

  const volumeData = props.data.bars.map(bar => ({
    time: bar.time,
    value: bar.volume,
    color: bar.close >= bar.open ? 'rgba(38, 166, 154, 0.5)' : 'rgba(239, 83, 80, 0.5)',
  }));

  candlestickSeries.setData(chartData);
  volumeSeries.setData(volumeData);

  // 添加标注
  drawOverlays();
  
  // 自动调整可见范围
  chart.timeScale().fitContent();
}

function drawOverlays() {
  if (!props.data?.overlays || !candlestickSeries) return;

  const newMarkers = [];

  props.data.overlays.forEach(overlay => {
    try {
      if (overlay.type === 'horizontal_line' && overlay.price) {
        const priceLine = candlestickSeries.createPriceLine({
          price: overlay.price,
          color: overlay.color || 'rgba(0, 122, 255, 0.8)',
          lineWidth: overlay.width || 2,
          lineStyle: 2,
          axisLabelVisible: true,
          title: overlay.text || '',
        });
      }

      if ((overlay.type === 'marker' || overlay.type === 'label') && overlay.start) {
        const bar = props.data.bars[overlay.start.barIndex];
        if (bar) {
          newMarkers.push({
            time: bar.time,
            position: overlay.position === 'below' ? 'belowBar' : 'aboveBar',
            color: overlay.color || 'rgba(0, 122, 255, 0.9)',
            shape: overlay.shape || 'circle',
            text: overlay.text || '',
          });
        }
      }

      // 趋势线
      if (overlay.type === 'trend_line' && overlay.start && overlay.end) {
        const startBar = props.data.bars[overlay.start.barIndex];
        const endBar = props.data.bars[overlay.end.barIndex];
        
        if (startBar && endBar) {
          const line = candlestickSeries.createPriceLine({
            price: overlay.start.price,
            color: overlay.color || 'rgba(255, 152, 0, 0.8)',
            lineWidth: overlay.width || 2,
            lineStyle: 0,
            axisLabelVisible: false,
            title: overlay.text || '',
          });
        }
      }
    } catch (e) {
      console.warn('绘制标注失败:', e);
    }
  });

  if (newMarkers.length > 0) {
    candlestickSeries.setMarkers(newMarkers);
    markers.value = newMarkers;
  }
}

function resize() {
  if (!chart || !chartContainer.value) return;
  const containerWidth = chartContainer.value.clientWidth;
  chart.applyOptions({ width: containerWidth });
}

onMounted(() => {
  nextTick(() => {
    initChart();
  });
  window.addEventListener('resize', resize);
});

onUnmounted(() => {
  window.removeEventListener('resize', resize);
  if (chart) {
    chart.remove();
    chart = null;
  }
});

watch(() => props.data, () => {
  if (chart) {
    chart.remove();
    chart = null;
  }
  nextTick(() => {
    initChart();
  });
}, { deep: true });
</script>

<template>
  <div class="chart-container">
    <div ref="chartContainer" class="chart-canvas"></div>
  </div>
</template>

<style scoped>
.chart-container {
  width: 100%;
  height: 100%;
  position: relative;
  border-radius: 1rem;
  overflow: hidden;
}

.chart-canvas {
  width: 100%;
  height: 100%;
}
</style>
