<template>
    <AppShell title="概览" subtitle="我的账号与订阅信息">
        <!-- 余额卡片 -->
        <div class="card balance-card">
            <div class="balance-header">
                <h2 class="card-title">当前余额</h2>
                <RouterLink class="btn btn-primary btn-sm" to="/app/subscription">立即充值</RouterLink>
            </div>
            <div class="card-content">
                <div class="balance-row">
                    <div class="balance-info">
                        <span class="balance-label">订阅额度</span>
                        <span class="balance-hint">优先消耗，在订阅过期时间后清空</span>
                    </div>
                    <span class="balance-value">{{ formatCredits(credit?.remainingCredits) }}</span>
                </div>
                <div class="progress-bar">
                    <div class="progress-fill" :style="{ width: creditProgress + '%' }"></div>
                </div>
            </div>
        </div>

        <div class="grid grid-2">
            <div class="card">
                <h2 class="card-title">账号信息</h2>
                <div v-if="overview.user" class="card-content">
                    <div class="stat-row">
                        <span class="stat-label">邮箱</span>
                        <span class="stat-value">{{ overview.user.email }}</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">昵称</span>
                        <span class="stat-value">{{ overview.user.display_name || '-' }}</span>
                    </div>
                </div>
                <p v-else class="text-muted">加载中...</p>
            </div>

            <div class="card">
                <h2 class="card-title">订阅状态</h2>
                <div v-if="overview.subscription" class="card-content">
                    <div class="stat-row">
                        <span class="stat-label">套餐</span>
                        <span class="stat-value">{{ formatPlanCode(overview.subscription.plan_code) }}</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">有效期至</span>
                        <span class="stat-value">{{ formatDate(overview.subscription.current_period_end) }}</span>
                    </div>
                </div>
                <p v-else class="text-muted">暂无订阅，可使用激活码开通</p>
            </div>
        </div>

        <div class="card">
            <h2 class="card-title">激活码兑换</h2>
            <form class="card-content" @submit.prevent="onRedeem">
                <div class="input-with-button">
                    <input v-model="code" class="form-input" placeholder="输入激活码" required />
                    <button class="btn btn-primary" type="submit" :disabled="redeeming">
                        {{ redeeming ? '兑换中...' : '兑换' }}
                    </button>
                </div>
                <p v-if="redeemError" class="form-error">{{ redeemError }}</p>
                <p v-if="redeemSuccess" class="form-success">{{ redeemSuccess }}</p>
            </form>
        </div>
    </AppShell>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { api } from '../lib/apiClient.js';
import AppShell from '../components/AppShell.vue';
import { useOverviewStore } from '../stores/overviewStore.js';

const overview = reactive({ user: null, subscription: null });
const credit = ref(null);
const code = ref('');
const redeemError = ref('');
const redeemSuccess = ref('');
const redeeming = ref(false);
const loading = ref(false);

const overviewStore = useOverviewStore();

const creditProgress = computed(() => {
    if (!credit.value) return 0;
    const { allowanceCredits, remainingCredits } = credit.value;
    if (!allowanceCredits || allowanceCredits <= 0) return 0;
    return Math.min(100, Math.max(0, (remainingCredits / allowanceCredits) * 100));
});

function formatDate(value) {
    if (!value) return '-';
    try {
        return new Date(value).toISOString().slice(0, 10);
    } catch {
        return String(value);
    }
}

function formatPlanCode(code) {
    const planMap = { monthly: '月度版', quarterly: '季度版', yearly: '年度版', free: '免费版' };
    return planMap[code] || code;
}

function formatCredits(value) {
    if (value === null || value === undefined) return '0.00';
    return Number(value).toFixed(2);
}

async function load({ force = false } = {}) {
    loading.value = true;
    try {
        const res = await overviewStore.get({ force });
        overview.user = res.user;
        overview.subscription = res.subscription;
    } finally {
        loading.value = false;
    }
}

async function loadCredit() {
    try {
        const res = await api.request('/api/saas/ai/state');
        credit.value = res.credit || null;
    } catch {
        credit.value = null;
    }
}

async function onRedeem() {
    redeemError.value = '';
    redeemSuccess.value = '';
    redeeming.value = true;
    try {
        const res = await api.request('/api/billing/redeem-activation-code', {
            method: 'POST',
            body: { code: code.value },
        });
        overviewStore.invalidate();
        await load({ force: true });
        await loadCredit();
        overview.subscription = res.subscription;
        redeemSuccess.value = '兑换成功，订阅已更新';
        code.value = '';
    } catch (e) {
        redeemError.value = e?.message || '兑换失败';
    } finally {
        redeeming.value = false;
    }
}

onMounted(() => {
    load({ force: false });
    loadCredit();
});
</script>
