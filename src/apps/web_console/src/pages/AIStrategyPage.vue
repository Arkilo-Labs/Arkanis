<template>
    <AppShell title="AI 策略" subtitle="智能分析交易信号">
        <div v-if="loading" class="card">
            <p class="text-muted">加载中...</p>
        </div>

        <div v-else-if="!state.subscriptionActive" class="card">
            <h2 class="card-title">需要订阅</h2>
            <div class="card-content">
                <p class="text-muted">当前账号未激活订阅，无法运行策略分析。</p>
                <div class="input-with-button">
                    <input v-model="activationCode" class="form-input" placeholder="输入激活码" />
                    <button class="btn btn-primary" type="button" :disabled="redeeming" @click="redeem">
                        {{ redeeming ? '兑换中...' : '兑换并激活' }}
                    </button>
                </div>
                <p v-if="redeemError" class="form-error">{{ redeemError }}</p>
                <p v-if="redeemSuccess" class="form-success">{{ redeemSuccess }}</p>
            </div>
        </div>

        <div v-else class="grid grid-2">
            <div class="card credit-summary-card" style="grid-column: 1 / -1;">
                <div class="card-content">
                    <div class="credit-progress-section">
                        <div class="credit-header">
                            <span class="credit-label">剩余额度</span>
                            <span class="credit-value">{{ (state.credit?.remainingCredits ?? 0).toFixed(0) }} <span class="credit-unit">积分</span></span>
                        </div>
                        <div class="progress-bar">
                            <div class="progress-fill" :style="{ width: creditPercent + '%' }"></div>
                        </div>
                        <div class="credit-meta">
                            <span>重置：{{ formatDate(state.credit?.periodEnd) }}</span>
                            <span v-if="selectedProvider">模型：{{ selectedProvider.display_name }}</span>
                            <span v-else class="text-warn">未选择模型</span>
                        </div>
                    </div>
                    <p v-if="!selectedProvider" class="form-error" style="margin-top: 0.75rem;">请先在「模型」页面选择并配置</p>
                    <p v-else-if="!selectedProvider.hasKey" class="form-error" style="margin-top: 0.75rem;">当前模型未配置密钥</p>
                </div>
            </div>


            <div class="card">
                <h2 class="card-title">参数</h2>
                <div class="card-content">
                    <div class="form-group">
                        <label class="form-label">交易对</label>
                        <input v-model="config.symbol" class="form-input" placeholder="BTCUSDT" :disabled="isRunning" />
                    </div>

                    <div class="form-group">
                        <label class="form-label">时间周期</label>
                        <select v-model="config.timeframe" class="form-input" :disabled="isRunning">
                            <option v-for="tf in timeframes" :key="tf" :value="tf">{{ tf }}</option>
                        </select>
                    </div>

                    <div class="form-group">
                        <label class="form-label">K线数量</label>
                        <input v-model.number="config.bars" class="form-input" type="number" min="50" max="2000" :disabled="isRunning" />
                    </div>

                    <div class="form-group">
                        <label class="form-label">4x 模式</label>
                        <div class="input-with-button">
                            <label class="text-muted" style="display:flex;align-items:center;gap:0.5rem;">
                                <input v-model="config.enable4x" type="checkbox" :disabled="isRunning" />
                                启用辅助周期图
                            </label>
                        </div>
                    </div>

                    <div v-if="config.enable4x" class="form-group">
                        <label class="form-label">辅助周期</label>
                        <select v-model="config.auxTimeframe" class="form-input" :disabled="isRunning">
                            <option value="">自动</option>
                            <option v-for="tf in timeframes" :key="tf" :value="tf">{{ tf }}</option>
                        </select>
                    </div>

                    <div class="input-with-button">
                        <button class="btn btn-primary" type="button" :disabled="isRunning || !canRun" @click="run">
                            {{ isRunning ? '运行中...' : '运行策略分析' }}
                        </button>
                        <button class="btn btn-danger" type="button" :disabled="!pid" @click="stop">停止</button>
                    </div>

                    <p v-if="runError" class="form-error">{{ runError }}</p>
                </div>
            </div>

            <div class="card">
                <h2 class="card-title">结果</h2>
                <div class="card-content">
                    <div v-if="decision" class="grid grid-2" style="gap: 0.75rem;">
                        <div class="stat-row">
                            <span class="stat-label">入场信号</span>
                            <span class="stat-value">{{ decision.enter ? '建议入场' : '等待观望' }}</span>
                        </div>
                        <div class="stat-row">
                            <span class="stat-label">置信度</span>
                            <span class="stat-value">{{ Math.round((decision.confidence || 0) * 100) }}%</span>
                        </div>
                        <div v-if="decision.enter" class="stat-row">
                            <span class="stat-label">方向</span>
                            <span class="stat-value">{{ formatDirection(decision.direction) }}</span>
                        </div>
                        <div v-if="decision.enter" class="stat-row">
                            <span class="stat-label">入场价</span>
                            <span class="stat-value">{{ formatPrice(decision.entry_price) }}</span>
                        </div>
                        <div v-if="decision.enter" class="stat-row">
                            <span class="stat-label">止损价</span>
                            <span class="stat-value">{{ formatPrice(decision.stop_loss_price) }}</span>
                        </div>
                        <div v-if="decision.enter" class="stat-row">
                            <span class="stat-label">止盈价</span>
                            <span class="stat-value">{{ formatPrice(decision.take_profit_price) }}</span>
                        </div>
                    </div>
                    <p v-else class="text-muted">等待分析结果</p>

                    <div v-if="decision?.reason" class="mt-16">
                        <div class="stat-row">
                            <span class="stat-label">分析理由</span>
                            <span class="stat-value" style="text-align:right;max-width:70%;">{{ decision.reason }}</span>
                        </div>
                    </div>

                    <div v-if="decision?.indicator_views" class="mt-16">
                        <IndicatorViewsCard :views="decision.indicator_views" />
                    </div>
                </div>
            </div>

            <div class="card" style="grid-column: 1 / -1;">
                <h2 class="card-title">日志</h2>
                <LogTerminal :logs="logs" />
            </div>

            <div class="card" style="grid-column: 1 / -1;">
                <h2 class="card-title">图表</h2>
                <div class="card-content">
                    <div v-if="chart.base" class="grid grid-2">
                        <div>
                            <p class="text-muted" style="margin-bottom:0.5rem;">Base</p>
                            <ChartView :data="chart.base" :title="`${chart.base.symbol} ${chart.base.timeframe}`" :height="420" />
                        </div>
                        <div v-if="chart.aux">
                            <p class="text-muted" style="margin-bottom:0.5rem;">Aux</p>
                            <ChartView :data="chart.aux" :title="`${chart.aux.symbol} ${chart.aux.timeframe}`" :height="420" />
                        </div>
                        <div v-if="chart.lens" style="grid-column: 1 / -1;">
                            <p class="text-muted" style="margin-bottom:0.5rem;">Lens Overlays</p>
                            <ChartView :data="chart.lens" :title="`Lens ${chart.lens.symbol} ${chart.lens.timeframe}`" :height="460" />
                        </div>
                    </div>
                    <p v-else class="text-muted">暂无图表数据</p>
                </div>
            </div>
        </div>
    </AppShell>
