<template>
    <AdminShell title="用户管理" subtitle="查询用户、封禁/解封、强制退出">
        <div class="card">
            <div class="card-content banner-row">
                <div class="input-with-button" style="width: 100%;">
                    <input v-model="q" class="form-input" placeholder="搜索：邮箱 / 昵称（回车搜索）" @keydown.enter="reload" />
                    <button class="btn btn-secondary" type="button" :disabled="loading" @click="reload">
                        {{ loading ? '加载中...' : '搜索' }}
                    </button>
                </div>
            </div>
            <div class="card-content">
                <p v-if="error" class="form-error">{{ error }}</p>
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>邮箱</th>
                            <th>昵称</th>
                            <th>状态</th>
                            <th>邮箱验证</th>
                            <th>删除/注销</th>
                            <th>注册时间</th>
                            <th>操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="u in items" :key="u.id">
                            <td><code>{{ u.id }}</code></td>
                            <td>{{ u.email }}</td>
                            <td>{{ u.display_name || '-' }}</td>
                            <td>{{ u.status }}</td>
                            <td>{{ u.email_verified_at ? '是' : '-' }}</td>
                            <td>{{ u.deleted_at ? formatDateTime(u.deleted_at) : '-' }}</td>
                            <td>{{ formatDateTime(u.created_at) }}</td>
                            <td>
                                <div class="input-with-button">
                                    <button
                                        class="btn btn-secondary btn-sm"
                                        type="button"
                                        :disabled="workingId === u.id || !!u.deleted_at"
                                        @click="toggleStatus(u)"
                                    >
                                        {{ u.status === 'disabled' ? '解封' : '封禁' }}
                                    </button>
                                    <button
                                        class="btn btn-danger btn-sm"
                                        type="button"
                                        :disabled="workingId === u.id || !!u.deleted_at"
                                        @click="revokeSessions(u)"
                                    >
                                        强制退出
                                    </button>
                                    <button
                                        class="btn btn-secondary btn-sm"
                                        type="button"
                                        :disabled="workingId === u.id || !!u.deleted_at"
                                        @click="edit(u)"
                                    >
                                        编辑
                                    </button>
                                    <button class="btn btn-secondary btn-sm" type="button" @click="copy(u.id)">
                                        复制ID
                                    </button>
                                    <button
                                        class="btn btn-danger btn-sm"
                                        type="button"
                                        :disabled="workingId === u.id || !!u.deleted_at"
                                        @click="deleteAccount(u)"
                                    >
                                        删除
                                    </button>
                                </div>
                            </td>
                        </tr>
                        <tr v-if="!items.length && !loading">
                            <td colspan="8" class="text-muted">没有匹配的用户</td>
                        </tr>
                    </tbody>
                </table>

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
                <div class="card-title">编辑用户</div>
                <div class="grid grid-3 mt-16">
                    <div class="form-group">
                        <label class="form-label">邮箱</label>
                        <input v-model="editForm.email" class="form-input" />
                    </div>
                    <div class="form-group">
                        <label class="form-label">昵称</label>
                        <input v-model="editForm.displayName" class="form-input" />
                    </div>
                    <div class="form-group">
                        <label class="form-label">状态</label>
                        <select v-model="editForm.status" class="form-input">
                            <option value="active">active</option>
                            <option value="disabled">disabled</option>
                        </select>
                    </div>
                </div>
                <div class="input-with-button mt-16">
                    <button class="btn btn-primary" type="button" :disabled="saving" @click="saveEdit">
                        {{ saving ? '保存中...' : '保存' }}
                    </button>
                    <button class="btn btn-secondary" type="button" :disabled="saving" @click="cancelEdit">取消</button>
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
const items = ref([]);
const total = ref(0);
const loading = ref(false);
const error = ref('');
const workingId = ref('');

const limit = 50;
const offset = ref(0);

const editing = ref(null);
const editForm = ref({ id: '', email: '', displayName: '', status: 'active' });
const saving = ref(false);
const editError = ref('');

