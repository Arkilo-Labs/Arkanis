<template>
    <AdminShell title="订阅管理" subtitle="订阅列表与筛选">
        <div class="card">
            <div class="card-content">
                <div class="grid grid-3">
                    <div class="form-group">
                        <label class="form-label">搜索（组织）</label>
                        <input v-model="q" class="form-input" placeholder="名称 / slug（回车搜索）" @keydown.enter="reload" />
                    </div>
                    <div class="form-group">
                        <label class="form-label">Provider</label>
                        <select v-model="provider" class="form-input">
                            <option value="">全部</option>
                            <option value="stripe">stripe</option>
                            <option value="activation_code">activation_code</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label class="form-label">状态</label>
                        <select v-model="status" class="form-input">
                            <option value="">全部</option>
                            <option value="active">active</option>
                            <option value="canceled">canceled</option>
                            <option value="incomplete">incomplete</option>
                            <option value="incomplete_expired">incomplete_expired</option>
                            <option value="past_due">past_due</option>
                            <option value="unpaid">unpaid</option>
                        </select>
                    </div>
                </div>

                <div class="input-with-button">
                    <button class="btn btn-secondary" type="button" :disabled="loading" @click="reload">
                        {{ loading ? '加载中...' : '刷新' }}
                    </button>
                </div>

                <p v-if="error" class="form-error mt-16">{{ error }}</p>
                <div class="mt-16">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>组织</th>
                                <th>套餐</th>
                                <th>Provider</th>
                                <th>状态</th>
                                <th>到期</th>
                                <th>创建</th>
                                <th>操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="s in items" :key="s.id">
                                <td>{{ s.organization_name }} <span class="text-muted">({{ s.organization_slug }})</span></td>
                                <td>{{ s.plan_code }}</td>
                                <td>{{ s.provider }}</td>
                                <td>{{ s.status }}</td>
                                <td>{{ formatDateTime(s.current_period_end) }}</td>
                                <td>{{ formatDateTime(s.created_at) }}</td>
                                <td>
                                    <div class="input-with-button">
                                        <button
                                            class="btn btn-secondary btn-sm"
                                            type="button"
                                            :disabled="savingId === s.id || s.provider !== 'activation_code'"
                                            @click="openEdit(s)"
                                        >
                                            编辑
                                        </button>
                                        <button
                                            class="btn btn-secondary btn-sm"
                                            type="button"
                                            :disabled="savingId === s.id || s.provider !== 'stripe'"
                                            @click="syncStripe(s)"
                                        >
                                            同步
                                        </button>
                                    </div>
                                </td>
                            </tr>
                            <tr v-if="!items.length && !loading">
                                <td colspan="7" class="text-muted">没有匹配的订阅</td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div class="mt-16 input-with-button">
                    <button class="btn btn-secondary" type="button" :disabled="loading || offset === 0" @click="prev">
                        上一页
                    </button>
                    <div class="text-muted">共 {{ total }} 条</div>
                    <button class="btn btn-secondary" type="button" :disabled="loading || offset + limit >= total" @click="next">
                        下一页
                    </button>
                </div>
            </div>
        </div>

        <div v-if="editing" class="card">
            <div class="card-content">
                <div class="card-title">编辑订阅</div>
                <div class="text-muted mt-16">仅支持修改激活码订阅；Stripe 订阅建议在 Stripe 侧变更后再同步。</div>

                <div class="grid grid-3 mt-16">
                    <div class="form-group">
                        <label class="form-label">套餐</label>
                        <input v-model="editForm.planCode" class="form-input" />
                    </div>
                    <div class="form-group">
                        <label class="form-label">状态</label>
                        <input v-model="editForm.status" class="form-input" />
                    </div>
                    <div class="form-group">
                        <label class="form-label">到期时间（可选）</label>
                        <input v-model="editForm.currentPeriodEndLocal" class="form-input" type="datetime-local" />
                    </div>
                </div>

                <div class="grid grid-3 mt-16">
                    <div class="form-group">
                        <label class="form-label">延长天数（可选）</label>
                        <input v-model.number="editForm.extendDays" class="form-input" type="number" min="1" max="3650" />
                    </div>
                    <div class="form-group">
                        <label class="form-label">期末取消</label>
                        <select v-model="editForm.cancelAtPeriodEnd" class="form-input">
                            <option :value="null">不修改</option>
                            <option :value="true">true</option>
                            <option :value="false">false</option>
                        </select>
                    </div>
                </div>

                <div class="input-with-button mt-16">
                    <button class="btn btn-primary" type="button" :disabled="savingId === editing.id" @click="saveEdit">
                        {{ savingId === editing.id ? '保存中...' : '保存' }}
                    </button>
                    <button class="btn btn-secondary" type="button" :disabled="savingId === editing.id" @click="closeEdit">取消</button>
                </div>
                <p v-if="editError" class="form-error mt-16">{{ editError }}</p>
            </div>
        </div>
    </AdminShell>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import AdminShell from '../components/AdminShell.vue';
