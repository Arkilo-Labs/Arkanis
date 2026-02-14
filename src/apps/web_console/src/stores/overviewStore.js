import { reactive } from 'vue';
import { api } from '../lib/apiClient.js';

const CACHE_TTL_MS = 30_000;

const state = reactive({
    value: null,
    fetchedAt: 0,
    pending: null,
});

function isFresh() {
    return state.value && Date.now() - state.fetchedAt < CACHE_TTL_MS;
}

async function fetchOverview() {
    const res = await api.request('/api/console/overview');
    state.value = res;
    state.fetchedAt = Date.now();
    return res;
}

export function useOverviewStore() {
    async function get({ force = false } = {}) {
        if (!force && isFresh()) return state.value;
        if (state.pending) return state.pending;

        state.pending = fetchOverview().finally(() => {
            state.pending = null;
        });
        return state.pending;
    }

    function invalidate() {
        state.value = null;
        state.fetchedAt = 0;
        state.pending = null;
    }

    return { state, get, invalidate };
}

