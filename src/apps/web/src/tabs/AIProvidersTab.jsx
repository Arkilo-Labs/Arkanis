import { useCallback, useEffect, useMemo, useState } from 'react';
import CustomSelect from '../components/CustomSelect.jsx';
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
        <div className="ai-providers-tab space-y-6">
            <div className="glass-card p-8 animate-slide-up">
                <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
                    <div>
                        <span className="text-subtitle-en mb-2 block">
                            AI Models Management
                        </span>
                        <h1 className="text-hero-cn text-apple-gradient">AI Provider</h1>
                        <p className="text-sm text-white/50 mt-2">
                            管理多个 AI Provider 配置
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={openAddModal}
                        className="btn-glass h-14 px-8"
                    >
                        <i className="fas fa-plus"></i>
                        <span className="font-bold">添加 Provider</span>
                    </button>
                </div>
            </div>

            {isLoading ? (
                <div className="flex justify-center py-20">
                    <div className="flex flex-col items-center gap-4">
                        <i className="fas fa-spinner fa-spin text-4xl text-white/30"></i>
                        <span className="text-white/50">Loading providers...</span>
                    </div>
                </div>
            ) : providerList.length > 0 ? (
                <div className="provider-list-grid">
                    {providerList.map((provider, index) => (
                        <div
                            key={provider.id}
                            className="animate-slide-up"
                            style={{ animationDelay: `${index * 0.05}s` }}
                        >
                            <ProviderCard
                                provider={provider}
                                onUpdate={updateProvider}
                                onDelete={deleteProvider}
                                onActivate={activateProvider}
                            />
                        </div>
                    ))}
                </div>
            ) : (
                <div className="glass-card p-12 text-center animate-slide-up">
                    <div className="empty-state-icon">
                        <i className="fas fa-brain"></i>
                    </div>
                    <h3 className="text-xl text-white/70 mb-2 font-semibold">暂无 Provider</h3>
                    <p className="text-sm text-white/50 mb-6">
                        点击上方按钮添加您的第一个 AI Provider
                    </p>
                    <button type="button" onClick={openAddModal} className="btn-glass">
                        <i className="fas fa-plus"></i>
                        <span>添加 Provider</span>
                    </button>
                </div>
            )}

            {showAddModal ? (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
                    onClick={(e) => {
                        if (e.target === e.currentTarget) setShowAddModal(false);
                    }}
                >
                    <div className="glass-card max-w-3xl w-full max-h-[90vh] overflow-y-auto p-8">
                        <div className="flex items-center justify-between mb-6">
                            <h2 className="text-2xl font-bold text-white">添加 Provider</h2>
                            <button
                                type="button"
                                onClick={() => setShowAddModal(false)}
                                className="p-2 rounded-lg hover:bg-white/10 text-white/60 transition-colors"
                            >
                                <i className="fas fa-times"></i>
                            </button>
                        </div>

                        <div className="space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="text-label block mb-2">
                                        <i className="fas fa-tag text-xs mr-1"></i>
                                        显示名称 *
                                    </label>
                                    <input
                                        value={newProvider.name}
                                        onChange={(e) =>
                                            setNewProvider((prev) => ({
                                                ...prev,
                                                name: e.target.value,
                                            }))
                                        }
                                        type="text"
                                        className="input-glass"
                                        placeholder="Claude Sonnet 4.5"
                                        required
                                    />
                                </div>

                                <div>
                                    <label className="text-label block mb-2">
                                        <i className="fas fa-link text-xs mr-1"></i>
                                        API Base URL *
                                    </label>
                                    <input
                                        value={newProvider.baseUrl}
                                        onChange={(e) =>
                                            setNewProvider((prev) => ({
                                                ...prev,
                                                baseUrl: e.target.value,
                                            }))
                                        }
                                        type="text"
                                        className="input-glass"
                                        placeholder="https://api.example.com"
                                        required
                                    />
                                </div>

                                <div>
                                    <label className="text-label block mb-2">
                                        <i className="fas fa-cube text-xs mr-1"></i>
                                        模型名称 *
                                    </label>
                                    <input
                                        value={newProvider.modelName}
                                        onChange={(e) =>
                                            setNewProvider((prev) => ({
                                                ...prev,
                                                modelName: e.target.value,
                                            }))
                                        }
                                        type="text"
                                        className="input-glass"
                                        placeholder="claude-sonnet-4-5"
                                        required
                                    />
                                </div>

                                <div>
                                    <label className="text-label block mb-2">
                                        <i className="fas fa-key text-xs mr-1"></i>
                                        API Key *
                                    </label>
                                    <input
                                        value={newProvider.apiKey}
                                        onChange={(e) =>
                                            setNewProvider((prev) => ({
                                                ...prev,
                                                apiKey: e.target.value,
                                            }))
                                        }
                                        type="password"
                                        className="input-glass"
                                        placeholder="sk-..."
                                        required
                                    />
                                </div>

                                <div>
                                    <label className="text-label block mb-2">
                                        Thinking Mode
                                    </label>
                                    <CustomSelect
                                        value={newProvider.thinkingMode}
                                        options={thinkingModeOptions}
                                        onChange={(nextValue) =>
                                            setNewProvider((prev) => ({
                                                ...prev,
                                                thinkingMode: nextValue,
                                            }))
                                        }
                                    />
                                </div>

                                <div>
                                    <label className="text-label block mb-2">Max Tokens</label>
                                    <input
                                        value={newProvider.maxTokens}
                                        onChange={(e) =>
                                            setNewProvider((prev) => ({
                                                ...prev,
                                                maxTokens: Number(e.target.value || 0),
                                            }))
                                        }
                                        type="number"
                                        className="input-glass"
                                    />
                                </div>

                                <div>
                                    <label className="text-label block mb-2">Temperature</label>
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
                                        className="input-glass"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="text-label block mb-2">描述</label>
                                <textarea
                                    value={newProvider.description}
                                    onChange={(e) =>
                                        setNewProvider((prev) => ({
                                            ...prev,
                                            description: e.target.value,
                                        }))
                                    }
                                    className="input-glass min-h-[80px]"
                                    rows={3}
                                    placeholder="Provider 描述..."
                                ></textarea>
                            </div>

                            <div className="flex gap-3 pt-4">
                                <button
                                    type="button"
                                    onClick={createProvider}
                                    className="btn-glass flex-1 !border-green-500/30 !text-green-400"
                                >
                                    <i className="fas fa-save"></i>
                                    <span>创建</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setShowAddModal(false)}
                                    className="btn-glass flex-1"
                                >
                                    <i className="fas fa-times"></i>
                                    <span>取消</span>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            ) : null}

            {toast.show ? (
                <div className="fixed top-24 right-4 z-50 glass-card px-6 py-3 flex items-center gap-3 shadow-xl">
                    <i
                        className={[
                            'fas',
                            toast.type === 'success'
                                ? 'fa-check-circle text-green-400'
                                : toast.type === 'error'
                                  ? 'fa-exclamation-circle text-red-400'
                                  : 'fa-info-circle text-blue-400',
                        ].join(' ')}
                    ></i>
                    <span className="text-sm text-white/90">{toast.message}</span>
                </div>
            ) : null}
        </div>
    );
}
