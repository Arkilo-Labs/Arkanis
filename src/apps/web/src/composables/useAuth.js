import { computed, ref } from 'vue';
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

function buildHeaders(initHeaders) {
  const headers = new Headers(initHeaders || {});
  const token = tokenRef.value;
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return headers;
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

const tokenRef = ref(readToken());
const statusRef = ref({
  allowNoAuth: false,
  initialized: false,
  authed: false,
  user: null,
  setupRequired: false,
});
const loadingRef = ref(false);
const errorRef = ref(null);

export function setToken(token) {
  tokenRef.value = token ? String(token) : null;
  writeToken(tokenRef.value);
}

export async function checkStatus() {
  loadingRef.value = true;
  errorRef.value = null;
  try {
    const headers = new Headers();
    if (tokenRef.value) headers.set('Authorization', `Bearer ${tokenRef.value}`);
    const res = await fetch('/api/auth/status', { headers });

    if (res.status === 403) {
      statusRef.value = {
        allowNoAuth: false,
        initialized: false,
        authed: false,
        user: null,
        setupRequired: true,
      };
      return statusRef.value;
    }

    const payload = await res.json().catch(() => null);
    if (!res.ok) throw createHttpError(res, payload);

    statusRef.value = { ...payload, setupRequired: false };
    return statusRef.value;
  } catch (error) {
    errorRef.value = error?.message || String(error);
    throw error;
  } finally {
    loadingRef.value = false;
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
    statusRef.value = { ...statusRef.value, authed: false, user: null };
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
      statusRef.value = {
        allowNoAuth: false,
        initialized: false,
        authed: false,
        user: null,
        setupRequired: true,
      };
    } else {
      statusRef.value = { ...statusRef.value, authed: false, user: null };
    }
    throw createHttpError(res, payload);
  }

  return res;
}

export function useAuth() {
  return {
    token: computed(() => tokenRef.value),
    status: computed(() => statusRef.value),
    loading: computed(() => loadingRef.value),
    error: computed(() => errorRef.value),
    setToken,
    checkStatus,
    login,
    logout,
    authedFetch,
  };
}
