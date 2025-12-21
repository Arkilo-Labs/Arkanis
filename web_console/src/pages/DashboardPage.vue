<template>
    <AppShell title="概览" subtitle="工作区、订阅与激活">
        <div class="grid grid-2">
            <div class="card">
                <h2 class="card-title">工作区</h2>
                <div v-if="overview.organization" class="card-content">
                    <div class="stat-row">
                        <span class="stat-label">名称</span>
                        <span class="stat-value">{{ overview.organization.name }}</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">Slug</span>
                        <span class="stat-value"><code>{{ overview.organization.slug }}</code></span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">角色</span>
                        <span class="stat-value">{{ overview.organization.role }}</span>
                    </div>
                </div>
                <p v-else class="text-muted">加载中...</p>
            </div>

            <div class="card">
                <h2 class="card-title">订阅状态</h2>
                <div v-if="overview.subscription" class="card-content">
                    <div class="stat-row">
                        <span class="stat-label">计划</span>
                        <span class="stat-value">{{ overview.subscription.plan_code }}</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">到期</span>
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
import { onMounted, reactive, ref } from 'vue';
import { api } from '../lib/apiClient.js';
import AppShell from '../components/AppShell.vue';

const overview = reactive({ user: null, organization: null, subscription: null });
const code = ref('');
const redeemError = ref('');
const redeemSuccess = ref('');
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
    const res = await api.request('/api/console/overview');
    overview.user = res.user;
    overview.organization = res.organization;
    overview.subscription = res.subscription;
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
        overview.organization = res.organization;
        overview.subscription = res.subscription;
        redeemSuccess.value = '兑换成功，订阅已更新';
        code.value = '';
    } catch (e) {
        redeemError.value = e?.message || '兑换失败';
    } finally {
        redeeming.value = false;
    }
}

onMounted(load);
</script>

