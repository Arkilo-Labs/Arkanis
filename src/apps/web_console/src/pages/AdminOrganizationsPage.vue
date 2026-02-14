<template>
    <AdminShell title="组织管理" subtitle="组织与当前订阅概览">
        <div class="card">
            <div class="card-content banner-row">
                <div class="input-with-button" style="width: 100%;">
                    <input v-model="q" class="form-input" placeholder="搜索：名称 / slug（回车搜索）" @keydown.enter="reload" />
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
                            <th>名称</th>
                            <th>Slug</th>
                            <th>成员数</th>
                            <th>当前套餐</th>
                            <th>订阅状态</th>
                            <th>到期时间</th>
                            <th>创建时间</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="o in items" :key="o.id">
                            <td>{{ o.name }}</td>
                            <td><code>{{ o.slug }}</code></td>
                            <td>{{ o.member_count }}</td>
                            <td>{{ o.subscription_plan_code || '-' }}</td>
                            <td>{{ o.subscription_status || '-' }}</td>
                            <td>{{ formatDate(o.subscription_current_period_end) }}</td>
                            <td>{{ formatDate(o.created_at) }}</td>
                        </tr>
                        <tr v-if="!items.length && !loading">
                            <td colspan="7" class="text-muted">没有匹配的组织</td>
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

const limit = 50;
const offset = ref(0);

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
    loading.value = true;
    try {
        const qs = new URLSearchParams({
            limit: String(limit),
            offset: String(offset.value),
            q: q.value.trim(),
        });
        const res = await api.request(`/api/admin/organizations?${qs.toString()}`);
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

