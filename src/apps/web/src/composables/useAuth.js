import { useSyncExternalStore } from 'react';
import { disconnectSocket } from './useSocket';

const TOKEN_KEY = 'arkanis_session_token';

function readToken() {
    try {
        return localStorage.getItem(TOKEN_KEY);
    } catch {
        return null;
    }
}

function writeToken(token) {
    try {
        if (token) localStorage.setItem(TOKEN_KEY, token);
        else localStorage.removeItem(TOKEN_KEY);
    } catch {
        // 忽略
    }
}

function createHttpError(res, payload) {
    const message =
        payload && typeof payload === 'object' && payload.error
            ? String(payload.error)
            : `请求失败: ${res.status}`;
    const err = new Error(message);
    err.status = res.status;
    err.payload = payload;
    return err;
}

function buildHeaders(initHeaders) {
    const headers = new Headers(initHeaders || {});
    if (state.token) headers.set('Authorization', `Bearer ${state.token}`);
    return headers;
}

const listeners = new Set();

let state = {
    token: readToken(),
    status: {
        allowNoAuth: false,
        initialized: false,
        authed: false,
        user: null,
        setupRequired: false,
    },
    loading: false,
    error: null,
};

function notify() {
    listeners.forEach((listener) => listener());
}

function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

function getSnapshot() {
    return state;
}

function setState(partial) {
    state = { ...state, ...partial };
    notify();
}

export function setToken(nextToken) {
    const token = nextToken ? String(nextToken) : null;
    writeToken(token);
    setState({ token });
}

export async function checkStatus() {
    setState({ loading: true, error: null });

    try {
        const headers = new Headers();
        if (state.token) headers.set('Authorization', `Bearer ${state.token}`);
        const res = await fetch('/api/auth/status', { headers });

        if (res.status === 403) {
            const nextStatus = {
                allowNoAuth: false,
                initialized: false,
                authed: false,
                user: null,
                setupRequired: true,
            };
            setState({ status: nextStatus });
            return nextStatus;
        }

        const payload = await res.json().catch(() => null);
        if (!res.ok) throw createHttpError(res, payload);

        const nextStatus = { ...payload, setupRequired: false };
        setState({ status: nextStatus });
        return nextStatus;
    } catch (caught) {
        setState({ error: caught?.message || String(caught) });
        throw caught;
    } finally {
        setState({ loading: false });
    }
}

export async function login({ username, password }) {
    const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
    });

    const payload = await res.json().catch(() => null);
    if (!res.ok) throw createHttpError(res, payload);

    setToken(payload.token);
    await checkStatus().catch(() => null);
    return payload;
}

export async function logout() {
    try {
        await authedFetch('/api/auth/logout', { method: 'POST' }).catch(() => null);
    } finally {
        setToken(null);
        disconnectSocket();
        setState({ status: { ...state.status, authed: false, user: null } });
    }
}

export async function authedFetch(input, init = {}) {
    const headers = buildHeaders(init.headers);
    const res = await fetch(input, { ...init, headers });

    if (res.status === 401 || res.status === 403) {
        const payload = await res.json().catch(() => null);
        setToken(null);
        disconnectSocket();

        if (res.status === 403 && payload && typeof payload === 'object' && payload.error === 'Setup required') {
            const nextStatus = {
                allowNoAuth: false,
                initialized: false,
                authed: false,
                user: null,
                setupRequired: true,
            };
            setState({ status: nextStatus });
        } else {
            setState({ status: { ...state.status, authed: false, user: null } });
        }
        throw createHttpError(res, payload);
    }

    return res;
}

export function useAuth() {
    const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    return {
        token: snapshot.token,
        status: snapshot.status,
        loading: snapshot.loading,
        error: snapshot.error,
        setToken,
        checkStatus,
        login,
        logout,
        authedFetch,
    };
}
