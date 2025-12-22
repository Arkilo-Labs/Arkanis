<template>
    <AppShell title="Provider 管理" subtitle="管理员：新增 Provider 与设置倍率">
        <div class="card">
            <h2 class="card-title">新增 Provider</h2>
            <form class="card-content" @submit.prevent="create">
                <div class="grid grid-3">
                    <div class="form-group">
                        <label class="form-label">code</label>
                        <input v-model="form.code" class="form-input" placeholder="openai_gpt4o" required />
                    </div>
                    <div class="form-group">
                        <label class="form-label">displayName</label>
                        <input v-model="form.displayName" class="form-input" placeholder="OpenAI GPT-4o" required />
                    </div>
                    <div class="form-group">
                        <label class="form-label">modelName</label>
                        <input v-model="form.modelName" class="form-input" placeholder="gpt-4o-mini" required />
                    </div>
                </div>

                <div class="grid grid-3">
                    <div class="form-group">
                        <label class="form-label">baseUrl（可选）</label>
                        <input v-model="form.baseUrl" class="form-input" placeholder="https://api.openai.com/v1" />
                    </div>
                    <div class="form-group">
                        <label class="form-label">倍率 multiplier</label>
                        <input v-model.number="form.multiplier" class="form-input" type="number" min="0.01" step="0.01" />
                    </div>
                    <div class="form-group">
                        <label class="form-label">isActive</label>
                        <select v-model="form.isActive" class="form-input">
                            <option :value="true">true</option>
                            <option :value="false">false</option>
                        </select>
                    </div>
                </div>

                <button class="btn btn-primary" type="submit" :disabled="creating">
                    {{ creating ? '创建中...' : '创建' }}
                </button>
                <p v-if="createError" class="form-error">{{ createError }}</p>
            </form>
        </div>

        <div class="card">
            <h2 class="card-title">列表</h2>
            <div class="card-content">
                <button class="btn btn-secondary" type="button" @click="load" :disabled="loading">
                    {{ loading ? '刷新中...' : '刷新' }}
                </button>
                <p v-if="loadError" class="form-error">{{ loadError }}</p>

                <div class="mt-16">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>code</th>
                                <th>name</th>
                                <th>model</th>
                                <th>multiplier</th>
                                <th>active</th>
                                <th>op</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="p in items" :key="p.id">
                                <td><code>{{ p.code }}</code></td>
                                <td>{{ p.display_name }}</td>
                                <td><code>{{ p.model_name }}</code></td>
                                <td><code>{{ (p.multiplier_x100 / 100).toFixed(2) }}</code></td>
                                <td>{{ p.is_active ? '是' : '否' }}</td>
                                <td>
                                    <button class="btn btn-secondary btn-sm" type="button" @click="edit(p)">编辑</button>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>

        <div v-if="editing" class="card">
            <h2 class="card-title">编辑 Provider</h2>
            <form class="card-content" @submit.prevent="saveEdit">
                <div class="grid grid-3">
                    <div class="form-group">
                        <label class="form-label">displayName</label>
                        <input v-model="editForm.displayName" class="form-input" required />
                    </div>
                    <div class="form-group">
                        <label class="form-label">modelName</label>
                        <input v-model="editForm.modelName" class="form-input" required />
                    </div>
                    <div class="form-group">
                        <label class="form-label">baseUrl</label>
                        <input v-model="editForm.baseUrl" class="form-input" />
                    </div>
                </div>
                <div class="grid grid-3">
                    <div class="form-group">
                        <label class="form-label">multiplier</label>
                        <input v-model.number="editForm.multiplier" class="form-input" type="number" min="0.01" step="0.01" />
                    </div>
                    <div class="form-group">
                        <label class="form-label">isActive</label>
                        <select v-model="editForm.isActive" class="form-input">
                            <option :value="true">true</option>
                            <option :value="false">false</option>
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
    </AppShell>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import AppShell from '../components/AppShell.vue';
import { api } from '../lib/apiClient.js';

const router = useRouter();

const items = ref([]);
const loading = ref(false);
const loadError = ref('');

const form = reactive({ code: '', displayName: '', modelName: '', baseUrl: '', multiplier: 1, isActive: true });
const creating = ref(false);
const createError = ref('');

const editing = ref(null);
const editForm = reactive({ id: '', displayName: '', modelName: '', baseUrl: '', multiplier: 1, isActive: true });
const saving = ref(false);
const editError = ref('');

async function load() {
    loadError.value = '';
    loading.value = true;
    try {
        const res = await api.request('/api/admin/ai-providers?limit=200&offset=0');
        items.value = res.items || [];
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
            multiplier: Number(form.multiplier || 1),
            isActive: !!form.isActive,
        };
        await api.request('/api/admin/ai-providers', { method: 'POST', body });
        form.code = '';
        form.displayName = '';
        form.modelName = '';
        form.baseUrl = '';
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
    editForm.multiplier = Number(p.multiplier_x100 || 100) / 100;
    editForm.isActive = !!p.is_active;
    editError.value = '';
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

onMounted(load);
</script>

