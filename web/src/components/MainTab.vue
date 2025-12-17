<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { Play, Square, Loader2, Image as ImageIcon, FileText, Activity, TrendingUp, TrendingDown } from 'lucide-vue-next';
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
  <div class="grid grid-cols-1 lg:grid-cols-12 gap-5">
    <!-- Left -->
    <div class="lg:col-span-4 space-y-5">
      
      <!-- Config -->
      <div class="liquid-glass p-5 animate-slide-up">
        <h2 class="text-xs font-semibold text-ink-tertiary uppercase tracking-wider mb-4 flex items-center gap-2">
          <FileText class="w-4 h-4" />
          Configuration
        </h2>
        
        <div class="space-y-4">
          <div>
            <label class="block text-xs font-medium text-ink-secondary mb-1.5">Symbol</label>
            <input v-model="config.symbol" type="text" class="input-liquid font-mono" placeholder="BTCUSDT" />
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-xs font-medium text-ink-secondary mb-1.5">Timeframe</label>
              <select v-model="config.timeframe" class="select-liquid">
                <option v-for="tf in timeframes" :key="tf" :value="tf">{{ tf }}</option>
              </select>
            </div>
            <div>
              <label class="block text-xs font-medium text-ink-secondary mb-1.5">Bars</label>
              <input v-model.number="config.bars" type="number" class="input-liquid font-mono" />
            </div>
          </div>

          <div class="pt-3 border-t border-black/[0.04]">
            <label class="toggle-liquid">
              <input v-model="config.enable4x" type="checkbox">
              <div class="toggle-track"></div>
              <div class="toggle-thumb"></div>
              <span class="ml-3 text-sm text-ink-secondary">4x Chart</span>
            </label>
          </div>
          
          <div v-if="config.enable4x" class="animate-fade-in">
            <label class="block text-xs font-medium text-ink-secondary mb-1.5">Aux Timeframe</label>
            <select v-model="config.auxTimeframe" class="select-liquid">
              <option value="">Auto</option>
              <option v-for="tf in timeframes" :key="tf" :value="tf">{{ tf }}</option>
            </select>
          </div>

          <div class="pt-3">
            <button 
              v-if="!isRunning"
              @click="runScript"
              class="btn-liquid w-full flex justify-center items-center gap-2"
            >
              <Play class="w-4 h-4 fill-current" />
              Run Analysis
            </button>
            <button 
              v-else
              @click="stopScript"
              class="btn-liquid-danger w-full flex justify-center items-center gap-2"
            >
              <Square class="w-4 h-4 fill-current" />
              Stop
            </button>
          </div>
        </div>
      </div>

      <!-- Result -->
      <div v-if="resultJson" class="liquid-glass p-5 animate-slide-up">
        <div class="flex justify-between items-start mb-4">
          <div>
            <div class="text-xs font-medium text-ink-tertiary mb-1">Decision</div>
            <div class="text-2xl font-bold" :class="resultJson.enter ? 'text-green' : 'text-ink-tertiary'">
              {{ resultJson.enter ? 'ENTER' : 'WAIT' }}
            </div>
          </div>
          <div v-if="resultJson.enter" class="text-right">
            <div class="text-xs font-medium text-ink-tertiary mb-1">Confidence</div>
            <div class="text-lg font-mono text-ink">{{ (resultJson.confidence * 100).toFixed(0) }}%</div>
          </div>
        </div>

        <div v-if="resultJson.enter" class="grid grid-cols-2 gap-3 mb-4 p-3 rounded-lg bg-canvas border border-black/[0.04]">
          <div>
            <span class="text-xs text-ink-tertiary block mb-0.5">Direction</span>
            <div class="flex items-center gap-1.5 font-semibold" :class="resultJson.direction === 'LONG' ? 'text-green' : 'text-red'">
              <component :is="resultJson.direction === 'LONG' ? TrendingUp : TrendingDown" class="w-4 h-4" />
              {{ resultJson.direction }}
            </div>
          </div>
          <div>
            <span class="text-xs text-ink-tertiary block mb-0.5">Entry</span>
            <div class="font-mono text-ink">{{ resultJson.entryPrice }}</div>
          </div>
        </div>

        <div class="pt-3 border-t border-black/[0.04]">
          <div class="text-xs font-medium text-ink-tertiary mb-2 flex items-center gap-1.5">
            <Activity class="w-3 h-3" />
            Reasoning
          </div>
          <p class="text-sm text-ink-secondary leading-relaxed max-h-28 overflow-y-auto scrollbar-liquid">
            {{ resultJson.reason }}
          </p>
        </div>
      </div>
    </div>

    <!-- Right -->
    <div class="lg:col-span-8 space-y-5">
      
      <!-- Chart -->
      <div class="liquid-glass p-1 min-h-[460px] flex items-center justify-center animate-slide-up">
        <div v-if="resultImage" class="w-full h-full p-0.5">
          <img :src="resultImage" class="w-full h-auto rounded-[14px] shadow-glass" alt="Analysis" />
        </div>
        
        <div v-else-if="isRunning" class="flex flex-col items-center gap-3">
          <Loader2 class="w-10 h-10 animate-spin text-blue" />
          <span class="text-ink-tertiary text-sm">Processing...</span>
        </div>
        
        <div v-else class="flex flex-col items-center gap-3 opacity-40">
          <div class="w-16 h-16 rounded-2xl bg-canvas border border-black/[0.04] flex items-center justify-center">
            <ImageIcon class="w-7 h-7 text-ink-muted" />
          </div>
          <span class="text-ink-muted text-sm">Ready</span>
        </div>
      </div>

      <!-- Logs -->
      <div class="liquid-glass p-5 animate-slide-up">
        <h3 class="text-xs font-semibold text-ink-tertiary uppercase tracking-wider mb-3 flex items-center gap-2">
          <Terminal class="w-4 h-4" />
          Logs
        </h3>
        <LogTerminal :logs="logs" class="min-h-[160px]" />
      </div>
    </div>
  </div>
</template>