</template>

<script setup>
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import AppShell from '../components/AppShell.vue';
import ChartView from '../components/ChartView.vue';
import LogTerminal from '../components/LogTerminal.vue';
import IndicatorViewsCard from '../components/IndicatorViewsCard.vue';
import { api } from '../lib/apiClient.js';
import { useSaasSocket } from '../composables/useSaasSocket.js';

const timeframes = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];

const loading = ref(true);
const activationCode = ref('');
const redeeming = ref(false);
const redeemError = ref('');
const redeemSuccess = ref('');

const state = reactive({
    subscription: null,
    subscriptionActive: false,
    credit: null,
    providers: { selectedId: null, items: [] },
});

const config = reactive({
    symbol: 'BTCUSDT',
    timeframe: '1h',
    bars: 200,
    enable4x: false,
    auxTimeframe: '',
});

const isRunning = ref(false);
const pid = ref(null);
const sessionId = ref('');
const logs = ref([]);
const runError = ref('');
const decision = ref(null);
const chart = reactive({ base: null, aux: null, lens: null });

const selectedProvider = computed(() => state.providers.items.find((p) => p.id === state.providers.selectedId) || null);
const canRun = computed(() => !!selectedProvider.value && !!selectedProvider.value.hasKey);

// 额度百分比用于进度条
const creditPercent = computed(() => {
    const remaining = state.credit?.remainingCredits ?? 0;
    const allowance = state.credit?.allowanceCredits ?? 0;
    if (allowance <= 0) return 0;
    return Math.min(100, Math.max(0, (remaining / allowance) * 100));
});

function addLog(type, data, sid) {
    if (sid && sessionId.value && sid !== sessionId.value) return;
    logs.value.push({ type, data, timestamp: Date.now() });
}

