<template>
    <AppShell title="订阅" subtitle="选择适合您的套餐">
        <!-- 当前订阅状态 -->
        <div v-if="subscription" class="card">
            <div style="display:flex; align-items:center; justify-content:space-between; gap: 1rem;">
                <h2 class="card-title" style="margin:0;">当前订阅</h2>
                <button
                    v-if="subscription?.provider === 'stripe'"
                    class="btn btn-secondary btn-sm"
                    type="button"
                    :disabled="syncingStripe"
                    @click="syncStripeSubscription"
                >
                    {{ syncingStripe ? '同步中...' : '同步订阅' }}
                </button>
            </div>
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
                                <template v-if="upgradeDisplay[p.code]">
                                    <span class="pricing-amount pricing-discount">{{ upgradeDisplay[p.code].perMonthDisplay }}</span>
                                    <span class="pricing-period">/月</span>
                                    <span class="text-muted" style="margin-left:0.5rem;">
                                        {{ upgradeDisplay[p.code].payableTotalDisplay }}
                                        / {{ upgradeDisplay[p.code].months }} 个月
                                    </span>
                                    <span class="pricing-original">{{ upgradeDisplay[p.code].originalTotalDisplay }}</span>
                                </template>
                                <template v-else>
                                    <span class="pricing-amount">{{ formatPrice(p).amount }}</span>
                                    <span class="pricing-period">{{ formatPrice(p).period }}</span>
                                </template>
                            </div>
                            <div class="text-muted" style="margin-top:0.25rem;">
                                {{ formatBillingCycle(p) }}
                            </div>
                            <div v-if="upgradeDisplay[p.code]" class="upgrade-hint">
                                剩余价值：{{ upgradeDisplay[p.code].remainingValueDisplay }}（剩余 {{ upgradeDisplay[p.code].remainingPercent }}%）
                            </div>
                            <div v-else-if="isUpgradeTarget(p.code) && isActiveSubscription && isStripeSubscription && upgradeQuotes[p.code]?.loading" class="upgrade-hint">
                                正在计算升级补差价...
                            </div>
                            <div v-else-if="isUpgradeTarget(p.code) && isActiveSubscription && isStripeSubscription && upgradeQuotes[p.code]?.error" class="upgrade-hint">
                                升级补差价预估暂不可用，结算以 Stripe 结算页为准。
                            </div>
                            <div v-else-if="isUpgradeTarget(p.code) && isActiveSubscription && !isStripeSubscription" class="upgrade-hint">
                                当前订阅非 Stripe（例如激活码），无法计算升级补差价；需使用 Stripe 订阅开通后才可升级。
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
                            :disabled="creatingStripe || !p.available || isCurrentPlan(p.code)"
                            @click="startCheckout(p.code)"
                        >
                            {{ getButtonText(p, creatingStripe) }}
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
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
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
const upgradeQuotes = ref({});
const syncingStripe = ref(false);
const lastAutoSyncAt = ref(0);

const route = useRoute();

const currentPlanCode = computed(() => String(subscription.value?.plan_code || '').trim());
const isStripeSubscription = computed(() => subscription.value?.provider === 'stripe');
const isActiveSubscription = computed(() => {
    if (!subscription.value) return false;
    if (subscription.value.status !== 'active') return false;
    if (!subscription.value.current_period_end) return false;
    const end = new Date(subscription.value.current_period_end).getTime();
    return Number.isFinite(end) && end > Date.now();
});
const upgradeDisplay = computed(() => computeUpgradeDisplays());

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

function formatStatus(status) {
    const statusMap = { active: '有效', canceled: '已取消', expired: '已过期', trialing: '试用中' };
    return statusMap[status] || status;
}

function formatPrice(plan) {
    const price = plan?.price || null;
    const unitAmount = Number(price?.unitAmount);
    const interval = String(price?.interval || '').trim();
    const intervalCount = Number(price?.intervalCount);

    if (Number.isFinite(unitAmount) && unitAmount >= 0 && interval) {
        const total = unitAmount / 100;
        if (interval === 'month') {
            const denom = Number.isFinite(intervalCount) && intervalCount > 0 ? intervalCount : 1;
            const perMonth = total / denom;
            return { amount: `$${formatCompactNumber(perMonth)}`, period: '/月' };
        }
        if (interval === 'year') {
            const perMonth = total / 12;
            return { amount: `$${formatCompactNumber(perMonth)}`, period: '/月' };
        }
        if (interval === 'week') {
            return { amount: `$${formatCompactNumber(total)}`, period: '/周' };
        }
        return { amount: `$${formatCompactNumber(total)}`, period: `/${interval}` };
    }

    // 兜底：按营销口径显示（避免 Stripe 未配置时空白）
    const priceMap = { monthly: 10, quarterly: 8, yearly: 7, free: 0 };
    const v = Number(priceMap[plan.code]) || 0;
    if (v <= 0) return { amount: '免费', period: '' };
    return { amount: `$${v}`, period: '/月' };
}

