<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { Play, Square, Calendar, Loader2, ArrowRight, Cpu } from 'lucide-vue-next';
import LogTerminal from './LogTerminal.vue';
import { useSocket } from '../composables/useSocket';

const { socket } = useSocket();

const config = ref({
  symbol: 'BTCUSDT',
  timeframe: '5m',
  bars: 200,
  startTime: '2024-12-01',
  endTime: '2024-12-02',
  workers: 4,
  enable4x: false
});

const isRunning = ref(false);
const logs = ref([]);
const pid = ref(null);

const timeframes = ['5m', '15m', '1h', '4h'];

function addLog(type, data) {
  logs.value.push({ type, data, timestamp: Date.now() });
}

function runBacktest() {
  isRunning.value = true;
  logs.value = [];
  pid.value = null;

  const args = [
    '--symbol', config.value.symbol,
    '--timeframe', config.value.timeframe,
    '--bars', config.value.bars.toString(),
    '--start-time', config.value.startTime,
    '--workers', config.value.workers.toString(),
    '--wait', '500'
  ];

  if (config.value.endTime) args.push('--end-time', config.value.endTime);
  if (config.value.enable4x) args.push('--enable-4x-chart');

  addLog('stdout', `Starting backtest.js with args: ${args.join(' ')}`);

  fetch('/api/run-script', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ script: 'backtest', args })
  })
  .then(res => res.json())
  .then(data => {
    if (data.pid) {
      pid.value = data.pid;
      addLog('stdout', `Started with PID: ${data.pid}`);
    } else if (data.error) {
       addLog('error', `Failed: ${data.error}`);
       isRunning.value = false;
    }
  })
  .catch(err => {
    addLog('error', `Error: ${err.message}`);
    isRunning.value = false;
  });
}

function stopBacktest() {
  if (pid.value) socket.emit('kill-process', pid.value);
}

const onLog = (msg) => addLog(msg.type, msg.data);
const onProcessExit = (msg) => {
  addLog('stdout', `Exited with code ${msg.code}`);
  isRunning.value = false;
  pid.value = null;
  if (msg.code === 0) addLog('stdout', 'Complete. Check outputs/backtest.');
};
const onProcessKilled = (killedPid) => {
  if (killedPid === pid.value) {
    addLog('stderr', 'Terminated.');
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
    <!-- Config -->
    <div class="lg:col-span-4">
      <div class="liquid-glass p-5 animate-slide-up">
        <h2 class="text-xs font-semibold text-ink-tertiary uppercase tracking-wider mb-4 flex items-center gap-2">
          <Calendar class="w-4 h-4" />
          Backtest Config
        </h2>
        
        <div class="space-y-4">
          <div>
            <label class="block text-xs font-medium text-ink-secondary mb-1.5">Symbol</label>
            <input v-model="config.symbol" type="text" class="input-liquid font-mono" />
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

          <div>
            <label class="block text-xs font-medium text-ink-secondary mb-1.5">Date Range</label>
            <div class="flex items-center gap-2">
              <input v-model="config.startTime" type="date" class="input-liquid text-sm flex-1" />
              <ArrowRight class="w-4 h-4 text-ink-muted flex-shrink-0" />
              <input v-model="config.endTime" type="date" class="input-liquid text-sm flex-1" />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3 pt-3 border-t border-black/[0.04]">
            <div>
              <label class="block text-xs font-medium text-ink-secondary mb-1.5 flex items-center gap-1">
                <Cpu class="w-3 h-3" /> Workers
              </label>
              <input v-model.number="config.workers" type="number" min="1" max="10" class="input-liquid font-mono" />
            </div>
            <div class="flex items-end pb-1">
              <label class="toggle-liquid">
                <input v-model="config.enable4x" type="checkbox">
                <div class="toggle-track"></div>
                <div class="toggle-thumb"></div>
                <span class="ml-3 text-xs text-ink-secondary">4x</span>
              </label>
            </div>
          </div>

          <div class="pt-3">
            <button 
              v-if="!isRunning"
              @click="runBacktest"
              class="btn-liquid w-full flex justify-center items-center gap-2"
            >
              <Play class="w-4 h-4 fill-current" />
              Start
            </button>
            <button 
              v-else
              @click="stopBacktest"
              class="btn-liquid-danger w-full flex justify-center items-center gap-2"
            >
              <Square class="w-4 h-4 fill-current" />
              Stop
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Logs -->
    <div class="lg:col-span-8 space-y-4">
      <div v-if="isRunning" class="liquid-glass p-3 flex items-center gap-3 animate-slide-up">
        <Loader2 class="w-4 h-4 animate-spin text-blue" />
        <span class="text-ink text-sm">Running...</span>
        <span class="badge-liquid ml-auto">{{ config.workers }} workers</span>
      </div>

      <div class="liquid-glass p-5 animate-slide-up">
        <h3 class="text-xs font-semibold text-ink-tertiary uppercase tracking-wider mb-3 flex items-center gap-2">
          <Play class="w-4 h-4" />
          Logs
        </h3>
        <LogTerminal :logs="logs" class="min-h-[400px]" />
      </div>
    </div>
  </div>
</template>