function formatDateTime(value) {
    if (!value) return '-';
    try {
        return new Date(value).toISOString().replace('T', ' ').slice(0, 19);
    } catch {
        return String(value);
    }
}

async function load() {
    error.value = '';
    loading.value = true;
    try {
        const qs = new URLSearchParams({
            limit: String(limit),
            offset: String(offset.value),
            q: q.value.trim(),
        });
        const res = await api.request(`/api/admin/users?${qs.toString()}`);
        items.value = res.items || [];
        total.value = Number(res.total || 0);
    } catch (e) {
        error.value = e?.message || '加载失败';
    } finally {
        loading.value = false;
    }
}

async function reload() {
    offset.value = 0;
    await load();
}

async function toggleStatus(u) {
    const next = u.status === 'disabled' ? 'active' : 'disabled';
    const label = next === 'disabled' ? '封禁' : '解封';
    if (!window.confirm(`确认${label}用户：${u.email}？`)) return;

    workingId.value = u.id;
    try {
        await api.request(`/api/admin/users/${encodeURIComponent(u.id)}`, { method: 'PATCH', body: { status: next } });
        await load();
    } catch (e) {
        error.value = e?.message || '操作失败';
    } finally {
        workingId.value = '';
    }
}

async function revokeSessions(u) {
    if (!window.confirm(`确认强制退出：${u.email}？（会撤销该用户所有会话）`)) return;

    workingId.value = u.id;
    try {
        await api.request(`/api/admin/users/${encodeURIComponent(u.id)}/revoke-sessions`, { method: 'POST' });
    } catch (e) {
        error.value = e?.message || '操作失败';
    } finally {
        workingId.value = '';
    }
}

function edit(u) {
    editing.value = u;
    editForm.value = {
        id: u.id,
        email: u.email,
        displayName: u.display_name || '',
        status: u.status || 'active',
    };
    editError.value = '';
}

function cancelEdit() {
    editing.value = null;
}

async function saveEdit() {
    editError.value = '';
    saving.value = true;
    try {
        const body = {
            email: editForm.value.email.trim(),
            displayName: editForm.value.displayName.trim() || null,
            status: editForm.value.status,
        };
        await api.request(`/api/admin/users/${encodeURIComponent(editForm.value.id)}`, { method: 'PATCH', body });
        editing.value = null;
        await load();
    } catch (e) {
        editError.value = e?.message || '保存失败';
    } finally {
        saving.value = false;
    }
}

async function deleteAccount(u) {
    const id1 = window.prompt('危险操作：请输入该用户 ID（UUID，可从表格“ID”列复制）以确认删除：', '');
    if (id1 === null) return;
    if (id1.trim() !== u.id) return (error.value = '确认失败：ID 不匹配（这里必须输入 UUID，不是邮箱/昵称）');

    const email1 = window.prompt('第二次确认：请输入该用户邮箱以确认删除：', '');
    if (email1 === null) return;
    if (email1.trim().toLowerCase() !== String(u.email || '').toLowerCase()) return (error.value = '确认失败：邮箱不匹配');

    const text = window.prompt('最终确认：请输入 DELETE（全大写）', '');
    if (text === null) return;
    if (text.trim() !== 'DELETE') return (error.value = '确认失败：未输入 DELETE');

    const note = window.prompt('可选：删除备注（留空可不填）', '') ?? '';

    workingId.value = u.id;
    try {
        await api.request(`/api/admin/users/${encodeURIComponent(u.id)}/delete`, {
            method: 'POST',
            body: {
                confirmUserId: u.id,
                confirmEmail: u.email,
                confirmText: 'DELETE',
                note: note.trim() || undefined,
            },
        });
        editing.value = null;
        await load();
    } catch (e) {
        error.value = e?.message || '删除失败';
    } finally {
        workingId.value = '';
    }
}

async function copy(text) {
    const value = String(text || '').trim();
    if (!value) return;
    try {
        await navigator.clipboard.writeText(value);
    } catch {
        // 兼容不支持 clipboard 的环境
        const ok = window.prompt('复制失败，请手动复制：', value);
        void ok;
    }
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