function formatCompactNumber(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '0';
    if (Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n));
    return n.toFixed(2).replace(/\.?0+$/, '');
}

function formatMoney(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return `$${formatCompactNumber(n)}`;
}

function getPlanMonthsFromPriceSummary(price) {
    const interval = String(price?.interval || '').trim();
    const count = Number(price?.intervalCount);
    const intervalCount = Number.isFinite(count) && count > 0 ? count : 1;

    if (interval === 'month') return intervalCount;
    if (interval === 'year') return 12 * intervalCount;
    return null;
}

function getPlanTotalFromPriceSummary(price) {
    const unitAmount = Number(price?.unitAmount);
    if (!Number.isFinite(unitAmount) || unitAmount < 0) return null;
    return unitAmount / 100;
}

function findPlanInStripeConfig(planCode) {
    const code = String(planCode || '').trim();
    const plans = stripeConfig.value?.plans || [];
    return plans.find((p) => p.code === code) || null;
}

function computeUpgradeDisplays() {
    if (!isStripeSubscription.value) return {};
    if (!isActiveSubscription.value) return {};
    if (!stripeConfig.value?.plans?.length) return {};

    const start = new Date(subscription.value?.current_period_start || '').getTime();
    const end = new Date(subscription.value?.current_period_end || '').getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return {};

    const now = Date.now();
    const totalSeconds = (end - start) / 1000;
    const remainingSeconds = Math.max(0, (end - now) / 1000);
    if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return {};

    const ratio = Math.min(1, Math.max(0, remainingSeconds / totalSeconds));

    const currentPlan = findPlanInStripeConfig(currentPlanCode.value);
    const oldTotal = getPlanTotalFromPriceSummary(currentPlan?.price);
    if (!Number.isFinite(oldTotal) || oldTotal <= 0) return {};

    const out = {};
    for (const plan of stripeConfig.value.plans) {
        if (!isUpgradeTarget(plan.code)) continue;
        const newTotal = getPlanTotalFromPriceSummary(plan?.price);
        const months = getPlanMonthsFromPriceSummary(plan?.price);
        if (!Number.isFinite(newTotal) || newTotal <= 0) continue;
        if (!Number.isFinite(months) || months <= 0) continue;

        const remainingValue = oldTotal * ratio;
        const payableTotal = Math.max(0, newTotal - remainingValue);
        const perMonth = payableTotal / months;
        out[plan.code] = {
            months,
            perMonthDisplay: formatMoney(perMonth),
            payableTotalDisplay: formatMoney(payableTotal),
            originalTotalDisplay: formatMoney(newTotal),
            remainingValueDisplay: formatMoney(remainingValue),
            remainingPercent: formatCompactNumber(ratio * 100),
        };
    }
    return out;
}

function formatBillingCycle(plan) {
    const price = plan?.price || null;
    const unitAmount = Number(price?.unitAmount);
    const currency = String(price?.currency || '').toUpperCase();
    const interval = String(price?.interval || '').trim();
    const intervalCount = Number(price?.intervalCount);

    if (Number.isFinite(unitAmount) && unitAmount >= 0 && interval) {
        const total = (unitAmount / 100).toFixed(2);
        const cur = currency === 'USD' || !currency ? 'US$' : `${currency} `;
        if (interval === 'month') {
            const count = Number.isFinite(intervalCount) && intervalCount > 0 ? intervalCount : 1;
            return `${cur}${total} / ${count} 个月`;
        }
        if (interval === 'year') {
            const count = Number.isFinite(intervalCount) && intervalCount > 0 ? intervalCount : 1;
            return count === 1 ? `${cur}${total} / 年` : `${cur}${total} / ${count} 年`;
        }
        if (interval === 'week') {
            const count = Number.isFinite(intervalCount) && intervalCount > 0 ? intervalCount : 1;
            return count === 1 ? `${cur}${total} / 周` : `${cur}${total} / ${count} 周`;
        }
        return `${cur}${total} / ${interval}`;
    }

    // 兜底：营销口径的总价/周期
    if (plan.code === 'monthly') return '10 USD / 1 个月';
    if (plan.code === 'quarterly') return '24 USD / 3 个月';
    if (plan.code === 'yearly') return '84 USD / 12 个月';
    return '';
}

function getPlanDesc(code) {
    const descMap = {
        monthly: '10 USD/月，每月 300 积分',
        quarterly: '24 USD/季（约 8 USD/月），每月 400 积分',
        yearly: '84 USD/年（约 7 USD/月），每月 500 积分',
        free: '短信验证后可领取 10 积分体验',
    };
    return descMap[code] || '专业级 AI 分析服务';
}

