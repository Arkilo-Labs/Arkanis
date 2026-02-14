const DEFAULT_HEADERS = { 'Content-Type': 'application/json' };

export class ApiClient {
    #token = null;

    setToken(token) {
        this.#token = token ? String(token) : null;
    }

    async request(path, { method = 'GET', body = undefined, headers = {} } = {}) {
        const finalHeaders = { ...DEFAULT_HEADERS, ...headers };
        if (this.#token) finalHeaders.Authorization = `Bearer ${this.#token}`;

        const res = await fetch(path, {
            method,
            headers: finalHeaders,
            body: body === undefined ? undefined : JSON.stringify(body),
        });

        const payload = await res.json().catch(() => null);
        if (res.ok) return payload;

        const message =
            payload && typeof payload === 'object' && payload.error ? String(payload.error) : `请求失败: ${res.status}`;
        const err = new Error(message);
        err.status = res.status;
        err.payload = payload;
        throw err;
    }
}

export const api = new ApiClient();

