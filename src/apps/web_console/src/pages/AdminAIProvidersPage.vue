<template>
    <AdminShell title="服务商管理" subtitle="管理员：新增服务商与配置倍率">
        <div class="card">
            <h2 class="card-title">新增服务商</h2>
            <form class="card-content" @submit.prevent="create">
                <div class="grid grid-3">
                    <div class="form-group">
                        <label class="form-label">代码</label>
                        <input v-model="form.code" class="form-input" placeholder="openai_gpt4o" required />
                    </div>
                    <div class="form-group">
                        <label class="form-label">显示名称</label>
                        <input v-model="form.displayName" class="form-input" placeholder="OpenAI GPT-4o" required />
                    </div>
                    <div class="form-group">
                        <label class="form-label">模型名称</label>
                        <input v-model="form.modelName" class="form-input" placeholder="gpt-4o-mini" required />
                    </div>
                </div>

                <div class="grid grid-3">
                    <div class="form-group">
                        <label class="form-label">API 基础地址</label>
                        <input v-model="form.baseUrl" class="form-input" placeholder="https://api.openai.com/v1" />
                    </div>
                    <div class="form-group">
                        <label class="form-label">消耗倍率</label>
                        <input v-model.number="form.multiplier" class="form-input" type="number" min="0.01" step="0.01" />
                    </div>
                    <div class="form-group">
                        <label class="form-label">是否启用</label>
                        <select v-model="form.isActive" class="form-input">
                            <option :value="true">是</option>
                            <option :value="false">否</option>
                        </select>
                    </div>
                </div>

                <div class="form-group">
                    <label class="form-label">备注</label>
                    <input v-model="form.remark" class="form-input" placeholder="例如：Anthropic 家的最强模型" />
                </div>

                <button class="btn btn-primary" type="submit" :disabled="creating">
                    {{ creating ? '创建中...' : '创建' }}
                </button>
                <p v-if="createError" class="form-error">{{ createError }}</p>
            </form>
        </div>

        <div class="card">
            <h2 class="card-title">配置密钥</h2>
            <div class="card-content">
                <p class="text-muted">密钥按「当前组织」保存，仅用于策略分析调用。</p>
                <div class="grid grid-2">
                    <div class="form-group">
                        <label class="form-label">模型</label>
                        <select v-model="keyForm.providerId" class="form-input">
                            <option value="">请选择</option>
                            <option v-for="p in activeProviders" :key="p.id" :value="p.id">
                                {{ p.display_name }} ({{ p.model_name }}) {{ hasKeyById[p.id] ? '·已设置' : '' }}
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
        </div>

        <div class="card">
            <h2 class="card-title">服务商列表</h2>
            <div class="card-content">
                <button class="btn btn-secondary" type="button" @click="load" :disabled="loading">
                    {{ loading ? '刷新中...' : '刷新' }}
                </button>
                <p v-if="loadError" class="form-error">{{ loadError }}</p>

                <div class="mt-16">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>代码</th>
                                <th>名称</th>
                                <th>模型</th>
                                <th>备注</th>
                                <th>倍率</th>
                                <th>启用</th>
                                <th>密钥</th>
                                <th>操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="p in items" :key="p.id">
                                <td>{{ p.code }}</td>
                                <td>{{ p.display_name }}</td>
                                <td>{{ p.model_name }}</td>
                                <td>{{ p.remark || '-' }}</td>
                                <td>{{ (p.multiplier_x100 / 100).toFixed(2) }}x</td>
                                <td>{{ p.is_active ? '是' : '否' }}</td>
                                <td>
                                    <span v-if="!p.is_active" class="text-muted">-</span>
                                    <span v-else-if="hasKeyById[p.id]" class="form-success">已设置</span>
                                    <span v-else class="text-muted">未设置</span>
                                </td>
                                <td>
                                    <button class="btn btn-secondary btn-sm" type="button" @click="edit(p)">编辑</button>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>

        <div v-if="editing" ref="editCardEl" class="card">
            <h2 class="card-title">编辑服务商</h2>
            <form class="card-content" @submit.prevent="saveEdit">
                <div class="grid grid-3">
                    <div class="form-group">
                        <label class="form-label">显示名称</label>
                        <input v-model="editForm.displayName" class="form-input" required />
                    </div>
                    <div class="form-group">
                        <label class="form-label">模型名称</label>
                        <input v-model="editForm.modelName" class="form-input" required />
                    </div>
                    <div class="form-group">
                        <label class="form-label">API 基础地址</label>
                        <input v-model="editForm.baseUrl" class="form-input" />
                    </div>
                </div>
                <div class="form-group">
                    <label class="form-label">备注</label>
                    <input v-model="editForm.remark" class="form-input" />
                </div>
                <div class="grid grid-3">
                    <div class="form-group">
                        <label class="form-label">消耗倍率</label>
                        <input v-model.number="editForm.multiplier" class="form-input" type="number" min="0.01" step="0.01" />
                    </div>
                    <div class="form-group">
                        <label class="form-label">是否启用</label>
                        <select v-model="editForm.isActive" class="form-input">
                            <option :value="true">是</option>
                            <option :value="false">否</option>
                        </select>
                    </div>
                </div>
                <div class="input-with-button">
                    <button class="btn btn-primary" type="submit" :disabled="saving">{{ saving ? '保存中...' : '保存' }}</button>
                    <button class="btn btn-secondary" type="button" @click="cancel">取消</button>
                </div>
                <p v-if="editError" class="form-error">{{ editError }}</p>
            </form>
        </div>
    </AdminShell>
