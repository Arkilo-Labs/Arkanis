<template>
    <AdminShell title="管理概览" subtitle="订阅、注册与转化的基础统计">
        <div class="grid grid-3">
            <div class="card">
                <div class="card-content">
                    <div class="text-muted">用户总数</div>
                    <div class="metric">{{ totals.users }}</div>
                </div>
            </div>
            <div class="card">
                <div class="card-content">
                    <div class="text-muted">组织总数</div>
                    <div class="metric">{{ totals.organizations }}</div>
                </div>
            </div>
            <div class="card">
                <div class="card-content">
                    <div class="text-muted">活跃订阅</div>
                    <div class="metric">{{ totals.activeSubscriptions }}</div>
                </div>
            </div>
        </div>

        <div class="card">
            <div class="card-content banner-row">
                <div>
                    <div class="card-title">时间轴</div>
                    <div class="text-muted">按天统计注册与订阅创建（含 Stripe/激活码）</div>
                </div>
                <div class="input-with-button">
                    <select v-model.number="days" class="form-input">
                        <option :value="7">近 7 天</option>
                        <option :value="30">近 30 天</option>
                        <option :value="90">近 90 天</option>
                    </select>
                    <button class="btn btn-secondary" type="button" :disabled="loading" @click="load">
                        {{ loading ? '刷新中...' : '刷新' }}
                    </button>
                </div>
            </div>
            <div class="card-content">
                <div class="grid grid-2">
                    <div>
                        <div class="text-muted">注册人数（按天）</div>
                        <div ref="usersChartEl" class="chart-box"></div>
                    </div>
                    <div>
                        <div class="text-muted">订阅创建（按天）</div>
                        <div ref="subsChartEl" class="chart-box"></div>
                    </div>
                </div>
                <p v-if="error" class="form-error mt-16">{{ error }}</p>
            </div>
        </div>

        <div class="card">
            <div class="card-content">
                <div class="card-title">套餐统计</div>
                <div class="text-muted">“活跃组织”按当前有效订阅统计</div>
                <div class="mt-16">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>套餐</th>
                                <th>活跃组织</th>
                                <th>活跃订阅</th>
                                <th>历史订阅数</th>
                                <th>历史组织数</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="row in byPlan" :key="row.planCode">
                                <td>{{ row.planCode }}</td>
                                <td>{{ row.activeOrganizations }}</td>
                                <td>{{ row.activeSubscriptions }}</td>
                                <td>{{ row.totalSubscriptions }}</td>
                                <td>{{ row.totalOrganizations }}</td>
                            </tr>
                            <tr v-if="!byPlan.length">
                                <td colspan="5" class="text-muted">暂无数据</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    </AdminShell>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { createChart } from 'lightweight-charts';
import AdminShell from '../components/AdminShell.vue';
import { api } from '../lib/apiClient.js';

const usersChartEl = ref(null);
const subsChartEl = ref(null);

const days = ref(30);
const loading = ref(false);
const error = ref('');

const totals = ref({ users: 0, organizations: 0, activeSubscriptions: 0 });
const byPlan = ref([]);

let usersChart = null;
let subsChart = null;
let usersSeries = null;
let subsSeries = null;

function toSeriesPoints(items) {
    if (!Array.isArray(items)) return [];
    return items
        .map((x) => ({ time: x.day, value: Number(x.count || 0) }))
        .filter((x) => typeof x.time === 'string' && Number.isFinite(x.value));
}

function ensureCharts() {
    if (!usersChartEl.value || !subsChartEl.value) return;

    if (!usersChart) {
        usersChart = createChart(usersChartEl.value, { height: 220, layout: { background: { color: 'transparent' } } });
        usersSeries = usersChart.addLineSeries();
    }
    if (!subsChart) {
        subsChart = createChart(subsChartEl.value, { height: 220, layout: { background: { color: 'transparent' } } });
        subsSeries = subsChart.addLineSeries();
    }
}

async function load() {
    error.value = '';
    loading.value = true;
    try {
        const res = await api.request(`/api/admin/stats/overview?days=${encodeURIComponent(days.value)}`);
        totals.value = res.totals || totals.value;
        byPlan.value = res.byPlan || [];

        ensureCharts();
        usersSeries?.setData(toSeriesPoints(res.series?.users || []));
        subsSeries?.setData(toSeriesPoints(res.series?.subscriptions || []));
        usersChart?.timeScale().fitContent();
        subsChart?.timeScale().fitContent();
    } catch (e) {
        error.value = e?.message || '加载失败';
    } finally {
        loading.value = false;
    }
}

onMounted(() => {
    ensureCharts();
    load();
});

onBeforeUnmount(() => {
    usersChart?.remove();
    subsChart?.remove();
    usersChart = null;
    subsChart = null;
    usersSeries = null;
    subsSeries = null;
});
</script>

<style scoped>
.metric {
    font-size: 28px;
    font-weight: 700;
    margin-top: 6px;
}

.chart-box {
    height: 220px;
    width: 100%;
    margin-top: 10px;
}
</style>

