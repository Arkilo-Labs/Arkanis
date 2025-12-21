<template>
    <AppShell title="订阅" subtitle="查看当前订阅并兑换激活码">
        <div class="card">
            <h2 class="card-title">当前订阅</h2>
            <div class="card-content">
                <div v-if="subscription">
                    <div class="stat-row">
                        <span class="stat-label">计划</span>
                        <span class="stat-value">{{ subscription.plan_code }}</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">状态</span>
                        <span class="stat-value">{{ subscription.status }}</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">到期</span>
                        <span class="stat-value">{{ formatDate(subscription.current_period_end) }}</span>
                    </div>
                </div>
                <p v-else class="text-muted">暂无订阅</p>
            </div>
        </div>

        <div class="card">
            <h2 class="card-title">兑换激活码</h2>
            <form class="card-content" @submit.prevent="onRedeem">
                <div class="input-with-button">
                    <input v-model="code" class="form-input" placeholder="输入激活码" required />
                    <button class="btn btn-primary" type="submit" :disabled="redeeming">
                        {{ redeeming ? '兑换中...' : '兑换' }}
                    </button>
                </div>
                <p v-if="error" class="form-error">{{ error }}</p>
                <p v-if="success" class="form-success">{{ success }}</p>
            </form>
        </div>
    </AppShell>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { api } from '../lib/apiClient.js';
import AppShell from '../components/AppShell.vue';

const subscription = ref(null);
const code = ref('');
const error = ref('');
const success = ref('');
const redeeming = ref(false);

function formatDate(value) {
    if (!value) return '-';
    try {
        return new Date(value).toISOString().slice(0, 10);
    } catch {
        return String(value);
    }
}

async function load() {
    const res = await api.request('/api/billing/subscription');
    subscription.value = res.subscription || null;
}

async function onRedeem() {
    error.value = '';
    success.value = '';
    redeeming.value = true;
    try {
        const res = await api.request('/api/billing/redeem-activation-code', {
            method: 'POST',
            body: { code: code.value },
        });
        subscription.value = res.subscription || null;
        success.value = '兑换成功';
        code.value = '';
    } catch (e) {
        error.value = e?.message || '兑换失败';
    } finally {
        redeeming.value = false;
    }
}

onMounted(load);
</script>

