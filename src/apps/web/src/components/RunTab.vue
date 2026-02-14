<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue';
	import LogTerminal from './LogTerminal.vue';
	import CustomSelect from './CustomSelect.vue';
	import IndicatorViewsCard from './IndicatorViewsCard.vue';
	import { useSocket } from '../composables/useSocket';
	import { authedFetch } from '../composables/useAuth';

const { socket } = useSocket();

const config = ref({
  symbol: 'BTCUSDT',
  timeframe: '1h',
  bars: 200,
  enable4x: false,
  auxTimeframe: '',
  intervalMinutes: 15,
  enableTelegram: true
});

const isRunning = ref(false);
const logs = ref([]);
const pid = ref(null);
const sessionId = ref(null);
const history = ref([]);
const timer = ref(null);
const nextRunTime = ref(null);
const countdownInterval = ref(null);

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

function addToHistory(item) {
  history.value.unshift({
    ...item,
    timestamp: Date.now()
  });

  if (history.value.length > 50) {
    history.value.pop();
  }
}

async function sendToTelegram(decision, retryCount = 3) {
  if (!config.value.enableTelegram) return;

  const fullDecision = {
    ...decision,
    symbol: config.value.symbol,
    timeframe: config.value.timeframe
  };

  for (let attempt = 1; attempt <= retryCount; attempt++) {
    try {
	      const response = await authedFetch('/api/send-telegram', {
	        method: 'POST',
	        headers: { 'Content-Type': 'application/json' },
	        body: JSON.stringify({ decision: fullDecision })
	      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      addLog('stdout', `入场信号已发送到 Telegram (${config.value.symbol} ${config.value.timeframe})`);
      return;
    } catch (err) {
      if (attempt < retryCount) {
        addLog('stdout', `Telegram 发送失败 (尝试 ${attempt}/${retryCount})，${2 * attempt} 秒后重试...`);
        await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
      } else {
        addLog('error', `Telegram 发送失败，已重试 ${retryCount} 次: ${err.message}`);
      }
    }
  }
}

function runSingleAnalysis() {
  if (pid.value) {
    addLog('error', '已有任务正在运行，请等待完成');
    return;
  }

  logs.value = [];
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

  addLog('stdout', `运行策略分析: ${config.value.symbol} ${config.value.timeframe}`);

	  authedFetch('/api/run-script', {
	    method: 'POST',
	    headers: { 'Content-Type': 'application/json' },
	    body: JSON.stringify({ script: 'main', args })
	  })
	  .then(res => res.json())
  .then(data => {
    if (data.pid) {
      pid.value = data.pid;
      addLog('stdout', `进程已启动 PID: ${data.pid}`);
    } else if (data.error) {
      addLog('error', `启动失败: ${data.error}`);
      pid.value = null;
    }
  })
  .catch(err => {
    addLog('error', `API 错误: ${err.message}`);
    pid.value = null;
  });
}

function scheduleNextRun() {
  if (timer.value) {
    clearTimeout(timer.value);
    timer.value = null;
  }

  if (!isRunning.value) {
    nextRunTime.value = null;
    return;
  }

  const intervalMs = config.value.intervalMinutes * 60 * 1000;
  nextRunTime.value = Date.now() + intervalMs;

  timer.value = setTimeout(() => {
    runSingleAnalysis();
  }, intervalMs);
}

function startAutoRun() {
  if (isRunning.value) return;

  isRunning.value = true;
  addLog('stdout', `启动定时运行，间隔: ${config.value.intervalMinutes} 分钟`);

  runSingleAnalysis();
}

function stopAutoRun() {
  isRunning.value = false;
  nextRunTime.value = null;

  if (timer.value) {
    clearTimeout(timer.value);
    timer.value = null;
  }

  if (pid.value) {
    socket.emit('kill-process', pid.value);
  }

  addLog('stdout', '定时运行已停止');
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

const currentTime = ref(Date.now());

const countdown = computed(() => {
  if (!nextRunTime.value) return '-';

  const remaining = Math.max(0, nextRunTime.value - currentTime.value);
  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);

  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
});

const onLog = (msg) => addLog(msg.type, msg.data);

const onProcessExit = async (msg) => {
  addLog('stdout', `进程退出 code ${msg.code}`);

  const currentPid = pid.value;
  pid.value = null;

  if (msg.code === 0 && sessionId.value) {
    try {
	      const response = await authedFetch(`/api/chart-data/${sessionId.value}`);
	      if (!response.ok) throw new Error('获取图表数据失败');

	      const data = await response.json();
      const decision = data.decision;

      addToHistory({
        symbol: config.value.symbol,
        timeframe: config.value.timeframe,
        enter: decision?.enter || false,
        direction: decision?.direction || '',
        confidence: decision?.confidence || 0,
        entry_price: decision?.entry_price,
        reason: decision?.reason || ''
      });

      if (decision?.enter) {
        addLog('stdout', `检测到入场信号: ${decision.direction?.toUpperCase()}`);
        await sendToTelegram(decision);
      }

      addLog('stdout', '分析完成');
    } catch (e) {
      console.error('处理结果错误:', e);
      addLog('error', `处理结果失败: ${e.message}`);

      addToHistory({
        symbol: config.value.symbol,
        timeframe: config.value.timeframe,
        enter: false,
        error: e.message
      });
    }
  } else if (msg.code !== 0) {
    addToHistory({
      symbol: config.value.symbol,
      timeframe: config.value.timeframe,
      enter: false,
      error: `退出码: ${msg.code}`
    });
  }

  if (isRunning.value) {
    scheduleNextRun();
  }
};

const onProcessKilled = (killedPid) => {
  if (killedPid === pid.value) {
    addLog('stderr', '进程已终止');
    pid.value = null;
  }
};

onMounted(() => {
  socket.on('log', onLog);
  socket.on('process-exit', onProcessExit);
  socket.on('process-killed', onProcessKilled);

  countdownInterval.value = setInterval(() => {
    currentTime.value = Date.now();
  }, 1000);
});

onUnmounted(() => {
  socket.off('log', onLog);
  socket.off('process-exit', onProcessExit);
  socket.off('process-killed', onProcessKilled);

  if (timer.value) {
    clearTimeout(timer.value);
  }

  if (countdownInterval.value) {
    clearInterval(countdownInterval.value);
  }
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
          <span class="text-subtitle-en mb-2 block">Automated Trading Analysis</span>
          <h1 class="text-hero-cn text-apple-gradient">自动运行</h1>
        </div>
        <div class="flex items-center gap-4">
          <div v-if="isRunning && nextRunTime" class="text-right">
            <span class="text-label block mb-1">下次运行</span>
            <span class="text-big-number text-apple-gradient">{{ countdown }}</span>
          </div>
          <button
            v-if="!isRunning"
            @click="startAutoRun"
            class="btn-glass h-14 px-8"
          >
            <i class="fas fa-play"></i>
            <span class="font-bold">启动自动运行</span>
          </button>
          <button
            v-else
            @click="stopAutoRun"
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
                :disabled="isRunning"
              />
            </div>

            <!-- Timeframe & Bars -->
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="text-label block mb-2">周期 Timeframe</label>
                <CustomSelect
                  v-model="config.timeframe"
                  :options="timeframeOptions"
                  :disabled="isRunning"
                />
              </div>
              <div>
                <label class="text-label block mb-2">K线数 Bars</label>
                <input
                  v-model.number="config.bars"
                  type="number"
                  class="input-glass font-mono"
                  :disabled="isRunning"
                />
              </div>
            </div>

            <!-- Interval -->
            <div>
              <label class="text-label block mb-2">运行间隔 (分钟)</label>
              <input
                v-model.number="config.intervalMinutes"
                type="number"
                min="1"
                class="input-glass font-mono"
                :disabled="isRunning"
              />
            </div>

            <!-- 4x Toggle -->
            <div class="pt-4 border-t border-white/10">
              <label class="toggle-glass">
                <input v-model="config.enable4x" type="checkbox" :disabled="isRunning">
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
                :disabled="isRunning"
              />
            </div>

            <!-- Telegram Toggle -->
            <div class="pt-4 border-t border-white/10">
              <label class="toggle-glass">
                <input v-model="config.enableTelegram" type="checkbox">
                <div class="toggle-track"></div>
                <div class="toggle-thumb"></div>
                <span class="ml-3 text-sm text-white/70">入场时发送 Telegram 通知</span>
              </label>
            </div>
          </div>
        </div>
      </div>

      <!-- History Panel -->
      <div class="bento-lg glass-card p-6 animate-slide-up stagger-2">
        <h3 class="text-label flex items-center gap-2 mb-4">
          <i class="fas fa-history"></i>
          运行历史 History
        </h3>

        <div class="space-y-2 max-h-[400px] overflow-y-auto scrollbar-glass">
          <div
            v-for="(item, index) in history"
            :key="index"
            class="p-4 rounded-xl bg-white/5 border border-white/10 hover:bg-white/[0.07] transition-colors"
          >
            <div class="flex items-start justify-between mb-2">
              <div class="flex items-center gap-3">
                <span class="text-xs text-white/40">{{ formatTime(item.timestamp) }}</span>
                <span class="text-sm font-mono text-white/70">{{ item.symbol }} {{ item.timeframe }}</span>
              </div>
              <div v-if="item.enter" class="flex items-center gap-2">
                <i
                  :class="[
                    'fas text-sm',
                    item.direction === 'long' ? 'fa-arrow-up text-green-400' : 'fa-arrow-down text-red-400'
                  ]"
                ></i>
                <span
                  class="text-sm font-bold"
                  :class="item.direction === 'long' ? 'text-green-400' : 'text-red-400'"
                >
                  {{ item.direction?.toUpperCase() }}
                </span>
                <span class="text-xs text-white/50 ml-2">
                  {{ (item.confidence * 100).toFixed(0) }}%
                </span>
              </div>
              <span v-else class="text-xs text-white/30">WAIT</span>
            </div>

            <div v-if="item.enter && item.entry_price" class="text-xs text-white/50 font-mono">
              入场: {{ formatPrice(item.entry_price) }}
            </div>

            <div v-if="item.error" class="text-xs text-red-400 mt-2">
              错误: {{ item.error }}
            </div>

            <div v-if="item.reason" class="text-xs text-white/40 mt-2 line-clamp-2">
              {{ item.reason }}
            </div>

            <div v-if="item.indicator_views" class="mt-3">
              <IndicatorViewsCard :views="item.indicator_views" title="指标观点（本次）" />
            </div>
          </div>

          <div v-if="history.length === 0" class="py-12 text-center">
            <div class="flex flex-col items-center gap-4 opacity-40">
              <i class="fas fa-inbox text-white/30 text-3xl"></i>
              <span class="text-white/50 text-sm">暂无运行记录</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Logs Terminal -->
      <div class="bento-full glass-card p-6 animate-slide-up stagger-3">
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
.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
