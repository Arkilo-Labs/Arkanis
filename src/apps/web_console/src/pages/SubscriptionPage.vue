<template>
    <AppShell title="订阅" subtitle="解锁 AI 分析的全部潜力">
        <!-- 无订阅时的营销横幅 -->
        <div v-if="!subscription" class="promo-banner">
            <div class="promo-content">
                <div class="promo-icon">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
                    </svg>
                </div>
                <div class="promo-text">
                    <h3>开启 AI 驱动的智能分析</h3>
                    <p>获得专业级 VLM 模型支持，自动识别 K 线形态，精准标注支撑/阻力位</p>
                </div>
            </div>
        </div>

        <!-- 当前订阅状态 -->
        <div v-if="subscription" class="card subscription-status-card">
            <div class="subscription-header">
                <div class="subscription-badge">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/>
                    </svg>
                    当前订阅
                </div>
                <button
                    v-if="subscription?.provider === 'stripe'"
                    class="btn btn-secondary btn-sm"
                    type="button"
                    :disabled="syncingStripe"
                    @click="syncStripeSubscription"
                >
                    {{ syncingStripe ? '同步中...' : '同步' }}
                </button>
            </div>
            <div class="subscription-details">
                <div class="subscription-plan">
                    <span class="plan-name">{{ formatPlanCode(subscription.plan_code) }}</span>
                    <span class="plan-status" :class="subscription.status">{{ formatStatus(subscription.status) }}</span>
                </div>
                <div class="plan-expiry">
                    有效期至 <strong>{{ formatDate(subscription.current_period_end) }}</strong>
                </div>
            </div>
        </div>

        <!-- 定价卡片 -->
        <div class="pricing-section">
            <div class="section-header">
                <h2>选择套餐</h2>
                <p v-if="!subscription">选择最适合您的方案，立即开始使用</p>
                <p v-else>升级至更高套餐，享受更多额度</p>
            </div>

            <div v-if="stripeError" class="form-error" style="margin-bottom: 1rem;">{{ stripeError }}</div>
            <p v-if="stripeMsg" class="form-success" style="margin-bottom: 1rem;">{{ stripeMsg }}</p>

            <div v-if="stripeConfig" class="pricing-grid">
                <div 
                    v-for="(p, index) in stripeConfig.plans" 
                    :key="p.code" 
                    class="pricing-card"
                    :class="{ featured: index === 1, current: isCurrentPlan(p.code) }"
                >
                    <span v-if="index === 1" class="pricing-badge">最受欢迎</span>
                    <span v-else-if="index === 2" class="pricing-badge pricing-badge-save">最省钱</span>
                    
                    <div class="pricing-header">
                        <div class="pricing-name">{{ p.displayName }}</div>
                        <div class="pricing-price">
                            <template v-if="upgradeDisplay[p.code]">
                                <span class="pricing-amount pricing-discount">{{ upgradeDisplay[p.code].perMonthDisplay }}</span>
                                <span class="pricing-period">/月</span>
                            </template>
                            <template v-else>
                                <span class="pricing-amount">{{ formatPrice(p).amount }}</span>
                                <span class="pricing-period">{{ formatPrice(p).period }}</span>
                            </template>
                        </div>
                        <div class="pricing-billing">
                            {{ formatBillingCycle(p) }}
                        </div>
                        
                        <!-- 升级信息 -->
                        <div v-if="upgradeDisplay[p.code]" class="upgrade-info">
                            <div class="upgrade-price">
                                升级价：{{ upgradeDisplay[p.code].payableTotalDisplay }}
                                <span class="original-price">{{ upgradeDisplay[p.code].originalTotalDisplay }}</span>
                            </div>
                            <div class="upgrade-value">
                                已抵扣 {{ upgradeDisplay[p.code].remainingValueDisplay }}（{{ upgradeDisplay[p.code].remainingPercent }}%）
                            </div>
                        </div>
                        <div v-else-if="isUpgradeTarget(p.code) && isActiveSubscription && isStripeSubscription && upgradeQuotes[p.code]?.loading" class="upgrade-hint">
                            计算升级价格中...
                        </div>
                        <div v-else-if="isUpgradeTarget(p.code) && isActiveSubscription && !isStripeSubscription" class="upgrade-hint upgrade-hint-warn">
                            激活码订阅无法直接升级
                        </div>
                    </div>

                    <div class="pricing-body">
                        <p class="pricing-desc">{{ getPlanDesc(p.code) }}</p>
                        <ul class="pricing-features">
                            <li v-for="feature in getPlanFeatures(p.code)" :key="feature">{{ feature }}</li>
                        </ul>
                    </div>

                    <button
                        class="btn pricing-btn"
                        :class="getPricingButtonClass(p, index)"
                        type="button"
                        :disabled="creatingStripe || !p.available || isCurrentPlan(p.code)"
                        @click="startCheckout(p.code)"
                    >
                        {{ getButtonText(p, creatingStripe) }}
                    </button>
                </div>
            </div>
            <div v-else class="loading-placeholder">
                <div class="loading-spinner"></div>
                <p>加载套餐信息...</p>
            </div>
        </div>

        <!-- 激活码兑换 -->
        <div class="card activation-card">
            <div class="activation-header">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                    <circle cx="12" cy="16" r="1"/>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
                <h3>激活码兑换</h3>
            </div>
            <p class="text-muted">购买了激活码？在此处兑换开通订阅</p>
            <form class="activation-form" @submit.prevent="onRedeem">
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