function getPlanFeatures(code) {
    const featuresMap = {
        monthly: [
            '每月 300 积分（约 300 次 AI 分析）',
            '高级模型：Sonnet 4.5 / GPT-5.2 / Gemini 3 Pro / Qwen3-VL-Plus / GLM-4.7',
            '支持自定义 Provider 与倍率',
            '优先排队与稳定性保障',
        ],
        quarterly: [
            '每月 400 积分（按季付费）',
            '顶级模型：GPT-5.2 Extra Thinking / o3 / Opus 4.5',
            '包含月度版全部权益',
            '季付更省：24 USD/季',
        ],
        yearly: [
            '每月 500 积分（按年付费）',
            '顶级模型：GPT-5.2 Extra Thinking / o3 / Opus 4.5',
            '包含季度版全部权益',
            '年付最省：84 USD/年',
        ],
        free: [
            '短信验证后赠送 10 积分（体验）',
            '基础图表与策略体验',
            '社区支持',
        ],
    };
    return featuresMap[code] || ['专业 AI 分析', '高级图表工具'];
}

const PLAN_RANK = { free: 0, monthly: 1, quarterly: 2, yearly: 3 };

function isUpgradeTarget(planCode) {
    if (!subscription.value) return false;
    if (!isActiveSubscription.value) return false;
    const currentRank = PLAN_RANK[currentPlanCode.value] || 0;
    const targetRank = PLAN_RANK[String(planCode || '').trim()] || 0;
    return targetRank > currentRank;
}

// 判断是否为当前已订阅的套餐
function isCurrentPlan(planCode) {
    if (!subscription.value) return false;
    return subscription.value.plan_code === planCode && subscription.value.status === 'active';
}

// 获取按钮文字
function getButtonText(plan, loading) {
    if (!plan.available) return '暂不可用';
    if (loading) return '处理中...';
    if (isCurrentPlan(plan.code)) return '当前套餐';
    if (isUpgradeTarget(plan.code)) return '立即升级';
    return '立即订阅';
}

async function load() {
    const res = await api.request('/api/billing/subscription');
    subscription.value = res.subscription || null;
}

async function syncStripeSubscription() {
    syncingStripe.value = true;
    stripeError.value = '';
    try {
        await api.request('/api/stripe/subscriptions/sync', { method: 'POST' });
        await load();
        await loadStripeConfig();
        await loadUpgradeQuotes();
    } catch (e) {
        stripeError.value = e?.message || '同步订阅失败';
    } finally {
        syncingStripe.value = false;
    }
}

function shouldAutoSync() {
    if (syncingStripe.value) return false;
    if (subscription.value?.provider !== 'stripe') return false;
    const now = Date.now();
    if (now - lastAutoSyncAt.value < 15_000) return false;
    return true;
}

async function maybeAutoSync(reason) {
    if (!shouldAutoSync()) return;
    lastAutoSyncAt.value = Date.now();
    try {
        await syncStripeSubscription();
    } catch {
        // 自动同步失败不打扰用户，仍可手动点按钮
    } finally {
        // 预留：后续可用 reason 做埋点
        void reason;
    }
}

async function loadUpgradeQuotes() {
    upgradeQuotes.value = {};
    if (!isStripeSubscription.value) return;
    if (!isActiveSubscription.value) return;
    if (!stripeConfig.value?.plans?.length) return;

    for (const plan of stripeConfig.value.plans) {
        if (!isUpgradeTarget(plan.code)) continue;
        upgradeQuotes.value[plan.code] = { loading: true, error: false, amountDueDisplay: null };
        try {
            const quote = await api.request('/api/stripe/subscriptions/upgrade/preview', {
                method: 'POST',
                body: { targetPlanCode: plan.code },
            });
            upgradeQuotes.value[plan.code] = { ...quote, loading: false, error: false };
        } catch {
            upgradeQuotes.value[plan.code] = { loading: false, error: true, amountDueDisplay: null };
        }
    }
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

    if (flag === 'portal_return') {
        stripeMsg.value = '正在同步订阅...';
        await syncStripeSubscription().catch(() => null);
        stripeMsg.value = '订阅已更新';
        return;
    }

    if (flag === 'success' && sessionId) {
        stripeMsg.value = '支付完成，正在开通订阅...';
        try {
            await api.request('/api/stripe/checkout/complete', { method: 'POST', body: { sessionId } });
        } catch {}
        await syncStripeSubscription().catch(() => null);
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

watch([subscription, stripeConfig], () => {
    void loadUpgradeQuotes();
});

onMounted(async () => {
    await load();
    await loadStripeConfig();
    await loadUpgradeQuotes();
    await handleReturnFromStripe();

    // Stripe Portal 不一定会跳回 return_url（用户可能点“前往我的账户”或直接关闭页签）
    // 所以这里做一次“轻量自动同步”，并在用户切回窗口时再同步一次
    await maybeAutoSync('mounted');

    const onFocus = () => void maybeAutoSync('focus');
    const onVisibility = () => {
        if (document.visibilityState === 'visible') void maybeAutoSync('visible');
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);

    onUnmounted(() => {
        window.removeEventListener('focus', onFocus);
        document.removeEventListener('visibilitychange', onVisibility);
    });
});
</script>
