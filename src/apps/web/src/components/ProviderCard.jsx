import { useEffect, useMemo, useState } from 'react';

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
                    'card card-hover p-6 cursor-pointer',
                    provider.isActive ? 'border-success/25' : '',
                ].join(' ')}
                onClick={openDetailModal}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') openDetailModal();
                }}
            >
                <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-10 h-10 rounded-xl bg-white/5 border border-border-light/10 flex items-center justify-center flex-shrink-0">
                                <i className="fas fa-brain text-white/70"></i>
                            </div>

                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                    <h3 className="text-base font-bold truncate">
                                        {provider.name}
                                    </h3>
                                    {provider.isActive ? (
                                        <span className="badge badge-success">
                                            <span className="w-1.5 h-1.5 rounded-full bg-success"></span>
                                            当前使用
                                        </span>
                                    ) : null}
                                </div>
                                <div className="text-xs text-text-muted font-mono truncate">
                                    {provider.modelName}
                                </div>
                            </div>
                        </div>

                        <div className="space-y-2 text-sm text-text-muted">
                            <div className="flex items-center gap-2 min-w-0">
                                <i className="fas fa-link text-xs w-4 flex-shrink-0"></i>
                                <span className="font-mono truncate text-xs">
                                    {provider.baseUrl}
                                </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-3 text-xs">
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

                    <div className="flex items-center gap-2">
                        {canActivate ? (
                            <button
                                type="button"
                                onClick={handleActivate}
                                className="btn btn-secondary btn-sm"
                                title="激活此 Provider"
                                aria-label="激活此 Provider"
                            >
                                <i className="fas fa-check-circle"></i>
                            </button>
                        ) : null}
                    </div>
                </div>
            </div>

            {showDetailModal ? (
                <div
                    className="modal-overlay"
                    onClick={(e) => {
                        if (e.target === e.currentTarget) closeDetailModal();
                    }}
                >
                    <div
                        className="modal-card max-w-3xl p-8"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between mb-6">
                            <div className="min-w-0">
                                <h2 className="text-xl font-bold truncate">
                                    {provider.name}
                                </h2>
                                <p className="text-sm text-text-muted font-mono truncate mt-1">
                                    {provider.modelName}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={closeDetailModal}
                                className="p-2 rounded-lg hover:bg-white/10 text-white/70 transition-colors"
                                aria-label="关闭"
                            >
                                <i className="fas fa-times"></i>
                            </button>
                        </div>

                        {!isEditing ? (
                            <div className="space-y-4">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="form-label">API Base URL</label>
                                        <div className="rounded-xl bg-white/5 border border-border-light/10 p-3 font-mono text-sm text-white/80 break-all">
                                            {provider.baseUrl}
                                        </div>
                                    </div>

                                    <div>
                                        <label className="form-label">API Key</label>
                                        <div className="rounded-xl bg-white/5 border border-border-light/10 p-3 font-mono text-sm text-white/80 break-all">
                                            {String(provider.apiKey || '').slice(0, 20)}...
                                        </div>
                                    </div>

                                    <div>
                                        <label className="form-label">Thinking Mode</label>
                                        <div className="rounded-xl bg-white/5 border border-border-light/10 p-3 text-sm text-white/80">
                                            {provider.thinkingMode || 'none'}
                                        </div>
                                    </div>

                                    <div>
                                        <label className="form-label">Max Tokens</label>
                                        <div className="rounded-xl bg-white/5 border border-border-light/10 p-3 text-sm text-white/80">
                                            {provider.maxTokens ?? 'N/A'}
                                        </div>
                                    </div>

                                    <div>
                                        <label className="form-label">Temperature</label>
                                        <div className="rounded-xl bg-white/5 border border-border-light/10 p-3 text-sm text-white/80">
                                            {provider.temperature ?? 'N/A'}
                                        </div>
                                    </div>
                                </div>

                                {provider.description ? (
                                    <div>
                                        <label className="form-label">描述</label>
                                        <div className="rounded-xl bg-white/5 border border-border-light/10 p-3 text-sm text-white/80 whitespace-pre-wrap">
                                            {provider.description}
                                        </div>
                                    </div>
                                ) : null}

                                <div className="flex gap-3 pt-4">
                                    <button
                                        type="button"
                                        onClick={startEdit}
                                        className="btn btn-secondary flex-1"
                                    >
                                        <i className="fas fa-edit"></i>
                                        编辑
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleDelete}
                                        className="btn btn-danger flex-1"
                                    >
                                        <i className="fas fa-trash"></i>
                                        删除
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="form-label">显示名称 *</label>
                                        <input
                                            value={editForm.name || ''}
                                            onChange={(e) =>
                                                setEditForm((prev) => ({
                                                    ...prev,
                                                    name: e.target.value,
                                                }))
                                            }
                                            type="text"
                                            className="form-input"
                                            required
                                        />
                                    </div>

                                    <div>
                                        <label className="form-label">API Base URL *</label>
                                        <input
                                            value={editForm.baseUrl || ''}
                                            onChange={(e) =>
                                                setEditForm((prev) => ({
                                                    ...prev,
                                                    baseUrl: e.target.value,
                                                }))
                                            }
                                            type="text"
                                            className="form-input font-mono"
                                            required
                                        />
                                    </div>

                                    <div>
                                        <label className="form-label">模型名称 *</label>
                                        <input
                                            value={editForm.modelName || ''}
                                            onChange={(e) =>
                                                setEditForm((prev) => ({
                                                    ...prev,
                                                    modelName: e.target.value,
                                                }))
                                            }
                                            type="text"
                                            className="form-input font-mono"
                                            required
                                        />
                                    </div>

                                    <div>
                                        <label className="form-label">API Key *</label>
                                        <input
                                            value={editForm.apiKey || ''}
                                            onChange={(e) =>
                                                setEditForm((prev) => ({
                                                    ...prev,
                                                    apiKey: e.target.value,
                                                }))
                                            }
                                            type="password"
                                            className="form-input font-mono"
                                            required
                                        />
                                    </div>

                                    <div>
                                        <label className="form-label">Thinking Mode</label>
                                        <select
                                            value={editForm.thinkingMode || 'none'}
                                            onChange={(e) =>
                                                setEditForm((prev) => ({
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
                                            value={editForm.maxTokens ?? ''}
                                            onChange={(e) =>
                                                setEditForm((prev) => ({
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
                                            value={editForm.temperature ?? ''}
                                            onChange={(e) =>
                                                setEditForm((prev) => ({
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
                                        value={editForm.description || ''}
                                        onChange={(e) =>
                                            setEditForm((prev) => ({
                                                ...prev,
                                                description: e.target.value,
                                            }))
                                        }
                                        className="form-input min-h-[96px]"
                                        rows={3}
                                    ></textarea>
                                </div>

                                <div className="flex gap-3 pt-4">
                                    <button
                                        type="button"
                                        onClick={saveEdit}
                                        className="btn btn-primary flex-1"
                                    >
                                        <i className="fas fa-save"></i>
                                        保存
                                    </button>
                                    <button
                                        type="button"
                                        onClick={cancelEdit}
                                        className="btn btn-secondary flex-1"
                                    >
                                        <i className="fas fa-times"></i>
                                        取消
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
