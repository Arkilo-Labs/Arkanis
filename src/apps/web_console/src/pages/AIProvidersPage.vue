<template>
    <AppShell title="模型" subtitle="选择 AI 分析模型">
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
                        <span class="stat-label">可用额度</span>
                        <span class="stat-value">{{ state.credit.remainingCredits.toFixed(0) }} 积分</span>
                    </div>
                    <div v-if="state.credit" class="stat-row">
                        <span class="stat-label">重置日期</span>
                        <span class="stat-value">{{ formatDate(state.credit.periodEnd) }}</span>
                    </div>
                    <p v-if="!state.subscriptionActive" class="text-muted">
                        未激活订阅时无法运行策略分析，你仍可提前选择模型。
                    </p>
                </div>
            </div>

            <div class="card">
                <h2 class="card-title">当前模型</h2>
                <div class="card-content">
                    <p v-if="!selected" class="text-muted">尚未选择模型</p>
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
                        <div v-if="selected.remark" class="stat-row">
                            <span class="stat-label">备注</span>
                            <span class="stat-value">{{ selected.remark }}</span>
                        </div>
                        <p v-if="!selected.hasKey" class="text-muted">该模型暂不可用，请联系管理员</p>
                    </div>
                </div>
            </div>

            <div class="card" style="grid-column: 1 / -1;">
                <h2 class="card-title">可用模型</h2>
                <div class="card-content">
                    <p v-if="error" class="form-error">{{ error }}</p>

                    <p v-if="selectableProviders.length === 0" class="text-muted">暂无可选择模型，请联系管理员配置。</p>

                    <div v-else class="model-grid">
                        <div 
                            v-for="p in selectableProviders" 
                            :key="p.id" 
                            class="model-card"
                            :class="{ selected: state.providers.selectedId === p.id }"
                            @click="select(p.id)"
                        >
                            <div class="model-name-row">
                                <div class="model-name">{{ p.display_name }}</div>
                                <div class="model-status">
                                    <span v-if="state.providers.selectedId === p.id" class="status-selected">当前使用</span>
                                    <span v-else class="status-available">可选择</span>
                                </div>
                            </div>
                            <div class="model-meta" :title="p.model_name">{{ p.remark || p.model_name }}</div>
                            <div class="model-meta">倍率 {{ (p.multiplier_x100 / 100).toFixed(2) }}x</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </AppShell>
</template>


<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import AppShell from '../components/AppShell.vue';
import { api } from '../lib/apiClient.js';

const loading = ref(true);
const error = ref('');

const state = reactive({
    subscription: null,
    subscriptionActive: false,
    credit: null,
    providers: { selectedId: null, items: [] },
});

const selectingId = ref('');

const selected = computed(() => state.providers.items.find((p) => p.id === state.providers.selectedId) || null);
const selectableProviders = computed(() => (state.providers.items || []).filter((p) => !!p.hasKey));

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
    if (!id || selectingId.value) return;
    if (state.providers.selectedId === id) return;
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

<style scoped>
.model-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: var(--spacing-md);
}

.model-card {
    padding: var(--spacing-lg);
    background: rgba(40, 40, 40, 0.5);
    border: 1px solid var(--color-border-light);
    border-radius: var(--radius-xl);
    cursor: pointer;
    transition: all var(--transition-fast);
}

.model-card:hover {
    background: rgba(50, 50, 50, 0.6);
    border-color: rgba(255, 255, 255, 0.15);
    transform: translateY(-2px);
}

.model-card.selected {
    background: rgba(255, 69, 0, 0.1);
    border-color: var(--color-accent);
}

.model-name-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--spacing-sm);
    margin-bottom: var(--spacing-sm);
}

.model-name {
    font-size: var(--font-size-base);
    font-weight: 600;
    color: var(--color-text);
}

.model-status {
    font-size: var(--font-size-xs);
}

.model-meta {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
}

.status-selected {
    color: var(--color-accent);
    font-weight: 600;
}

.status-available {
    color: var(--color-success);
}

@media (max-width: 480px) {
    .model-grid {
        grid-template-columns: repeat(2, 1fr);
    }
    
    .model-card {
        padding: var(--spacing-md);
    }
}
</style>
