import { useEffect, useMemo, useState } from 'react';
import { authedFetch } from '../composables/useAuth.js';

const thinkingModeOptions = [
  { value: 'enabled', label: 'Enabled' },
  { value: 'disabled', label: 'Disabled' },
  { value: 'none', label: 'None' },
];

const protocolOptions = [
  { value: 'chat_completions', label: 'Chat Completions' },
  { value: 'responses', label: 'Responses' },
  { value: 'anthropic', label: 'Anthropic' },
];

function getKeyBadge(provider) {
  if (!provider?.hasKey) {
    return { className: 'badge badge-error', label: '未配置', textClassName: 'text-error' };
  }
  if (provider.keySource === 'env') {
    return { className: 'badge badge-accent', label: '已配置(ENV)', textClassName: 'text-accent-light' };
  }
  return { className: 'badge badge-success', label: '已配置(secrets)', textClassName: 'text-success' };
}

export default function ProviderCard({ provider, usedRoles = [], onUpdate, onDelete }) {
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({ ...provider });
  const [newApiKey, setNewApiKey] = useState('');
  const [keySaving, setKeySaving] = useState(false);

  useEffect(() => {
    setEditForm({
      ...provider,
      thinkingMode: provider.thinkingMode || 'none',
      protocol: provider.protocol || '',
    });
  }, [provider]);

  const keyBadge = useMemo(() => getKeyBadge(provider), [provider]);

  function openDetailModal() {
    setShowDetailModal(true);
    setIsEditing(false);
    setEditForm({
      ...provider,
      thinkingMode: provider.thinkingMode || 'none',
      protocol: provider.protocol || '',
    });
  }

  function closeDetailModal() {
    setShowDetailModal(false);
    setIsEditing(false);
    setEditForm({
      ...provider,
      thinkingMode: provider.thinkingMode || 'none',
      protocol: provider.protocol || '',
    });
  }

  function startEdit() {
    setIsEditing(true);
    setNewApiKey('');
    setEditForm({
      ...provider,
      thinkingMode: provider.thinkingMode || 'none',
      protocol: provider.protocol || '',
    });
  }

  function cancelEdit() {
    setIsEditing(false);
    setNewApiKey('');
    setEditForm({
      ...provider,
      thinkingMode: provider.thinkingMode || 'none',
      protocol: provider.protocol || '',
    });
  }

  async function saveEdit() {
    setKeySaving(true);
    try {
      await onUpdate?.(editForm);
      if (newApiKey) {
        const res = await authedFetch(`/api/ai-providers/${provider.id}/key`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey: newApiKey }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error || 'API Key 保存失败');
        }
      }
      setIsEditing(false);
      setNewApiKey('');
    } catch {
      // onUpdate already handles toast
    } finally {
      setKeySaving(false);
    }
  }

  function handleDelete() {
    if (confirm(`确定删除 Provider "${provider.name}"？`)) {
      onDelete?.(provider.id);
      closeDetailModal();
    }
  }

  return (
    <>
      <div
        className={[
          'card card-hover p-6 cursor-pointer',
          provider.hasKey ? 'border-success/25' : '',
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
                  <h3 className="text-base font-bold truncate">{provider.name}</h3>
                  <span className={keyBadge.className}>{keyBadge.label}</span>
                </div>
                <div className="text-xs text-text-muted font-mono truncate">
                  {provider.modelName}
                </div>
                {/* 固定高度容器，保证所有卡片等高 */}
                <div className="h-5 mt-2 flex items-center">
                  {usedRoles.length ? (
                    <span className="badge badge-muted inline-flex">
                      <i className="fas fa-plug text-[9px]"></i>
                      {usedRoles.length} 个角色
                    </span>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="space-y-2 text-sm text-text-muted">
              <div className="flex items-center gap-2 min-w-0">
                <i className="fas fa-link text-xs w-4 flex-shrink-0"></i>
                <span className="font-mono truncate text-xs">{provider.baseUrl}</span>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <div className="flex items-center gap-1.5">
                  <i className="fas fa-key w-4"></i>
                  <span className="font-mono">
                    {provider.apiKeyEnv ? provider.apiKeyEnv : 'secrets'}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <i className="fas fa-plug w-4"></i>
                  <span className="font-mono">{provider.protocol || '—'}</span>
                </div>
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
          <button
            type="button"
            className="p-1.5 rounded-lg hover:bg-white/10 text-white/40 hover:text-white/80 transition-colors flex-shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              setShowDetailModal(true);
              setIsEditing(true);
              setEditForm({
                ...provider,
                thinkingMode: provider.thinkingMode || 'none',
                protocol: provider.protocol || '',
              });
            }}
            aria-label="编辑"
          >
            <i className="fas fa-pen text-xs"></i>
          </button>
        </div>
      </div>

      {showDetailModal ? (
        <div
          className="modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeDetailModal();
          }}
        >
          <div className="modal-card max-w-3xl p-8" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <div className="min-w-0">
                <h2 className="text-xl font-bold truncate">{provider.name}</h2>
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
                    <label className="form-label">Provider ID</label>
                    <div className="rounded-xl bg-white/5 border border-border-light/10 p-3 font-mono text-sm text-white/80 break-all">
                      {provider.id}
                    </div>
                  </div>

                  <div>
                    <label className="form-label">API Base URL</label>
                    <div className="rounded-xl bg-white/5 border border-border-light/10 p-3 font-mono text-sm text-white/80 break-all">
                      {provider.baseUrl}
                    </div>
                  </div>

                  <div>
                    <label className="form-label">API Key 来源</label>
                    <div className="rounded-xl bg-white/5 border border-border-light/10 p-3 text-sm text-white/80">
                      {keyBadge.label}
                      {provider.locked ? (
                        <span className="text-xs text-text-muted ml-2">(已锁定)</span>
                      ) : null}
                    </div>
                  </div>

                  <div>
                    <label className="form-label">API Key ENV（可选）</label>
                    <div className="rounded-xl bg-white/5 border border-border-light/10 p-3 font-mono text-sm text-white/80 break-all">
                      {provider.apiKeyEnv ? provider.apiKeyEnv : '-'}
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

                  <div>
                    <label className="form-label">API 协议</label>
                    <div className="rounded-xl bg-white/5 border border-border-light/10 p-3 font-mono text-sm text-white/80">
                      {provider.protocol || '—'}
                    </div>
                  </div>

                  <div>
                    <label className="form-label">Supports Vision</label>
                    <div className="rounded-xl bg-white/5 border border-border-light/10 p-3 text-sm text-white/80">
                      {provider.supportsVision ? 'Yes' : 'No'}
                    </div>
                  </div>

                  <div>
                    <label className="form-label">Thinking Mode</label>
                    <div className="rounded-xl bg-white/5 border border-border-light/10 p-3 text-sm text-white/80">
                      {provider.thinkingMode || 'disabled'}
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
                  <button type="button" onClick={startEdit} className="btn btn-secondary flex-1">
                    <i className="fas fa-edit"></i>
                    编辑
                  </button>
                  <button type="button" onClick={handleDelete} className="btn btn-danger flex-1">
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
                    <label className="form-label">Base Model Name *</label>
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
                    <label className="form-label">API Key ENV（可选）</label>
                    <input
                      value={editForm.apiKeyEnv || ''}
                      onChange={(e) =>
                        setEditForm((prev) => ({
                          ...prev,
                          apiKeyEnv: e.target.value,
                        }))
                      }
                      type="text"
                      className="form-input font-mono"
                      placeholder="OPENAI_API_KEY"
                    />
                  </div>

                  <div>
                    <label className="form-label">
                      API Key
                      <span className={`ml-2 text-xs font-normal ${keyBadge.textClassName}`}>
                        {keyBadge.label}
                      </span>
                    </label>
                    {provider.locked ? (
                      <p className="text-xs text-text-muted">由 ENV 管理，无法在此修改</p>
                    ) : (
                      <input
                        value={newApiKey}
                        onChange={(e) => setNewApiKey(e.target.value)}
                        type="password"
                        className="form-input font-mono"
                        placeholder="留空保持不变"
                        autoComplete="off"
                      />
                    )}
                  </div>

                  <div>
                    <label className="form-label">API 协议 *</label>
                    <select
                      value={editForm.protocol || ''}
                      onChange={(e) =>
                        setEditForm((prev) => ({
                          ...prev,
                          protocol: e.target.value,
                        }))
                      }
                      className="form-input font-mono"
                      required
                    >
                      <option value="" disabled>
                        请选择协议
                      </option>
                      {protocolOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
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
                    <label className="form-label">Supports Vision</label>
                    <div className="flex items-center h-10">
                      <label className="switch">
                        <input
                          checked={Boolean(editForm.supportsVision)}
                          onChange={(e) =>
                            setEditForm((prev) => ({
                              ...prev,
                              supportsVision: e.target.checked,
                            }))
                          }
                          type="checkbox"
                        />
                        <span className="switch-control">
                          <span className="switch-track"></span>
                          <span className="switch-thumb"></span>
                        </span>
                      </label>
                    </div>
                  </div>

                  <div>
                    <label className="form-label">Max Tokens</label>
                    <input
                      value={editForm.maxTokens ?? ''}
                      onChange={(e) =>
                        setEditForm((prev) => ({
                          ...prev,
                          maxTokens: e.target.value === '' ? undefined : Number(e.target.value),
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
                    disabled={keySaving}
                  >
                    <i className={keySaving ? 'fas fa-spinner fa-spin' : 'fas fa-save'}></i>
                    {keySaving ? '保存中...' : '保存'}
                  </button>
                  <button
                    type="button"
                    onClick={cancelEdit}
                    className="btn btn-secondary flex-1"
                    disabled={keySaving}
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
