<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import LogTerminal from './LogTerminal.vue';
import { useSocket } from '../composables/useSocket';

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
const resultImage = ref(null);
const resultJson = ref(null);

const timeframes = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];

function addLog(type, data) {
  logs.value.push({ type, data, timestamp: Date.now() });
}

function runScript() {
  isRunning.value = true;
  logs.value = [];
  resultImage.value = null;
  resultJson.value = null;
  pid.value = null;

  const args = [
    '--symbol', config.value.symbol,
    '--timeframe', config.value.timeframe,
    '--bars', config.value.bars.toString(),
    '--wait', '1000'
  ];

  if (config.value.enable4x) {
    args.push('--enable-4x-chart');
    if (config.value.auxTimeframe) {
      args.push('--aux-timeframe', config.value.auxTimeframe);
    }
  }

  addLog('stdout', `Starting main.js with args: ${args.join(' ')}`);

  fetch('/api/run-script', {
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
  
  if (msg.code === 0) {
    const timestamp = Date.now();
    resultImage.value = `/outputs/${config.value.symbol}_${config.value.timeframe}_with_vlm_decision.png?t=${timestamp}`;
    fetch(`/outputs/vlm_decision.json?t=${timestamp}`)
      .then(r => r.json())
      .then(data => resultJson.value = data)
      .catch(e => console.error(e));
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
                <select v-model="config.timeframe" class="input-glass select-glass">
                  <option v-for="tf in timeframes" :key="tf" :value="tf">{{ tf }}</option>
                </select>
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
              <select v-model="config.auxTimeframe" class="input-glass select-glass">
                <option value="">Auto</option>
                <option v-for="tf in timeframes" :key="tf" :value="tf">{{ tf }}</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <!-- Chart Display -->
      <div class="bento-xl glass-card p-4 min-h-[500px] flex items-center justify-center animate-slide-up stagger-2">
        <!-- Result Image -->
        <div v-if="resultImage" class="w-full h-full">
          <img 
            :src="resultImage" 
            class="w-full h-auto rounded-2xl shadow-2xl" 
            alt="Analysis Result"
          />
        </div>
        
        <!-- Loading State -->
        <div v-else-if="isRunning" class="flex flex-col items-center gap-4">
          <div class="w-16 h-16 rounded-2xl bg-blue-500/20 flex items-center justify-center">
            <i class="fas fa-spinner fa-spin text-blue-400 text-2xl"></i>
          </div>
          <div class="text-center">
            <span class="text-white/80 text-lg font-medium block">分析中</span>
            <span class="text-white/40 text-sm">Processing...</span>
          </div>
        </div>
        
        <!-- Empty State -->
        <div v-else class="flex flex-col items-center gap-4 opacity-40">
          <div class="w-20 h-20 rounded-3xl bg-white/5 border border-white/10 flex items-center justify-center">
            <i class="fas fa-chart-area text-white/30 text-3xl"></i>
          </div>
          <div class="text-center">
            <span class="text-white/50 text-lg block">等待分析</span>
            <span class="text-white/30 text-sm">Ready to analyze</span>
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
                    resultJson.direction === 'LONG' ? 'fa-arrow-up text-green-400' : 'fa-arrow-down text-red-400'
                  ]"
                ></i>
                <span 
                  class="text-xl font-bold"
                  :class="resultJson.direction === 'LONG' ? 'text-green-400' : 'text-red-400'"
                >
                  {{ resultJson.direction }}
                </span>
              </div>
            </div>

            <!-- Entry Price -->
            <div class="flex items-center justify-between p-4 rounded-xl bg-white/5 border border-white/10">
              <span class="text-label">入场价 Entry</span>
              <span class="text-xl font-mono text-white">{{ resultJson.entryPrice }}</span>
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
