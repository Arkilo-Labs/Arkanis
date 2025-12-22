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
            <h2 class="card-title">Stripe 订阅</h2>
            <div class="card-content">
                <p class="text-muted">选择套餐后跳转到 Stripe 托管结账页完成支付（测试环境）。</p>

                <div v-if="stripeError" class="form-error">{{ stripeError }}</div>
                <p v-if="stripeMsg" class="form-success">{{ stripeMsg }}</p>

                <div v-if="stripeConfig" class="grid grid-2">
                    <div v-for="p in stripeConfig.plans" :key="p.code" class="card" style="padding: 1rem">
                        <div class="stat-row">
                            <span class="stat-label">套餐</span>
                            <span class="stat-value">{{ p.displayName }}</span>
                        </div>
                        <div class="stat-row">
                            <span class="stat-label">每月额度</span>
                            <span class="stat-value"><code>{{ Number(p.allowanceCreditsPerMonth).toFixed(2) }}</code></span>
                        </div>
                        <button
                            class="btn btn-primary mt-16"
                            type="button"
                            :disabled="creatingStripe || !p.available"
                            @click="startCheckout(p.code)"
                        >
                            {{ p.available ? (creatingStripe ? '创建中...' : '跳转支付') : '未配置' }}
                        </button>
                    </div>
                </div>
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
import { useRoute } from 'vue-router';

const subscription = ref(null);
const code = ref('');
const error = ref('');
const success = ref('');
const redeeming = ref(false);

const stripeConfig = ref(null);
const stripeError = ref('');
const stripeMsg = ref('');
const creatingStripe = ref(false);

const route = useRoute();

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

async function loadStripeConfig() {
    stripeError.value = '';
    try {
        stripeConfig.value = await api.request('/api/stripe/config');
    } catch (e) {
        stripeConfig.value = null;
        stripeError.value = e?.message || 'Stripe 配置加载失败';
    }
}

async function startCheckout(planCode) {
    stripeError.value = '';
    stripeMsg.value = '';
    creatingStripe.value = true;

    try {
        const res = await api.request('/api/stripe/checkout/create', {
            method: 'POST',
            body: { planCode },
        });
        if (!res?.url) throw new Error('未获取到跳转链接');
        window.location.assign(res.url);
    } catch (e) {
        stripeError.value = e?.message || '创建订阅失败';
    } finally {
        creatingStripe.value = false;
    }
}

async function handleReturnFromStripe() {
    const flag = String(route.query.stripe || '').trim();
    const sessionId = String(route.query.session_id || '').trim();

    if (flag === 'cancel') {
        stripeMsg.value = '已取消支付';
        return;
    }

    if (flag === 'success' && sessionId) {
        stripeMsg.value = '支付完成，正在开通订阅...';
        try {
            await api.request('/api/stripe/checkout/complete', { method: 'POST', body: { sessionId } });
        } catch {}
        await api.request('/api/stripe/subscriptions/sync', { method: 'POST' }).catch(() => null);
        await load();
        stripeMsg.value = '订阅已更新';
    }
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
onMounted(loadStripeConfig);
onMounted(handleReturnFromStripe);
</script>