// 获取定价按钮样式类
function getPricingButtonClass(plan, index) {
    if (isCurrentPlan(plan.code)) return 'btn-secondary';
    if (index === 1) return 'btn-primary';
    if (index === 2) return 'btn-accent';
    return 'btn-secondary';
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

<style scoped>
/* 营销横幅 */
.promo-banner {
    background: linear-gradient(135deg, rgba(255, 69, 0, 0.15) 0%, rgba(255, 100, 50, 0.08) 100%);
    border: 1px solid rgba(255, 69, 0, 0.3);
    border-radius: var(--radius-2xl);
    padding: var(--spacing-xl);
    margin-bottom: var(--spacing-xl);
}

.promo-content {
    display: flex;
    align-items: center;
    gap: var(--spacing-lg);
}

.promo-icon {
    flex-shrink: 0;
    width: 56px;
    height: 56px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, var(--color-accent), var(--color-accent-light));
    border-radius: var(--radius-xl);
    color: white;
}

.promo-text h3 {
    font-size: var(--font-size-xl);
    font-weight: 600;
    margin-bottom: var(--spacing-xs);
    color: var(--color-white);
}

.promo-text p {
    color: var(--color-text-muted);
    font-size: var(--font-size-base);
}

/* 订阅状态卡片 */
.subscription-status-card {
    background: linear-gradient(135deg, rgba(34, 197, 94, 0.1) 0%, rgba(30, 30, 30, 0.6) 100%);
    border-color: rgba(34, 197, 94, 0.3);
}

.subscription-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--spacing-md);
}

.subscription-badge {
    display: inline-flex;
    align-items: center;
    gap: var(--spacing-xs);
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--color-success);
}

.subscription-details {
    padding-top: var(--spacing-md);
    border-top: 1px solid var(--color-border-light);
}

.subscription-plan {
    display: flex;
    align-items: center;
    gap: var(--spacing-md);
    margin-bottom: var(--spacing-sm);
}

.plan-name {
    font-size: var(--font-size-xl);
    font-weight: 700;
    color: var(--color-white);
}

.plan-status {
    font-size: var(--font-size-xs);
    font-weight: 600;
    padding: 0.2rem 0.6rem;
    border-radius: var(--radius-full);
    text-transform: uppercase;
}

.plan-status.active {
    background: rgba(34, 197, 94, 0.2);
    color: var(--color-success);
}

.plan-expiry {
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
}

/* 定价区域 */
.pricing-section {
    margin-bottom: var(--spacing-xl);
}

.section-header {
    margin-bottom: var(--spacing-xl);
}

.section-header h2 {
    font-size: var(--font-size-2xl);
    font-weight: 700;
    margin-bottom: var(--spacing-xs);
}

.section-header p {
    color: var(--color-text-muted);
}

.pricing-badge-save {
    background: linear-gradient(135deg, #10b981, #34d399);
}

.pricing-card.current {
    opacity: 0.7;
}

.pricing-billing {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
    margin-top: var(--spacing-xs);
}

.pricing-body {
    flex: 1;
    margin-bottom: var(--spacing-lg);
}

.pricing-btn {
    width: 100%;
    margin-top: auto;
}

/* 升级信息 */
.upgrade-info {
    margin-top: var(--spacing-md);
    padding: var(--spacing-sm) var(--spacing-md);
    background: rgba(255, 69, 0, 0.1);
    border-radius: var(--radius-lg);
    font-size: var(--font-size-sm);
}

.upgrade-price {
    color: var(--color-accent);
    font-weight: 600;
}

.original-price {
    color: var(--color-text-muted);
    text-decoration: line-through;
    margin-left: var(--spacing-sm);
}

.upgrade-value {
    color: var(--color-success);
    font-size: var(--font-size-xs);
    margin-top: 0.25rem;
}

.upgrade-hint {
    font-size: var(--font-size-xs);
    color: var(--color-text-muted);
    margin-top: var(--spacing-sm);
}

.upgrade-hint-warn {
    color: var(--color-warning);
}

/* 加载状态 */
.loading-placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: var(--spacing-3xl);
    color: var(--color-text-muted);
}

.loading-spinner {
    width: 32px;
    height: 32px;
    border: 3px solid var(--color-border);
    border-top-color: var(--color-accent);
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin-bottom: var(--spacing-md);
}

@keyframes spin {
    to { transform: rotate(360deg); }
}

/* 激活码区域 */
.activation-card {
    background: rgba(30, 30, 30, 0.4);
}

.activation-header {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    margin-bottom: var(--spacing-sm);
    color: var(--color-text);
}

.activation-header h3 {
    font-size: var(--font-size-lg);
    font-weight: 600;
    margin: 0;
}

.activation-form {
    margin-top: var(--spacing-md);
}

/* 响应式适配 */
@media (max-width: 768px) {
    .promo-content {
        flex-direction: column;
        text-align: center;
    }

    .promo-text h3 {
        font-size: var(--font-size-lg);
    }

    .subscription-plan {
        flex-direction: column;
        align-items: flex-start;
        gap: var(--spacing-sm);
    }
}
</style>
