<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { Play, Square, Loader2, Image as ImageIcon, FileText, Activity, ArrowRight, CheckCircle2, AlertCircle } from 'lucide-vue-next';
import LogTerminal from './LogTerminal.vue';
import { useSocket } from '../composables/useSocket';

const { socket } = useSocket();

// Config
const config = ref({
  symbol: 'BTCUSDT',
  timeframe: '1h',
  bars: 200,
  enable4x: false,
  auxTimeframe: ''
});

// State
const isRunning = ref(false);
const logs = ref([]);
const pid = ref(null);
const resultImage = ref(null);
const resultJson = ref(null);
const lastRunTime = ref(null);

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

// Socket listeners
const onLog = (msg) => addLog(msg.type, msg.data);
const onProcessExit = (msg) => {
  addLog('stdout', `Process exited with code ${msg.code}`);
  isRunning.value = false;
  pid.value = null;
  lastRunTime.value = Date.now();
  
  if (msg.code === 0) {
    // Refresh results
    const timestamp = Date.now(); // Cache buster
    resultImage.value = `/outputs/${config.value.symbol}_${config.value.timeframe}_with_vlm_decision.png?t=${timestamp}`;
    
    fetch(`/outputs/vlm_decision.json?t=${timestamp}`)
      .then(r => r.json())
      .then(data => resultJson.value = data)
      .catch(e => console.error(e));
  }
};
const onProcessKilled = (killedPid) => {
  if (killedPid === pid.value) {
    addLog('stderr', 'Process terminated by user.');
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
    <!-- Left Column: Config & Results (4 columns) -->
    <div class="lg:col-span-4 space-y-8">
      
      <!-- Configuration Panel -->
      <div class="glass-card p-6 animate-slide-up" style="animation-delay: 0.1s;">
        <h2 class="text-sm font-bold text-mist uppercase tracking-widest mb-6 flex items-center gap-2">
          <FileText class="w-4 h-4 text-neon-teal" />
          Configuration
        </h2>
        
        <div class="space-y-6">
          <div class="group">
            <label class="block text-xs font-semibold text-mist uppercase tracking-wider mb-2 group-focus-within:text-neon-teal transition-colors">Symbol</label>
            <input v-model="config.symbol" type="text" class="input-premium font-mono" placeholder="BTCUSDT" />
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div class="group">
              <label class="block text-xs font-semibold text-mist uppercase tracking-wider mb-2 group-focus-within:text-neon-teal transition-colors">Timeframe</label>
              <select v-model="config.timeframe" class="input-premium cursor-pointer">
                <option v-for="tf in timeframes" :key="tf" :value="tf">{{ tf }}</option>
              </select>
            </div>
            <div class="group">
              <label class="block text-xs font-semibold text-mist uppercase tracking-wider mb-2 group-focus-within:text-neon-teal transition-colors">Bars</label>
              <input v-model.number="config.bars" type="number" class="input-premium font-mono" />
            </div>
          </div>

          <div class="pt-2 border-t border-white/5">
            <label class="flex items-center gap-3 cursor-pointer group">
              <div class="relative flex items-center">
                <input v-model="config.enable4x" type="checkbox" class="peer sr-only">
                <div class="w-11 h-6 bg-charcoal rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-neon-teal"></div>
              </div>
              <span class="text-sm font-medium text-mist group-hover:text-snow transition-colors">Enable 4x Aux Chart</span>
            </label>
          </div>
          
          <div v-if="config.enable4x" class="animate-fade-in">
             <label class="block text-xs font-semibold text-mist uppercase tracking-wider mb-2">Aux Timeframe</label>
              <select v-model="config.auxTimeframe" class="input-premium cursor-pointer">
                <option value="">Auto (4x)</option>
                <option v-for="tf in timeframes" :key="tf" :value="tf">{{ tf }}</option>
              </select>
          </div>

          <div class="pt-4">
            <button 
              v-if="!isRunning"
              @click="runScript"
              class="btn-primary w-full flex justify-center items-center gap-3"
            >
              <Play class="w-5 h-5 fill-current" />
              Run Analysis
            </button>
            <button 
              v-else
              @click="stopScript"
              class="btn-danger w-full flex justify-center items-center gap-3 animate-pulse"
            >
              <Square class="w-5 h-5 fill-current" />
              Stop Execution
            </button>
          </div>
        </div>
      </div>

      <!-- Analysis Result Panel -->
      <div v-if="resultJson" class="glass-card p-0 overflow-hidden animate-slide-up relative group" style="animation-delay: 0.2s;">
         <div class="absolute top-0 left-0 w-1 h-full" :class="resultJson.enter ? 'bg-neon-teal' : 'bg-charcoal'"></div>
         
         <div class="p-6">
            <div class="flex justify-between items-start mb-6">
               <div>
                  <h3 class="text-xs font-bold text-mist uppercase tracking-widest mb-1">Decision</h3>
                  <div class="text-4xl font-bold tracking-tighter" :class="resultJson.enter ? 'text-neon-teal drop-shadow-lg' : 'text-mist'">
                    {{ resultJson.enter ? 'ENTER' : 'WAIT' }}
                  </div>
               </div>
               <div v-if="resultJson.enter" class="text-right">
                  <h3 class="text-xs font-bold text-mist uppercase tracking-widest mb-1">Confidence</h3>
                  <div class="text-2xl font-mono text-snow">{{ (resultJson.confidence * 100).toFixed(0) }}%</div>
               </div>
            </div>

            <div v-if="resultJson.enter" class="grid grid-cols-2 gap-4 mb-6 p-4 bg-obsidian/30 rounded-lg border border-white/5">
                <div>
                  <span class="text-xs text-mist block mb-1">Direction</span>
                  <div class="flex items-center gap-2 font-bold" :class="resultJson.direction === 'LONG' ? 'text-green-400' : 'text-red-400'">
                    <ArrowRight class="w-4 h-4" :class="resultJson.direction === 'LONG' ? '-rotate-45' : 'rotate-45'" />
                    {{ resultJson.direction }}
                  </div>
                </div>
                <div>
                  <span class="text-xs text-mist block mb-1">Entry Price</span>
                  <div class="font-mono text-snow">{{ resultJson.entryPrice }}</div>
                </div>
            </div>

            <div class="pt-4 border-t border-white/5">
               <h3 class="text-xs font-bold text-mist uppercase tracking-widest mb-2 flex items-center gap-2">
                 <Activity class="w-3 h-3" />
                 Analysis Engine Reasoning
               </h3>
               <p class="text-sm text-gray-300 leading-relaxed max-h-40 overflow-y-auto scrollbar-thin pr-2">
                 {{ resultJson.reason }}
               </p>
            </div>
         </div>
      </div>
    </div>

    <!-- Right Column: Visualization & Logs (8 columns) -->
    <div class="lg:col-span-8 space-y-8">
      
      <!-- Chart Area -->
      <div class="glass-card p-1 min-h-[500px] flex items-center justify-center relative overflow-hidden group animate-slide-up" style="animation-delay: 0.3s;">
          <!-- Background decoration -->
          <div class="absolute inset-0 bg-gradient-to-br from-obsidian via-charcoal to-obsidian opacity-50 z-0"></div>
          
          <div v-if="resultImage" class="relative z-10 w-full h-full p-2">
              <img :src="resultImage" class="w-full h-auto rounded-lg shadow-2xl border border-white/5 transition-transform duration-500 hover:scale-[1.01]" alt="Analysis Result" />
          </div>
          
          <div v-else-if="isRunning" class="relative z-10 flex flex-col items-center gap-4">
              <div class="relative p-6">
                 <div class="absolute inset-0 bg-neon-teal/20 blur-xl rounded-full animate-pulse"></div>
                 <Loader2 class="w-12 h-12 animate-spin text-neon-teal relative z-10" />
              </div>
              <span class="text-mist font-medium tracking-wide animate-pulse">Processing Market Data...</span>
          </div>
          
          <div v-else class="relative z-10 flex flex-col items-center gap-4 opacity-50">
              <div class="w-20 h-20 rounded-full bg-charcoal border border-white/10 flex items-center justify-center">
                <ImageIcon class="w-8 h-8 text-mist" />
              </div>
              <span class="text-mist font-light tracking-wide">Ready for Analysis</span>
          </div>
      </div>

      <!-- Logs Area -->
      <div class="glass-card p-6 animate-slide-up" style="animation-delay: 0.4s;">
        <h3 class="text-sm font-bold text-mist uppercase tracking-widest mb-4 flex items-center gap-2">
          <Terminal class="w-4 h-4 text-neon-teal" />
          System Logs
        </h3>
        <LogTerminal :logs="logs" class="min-h-[200px]" />
      </div>
    </div>
  </div>
</template>
