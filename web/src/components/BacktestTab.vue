<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { Play, Square, Calendar, Loader2, ArrowRight } from 'lucide-vue-next';
import LogTerminal from './LogTerminal.vue';
import { useSocket } from '../composables/useSocket';

const { socket } = useSocket();

// Config
const config = ref({
  symbol: 'BTCUSDT',
  timeframe: '5m',
  bars: 200,
  startTime: '2024-12-01',
  endTime: '2024-12-02',
  workers: 4,
  enable4x: false
});

// State
const isRunning = ref(false);
const logs = ref([]);
const pid = ref(null);
const resultSummary = ref(null);

const timeframes = ['5m', '15m', '1h', '4h'];

function addLog(type, data) {
  logs.value.push({ type, data, timestamp: Date.now() });
}

function runBacktest() {
  isRunning.value = true;
  logs.value = [];
  resultSummary.value = null;
  pid.value = null;

  const args = [
    '--symbol', config.value.symbol,
    '--timeframe', config.value.timeframe,
    '--bars', config.value.bars.toString(),
    '--start-time', config.value.startTime,
    '--workers', config.value.workers.toString(),
    '--wait', '500' // Faster for backtest
  ];

  if (config.value.endTime) {
      args.push('--end-time', config.value.endTime);
  }
  
  if (config.value.enable4x) {
    args.push('--enable-4x-chart');
  }

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
      addLog('stdout', `Backtest process started with PID: ${data.pid}`);
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

function stopBacktest() {
  if (pid.value) {
    socket.emit('kill-process', pid.value);
  }
}

// Socket listeners
const onLog = (msg) => {
    addLog(msg.type, msg.data);
    // Try to parse summary from logs if possible, or wait for file
    // The backtest script prints: "分析成功: N", "入场信号: N" etc.
};

const onProcessExit = (msg) => {
  addLog('stdout', `Process exited with code ${msg.code}`);
  isRunning.value = false;
  pid.value = null;
  
  if (msg.code === 0) {
     // We could fetch the latest result json, but the filenames are timestamped.
     // For now, rely on logs.
     addLog('stdout', 'Backtest complete. Check "outputs/backtest" for detailed results.');
  }
};
const onProcessKilled = (killedPid) => {
  if (killedPid === pid.value) {
    addLog('stderr', 'Backtest terminated by user.');
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
  <div class="grid grid-cols-1 lg:grid-cols-12 gap-8">
    <!-- Configuration Panel (4 cols) -->
    <div class="lg:col-span-4 space-y-8">
      <div class="glass-card p-6 animate-slide-up" style="animation-delay: 0.1s;">
        <h2 class="text-sm font-bold text-mist uppercase tracking-widest mb-6 flex items-center gap-2">
          <Calendar class="w-4 h-4 text-neon-teal" />
          Backtest Config
        </h2>
        
        <div class="space-y-6">
          <div class="group">
            <label class="block text-xs font-semibold text-mist uppercase tracking-wider mb-2 group-focus-within:text-neon-teal transition-colors">Symbol</label>
            <input v-model="config.symbol" type="text" class="input-premium font-mono" />
          </div>

          <div class="grid grid-cols-2 gap-4">
             <div class="group">
              <label class="block text-xs font-semibold text-mist uppercase tracking-wider mb-2 group-focus-within:text-neon-teal transition-colors">Timeframe</label>
              <select v-model="config.timeframe" class="input-premium cursor-pointer">
                <option v-for="tf in timeframes" :key="tf" :value="tf">{{ tf }}</option>
              </select>
            </div>
            <div class="group">
              <label class="block text-xs font-semibold text-mist uppercase tracking-wider mb-2 group-focus-within:text-neon-teal transition-colors">Bars / Step</label>
              <input v-model.number="config.bars" type="number" class="input-premium font-mono" />
            </div>
          </div>

          <div class="group">
             <label class="block text-xs font-semibold text-mist uppercase tracking-wider mb-2 group-focus-within:text-neon-teal transition-colors">Date Range</label>
             <div class="flex items-center gap-3">
                <input v-model="config.startTime" type="date" class="input-premium text-sm flex-1" />
                <ArrowRight class="w-4 h-4 text-mist" />
                <input v-model="config.endTime" type="date" class="input-premium text-sm flex-1" />
             </div>
          </div>

           <div class="grid grid-cols-2 gap-4">
            <div class="group">
               <label class="block text-xs font-semibold text-mist uppercase tracking-wider mb-2 group-focus-within:text-neon-teal transition-colors">Workers</label>
               <input v-model.number="config.workers" type="number" min="1" max="10" class="input-premium font-mono" />
            </div>
            <div class="flex items-center pt-6 border-l border-white/5 pl-4">
                <label class="flex items-center gap-3 cursor-pointer group">
                  <div class="relative flex items-center">
                    <input v-model="config.enable4x" type="checkbox" class="peer sr-only">
                    <div class="w-11 h-6 bg-charcoal rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-neon-teal"></div>
                  </div>
                  <span class="text-xs font-medium text-mist group-hover:text-snow transition-colors">Enable 4x</span>
                </label>
            </div>
          </div>

          <div class="pt-4">
            <button 
              v-if="!isRunning"
              @click="runBacktest"
              class="btn-primary w-full flex justify-center items-center gap-3 bg-gradient-to-r from-purple-500 to-indigo-500 hover:shadow-purple-500/20"
            >
              <Play class="w-5 h-5 fill-current" />
              Start Backtest
            </button>
            <button 
              v-else
              @click="stopBacktest"
              class="btn-danger w-full flex justify-center items-center gap-3 animate-pulse"
            >
              <Square class="w-5 h-5 fill-current" />
              Stop Backtest
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Logs (8 cols) -->
    <div class="lg:col-span-8 space-y-6">
      <div v-if="isRunning" class="glass-card p-4 flex items-center justify-between border-neon-teal/30 bg-neon-teal/5 animate-slide-up">
          <div class="flex items-center gap-3">
             <Loader2 class="w-5 h-5 animate-spin text-neon-teal" />
             <span class="text-snow font-medium tracking-wide">Backtest running... processing historical data.</span>
          </div>
      </div>

       <div class="glass-card p-6 animate-slide-up" style="animation-delay: 0.2s;">
        <h3 class="text-sm font-bold text-mist uppercase tracking-widest mb-4 flex items-center gap-2">
          <Play class="w-4 h-4 text-neon-teal" />
          Execution Logs
        </h3>
        <LogTerminal :logs="logs" class="min-h-[400px]" />
      </div>
    </div>
  </div>
</template>
