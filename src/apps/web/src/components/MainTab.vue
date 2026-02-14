<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue';
	import LogTerminal from './LogTerminal.vue';
	import CustomSelect from './CustomSelect.vue';
	import ChartView from './ChartView.vue';
	import IndicatorViewsCard from './IndicatorViewsCard.vue';
	import { useSocket } from '../composables/useSocket';
	import { authedFetch } from '../composables/useAuth';

const { socket } = useSocket();

const config = ref({
  symbol: 'BTCUSDT',
  timeframe: '1h',
  bars: 200,
  enable4x: false,
  auxTimeframe: ''
});

const isRunning = ref(false);
const logs = ref([]);
const pid = ref(null);
const sessionId = ref(null);
const baseChartData = ref(null);
const auxChartData = ref(null);
const vlmChartData = ref(null);
const resultJson = ref(null);
const showChartGallery = ref(false);

const timeframes = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];

const timeframeOptions = computed(() => 
  timeframes.map(tf => ({ value: tf, label: tf }))
);

const auxTimeframeOptions = computed(() => [
  { value: '', label: 'Auto' },
  ...timeframes.map(tf => ({ value: tf, label: tf }))
]);

function addLog(type, data) {
  logs.value.push({ type, data, timestamp: Date.now() });
}

function runScript() {
  isRunning.value = true;
  logs.value = [];
  baseChartData.value = null;
  auxChartData.value = null;
  vlmChartData.value = null;
  resultJson.value = null;
  showChartGallery.value = false;
  pid.value = null;
  sessionId.value = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  const args = [
    '--symbol', config.value.symbol,
    '--timeframe', config.value.timeframe,
    '--bars', config.value.bars.toString(),
    '--wait', '1000',
    '--session-id', sessionId.value
  ];

  if (config.value.enable4x) {
    args.push('--enable-4x-chart');
    if (config.value.auxTimeframe) {
      args.push('--aux-timeframe', config.value.auxTimeframe);
    }
  }

  addLog('stdout', `Starting main.js with args: ${args.join(' ')}`);

	  authedFetch('/api/run-script', {
	    method: 'POST',
	    headers: { 'Content-Type': 'application/json' },
	    body: JSON.stringify({ script: 'main', args })
	  })
	  .then(res => res.json())
  .then(data => {
    if (data.pid) {
      pid.value = data.pid;
      addLog('stdout', `Process started with PID: ${data.pid}`);
    } else if (data.error) {
       addLog('error', `Failed to start: ${data.error}`);
       isRunning.value = false;
    }
  })
  .catch(err => {
    addLog('error', `API Error: ${err.message}`);
    isRunning.value = false;
  });
}

function stopScript() {
  if (pid.value) {
    socket.emit('kill-process', pid.value);
  }
}

const onLog = (msg) => addLog(msg.type, msg.data);
const onProcessExit = (msg) => {
  addLog('stdout', `Process exited with code ${msg.code}`);
  isRunning.value = false;
  pid.value = null;

  if (msg.code === 0 && sessionId.value) {
    // 从API获取图表数据
	    authedFetch(`/api/chart-data/${sessionId.value}`)
	      .then(r => {
	        if (!r.ok) throw new Error('Failed to fetch chart data');
	        return r.json();
	      })
      .then(data => {
        baseChartData.value = data.base;
        auxChartData.value = data.aux;
        vlmChartData.value = data.vlm;
        resultJson.value = data.decision;
        showChartGallery.value = true;
        addLog('stdout', 'Chart data loaded successfully');
      })
      .catch(e => {
        console.error('Load chart data error:', e);
        addLog('error', `Failed to load chart data: ${e.message}`);
      });
  }
};
const onProcessKilled = (killedPid) => {
  if (killedPid === pid.value) {
    addLog('stderr', 'Process terminated.');
    isRunning.value = false;
    pid.value = null;
  }
};

onMounted(() => {
  socket.on('log', onLog);
  socket.on('process-exit', onProcessExit);
  socket.on('process-killed', onProcessKilled);
});

onUnmounted(() => {
  socket.off('log', onLog);
  socket.off('process-exit', onProcessExit);
  socket.off('process-killed', onProcessKilled);
});

function formatPrice(value) {
  if (value === null || value === undefined || value === 0) return '-';
  if (value === 'market') return '市价';
  const num = Number(value);
  if (!Number.isFinite(num)) return '-';
  return num.toFixed(6);
}
</script>

