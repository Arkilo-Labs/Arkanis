import { useCallback, useEffect, useMemo, useState } from 'react';
import ProviderCard from '../components/ProviderCard.jsx';
import { authedFetch } from '../composables/useAuth.js';
import { useSocket } from '../composables/useSocket.js';

const thinkingModeOptions = [
    { value: 'enabled', label: 'Enabled' },
    { value: 'disabled', label: 'Disabled' },
    { value: 'none', label: 'None' },
];

const providerIdRe = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
const envNameRe = /^[A-Z][A-Z0-9_]+$/;

function validateForm(data) {
    if (!data?.name || !data?.baseUrl || !data?.modelName) return false;
    if (data.id && !providerIdRe.test(String(data.id).trim())) return false;
    if (data.apiKeyEnv && !envNameRe.test(String(data.apiKeyEnv).trim())) return false;
    return true;
}

function defaultProvider() {
    return {
        id: '',
        name: '',
        type: 'openai_compatible',
        baseUrl: '',
        modelName: '',
        apiKeyEnv: '',
        supportsVision: false,
        thinkingMode: 'disabled',
        maxTokens: 8192,
        temperature: 0.2,
        description: '',
    };
}

export default function AIProvidersTab() {
    const { socket } = useSocket();

    const [providers, setProviders] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [showAddModal, setShowAddModal] = useState(false);
    const [toast, setToast] = useState({ show: false, message: '', type: 'info' });
    const [newProvider, setNewProvider] = useState(defaultProvider());

    const [providerConfig, setProviderConfig] = useState(null);
    const [rolesDraft, setRolesDraft] = useState({ lens: null, newser: null, researcher: null, auditor: null });
    const [savingRoles, setSavingRoles] = useState(false);

    const [keyForm, setKeyForm] = useState({ providerId: '', apiKey: '' });
    const [savingKey, setSavingKey] = useState(false);
    const [keyMessage, setKeyMessage] = useState({ type: 'info', text: '' });

    const showToast = useCallback((message, type = 'info') => {
        setToast({ show: true, message, type });
        window.setTimeout(() => {
            setToast((prev) => ({ ...prev, show: false }));
        }, 3000);
    }, []);

    const loadProviders = useCallback(async () => {
        setIsLoading(true);
        try {
            const res = await authedFetch('/api/ai-providers');
            if (res.ok) {
                setProviders(await res.json());
                return;
            }
            showToast('加载 Provider 失败', 'error');
        } catch (error) {
            console.error('加载 Provider 失败:', error);
            showToast('加载 Provider 失败', 'error');
        } finally {
            setIsLoading(false);
        }
    }, [showToast]);

    const loadProviderConfig = useCallback(async () => {
        try {
            const res = await authedFetch('/api/provider-config');
            if (!res.ok) {
                showToast('加载 Provider Config 失败', 'error');
                return;
            }
            const cfg = await res.json();
            setProviderConfig(cfg);
            setRolesDraft(cfg?.roles || { lens: null, newser: null, researcher: null, auditor: null });
        } catch (error) {
            console.error('加载 Provider Config 失败:', error);
            showToast('加载 Provider Config 失败', 'error');
        }
    }, [showToast]);

    const loadAll = useCallback(async () => {
        await Promise.all([loadProviders(), loadProviderConfig()]);
    }, [loadProviderConfig, loadProviders]);

    const createProvider = useCallback(async () => {
        if (!validateForm(newProvider)) {
            showToast('请检查必填字段 / Provider ID / apiKeyEnv 格式', 'error');
            return;
        }

        try {
            const payload = {
                ...newProvider,
                id: String(newProvider.id || '').trim() || undefined,
                apiKeyEnv: String(newProvider.apiKeyEnv || '').trim() || '',
                baseUrl: String(newProvider.baseUrl || '').trim(),
                modelName: String(newProvider.modelName || '').trim(),
                name: String(newProvider.name || '').trim(),
            };
            const res = await authedFetch('/api/ai-providers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (res.ok) {
                await loadAll();
                setShowAddModal(false);
                setNewProvider(defaultProvider());
                showToast('Provider 创建成功', 'success');
                return;
            }

            const data = await res.json().catch(() => null);
            showToast(data?.error || '创建失败', 'error');
        } catch (error) {
            console.error('创建 Provider 失败:', error);
            showToast('创建 Provider 失败', 'error');
        }
    }, [loadAll, newProvider, showToast]);

    const updateProvider = useCallback(
        async (providerData) => {
            try {
                const payload = {
                    ...providerData,
                    apiKeyEnv: String(providerData.apiKeyEnv || '').trim() || '',
                    baseUrl: String(providerData.baseUrl || '').trim(),
                    modelName: String(providerData.modelName || '').trim(),
                    name: String(providerData.name || '').trim(),
                };
                const res = await authedFetch(`/api/ai-providers/${providerData.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });

                if (res.ok) {
                    await loadAll();
                    showToast('Provider 更新成功', 'success');
                    return;
                }

                const data = await res.json().catch(() => null);
                showToast(data?.error || '更新失败', 'error');
            } catch (error) {
                console.error('更新 Provider 失败:', error);
                showToast('更新 Provider 失败', 'error');
            }
        },
        [loadAll, showToast],
    );

    const deleteProvider = useCallback(
        async (id) => {
            try {
                const res = await authedFetch(`/api/ai-providers/${id}`, {
                    method: 'DELETE',
                });

                if (res.ok) {
                    await loadAll();
                    showToast('Provider 删除成功', 'success');
                    return;
                }

                const data = await res.json().catch(() => null);
                showToast(data?.error || '删除失败', 'error');
            } catch (error) {
                console.error('删除 Provider 失败:', error);
                showToast('删除 Provider 失败', 'error');
            }
        },
        [loadAll, showToast],
    );

    const saveProviderRoles = useCallback(async () => {
        setSavingRoles(true);
        try {
            const res = await authedFetch('/api/provider-config', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ roles: rolesDraft }),
            });
            if (res.ok) {
                const cfg = await res.json();
                setProviderConfig(cfg);
                setRolesDraft(cfg?.roles || rolesDraft);
                showToast('Provider Config 已保存', 'success');
                await loadProviders();
                return;
            }
            const data = await res.json().catch(() => null);
            showToast(data?.error || '保存失败', 'error');
        } catch (error) {
            console.error('保存 Provider Config 失败:', error);
            showToast('保存 Provider Config 失败', 'error');
        } finally {
            setSavingRoles(false);
        }
    }, [loadProviders, rolesDraft, showToast]);

    const openAddModal = useCallback(() => {
        setNewProvider(defaultProvider());
        setShowAddModal(true);
    }, []);

    useEffect(() => {
        loadAll();

        const handler = () => loadAll();
        socket.on('providers-updated', handler);
        return () => socket.off('providers-updated', handler);
    }, [loadAll, socket]);

    const providerList = useMemo(() => providers || [], [providers]);

    const rolesByProviderId = useMemo(() => {
        const roles = providerConfig?.roles || rolesDraft || {};
        const map = {};
        const label = { lens: 'Lens', newser: 'Newser', researcher: 'Researcher', auditor: 'Auditor' };
        for (const [role, providerId] of Object.entries(roles)) {
            if (!providerId) continue;
            if (!map[providerId]) map[providerId] = [];
            map[providerId].push(label[role] || role);
        }
        return map;
    }, [providerConfig?.roles, rolesDraft]);

    const selectedProvider = useMemo(() => {
        const id = String(keyForm.providerId || '').trim();
        if (!id) return null;
        return providerList.find((p) => p.id === id) || null;
    }, [keyForm.providerId, providerList]);

    const saveKey = useCallback(async () => {
        setKeyMessage({ type: 'info', text: '' });
        setSavingKey(true);
        try {
            const providerId = String(keyForm.providerId || '').trim();
            const apiKey = String(keyForm.apiKey || '').trim();
            if (!providerId) {
                setKeyMessage({ type: 'error', text: '请选择 Provider' });
                return;
            }
            if (!apiKey) {
                setKeyMessage({ type: 'error', text: '请输入 apiKey' });
                return;
            }

            const res = await authedFetch(`/api/ai-providers/${providerId}/key`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ apiKey }),
            });
            if (res.ok) {
                setKeyForm((prev) => ({ ...prev, apiKey: '' }));
                setKeyMessage({ type: 'success', text: '已保存' });
                await loadProviders();
                return;
            }
            const data = await res.json().catch(() => null);
            setKeyMessage({ type: 'error', text: data?.error || '保存失败' });
        } catch (error) {
            console.error('保存密钥失败:', error);
            setKeyMessage({ type: 'error', text: error?.message || '保存失败' });
        } finally {
            setSavingKey(false);
        }
    }, [keyForm.apiKey, keyForm.providerId, loadProviders]);

    const deleteKey = useCallback(async () => {
        setKeyMessage({ type: 'info', text: '' });
        setSavingKey(true);
        try {
            const providerId = String(keyForm.providerId || '').trim();
            if (!providerId) {
                setKeyMessage({ type: 'error', text: '请选择 Provider' });
                return;
            }

            const res = await authedFetch(`/api/ai-providers/${providerId}/key`, { method: 'DELETE' });
            if (res.ok) {
                setKeyForm((prev) => ({ ...prev, apiKey: '' }));
                setKeyMessage({ type: 'success', text: '已清除' });
                await loadProviders();
                return;
            }
            const data = await res.json().catch(() => null);
            setKeyMessage({ type: 'error', text: data?.error || '清除失败' });
        } catch (error) {
            console.error('清除密钥失败:', error);
            setKeyMessage({ type: 'error', text: error?.message || '清除失败' });
        } finally {
            setSavingKey(false);
        }
    }, [keyForm.providerId, loadProviders]);

    return (
        <div className="space-y-6">
            <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
                <div>
                    <div className="text-xs tracking-wide text-text-muted">
                        AI Models Management
                    </div>
                    <h1 className="text-2xl md:text-3xl font-bold mt-2">模型</h1>
                    <p className="text-sm text-text-muted mt-2">
                        管理 Provider 定义、密钥与角色映射（密钥永不回显）
                    </p>
                </div>

                <button type="button" onClick={openAddModal} className="btn btn-primary">
                    <i className="fas fa-plus"></i>
                    添加 Provider
                </button>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                <div className="card p-8 space-y-5">
                    <div>
                        <div className="text-xs tracking-wide text-text-muted">Provider Config</div>
                        <h2 className="text-xl font-bold mt-2">角色映射</h2>
                        <p className="text-sm text-text-muted mt-2">
                            为不同角色选择 Provider（仅保存映射，不包含密钥）
                        </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {[
                            { key: 'lens', label: 'Lens' },
                            { key: 'newser', label: 'Newser' },
                            { key: 'researcher', label: 'Researcher' },
                            { key: 'auditor', label: 'Auditor' },
                        ].map((item) => (
                            <div key={item.key}>
                                <label className="form-label">{item.label}</label>
                                <select
                                    value={rolesDraft?.[item.key] || ''}
                                    onChange={(e) =>
                                        setRolesDraft((prev) => ({
                                            ...prev,
                                            [item.key]: e.target.value || null,
                                        }))
                                    }
                                    className="form-input font-mono"
                                >
                                    <option value="">(未设置)</option>
                                    {providerList.map((p) => (
                                        <option key={p.id} value={p.id}>
                                            {p.name} ({p.id})
                                        </option>
                                    ))}
                                </select>
                            </div>
                        ))}
                    </div>

                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            onClick={saveProviderRoles}
                            className="btn btn-primary flex-1"
                            disabled={savingRoles}
                        >
                            <i className={savingRoles ? 'fas fa-spinner fa-spin' : 'fas fa-save'}></i>
                            保存
                        </button>
                    </div>
                </div>

                <div className="card p-8 space-y-5">
                    <div>
                        <div className="text-xs tracking-wide text-text-muted">Secrets</div>
                        <h2 className="text-xl font-bold mt-2">配置密钥</h2>
                        <p className="text-sm text-text-muted mt-2">
                            默认写入 data volume（可选 SECRETS_ENC_KEY 加密落盘）；若 Provider 已由 ENV 配置将拒绝覆盖
                        </p>
                    </div>

                    <div className="space-y-4">
                        <div>
                            <label className="form-label">Provider</label>
                            <select
                                value={keyForm.providerId}
                                onChange={(e) =>
                                    setKeyForm((prev) => ({ ...prev, providerId: e.target.value }))
                                }
                                className="form-input font-mono"
                            >
                                <option value="">请选择</option>
                                {providerList.map((p) => (
                                    <option key={p.id} value={p.id}>
                                        {p.name} ({p.id}) {p.locked ? '·ENV锁定' : ''}{' '}
                                        {p.hasKey ? `·${p.keySource}` : ''}
                                    </option>
                                ))}
                            </select>
                            {selectedProvider ? (
                                <p className="text-xs text-text-muted mt-2">
                                    当前状态：{selectedProvider.hasKey ? (selectedProvider.keySource === 'env' ? '已配置(ENV)' : '已配置(secrets)') : '未配置'}
                                    {selectedProvider.locked ? '（已锁定）' : ''}
                                </p>
                            ) : null}
                        </div>

                        <div>
                            <label className="form-label">apiKey</label>
                            <input
                                value={keyForm.apiKey}
                                onChange={(e) =>
                                    setKeyForm((prev) => ({ ...prev, apiKey: e.target.value }))
                                }
                                type="password"
                                className="form-input font-mono"
                                placeholder="sk-..."
                            />
                        </div>

                        {keyMessage.text ? (
                            <div className={keyMessage.type === 'success' ? 'text-success text-sm' : keyMessage.type === 'error' ? 'text-error text-sm' : 'text-text-muted text-sm'}>
                                {keyMessage.text}
                            </div>
                        ) : null}

                        <div className="flex gap-3 pt-2">
                            <button
                                type="button"
                                onClick={saveKey}
                                className="btn btn-primary flex-1"
                                disabled={savingKey}
                            >
                                <i className={savingKey ? 'fas fa-spinner fa-spin' : 'fas fa-save'}></i>
                                保存密钥
                            </button>
                            <button
                                type="button"
                                onClick={deleteKey}
                                className="btn btn-secondary flex-1"
                                disabled={savingKey}
                            >
                                <i className={savingKey ? 'fas fa-spinner fa-spin' : 'fas fa-eraser'}></i>
                                清除
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {isLoading ? (
                <div className="card p-8 flex items-center justify-center">
                    <div className="flex items-center gap-3 text-text-muted">
                        <i className="fas fa-spinner fa-spin"></i>
                        <span className="text-sm">Loading providers...</span>
                    </div>
                </div>
            ) : providerList.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                    {providerList.map((provider) => (
                        <ProviderCard
                            key={provider.id}
                            provider={provider}
                            usedRoles={rolesByProviderId[provider.id] || []}
                            onUpdate={updateProvider}
                            onDelete={deleteProvider}
                        />
                    ))}
                </div>
            ) : (
                <div className="card card-hover p-10 text-center">
                    <div className="w-16 h-16 rounded-2xl bg-white/5 border border-border-light/10 flex items-center justify-center mx-auto">
                        <i className="fas fa-brain text-white/40 text-3xl"></i>
                    </div>
                    <h3 className="text-lg font-semibold mt-5">暂无 Provider</h3>
                    <p className="text-sm text-text-muted mt-2">
                        点击上方按钮添加您的第一个 AI Provider
                    </p>
                    <div className="mt-6">
                        <button type="button" onClick={openAddModal} className="btn btn-primary">
                            <i className="fas fa-plus"></i>
                            添加 Provider
                        </button>
                    </div>
                </div>
            )}

            {showAddModal ? (
                <div
                    className="modal-overlay"
                    onClick={(e) => {
                        if (e.target === e.currentTarget) setShowAddModal(false);
                    }}
                >
                    <div className="modal-card max-w-3xl p-8" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between mb-6">
                            <h2 className="text-xl font-bold">添加 Provider</h2>
                            <button
                                type="button"
                                onClick={() => setShowAddModal(false)}
                                className="p-2 rounded-lg hover:bg-white/10 text-white/70 transition-colors"
                                aria-label="关闭"
                            >
                                <i className="fas fa-times"></i>
                            </button>
                        </div>

                        <div className="space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="md:col-span-2">
                                    <label className="form-label">Provider ID（可选）</label>
                                    <input
                                        value={newProvider.id}
                                        onChange={(e) =>
                                            setNewProvider((prev) => ({
                                                ...prev,
                                                id: e.target.value,
                                            }))
                                        }
                                        type="text"
                                        className="form-input font-mono"
                                        placeholder="openai_gpt41mini / duojie_opus4.5 ..."
                                    />
                                    <p className="text-xs text-text-muted mt-2">
                                        仅允许字母/数字/._-，且必须以字母或数字开头
                                    </p>
                                </div>

                                <div>
                                    <label className="form-label">Provider 名称</label>
                                    <input
                                        value={newProvider.name}
                                        onChange={(e) =>
                                            setNewProvider((prev) => ({
                                                ...prev,
                                                name: e.target.value,
                                            }))
                                        }
                                        type="text"
                                        className="form-input"
                                        placeholder="OpenAI / DeepSeek / 自建网关..."
                                        required
                                    />
                                </div>

                                <div>
                                    <label className="form-label">Model Name</label>
                                    <input
                                        value={newProvider.modelName}
                                        onChange={(e) =>
                                            setNewProvider((prev) => ({
                                                ...prev,
                                                modelName: e.target.value,
                                            }))
                                        }
                                        type="text"
                                        className="form-input"
                                        placeholder="gpt-4.1 / deepseek-chat ..."
                                        required
                                    />
                                </div>

                                <div className="md:col-span-2">
                                    <label className="form-label">API Base URL</label>
                                    <input
                                        value={newProvider.baseUrl}
                                        onChange={(e) =>
                                            setNewProvider((prev) => ({
                                                ...prev,
                                                baseUrl: e.target.value,
                                            }))
                                        }
                                        type="text"
                                        className="form-input font-mono"
                                        placeholder="https://api.openai.com"
                                        required
                                    />
                                    <p className="text-xs text-text-muted mt-2">
                                        不要带 /v1，系统会自动拼接
                                    </p>
                                </div>

                                <div className="md:col-span-2">
                                    <label className="form-label">API Key ENV（可选）</label>
                                    <input
                                        value={newProvider.apiKeyEnv}
                                        onChange={(e) =>
                                            setNewProvider((prev) => ({
                                                ...prev,
                                                apiKeyEnv: e.target.value,
                                            }))
                                        }
                                        type="text"
                                        className="form-input font-mono"
                                        placeholder="OPENAI_API_KEY"
                                    />
                                    <p className="text-xs text-text-muted mt-2">
                                        若设置且 ENV 中有值，将优先使用 ENV 并锁定 UI 覆盖
                                    </p>
                                </div>

                                <div>
                                    <label className="form-label">Thinking Mode</label>
                                    <select
                                        value={newProvider.thinkingMode}
                                        onChange={(e) =>
                                            setNewProvider((prev) => ({
                                                ...prev,
                                                thinkingMode: e.target.value,
                                            }))
                                        }
                                        className="form-input font-mono"
                                    >
                                        {thinkingModeOptions.map((opt) => (
                                            <option key={opt.value} value={opt.value}>
                                                {opt.label}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="form-label">Max Tokens</label>
                                    <input
                                        value={newProvider.maxTokens ?? ''}
                                        onChange={(e) =>
                                            setNewProvider((prev) => ({
                                                ...prev,
                                                maxTokens: e.target.value === '' ? undefined : Number(e.target.value),
                                            }))
                                        }
                                        type="number"
                                        className="form-input font-mono"
                                    />
                                </div>

                                <div className="flex items-center gap-3">
                                    <input
                                        id="supportsVision_add"
                                        checked={Boolean(newProvider.supportsVision)}
                                        onChange={(e) =>
                                            setNewProvider((prev) => ({
                                                ...prev,
                                                supportsVision: e.target.checked,
                                            }))
                                        }
                                        type="checkbox"
                                        className="rounded border-border-light/20 bg-white/5"
                                    />
                                    <label className="form-label mb-0" htmlFor="supportsVision_add">
                                        Supports Vision
                                    </label>
                                </div>

                                <div>
                                    <label className="form-label">Temperature</label>
                                    <input
                                        value={newProvider.temperature ?? ''}
                                        onChange={(e) =>
                                            setNewProvider((prev) => ({
                                                ...prev,
                                                temperature: e.target.value === '' ? undefined : Number(e.target.value),
                                            }))
                                        }
                                        type="number"
                                        step="0.1"
                                        className="form-input font-mono"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="form-label">描述</label>
                                <textarea
                                    value={newProvider.description}
                                    onChange={(e) =>
                                        setNewProvider((prev) => ({
                                            ...prev,
                                            description: e.target.value,
                                        }))
                                    }
                                    className="form-input min-h-[96px]"
                                    rows={3}
                                    placeholder="Provider 描述..."
                                ></textarea>
                            </div>

                            <div className="flex gap-3 pt-2">
                                <button
                                    type="button"
                                    onClick={createProvider}
                                    className="btn btn-primary flex-1"
                                >
                                    <i className="fas fa-save"></i>
                                    创建
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setShowAddModal(false)}
                                    className="btn btn-secondary flex-1"
                                >
                                    <i className="fas fa-times"></i>
                                    取消
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            ) : null}

            {toast.show ? (
                <div className="toast">
                    <i
                        className={[
                            'fas',
                            toast.type === 'success'
                                ? 'fa-check-circle text-success'
                                : toast.type === 'error'
                                  ? 'fa-exclamation-circle text-error'
                                  : 'fa-info-circle text-accent-light',
                        ].join(' ')}
                    ></i>
                    <span className="text-sm text-text">{toast.message}</span>
                </div>
            ) : null}
        </div>
    );
}
