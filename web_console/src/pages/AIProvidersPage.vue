<template>
    <AppShell title="AI 服务商" subtitle="配置 AI 模型与额度">
        <div v-if="loading" class="card">
            <p class="text-muted">加载中...</p>
        </div>

        <div v-else class="grid grid-2">
            <div class="card">
                <h2 class="card-title">额度信息</h2>
                <div class="card-content">
                    <div class="stat-row">
                        <span class="stat-label">订阅状态</span>
                        <span class="stat-value">{{ state.subscriptionActive ? '已激活' : '未激活' }}</span>
                    </div>
                    <div v-if="state.subscription" class="stat-row">
                        <span class="stat-label">套餐</span>
                        <span class="stat-value">{{ formatPlanCode(state.subscription.plan_code) }}</span>
                    </div>
                    <div v-if="state.credit" class="stat-row">
                        <span class="stat-label">月度额度</span>
                        <span class="stat-value">{{ state.credit.allowanceCredits.toFixed(2) }}</span>
                    </div>
                    <div v-if="state.credit" class="stat-row">
                        <span class="stat-label">已使用</span>
                        <span class="stat-value">{{ state.credit.usedCredits.toFixed(2) }}</span>
                    </div>
                    <div v-if="state.credit" class="stat-row">
                        <span class="stat-label">可用额度</span>
                        <span class="stat-value">{{ state.credit.remainingCredits.toFixed(2) }}</span>
                    </div>
                    <div v-if="state.credit" class="stat-row">
                        <span class="stat-label">重置日期</span>
                        <span class="stat-value">{{ formatDate(state.credit.periodEnd) }}</span>
                    </div>
                    <p v-if="!state.subscriptionActive" class="text-muted">
                        未激活订阅时不会扣费，也无法运行策略分析；你仍可提前配置 Provider。
                    </p>
                </div>
            </div>

            <div class="card">
                <h2 class="card-title">当前选择</h2>
                <div class="card-content">
                    <p v-if="!selected" class="text-muted">尚未选择服务商</p>
                    <div v-else>
                        <div class="stat-row">
                            <span class="stat-label">名称</span>
                            <span class="stat-value">{{ selected.display_name }}</span>
                        </div>
                        <div class="stat-row">
                            <span class="stat-label">模型</span>
                            <span class="stat-value">{{ selected.model_name }}</span>
                        </div>
                        <div class="stat-row">
                            <span class="stat-label">消耗倍率</span>
                            <span class="stat-value">{{ (selected.multiplier_x100 / 100).toFixed(2) }}x</span>
                        </div>
                        <p v-if="!selected.hasKey && canEditKeys" class="form-error">该服务商未配置密钥</p>
                        <p v-else-if="!selected.hasKey" class="text-muted">该服务商未就绪，请联系管理员配置</p>
                    </div>
                </div>
            </div>

            <div class="card" style="grid-column: 1 / -1;">
                <h2 class="card-title">服务商列表</h2>
                <div class="card-content">
                    <p v-if="error" class="form-error">{{ error }}</p>

                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>名称</th>
                                <th>模型</th>
                                <th>消耗倍率</th>
                                <th v-if="canEditKeys">密钥状态</th>
                                <th>操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="p in state.providers.items" :key="p.id">
                                <td>{{ p.display_name }}</td>
                                <td>{{ p.model_name }}</td>
                                <td>{{ (p.multiplier_x100 / 100).toFixed(2) }}x</td>
                                <td v-if="canEditKeys">
                                    <span v-if="p.hasKey" class="form-success">已设置</span>
                                    <span v-else class="text-muted">未设置</span>
                                </td>
                                <td>
                                    <button class="btn btn-secondary btn-sm" type="button" :disabled="selectingId === p.id" @click="select(p.id)">
                                        {{ state.providers.selectedId === p.id ? '已选中' : selectingId === p.id ? '选择中...' : '选择' }}
                                    </button>
                                </td>
                            </tr>
                        </tbody>
                    </table>

                    <div v-if="canEditKeys" class="mt-16">
                        <h3 class="card-title" style="margin-bottom:0.75rem;">配置密钥</h3>
                        <div class="grid grid-2">
                            <div class="form-group">
                                <label class="form-label">服务商</label>
                                <select v-model="keyForm.providerId" class="form-input">
                                    <option value="">请选择</option>
                                    <option v-for="p in state.providers.items" :key="p.id" :value="p.id">
                                        {{ p.display_name }} ({{ p.model_name }})
                                    </option>
                                </select>
                            </div>
                            <div class="form-group">
                                <label class="form-label">密钥</label>
                                <input v-model="keyForm.apiKey" class="form-input" placeholder="sk-..." />
                                <p v-if="keyError" class="form-error">{{ keyError }}</p>
                                <p v-if="keySuccess" class="form-success">{{ keySuccess }}</p>
                            </div>
                        </div>
                        <button class="btn btn-primary" type="button" :disabled="savingKey" @click="saveKey">
                            {{ savingKey ? '保存中...' : '保存' }}
                        </button>
                    </div>
                    <p v-else class="text-muted mt-16">密钥由管理员配置，您只能选择服务商。</p>
                </div>
            </div>
        </div>
    </AppShell>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import AppShell from '../components/AppShell.vue';
import { api } from '../lib/apiClient.js';
import { useAuthStore } from '../stores/authStore.js';

const loading = ref(true);
const error = ref('');

const state = reactive({
    subscription: null,
    subscriptionActive: false,
    credit: null,
    providers: { selectedId: null, items: [] },
});

const selectingId = ref('');

const keyForm = reactive({ providerId: '', apiKey: '' });
const savingKey = ref(false);
const keyError = ref('');
const keySuccess = ref('');

const auth = useAuthStore();
const canEditKeys = computed(() => auth.isAdmin.value);

const selected = computed(() => state.providers.items.find((p) => p.id === state.providers.selectedId) || null);

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

async function load() {
    error.value = '';
    const res = await api.request('/api/saas/ai/state');
    state.subscription = res.subscription || null;
    state.subscriptionActive = !!res.subscriptionActive;
    state.credit = res.credit || null;
    state.providers = res.providers || { selectedId: null, items: [] };
}

async function select(id) {
    selectingId.value = id;
    try {
        await api.request('/api/saas/ai/providers/select', { method: 'POST', body: { providerId: id } });
        await load();
    } catch (e) {
        error.value = e?.message || '选择失败';
    } finally {
        selectingId.value = '';
    }
}

async function saveKey() {
    keyError.value = '';
    keySuccess.value = '';
    savingKey.value = true;
    try {
        if (!keyForm.providerId) throw new Error('请选择 Provider');
        if (!keyForm.apiKey.trim()) throw new Error('请输入 apiKey');

        await api.request('/api/saas/ai/providers/set-key', {
            method: 'POST',
            body: { providerId: keyForm.providerId, apiKey: keyForm.apiKey.trim() },
        });
        keySuccess.value = '已保存';
        keyForm.apiKey = '';
        await load();
    } catch (e) {
        keyError.value = e?.message || '保存失败';
    } finally {
        savingKey.value = false;
    }
}

onMounted(async () => {
    try {
        await load();
    } catch (e) {
        error.value = e?.message || '加载失败';
    } finally {
        loading.value = false;
    }
});
</script>
