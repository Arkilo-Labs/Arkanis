<template>
    <AdminShell title="激活码" subtitle="创建、查看与撤销激活码（仅管理员）">
        <div class="card">
            <h2 class="card-title">创建激活码</h2>
            <form class="card-content" @submit.prevent="onCreate">
                <div class="grid grid-3">
                    <div class="form-group">
                        <label class="form-label">套餐代码</label>
                        <input v-model="form.planCode" class="form-input" placeholder="monthly / yearly" required />
                    </div>
                    <div class="form-group">
                        <label class="form-label">有效天数</label>
                        <input v-model.number="form.durationDays" class="form-input" type="number" min="1" required />
                    </div>
                    <div class="form-group">
                        <label class="form-label">生成数量</label>
                        <input v-model.number="form.count" class="form-input" type="number" min="1" max="100" />
                    </div>
                </div>

                <div class="grid grid-3">
                    <div class="form-group">
                        <label class="form-label">最大兑换次数</label>
                        <input v-model.number="form.maxRedemptions" class="form-input" type="number" min="1" max="1000" />
                    </div>
                    <div class="form-group">
                        <label class="form-label">过期时间</label>
                        <input v-model="form.expiresAt" class="form-input" placeholder="2026-01-01T00:00:00.000Z" />
                    </div>
                    <div class="form-group">
                        <label class="form-label">备注</label>
                        <input v-model="form.note" class="form-input" maxlength="2000" />
                    </div>
                </div>

                <button class="btn btn-primary" type="submit" :disabled="creating">
                    {{ creating ? '创建中...' : '创建' }}
                </button>
                <p v-if="createError" class="form-error">{{ createError }}</p>
                <p v-if="createdCodes.length" class="form-success">已创建 {{ createdCodes.length }} 个激活码（明文仅展示一次）</p>

                <div v-if="createdCodes.length" class="mt-16">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>激活码</th>
                                <th>套餐</th>
                                <th>天数</th>
                                <th>最大次数</th>
                                <th>过期时间</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="c in createdCodes" :key="c.id">
                                <td><code>{{ c.plaintext }}</code></td>
                                <td>{{ c.plan_code }}</td>
                                <td>{{ c.duration_days }}</td>
                                <td>{{ c.max_redemptions }}</td>
                                <td>{{ formatDate(c.expires_at) }}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </form>
        </div>

        <div class="card">
            <h2 class="card-title">激活码列表</h2>
            <div class="card-content">
                <button class="btn btn-secondary" type="button" @click="load" :disabled="loading">
                    {{ loading ? '刷新中...' : '刷新' }}
                </button>
                <p v-if="loadError" class="form-error">{{ loadError }}</p>

                <div class="mt-16">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>套餐</th>
                                <th>天数</th>
                                <th>已兑换</th>
                                <th>最大次数</th>
                                <th>过期时间</th>
                                <th>已撤销</th>
                                <th>创建时间</th>
                                <th>操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="item in items" :key="item.id">
                                <td><code>{{ item.id }}</code></td>
                                <td>{{ item.plan_code }}</td>
                                <td>{{ item.duration_days }}</td>
                                <td>{{ item.redeemed_count }}</td>
                                <td>{{ item.max_redemptions }}</td>
                                <td>{{ formatDate(item.expires_at) }}</td>
                                <td>{{ item.revoked_at ? '是' : '-' }}</td>
                                <td>{{ formatDate(item.created_at) }}</td>
                                <td>
                                    <button
                                        class="btn btn-danger btn-sm"
                                        type="button"
                                        :disabled="!!item.revoked_at || revokingId === item.id"
                                        @click="onRevoke(item.id)"
                                    >
                                        {{ revokingId === item.id ? '撤销中...' : '撤销' }}
                                    </button>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    </AdminShell>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../lib/apiClient.js';
import AdminShell from '../components/AdminShell.vue';

const router = useRouter();

const form = reactive({
    planCode: 'monthly',
    durationDays: 30,
    count: 1,
    maxRedemptions: 1,
    expiresAt: '',
    note: '',
});

const items = ref([]);
const createdCodes = ref([]);
const creating = ref(false);
const createError = ref('');
const loading = ref(false);
const loadError = ref('');
const revokingId = ref('');

function formatDate(value) {
    if (!value) return '-';
    try {
        return new Date(value).toISOString().slice(0, 10);
    } catch {
        return String(value);
    }
}

async function load() {
    loadError.value = '';
    loading.value = true;
    try {
        const res = await api.request('/api/admin/activation-codes?limit=50&offset=0');
        items.value = res.items || [];
    } catch (e) {
        if (e?.status === 403) return router.push('/app');
        loadError.value = e?.message || '加载失败';
    } finally {
        loading.value = false;
    }
}

async function onCreate() {
    createError.value = '';
    createdCodes.value = [];
    creating.value = true;

    try {
        const body = {
            planCode: form.planCode.trim(),
            durationDays: Number(form.durationDays),
            count: Number(form.count || 1),
            maxRedemptions: Number(form.maxRedemptions || 1),
            note: form.note.trim() || undefined,
        };
        if (form.expiresAt.trim()) body.expiresAt = form.expiresAt.trim();

        const res = await api.request('/api/admin/activation-codes', { method: 'POST', body });
        createdCodes.value = res.codes || [];
        await load();
    } catch (e) {
        if (e?.status === 403) return router.push('/app');
        createError.value = e?.message || '创建失败';
    } finally {
        creating.value = false;
    }
}

async function onRevoke(id) {
    revokingId.value = id;
    try {
        await api.request(`/api/admin/activation-codes/${encodeURIComponent(id)}/revoke`, { method: 'POST' });
        await load();
    } catch (e) {
        loadError.value = e?.message || '撤销失败';
    } finally {
        revokingId.value = '';
    }
}

onMounted(load);
</script>
