import { useCallback, useEffect, useMemo, useState } from 'react';
import ProviderCard from '../components/ProviderCard.jsx';
import { authedFetch } from '../composables/useAuth.js';
import { useSocket } from '../composables/useSocket.js';

const thinkingModeOptions = [
    { value: 'enabled', label: 'Enabled' },
    { value: 'disabled', label: 'Disabled' },
    { value: 'none', label: 'None' },
];

function validateForm(data) {
    return data.name && data.baseUrl && data.modelName && data.apiKey;
}

function defaultProvider() {
    return {
        name: '',
        baseUrl: '',
        modelName: '',
        apiKey: '',
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

    const createProvider = useCallback(async () => {
        if (!validateForm(newProvider)) {
            showToast('请填写所有必填字段', 'error');
            return;
        }

        try {
            const res = await authedFetch('/api/ai-providers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newProvider),
            });

            if (res.ok) {
                await loadProviders();
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
    }, [loadProviders, newProvider, showToast]);

    const updateProvider = useCallback(
        async (providerData) => {
            try {
                const res = await authedFetch(`/api/ai-providers/${providerData.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(providerData),
                });

                if (res.ok) {
                    await loadProviders();
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
        [loadProviders, showToast],
    );

    const deleteProvider = useCallback(
        async (id) => {
            try {
                const res = await authedFetch(`/api/ai-providers/${id}`, {
                    method: 'DELETE',
                });

                if (res.ok) {
                    await loadProviders();
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
        [loadProviders, showToast],
    );

    const activateProvider = useCallback(
        async (id) => {
            try {
                const res = await authedFetch(`/api/ai-providers/${id}/activate`, {
                    method: 'POST',
                });

                if (res.ok) {
                    await loadProviders();
                    showToast('Provider 已激活', 'success');
                    return;
                }

                const data = await res.json().catch(() => null);
                showToast(data?.error || '激活失败', 'error');
            } catch (error) {
                console.error('激活 Provider 失败:', error);
                showToast('激活 Provider 失败', 'error');
            }
        },
        [loadProviders, showToast],
    );

    const openAddModal = useCallback(() => {
        setNewProvider(defaultProvider());
        setShowAddModal(true);
    }, []);

    useEffect(() => {
        loadProviders();

        const handler = () => loadProviders();
        socket.on('providers-updated', handler);
        return () => socket.off('providers-updated', handler);
    }, [loadProviders, socket]);

    const providerList = useMemo(() => providers || [], [providers]);

    return (
        <div className="space-y-6">
            <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
                <div>
                    <div className="text-xs tracking-wide text-text-muted">
                        AI Models Management
                    </div>
                    <h1 className="text-2xl md:text-3xl font-bold mt-2">模型</h1>
                    <p className="text-sm text-text-muted mt-2">
                        管理多个 AI Provider 配置
                    </p>
                </div>

                <button type="button" onClick={openAddModal} className="btn btn-primary">
                    <i className="fas fa-plus"></i>
                    添加 Provider
                </button>
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
                            onUpdate={updateProvider}
                            onDelete={deleteProvider}
                            onActivate={activateProvider}
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
                                        placeholder="https://api.openai.com/v1"
                                        required
                                    />
                                </div>

                                <div className="md:col-span-2">
                                    <label className="form-label">API Key</label>
                                    <input
                                        value={newProvider.apiKey}
                                        onChange={(e) =>
                                            setNewProvider((prev) => ({
                                                ...prev,
                                                apiKey: e.target.value,
                                            }))
                                        }
                                        type="password"
                                        className="form-input font-mono"
                                        placeholder="sk-..."
                                        required
                                    />
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
                                        value={newProvider.maxTokens}
                                        onChange={(e) =>
                                            setNewProvider((prev) => ({
                                                ...prev,
                                                maxTokens: Number(e.target.value || 0),
                                            }))
                                        }
                                        type="number"
                                        className="form-input font-mono"
                                    />
                                </div>

                                <div>
                                    <label className="form-label">Temperature</label>
                                    <input
                                        value={newProvider.temperature}
                                        onChange={(e) =>
                                            setNewProvider((prev) => ({
                                                ...prev,
                                                temperature: Number(e.target.value || 0),
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