function newSessionId() {
    return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function formatPrice(value) {
    if (value === null || value === undefined || value === 0) return '-';
    if (value === 'market') return '市价';
    const num = Number(value);
    if (!Number.isFinite(num)) return '-';
    return num.toFixed(6);
}

function formatDate(value) {
    if (!value) return '-';
    try {
        return new Date(value).toISOString().slice(0, 10);
    } catch {
        return String(value);
    }
}

function formatDirection(dir) {
    const dirMap = { long: '做多', short: '做空', buy: '买入', sell: '卖出' };
    return dirMap[String(dir).toLowerCase()] || dir;
}

async function loadState() {
    const res = await api.request('/api/saas/ai/state');
    state.subscription = res.subscription || null;
    state.subscriptionActive = !!res.subscriptionActive;
    state.credit = res.credit || null;
    state.providers = res.providers || { selectedId: null, items: [] };
}

async function redeem() {
    redeemError.value = '';
    redeemSuccess.value = '';
    redeeming.value = true;
    try {
        const res = await api.request('/api/billing/redeem-activation-code', {
            method: 'POST',
            body: { code: activationCode.value },
        });
        state.subscription = res.subscription || null;
        state.subscriptionActive = true;
        redeemSuccess.value = '已激活订阅';
        activationCode.value = '';
        await loadState();
    } catch (e) {
        redeemError.value = e?.message || '兑换失败';
    } finally {
        redeeming.value = false;
    }
}

async function run() {
    runError.value = '';
    logs.value = [];
    decision.value = null;
    chart.base = null;
    chart.aux = null;
    chart.lens = null;

    sessionId.value = newSessionId();
    isRunning.value = true;

    const args = [
        '--symbol',
        config.symbol,
        '--timeframe',
        config.timeframe,
        '--bars',
        String(config.bars),
        '--wait',
        '1000',
        '--session-id',
        sessionId.value,
    ];

    if (config.enable4x) {
        args.push('--enable-4x-chart');
        if (config.auxTimeframe) args.push('--aux-timeframe', config.auxTimeframe);
    }

    try {
        const res = await api.request('/api/saas/run-script', {
            method: 'POST',
            body: { script: 'main', args, sessionId: sessionId.value },
        });
        pid.value = res.pid || null;
        if (!pid.value) throw new Error('启动失败');
        if (res.charged?.remainingCredits !== undefined && state.credit) {
            state.credit.remainingCredits = Number(res.charged.remainingCredits);
            state.credit.periodEnd = res.charged.nextResetAt || state.credit.periodEnd;
        }
    } catch (e) {
        runError.value = e?.message || '启动失败';
        isRunning.value = false;
    }
}

function stop() {
    if (!pid.value) return;
    socket().emit('kill-process', pid.value);
}

async function loadChartData() {
    if (!sessionId.value) return;
    const res = await api.request(`/api/saas/chart-data/${encodeURIComponent(sessionId.value)}`);
    chart.base = res.base || null;
    chart.aux = res.aux || null;
    chart.lens = res.lens || null;
    decision.value = res.decision || null;
}

const { socket } = useSaasSocket();

function onLog(msg) {
    addLog(msg.type, msg.data, msg.sessionId);
}

async function onExit(msg) {
    if (msg.sessionId && msg.sessionId !== sessionId.value) return;
    addLog('stdout', `Process exited with code ${msg.code}`, msg.sessionId);
    isRunning.value = false;
    pid.value = null;

    if (msg.code === 0) {
        try {
            await loadChartData();
        } catch (e) {
            addLog('error', `加载图表失败: ${e?.message || String(e)}`, msg.sessionId);
        }
    }
}

function onKilled(killedPid) {
    if (killedPid !== pid.value) return;
    addLog('stderr', 'Process terminated.', sessionId.value);
    isRunning.value = false;
    pid.value = null;
}

onMounted(async () => {
    try {
        await loadState();
    } finally {
        loading.value = false;
    }

    socket().on('log', onLog);
    socket().on('process-exit', onExit);
    socket().on('process-killed', onKilled);
});

onUnmounted(() => {
    socket()?.off?.('log', onLog);
    socket()?.off?.('process-exit', onExit);
    socket()?.off?.('process-killed', onKilled);
});
</script>

<style scoped>
.credit-summary-card {
    background: linear-gradient(135deg, rgba(30, 30, 30, 0.8) 0%, rgba(25, 25, 25, 0.6) 100%);
}

.credit-progress-section {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
}

.credit-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
}

.credit-label {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
}

.credit-value {
    font-size: var(--font-size-2xl);
    font-weight: 700;
    color: var(--color-white);
}

.credit-unit {
    font-size: var(--font-size-sm);
    font-weight: 400;
    color: var(--color-text-muted);
}

.credit-meta {
    display: flex;
    flex-wrap: wrap;
    gap: var(--spacing-md);
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
}

.text-warn {
    color: var(--color-warning, #f59e0b);
}

@media (max-width: 480px) {
    .credit-value {
        font-size: var(--font-size-xl);
    }

    .credit-meta {
        flex-direction: column;
        gap: var(--spacing-xs);
    }
}
</style>