</template>

<script setup>
import { nextTick, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import AdminShell from '../components/AdminShell.vue';
import { api } from '../lib/apiClient.js';

const router = useRouter();

const items = ref([]);
const loading = ref(false);
const loadError = ref('');

const form = reactive({ code: '', displayName: '', modelName: '', baseUrl: '', multiplier: 1, isActive: true, remark: '' });
const creating = ref(false);
const createError = ref('');

const editing = ref(null);
const editForm = reactive({ id: '', displayName: '', modelName: '', baseUrl: '', multiplier: 1, isActive: true, remark: '' });
const saving = ref(false);
const editError = ref('');
const editCardEl = ref(null);

const hasKeyById = reactive({});
const keyForm = reactive({ providerId: '', apiKey: '' });
const savingKey = ref(false);
const keyError = ref('');
const keySuccess = ref('');

const activeProviders = ref([]);

async function load() {
    loadError.value = '';
    loading.value = true;
    try {
        const [res, saasState] = await Promise.all([
            api.request('/api/admin/ai-providers?limit=200&offset=0'),
            api.request('/api/saas/ai/state'),
        ]);
        items.value = res.items || [];
        activeProviders.value = (items.value || []).filter((p) => !!p.is_active);
        Object.keys(hasKeyById).forEach((k) => delete hasKeyById[k]);
        const stateItems = saasState?.providers?.items || [];
        for (const p of stateItems) hasKeyById[p.id] = !!p.hasKey;
    } catch (e) {
        if (e?.status === 403) return router.push('/app');
        loadError.value = e?.message || '加载失败';
    } finally {
        loading.value = false;
    }
}

async function create() {
    createError.value = '';
    creating.value = true;
    try {
        const body = {
            code: form.code.trim(),
            displayName: form.displayName.trim(),
            modelName: form.modelName.trim(),
            baseUrl: form.baseUrl.trim() || undefined,
            remark: form.remark.trim() || undefined,
            multiplier: Number(form.multiplier || 1),
            isActive: !!form.isActive,
        };
        await api.request('/api/admin/ai-providers', { method: 'POST', body });
        form.code = '';
        form.displayName = '';
        form.modelName = '';
        form.baseUrl = '';
        form.remark = '';
        form.multiplier = 1;
        form.isActive = true;
        await load();
    } catch (e) {
        if (e?.status === 403) return router.push('/app');
        createError.value = e?.message || '创建失败';
    } finally {
        creating.value = false;
    }
}

function edit(p) {
    editing.value = p;
    editForm.id = p.id;
    editForm.displayName = p.display_name;
    editForm.modelName = p.model_name;
    editForm.baseUrl = p.base_url || '';
    editForm.remark = p.remark || '';
    editForm.multiplier = Number(p.multiplier_x100 || 100) / 100;
    editForm.isActive = !!p.is_active;
    editError.value = '';
    nextTick(() => {
        editCardEl.value?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    });
}

function cancel() {
    editing.value = null;
}

async function saveEdit() {
    editError.value = '';
    saving.value = true;
    try {
        const body = {
            displayName: editForm.displayName.trim(),
            modelName: editForm.modelName.trim(),
            baseUrl: editForm.baseUrl.trim() || null,
            remark: editForm.remark.trim() || null,
            multiplier: Number(editForm.multiplier || 1),
            isActive: !!editForm.isActive,
        };
        await api.request(`/api/admin/ai-providers/${encodeURIComponent(editForm.id)}`, { method: 'PUT', body });
        editing.value = null;
        await load();
    } catch (e) {
        if (e?.status === 403) return router.push('/app');
        editError.value = e?.message || '保存失败';
    } finally {
        saving.value = false;
    }
}

async function saveKey() {
    keyError.value = '';
    keySuccess.value = '';
    savingKey.value = true;
    try {
        if (!keyForm.providerId) throw new Error('请选择模型');
        if (!keyForm.apiKey.trim()) throw new Error('请输入密钥');
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

onMounted(load);
</script>