import { api } from '../lib/apiClient.js';

const q = ref('');
const provider = ref('');
const status = ref('');

const items = ref([]);
const total = ref(0);
const loading = ref(false);
const error = ref('');

const editing = ref(null);
const editForm = ref({
    planCode: '',
    status: '',
    currentPeriodEndLocal: '',
    extendDays: null,
    cancelAtPeriodEnd: null,
});
const savingId = ref('');
const editError = ref('');

const limit = 50;
const offset = ref(0);

function formatDateTime(value) {
    if (!value) return '-';
    try {
        return new Date(value).toISOString().replace('T', ' ').slice(0, 19);
    } catch {
        return String(value);
    }
}

function toLocalDateTimeInput(value) {
    if (!value) return '';
    try {
        const d = new Date(value);
        const pad = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch {
        return '';
    }
}

function localInputToIso(value) {
    const s = String(value || '').trim();
    if (!s) return '';
    const d = new Date(s);
    if (!Number.isFinite(d.getTime())) return '';
    return d.toISOString();
}

async function load() {
    error.value = '';
    loading.value = true;
    try {
        const qs = new URLSearchParams({
            limit: String(limit),
            offset: String(offset.value),
            q: q.value.trim(),
            provider: provider.value,
            status: status.value,
        });
        const res = await api.request(`/api/admin/subscriptions?${qs.toString()}`);
        items.value = res.items || [];
        total.value = Number(res.total || 0);
    } catch (e) {
        error.value = e?.message || '加载失败';
    } finally {
        loading.value = false;
    }
}

function openEdit(s) {
    editing.value = s;
    editForm.value = {
        planCode: s.plan_code || '',
        status: s.status || '',
        currentPeriodEndLocal: toLocalDateTimeInput(s.current_period_end),
        extendDays: null,
        cancelAtPeriodEnd: null,
    };
    editError.value = '';
}

function closeEdit() {
    editing.value = null;
}

async function saveEdit() {
    if (!editing.value) return;
    editError.value = '';
    savingId.value = editing.value.id;
    try {
        const body = {
            planCode: editForm.value.planCode.trim() || undefined,
            status: editForm.value.status.trim() || undefined,
            currentPeriodEnd: localInputToIso(editForm.value.currentPeriodEndLocal) || undefined,
            extendDays: editForm.value.extendDays ? Number(editForm.value.extendDays) : undefined,
            cancelAtPeriodEnd:
                editForm.value.cancelAtPeriodEnd === null ? undefined : !!editForm.value.cancelAtPeriodEnd,
        };

        if (body.currentPeriodEnd && body.extendDays) {
            return (editError.value = '到期时间与延长天数只能选一个');
        }

        await api.request(`/api/admin/subscriptions/${encodeURIComponent(editing.value.id)}`, { method: 'PATCH', body });
        editing.value = null;
        await load();
    } catch (e) {
        editError.value = e?.message || '保存失败';
    } finally {
        savingId.value = '';
    }
}

async function syncStripe(s) {
    savingId.value = s.id;
    try {
        await api.request('/api/admin/stripe/subscriptions/sync', { method: 'POST', body: { organizationId: s.organization_id } });
        await load();
    } catch (e) {
        error.value = e?.message || '同步失败';
    } finally {
        savingId.value = '';
    }
}

async function reload() {
    offset.value = 0;
    await load();
}

function prev() {
    offset.value = Math.max(0, offset.value - limit);
    load();
}

function next() {
    offset.value += limit;
    load();
}

onMounted(load);
</script>
