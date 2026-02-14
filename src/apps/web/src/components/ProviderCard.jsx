import { useEffect, useMemo, useState } from 'react';
import CustomSelect from './CustomSelect.jsx';

const thinkingModeOptions = [
    { value: 'enabled', label: 'Enabled' },
    { value: 'disabled', label: 'Disabled' },
    { value: 'none', label: 'None' },
];

export default function ProviderCard({ provider, onUpdate, onDelete, onActivate }) {
    const [showDetailModal, setShowDetailModal] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [editForm, setEditForm] = useState({ ...provider });

    useEffect(() => {
        setEditForm({ ...provider, thinkingMode: provider.thinkingMode || 'none' });
    }, [provider]);

    const canActivate = useMemo(() => !provider.isActive, [provider.isActive]);

    function openDetailModal() {
        setShowDetailModal(true);
        setIsEditing(false);
        setEditForm({ ...provider, thinkingMode: provider.thinkingMode || 'none' });
    }

    function closeDetailModal() {
        setShowDetailModal(false);
        setIsEditing(false);
        setEditForm({ ...provider, thinkingMode: provider.thinkingMode || 'none' });
    }

    function startEdit() {
        setIsEditing(true);
        setEditForm({ ...provider, thinkingMode: provider.thinkingMode || 'none' });
    }

    function cancelEdit() {
        setIsEditing(false);
        setEditForm({ ...provider, thinkingMode: provider.thinkingMode || 'none' });
    }

    function saveEdit() {
        onUpdate?.(editForm);
        setIsEditing(false);
    }

    function handleDelete() {
        if (confirm(`确定删除 Provider "${provider.name}"？`)) {
            onDelete?.(provider.id);
            closeDetailModal();
        }
    }

    function handleActivate(e) {
        e?.stopPropagation?.();
        if (!canActivate) return;
        onActivate?.(provider.id);
    }

    return (
        <>
            <div
                className={[
                    'provider-card glass-card p-6 transition-all duration-300 cursor-pointer',
                    provider.isActive ? 'provider-card-active' : '',
                ].join(' ')}
                onClick={openDetailModal}
            >
                <div className="flex items-start justify-between">
                    <div className="flex-1">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="provider-icon">
                                <i className="fas fa-brain"></i>
                            </div>
                            <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                    <h3 className="text-base font-bold text-white">
                                        {provider.name}
                                    </h3>
                                    {provider.isActive ? (
                                        <span className="badge-glass badge-green animate-pulse-subtle">
                                            <span className="status-dot"></span>
                                            当前使用
                                        </span>
                                    ) : null}
                                </div>
                                <div className="text-xs text-white/40 font-mono">
                                    {provider.modelName}
                                </div>
                            </div>
                        </div>

                        <div className="space-y-2 text-sm text-white/50">
                            <div className="flex items-center gap-2">
                                <i className="fas fa-link text-xs w-4"></i>
                                <span className="font-mono truncate text-xs">
                                    {provider.baseUrl}
                                </span>
                            </div>
                            <div className="flex items-center gap-3 text-xs">
                                <div className="flex items-center gap-1.5">
                                    <i className="fas fa-layer-group w-4"></i>
                                    <span>{provider.thinkingMode || 'none'}</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <i className="fas fa-temperature-half w-4"></i>
                                    <span>{provider.temperature ?? 'N/A'}</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <i className="fas fa-gauge w-4"></i>
                                    <span>{provider.maxTokens ?? 'N/A'}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 ml-4">
                        {canActivate ? (
                            <button
                                type="button"
                                onClick={handleActivate}
                                className="action-btn action-btn-activate"
                                title="激活此 Provider"
                            >
                                <i className="fas fa-check-circle"></i>
                            </button>
                        ) : null}
                    </div>
                </div>
            </div>

            {showDetailModal ? (
                <div
                    className="provider-card-modal fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
                    onClick={(e) => {
                        if (e.target === e.currentTarget) closeDetailModal();
                    }}
                >
                    <div
                        className="glass-card max-w-3xl w-full max-h-[90vh] overflow-y-auto p-8 animate-modal-in"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between mb-6">
                            <div>
                                <h2 className="text-2xl font-bold text-white mb-1">
                                    {provider.name}
                                </h2>
                                <p className="text-sm text-white/50 font-mono">
                                    {provider.modelName}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={closeDetailModal}
                                className="p-2 rounded-lg hover:bg-white/10 text-white/60 transition-colors"
                            >
                                <i className="fas fa-times"></i>
                            </button>
                        </div>

                        {!isEditing ? (
                            <div className="space-y-4">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="text-label block mb-2">
                                            <i className="fas fa-link text-xs mr-1"></i>
                                            API Base URL
                                        </label>
                                        <div className="font-mono text-sm text-white/70 bg-white/5 p-3 rounded-lg">
                                            {provider.baseUrl}
                                        </div>
                                    </div>

                                    <div>
                                        <label className="text-label block mb-2">
                                            <i className="fas fa-key text-xs mr-1"></i>
                                            API Key
                                        </label>
                                        <div className="font-mono text-sm text-white/70 bg-white/5 p-3 rounded-lg">
                                            {String(provider.apiKey || '').slice(0, 20)}...
                                        </div>
                                    </div>

                                    <div>
                                        <label className="text-label block mb-2">
                                            Thinking Mode
                                        </label>
                                        <div className="text-sm text-white/70 bg-white/5 p-3 rounded-lg">
                                            {provider.thinkingMode || 'none'}
                                        </div>
                                    </div>

                                    <div>
                                        <label className="text-label block mb-2">
                                            Max Tokens
                                        </label>
                                        <div className="text-sm text-white/70 bg-white/5 p-3 rounded-lg">
                                            {provider.maxTokens ?? 'N/A'}
                                        </div>
                                    </div>

                                    <div>
                                        <label className="text-label block mb-2">
                                            Temperature
                                        </label>
                                        <div className="text-sm text-white/70 bg-white/5 p-3 rounded-lg">
                                            {provider.temperature ?? 'N/A'}
                                        </div>
                                    </div>
                                </div>

                                {provider.description ? (
                                    <div>
                                        <label className="text-label block mb-2">描述</label>
                                        <div className="text-sm text-white/70 bg-white/5 p-3 rounded-lg">
                                            {provider.description}
                                        </div>
                                    </div>
                                ) : null}

                                <div className="flex gap-3 pt-4">
                                    <button
                                        type="button"
                                        onClick={startEdit}
                                        className="btn-glass flex-1"
                                    >
                                        <i className="fas fa-edit"></i>
                                        <span>编辑</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleDelete}
                                        className="btn-glass btn-glass-danger flex-1"
                                    >
                                        <i className="fas fa-trash"></i>
                                        <span>删除</span>
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="text-label block mb-2">
                                            显示名称 *
                                        </label>
                                        <input
                                            value={editForm.name || ''}
                                            onChange={(e) =>
                                                setEditForm((prev) => ({
                                                    ...prev,
                                                    name: e.target.value,
                                                }))
                                            }
                                            type="text"
                                            className="input-glass"
                                            required
                                        />
                                    </div>

                                    <div>
                                        <label className="text-label block mb-2">
                                            API Base URL *
                                        </label>
                                        <input
                                            value={editForm.baseUrl || ''}
                                            onChange={(e) =>
                                                setEditForm((prev) => ({
                                                    ...prev,
                                                    baseUrl: e.target.value,
                                                }))
                                            }
                                            type="text"
                                            className="input-glass"
                                            required
                                        />
                                    </div>

                                    <div>
                                        <label className="text-label block mb-2">模型名称 *</label>
                                        <input
                                            value={editForm.modelName || ''}
                                            onChange={(e) =>
                                                setEditForm((prev) => ({
                                                    ...prev,
                                                    modelName: e.target.value,
                                                }))
                                            }
                                            type="text"
                                            className="input-glass"
                                            required
                                        />
                                    </div>

                                    <div>
                                        <label className="text-label block mb-2">API Key *</label>
                                        <input
                                            value={editForm.apiKey || ''}
                                            onChange={(e) =>
                                                setEditForm((prev) => ({
                                                    ...prev,
                                                    apiKey: e.target.value,
                                                }))
                                            }
                                            type="password"
                                            className="input-glass"
                                            required
                                        />
                                    </div>

                                    <div>
                                        <label className="text-label block mb-2">Thinking Mode</label>
                                        <CustomSelect
                                            value={editForm.thinkingMode || 'none'}
                                            options={thinkingModeOptions}
                                            onChange={(nextValue) =>
                                                setEditForm((prev) => ({
                                                    ...prev,
                                                    thinkingMode: nextValue,
                                                }))
                                            }
                                        />
                                    </div>

                                    <div>
                                        <label className="text-label block mb-2">Max Tokens</label>
                                        <input
                                            value={editForm.maxTokens ?? ''}
                                            onChange={(e) =>
                                                setEditForm((prev) => ({
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
                                            value={editForm.temperature ?? ''}
                                            onChange={(e) =>
                                                setEditForm((prev) => ({
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
                                        value={editForm.description || ''}
                                        onChange={(e) =>
                                            setEditForm((prev) => ({
                                                ...prev,
                                                description: e.target.value,
                                            }))
                                        }
                                        className="input-glass min-h-[80px]"
                                        rows={3}
                                    ></textarea>
                                </div>

                                <div className="flex gap-3 pt-4">
                                    <button
                                        type="button"
                                        onClick={saveEdit}
                                        className="btn-glass flex-1 btn-glass-success"
                                    >
                                        <i className="fas fa-save"></i>
                                        <span>保存</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={cancelEdit}
                                        className="btn-glass btn-glass-secondary flex-1"
                                    >
                                        <i className="fas fa-times"></i>
                                        <span>取消</span>
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            ) : null}
        </>
    );
}
