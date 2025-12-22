<template>
    <AppShell title="AI Provider" subtitle="选择模型、设置倍率与管理 credit">
        <div v-if="loading" class="card">
            <p class="text-muted">加载中...</p>
        </div>

        <div v-else class="grid grid-2">
            <div class="card">
                <h2 class="card-title">Credit</h2>
                <div class="card-content">
                    <div class="stat-row">
                        <span class="stat-label">订阅状态</span>
                        <span class="stat-value">{{ state.subscriptionActive ? '已激活' : '未激活' }}</span>
                    </div>
                    <div v-if="state.subscription" class="stat-row">
                        <span class="stat-label">plan</span>
                        <span class="stat-value">{{ state.subscription.plan_code }}</span>
                    </div>
                    <div v-if="state.credit" class="stat-row">
                        <span class="stat-label">额度</span>
                        <span class="stat-value"><code>{{ state.credit.allowanceCredits.toFixed(2) }}</code></span>
                    </div>
                    <div v-if="state.credit" class="stat-row">
                        <span class="stat-label">已用</span>
                        <span class="stat-value"><code>{{ state.credit.usedCredits.toFixed(2) }}</code></span>
                    </div>
                    <div v-if="state.credit" class="stat-row">
                        <span class="stat-label">剩余</span>
                        <span class="stat-value"><code>{{ state.credit.remainingCredits.toFixed(2) }}</code></span>
                    </div>
                    <div v-if="state.credit" class="stat-row">
                        <span class="stat-label">下次重置</span>
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
                    <p v-if="!selected" class="text-muted">尚未选择 Provider</p>
                    <div v-else>
                        <div class="stat-row">
                            <span class="stat-label">name</span>
                            <span class="stat-value">{{ selected.display_name }}</span>
                        </div>
                        <div class="stat-row">
                            <span class="stat-label">model</span>
                            <span class="stat-value"><code>{{ selected.model_name }}</code></span>
                        </div>
                        <div class="stat-row">
                            <span class="stat-label">倍率</span>
                            <span class="stat-value"><code>{{ (selected.multiplier_x100 / 100).toFixed(2) }}</code></span>
                        </div>
                        <p v-if="!selected.hasKey && canEditKeys" class="form-error">该 Provider 还未设置 apiKey</p>
                        <p v-else-if="!selected.hasKey" class="text-muted">该 Provider 未就绪，请联系管理员配置</p>
                    </div>
                </div>
            </div>

            <div class="card" style="grid-column: 1 / -1;">
                <h2 class="card-title">Provider 列表</h2>
                <div class="card-content">
                    <p v-if="error" class="form-error">{{ error }}</p>

                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>name</th>
                                <th>model</th>
                                <th>multiplier</th>
                                <th v-if="canEditKeys">key</th>
                                <th>select</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="p in state.providers.items" :key="p.id">
                                <td>{{ p.display_name }}</td>
                                <td><code>{{ p.model_name }}</code></td>
                                <td><code>{{ (p.multiplier_x100 / 100).toFixed(2) }}</code></td>
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
                        <h3 class="card-title" style="margin-bottom:0.75rem;">设置 apiKey</h3>
                        <div class="grid grid-2">
                            <div class="form-group">
                                <label class="form-label">Provider</label>
                                <select v-model="keyForm.providerId" class="form-input">
                                    <option value="">请选择</option>
                                    <option v-for="p in state.providers.items" :key="p.id" :value="p.id">
                                        {{ p.display_name }} ({{ p.model_name }})
                                    </option>
                                </select>
                            </div>
                            <div class="form-group">
                                <label class="form-label">apiKey</label>
                                <input v-model="keyForm.apiKey" class="form-input" placeholder="sk-..." />
                                <p v-if="keyError" class="form-error">{{ keyError }}</p>
                                <p v-if="keySuccess" class="form-success">{{ keySuccess }}</p>
                            </div>
                        </div>
                        <button class="btn btn-primary" type="button" :disabled="savingKey" @click="saveKey">
                            {{ savingKey ? '保存中...' : '保存' }}
                        </button>
                    </div>
                    <p v-else class="text-muted mt-16">apiKey 由管理员配置；你只能选择 Provider。</p>
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
