<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
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
  <div class="space-y-6">
    <!-- Hero Section -->
    <div class="glass-card p-8 animate-slide-up">
      <div class="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
        <div>
          <span class="text-subtitle-en mb-2 block">Historical Strategy Validation</span>
          <h1 class="text-hero-cn text-apple-gradient">回测系统</h1>
        </div>
        <div class="flex items-center gap-4">
          <!-- Status Badge -->
          <div v-if="isRunning" class="badge-blue flex items-center gap-2">
            <i class="fas fa-spinner fa-spin"></i>
            {{ config.workers }} Workers
          </div>
          
          <button 
            v-if="!isRunning"
            @click="runBacktest"
            class="btn-glass h-14 px-8"
          >
            <i class="fas fa-play"></i>
            <span class="font-bold">开始回测</span>
          </button>
          <button 
            v-else
            @click="stopBacktest"
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
        <h2 class="text-label flex items-center gap-2 mb-6">
          <i class="fas fa-calendar-alt"></i>
          Backtest Config
        </h2>
        
        <div class="space-y-5">
          <!-- Symbol -->
          <div>
            <label class="text-label block mb-2">交易对 Symbol</label>
            <input v-model="config.symbol" type="text" class="input-glass font-mono" />
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

          <!-- Date Range -->
          <div>
            <label class="text-label block mb-2">时间范围 Date Range</label>
            <div class="flex items-center gap-3">
              <input v-model="config.startTime" type="date" class="input-glass text-sm flex-1" />
              <i class="fas fa-arrow-right text-white/30"></i>
              <input v-model="config.endTime" type="date" class="input-glass text-sm flex-1" />
            </div>
          </div>

          <!-- Workers & 4x -->
          <div class="grid grid-cols-2 gap-3 pt-4 border-t border-white/10">
            <div>
              <label class="text-label flex items-center gap-1 mb-2">
                <i class="fas fa-microchip text-[10px]"></i>
                Workers
              </label>
              <input v-model.number="config.workers" type="number" min="1" max="10" class="input-glass font-mono" />
            </div>
            <div class="flex items-end pb-2">
              <label class="toggle-glass">
                <input v-model="config.enable4x" type="checkbox">
                <div class="toggle-track"></div>
                <div class="toggle-thumb"></div>
                <span class="ml-3 text-xs text-white/70">4x</span>
              </label>
            </div>
          </div>
        </div>
      </div>

      <!-- Stats Cards -->
      <div class="bento-sm glass-card p-6 flex flex-col justify-center animate-slide-up stagger-2">
        <span class="text-subtitle-en mb-2">Total Trades</span>
        <span class="text-giant-number text-white">--</span>
        <span class="text-label mt-2">交易次数</span>
      </div>

      <div class="bento-sm glass-card p-6 flex flex-col justify-center animate-slide-up stagger-3">
        <span class="text-subtitle-en mb-2">Win Rate</span>
        <span class="text-giant-number text-green-400">--%</span>
        <span class="text-label mt-2">胜率</span>
      </div>

      <div class="bento-sm glass-card p-6 flex flex-col justify-center animate-slide-up stagger-4">
        <span class="text-subtitle-en mb-2">Profit Factor</span>
        <span class="text-giant-number text-apple-gradient">--</span>
        <span class="text-label mt-2">盈亏比</span>
      </div>

      <!-- Logs Terminal -->
      <div class="bento-full glass-card p-6 animate-slide-up">
        <h3 class="text-label flex items-center gap-2 mb-4">
          <i class="fas fa-terminal"></i>
          回测日志 Backtest Logs
        </h3>
        <LogTerminal :logs="logs" class="min-h-[400px]" />
      </div>

    </div>
  </div>
</template>