<template>
  <div class="space-y-6">
    <!-- Hero Section -->
    <div class="glass-card p-8 animate-slide-up">
      <div class="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
        <div>
          <span class="text-subtitle-en mb-2 block">AI-Powered Trading Analysis</span>
          <h1 class="text-hero-cn text-apple-gradient">策略分析</h1>
        </div>
        <div class="flex items-center gap-4">
          <div v-if="resultJson" class="text-right">
            <span class="text-label block mb-1">Confidence</span>
            <span class="text-big-number text-apple-gradient">{{ (resultJson.confidence * 100).toFixed(0) }}%</span>
          </div>
          <button 
            v-if="!isRunning"
            @click="runScript"
            class="btn-glass h-14 px-8"
          >
            <i class="fas fa-play"></i>
            <span class="font-bold">开始分析</span>
          </button>
          <button 
            v-else
            @click="stopScript"
            class="btn-glass btn-glass-danger h-14 px-8"
          >
            <i class="fas fa-stop"></i>
            <span class="font-bold">停止</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Bento Grid -->
    <div class="bento-grid">
      
      <!-- Config Card -->
      <div class="bento-md glass-card p-6 animate-slide-up stagger-1">
        <div class="liquidGlass-content">
          <h2 class="text-label flex items-center gap-2 mb-6">
            <i class="fas fa-sliders-h"></i>
            Configuration
          </h2>
          
          <div class="space-y-5">
            <!-- Symbol -->
            <div>
              <label class="text-label block mb-2">交易对 Symbol</label>
              <input 
                v-model="config.symbol" 
                type="text" 
                class="input-glass font-mono"
                placeholder="BTCUSDT"
              />
            </div>

            <!-- Timeframe & Bars -->
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="text-label block mb-2">周期 Timeframe</label>
                <CustomSelect 
                  v-model="config.timeframe" 
                  :options="timeframeOptions"
                />
              </div>
              <div>
                <label class="text-label block mb-2">K线数 Bars</label>
                <input v-model.number="config.bars" type="number" class="input-glass font-mono" />
              </div>
            </div>

            <!-- 4x Toggle -->
            <div class="pt-4 border-t border-white/10">
              <label class="toggle-glass">
                <input v-model="config.enable4x" type="checkbox">
                <div class="toggle-track"></div>
                <div class="toggle-thumb"></div>
                <span class="ml-3 text-sm text-white/70">4x Chart Mode</span>
              </label>
            </div>
            
            <div v-if="config.enable4x" class="animate-fade-in">
              <label class="text-label block mb-2">辅助周期 Aux Timeframe</label>
              <CustomSelect 
                v-model="config.auxTimeframe" 
                :options="auxTimeframeOptions"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- Chart Display -->
      <div class="bento-xl glass-card min-h-[500px] animate-slide-up stagger-2">
        <!-- Chart Gallery -->
        <div v-if="showChartGallery" class="w-full h-full p-4">
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <!-- Base Chart -->
            <div v-if="baseChartData" class="space-y-2">
              <div class="flex items-center gap-2 px-2">
                <i class="fas fa-chart-line text-blue-400 text-xs"></i>
                <span class="text-label">Base Chart ({{ config.timeframe }})</span>
              </div>
              <div class="rounded-xl border border-white/10 overflow-hidden">
                <ChartView :data="baseChartData" :title="`${config.symbol} ${config.timeframe}`" :height="400" />
              </div>
            </div>

            <!-- Aux Chart (4x) -->
            <div v-if="auxChartData" class="space-y-2">
              <div class="flex items-center gap-2 px-2">
                <i class="fas fa-chart-area text-purple-400 text-xs"></i>
                <span class="text-label">4x Chart (Higher Timeframe)</span>
              </div>
              <div class="rounded-xl border border-white/10 overflow-hidden">
                <ChartView :data="auxChartData" :title="`${config.symbol} ${auxChartData.timeframe || '4x'}`" :height="400" />
              </div>
            </div>

            <!-- VLM Decision Chart (Full Width) -->
            <div v-if="vlmChartData" :class="auxChartData ? 'lg:col-span-2' : 'lg:col-span-2'" class="space-y-2">
              <div class="flex items-center gap-2 px-2">
                <i class="fas fa-brain text-green-400 text-xs"></i>
                <span class="text-label">VLM Analysis Result</span>
              </div>
              <div class="rounded-xl border border-white/10 overflow-hidden">
                <ChartView :data="vlmChartData" :title="`${config.symbol} ${config.timeframe} - VLM Analysis`" :height="500" />
              </div>
            </div>
          </div>
        </div>

        <!-- Loading State -->
        <div v-else-if="isRunning" class="w-full h-full flex items-center justify-center p-4">
          <div class="flex flex-col items-center gap-4">
            <div class="w-16 h-16 rounded-2xl bg-blue-500/20 flex items-center justify-center">
              <svg class="spinner-custom" width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="16" cy="4" r="2.5" fill="rgba(255, 255, 255, 0.9)" />
                <circle cx="23.8" cy="8.2" r="2.5" fill="rgba(255, 255, 255, 0.8)" />
                <circle cx="27.8" cy="16" r="2.5" fill="rgba(255, 255, 255, 0.7)" />
                <circle cx="23.8" cy="23.8" r="2.5" fill="rgba(255, 255, 255, 0.6)" />
                <circle cx="16" cy="28" r="2.5" fill="rgba(255, 255, 255, 0.5)" />
                <circle cx="8.2" cy="23.8" r="2.5" fill="rgba(255, 255, 255, 0.4)" />
                <circle cx="4.2" cy="16" r="2.5" fill="rgba(255, 255, 255, 0.3)" />
                <circle cx="8.2" cy="8.2" r="2.5" fill="rgba(255, 255, 255, 0.2)" />
              </svg>
            </div>
            <div class="text-center">
              <span class="text-white/80 text-lg font-medium block">分析中</span>
              <span class="text-white/40 text-sm">Processing...</span>
            </div>
          </div>
        </div>

        <!-- Empty State -->
        <div v-else class="w-full h-full flex items-center justify-center p-4">
          <div class="flex flex-col items-center gap-4 opacity-40">
            <div class="w-20 h-20 rounded-3xl bg-white/5 border border-white/10 flex items-center justify-center">
              <i class="fas fa-chart-area text-white/30 text-3xl"></i>
            </div>
            <div class="text-center">
              <span class="text-white/50 text-lg block">等待分析</span>
              <span class="text-white/30 text-sm">Ready to analyze</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Decision Panel -->
      <div v-if="resultJson" class="bento-md glass-card p-6 animate-slide-up stagger-3">
        <div class="liquidGlass-content">
          <h2 class="text-label flex items-center gap-2 mb-6">
            <i class="fas fa-brain"></i>
            Decision Result
          </h2>

          <!-- Main Decision -->
          <div class="mb-6">
            <span class="text-subtitle-en block mb-2">Trading Signal</span>
            <div class="text-giant-number" :class="resultJson.enter ? 'text-green-400' : 'text-white/30'">
              {{ resultJson.enter ? 'ENTER' : 'WAIT' }}
            </div>
          </div>

          <!-- Details -->
          <div v-if="resultJson.enter" class="space-y-4">
            <!-- Direction -->
            <div class="flex items-center justify-between p-4 rounded-xl bg-white/5 border border-white/10">
              <span class="text-label">方向 Direction</span>
              <div class="flex items-center gap-2">
                <i
                  :class="[
                    'fas',
                    resultJson.direction === 'long' ? 'fa-arrow-up text-green-400' : 'fa-arrow-down text-red-400'
                  ]"
                ></i>
                <span
                  class="text-xl font-bold"
                  :class="resultJson.direction === 'long' ? 'text-green-400' : 'text-red-400'"
                >
                  {{ resultJson.direction?.toUpperCase() }}
                </span>
              </div>
            </div>

            <!-- Entry Price -->
            <div class="flex items-center justify-between p-4 rounded-xl bg-white/5 border border-white/10">
              <span class="text-label">入场价 Entry</span>
              <span class="text-xl font-mono text-white">{{ formatPrice(resultJson.entry_price) }}</span>
            </div>

            <!-- Stop Loss -->
            <div class="flex items-center justify-between p-4 rounded-xl bg-white/5 border border-white/10">
              <span class="text-label">止损 Stop Loss</span>
              <span class="text-xl font-mono text-red-400">{{ formatPrice(resultJson.stop_loss_price) }}</span>
            </div>

            <!-- Take Profit -->
            <div class="flex items-center justify-between p-4 rounded-xl bg-white/5 border border-white/10">
              <span class="text-label">止盈 Take Profit</span>
              <span class="text-xl font-mono text-green-400">{{ formatPrice(resultJson.take_profit_price) }}</span>
            </div>

            <!-- Position & Leverage -->
            <div class="grid grid-cols-2 gap-3">
              <div class="p-4 rounded-xl bg-white/5 border border-white/10">
                <span class="text-label block mb-1">仓位 Position</span>
                <span class="text-lg font-mono text-white">{{ (resultJson.position_size * 100).toFixed(0) }}%</span>
              </div>
              <div class="p-4 rounded-xl bg-white/5 border border-white/10">
                <span class="text-label block mb-1">杠杆 Leverage</span>
                <span class="text-lg font-mono text-white">{{ resultJson.leverage || 1 }}x</span>
              </div>
            </div>
          </div>

          <!-- Reasoning -->
          <div class="mt-6 pt-6 border-t border-white/10">
            <span class="text-label flex items-center gap-2 mb-3">
              <i class="fas fa-comment-alt"></i>
              分析理由 Reasoning
            </span>
            <p class="text-sm text-white/60 leading-relaxed max-h-32 overflow-y-auto scrollbar-glass">
              {{ resultJson.reason }}
            </p>
          </div>

          <div v-if="resultJson.indicator_views" class="mt-6 pt-6 border-t border-white/10">
            <IndicatorViewsCard :views="resultJson.indicator_views" />
          </div>
        </div>
      </div>

      <!-- Logs Terminal -->
      <div :class="[resultJson ? 'bento-xl' : 'bento-full']" class="glass-card p-6 animate-slide-up stagger-4">
        <h3 class="text-label flex items-center gap-2 mb-4">
          <i class="fas fa-terminal"></i>
          日志输出 Logs
        </h3>
        <LogTerminal :logs="logs" class="min-h-[200px] max-h-[300px]" />
      </div>

    </div>
  </div>
</template>

<style scoped>
.spinner-custom {
  animation: spin-rotate 1.2s linear infinite;
  transform-origin: center;
}

@keyframes spin-rotate {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>
