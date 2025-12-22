<template>
    <AppShell title="订阅" subtitle="选择适合您的套餐">
        <!-- 当前订阅状态 -->
        <div v-if="subscription" class="card">
            <h2 class="card-title">当前订阅</h2>
            <div class="card-content">
                <div class="stat-row">
                    <span class="stat-label">套餐</span>
                    <span class="stat-value">{{ formatPlanCode(subscription.plan_code) }}</span>
                </div>
                <div class="stat-row">
                    <span class="stat-label">状态</span>
                    <span class="stat-value">{{ formatStatus(subscription.status) }}</span>
                </div>
                <div class="stat-row">
                    <span class="stat-label">有效期至</span>
                    <span class="stat-value">{{ formatDate(subscription.current_period_end) }}</span>
                </div>
            </div>
        </div>

        <!-- 定价卡片 -->
        <div class="card">
            <h2 class="card-title">选择套餐</h2>
            <div class="card-content">
                <div v-if="stripeError" class="form-error">{{ stripeError }}</div>
                <p v-if="stripeMsg" class="form-success">{{ stripeMsg }}</p>

                <div v-if="stripeConfig" class="pricing-grid">
                    <div 
                        v-for="(p, index) in stripeConfig.plans" 
                        :key="p.code" 
                        class="pricing-card"
                        :class="{ featured: index === 1 }"
                    >
                        <span v-if="index === 1" class="pricing-badge">推荐</span>
                        <div class="pricing-header">
                            <div class="pricing-name">{{ p.displayName }}</div>
                            <div class="pricing-price">
                                <span class="pricing-amount">{{ formatPrice(p) }}</span>
                                <span class="pricing-period">/月</span>
                            </div>
                        </div>
                        <p class="pricing-desc">{{ getPlanDesc(p.code) }}</p>
                        <ul class="pricing-features">
                            <li v-for="feature in getPlanFeatures(p.code)" :key="feature">{{ feature }}</li>
                        </ul>
                        <button
                            class="btn"
                            :class="index === 1 ? 'btn-primary' : 'btn-secondary'"
                            type="button"
                            :disabled="creatingStripe || !p.available"
                            @click="startCheckout(p.code)"
                        >
                            {{ p.available ? (creatingStripe ? '处理中...' : '立即订阅') : '暂不可用' }}
                        </button>
                    </div>
                </div>
                <p v-else class="text-muted">加载套餐信息...</p>
            </div>
        </div>

        <!-- 激活码兑换 -->
        <div class="card">
            <h2 class="card-title">激活码兑换</h2>
            <form class="card-content" @submit.prevent="onRedeem">
                <p class="text-muted" style="margin-bottom: 1rem;">如果您有激活码，可以在此处兑换</p>
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

function formatPlanCode(code) {
    const planMap = { monthly: '月度版', yearly: '年度版', free: '免费版' };
    return planMap[code] || code;
}

function formatStatus(status) {
    const statusMap = { active: '有效', canceled: '已取消', expired: '已过期', trialing: '试用中' };
    return statusMap[status] || status;
}

function formatPrice(plan) {
    const price = Number(plan.pricePerMonth || plan.allowanceCreditsPerMonth || 0);
    if (price <= 0) return '免费';
    return `$${price.toFixed(0)}`;
}

function getPlanDesc(code) {
    const descMap = {
        monthly: '按月付费，灵活选择',
        yearly: '年付享优惠，性价比之选',
        free: '基础功能体验',
    };
    return descMap[code] || '专业级 AI 分析服务';
}

function getPlanFeatures(code) {
    const featuresMap = {
        monthly: [
            '每月 100 次 AI 策略分析',
            '支持所有主流交易对',
            '实时行情图表',
            '优先客服支持',
        ],
        yearly: [
            '每月 150 次 AI 策略分析',
            '所有月度版功能',
            '专属高级模型',
            '优先体验新功能',
            '年付节省 20%',
        ],
        free: [
            '每月 10 次 AI 策略分析',
            '基础图表功能',
            '社区支持',
        ],
    };
    return featuresMap[code] || ['专业 AI 分析', '高级图表工具'];
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
