import { computed, reactive } from 'vue';
import { api } from '../lib/apiClient.js';

const TOKEN_KEY = 'arkilo_session_token';

const state = reactive({
    token: sessionStorage.getItem(TOKEN_KEY) || null,
    user: null,
    isAdmin: false,
    initialized: false,
});

api.setToken(state.token);

function setToken(token) {
    state.token = token;
    api.setToken(token);
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
}

async function init() {
    if (state.initialized) return;
    if (!state.token) {
        state.initialized = true;
        return;
    }

    try {
        const res = await api.request('/api/auth/me');
        state.user = res.user || null;
        try {
            await api.request('/api/admin/activation-codes?limit=1&offset=0');
            state.isAdmin = true;
        } catch {
            state.isAdmin = false;
        }
    } catch {
        setToken(null);
    } finally {
        state.initialized = true;
    }
}

async function refreshUser() {
    if (!state.token) {
        state.user = null;
        state.isAdmin = false;
        return null;
    }
    const res = await api.request('/api/auth/me');
    state.user = res.user || null;
    return state.user;
}

async function login({ email, password }) {
    const res = await api.request('/api/auth/login', { method: 'POST', body: { email, password } });
    setToken(res.token);
    state.user = res.user;
    try {
        await api.request('/api/admin/activation-codes?limit=1&offset=0');
        state.isAdmin = true;
    } catch {
        state.isAdmin = false;
    }
    return res.user;
}

async function register({ email, password, displayName }) {
    const res = await api.request('/api/auth/register', {
        method: 'POST',
        body: { email, password, displayName: displayName || undefined },
    });
    setToken(res.token);
    state.user = res.user;
    try {
        await api.request('/api/admin/activation-codes?limit=1&offset=0');
        state.isAdmin = true;
    } catch {
        state.isAdmin = false;
    }
    return res.user;
}

async function logout() {
    try {
        await api.request('/api/auth/logout', { method: 'POST' });
    } finally {
        state.user = null;
        state.isAdmin = false;
        setToken(null);
    }
}

export function useAuthStore() {
    return {
        token: computed(() => state.token),
        user: computed(() => state.user),
        isAdmin: computed(() => state.isAdmin),
        initialized: computed(() => state.initialized),
        init,
        refreshUser,
        login,
        register,
        logout,
        setToken,
    };
}
