import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ProviderCard from '../components/ProviderCard.jsx';
import { authedFetch } from '../composables/useAuth.js';
import { useSocket } from '../composables/useSocket.js';

const LENS_ROLE_LABELS = {
    lens: 'Lens 主分析',
    newser: 'Newser',
    researcher: 'Researcher',
    auditor: 'Auditor',
};

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

function defaultNewProvider() {
    return {
        id: '',
        name: '',
        type: 'openai_compatible',
        protocol: '',
        baseUrl: '',
        modelName: '',
        apiKey: '',
        apiKeyEnv: '',
        supportsVision: false,
        thinkingMode: 'disabled',
        maxTokens: 8192,
        temperature: 0.2,
        description: '',
    };
}

// 三级"使用"下拉菜单
function UseDropdown({ providerId, providerName, rtAgents, lensRoleKeys, onApply, applying }) {
    const [open, setOpen] = useState(false);
    const [rtExpanded, setRtExpanded] = useState(false);
    const [lensExpanded, setLensExpanded] = useState(false);
    const ref = useRef(null);

    useEffect(() => {
        if (!open) return;
        function onOutside(e) {
            if (ref.current && !ref.current.contains(e.target)) setOpen(false);
        }
        document.addEventListener('mousedown', onOutside);
        return () => document.removeEventListener('mousedown', onOutside);
    }, [open]);

    function trigger(scope) {
        setOpen(false);
        setRtExpanded(false);
        setLensExpanded(false);
        onApply(providerId, scope);
    }

    return (
        <div ref={ref} className="relative">
            <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={(e) => {
                    e.stopPropagation();
                    setOpen((v) => !v);
                }}
                disabled={applying}
            >
                {applying ? (
                    <i className="fas fa-spinner fa-spin"></i>
                ) : (
                    <i className="fas fa-check-circle"></i>
                )}
                使用
                <i className="fas fa-chevron-down text-[10px]"></i>
            </button>

            {open ? (
                <div
                    className="absolute top-full right-0 mt-1 z-50 min-w-[180px] rounded-xl border border-border-light/15 bg-[rgb(var(--color-card))] shadow-lg py-1"
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* 第零级：全量 */}
                    <button
                        type="button"
                        className="use-dropdown-item"
                        onClick={() => trigger('all')}
                    >
                        <i className="fas fa-globe w-4"></i>
                        全量应用
                    </button>

                    <div className="use-dropdown-divider"></div>

                    {/* 第一级：Roundtable */}
                    <button
                        type="button"
                        className="use-dropdown-item"
                        onClick={() => setRtExpanded((v) => !v)}
                    >
                        <i className="fas fa-chess-rook w-4"></i>
                        Roundtable
                        <i className={['fas ml-auto text-[10px]', rtExpanded ? 'fa-chevron-up' : 'fa-chevron-down'].join(' ')}></i>
                    </button>
                    {rtExpanded ? (
                        <>
                            <button
                                type="button"
                                className="use-dropdown-item use-dropdown-sub"
                                onClick={() => trigger('roundtable')}
                            >
                                全部 Roundtable
                            </button>
                            {rtAgents.map((a) => (
                                <button
                                    key={a.name}
                                    type="button"
                                    className="use-dropdown-item use-dropdown-sub"
                                    onClick={() => trigger(`rt:${a.name}`)}
                                >
                                    {a.name}
                                    <span className="ml-auto text-[10px] text-text-muted">{a.role}</span>
                                </button>
                            ))}
                        </>
                    ) : null}

                    {/* 第一级：Lens */}
                    <button
                        type="button"
                        className="use-dropdown-item"
                        onClick={() => setLensExpanded((v) => !v)}
                    >
                        <i className="fas fa-eye w-4"></i>
                        Lens
                        <i className={['fas ml-auto text-[10px]', lensExpanded ? 'fa-chevron-up' : 'fa-chevron-down'].join(' ')}></i>
                    </button>
                    {lensExpanded ? (
                        <>
                            <button
                                type="button"
                                className="use-dropdown-item use-dropdown-sub"
                                onClick={() => trigger('lens')}
                            >
                                全部 Lens 角色
                            </button>
                            {lensRoleKeys.map((role) => (
                                <button
                                    key={role}
                                    type="button"
                                    className="use-dropdown-item use-dropdown-sub"
                                    onClick={() => trigger(`lr:${role}`)}
                                >
                                    {LENS_ROLE_LABELS[role] || role}
                                </button>
                            ))}
                        </>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}

// 简化的添加 Provider 弹窗
function AddProviderModal({ onClose, onCreate }) {
    const [form, setForm] = useState(defaultNewProvider());
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState('');

    function update(patch) {
        setForm((prev) => ({ ...prev, ...patch }));
    }

    async function handleSubmit(e) {
        e.preventDefault();
        if (!form.name.trim() || !form.baseUrl.trim() || !form.modelName.trim()) {
            setError('名称、Base URL、模型名称为必填项');
            return;
        }
        if (!form.protocol) {
            setError('API 协议为必填项');
            return;
        }
        setError('');
        setCreating(true);
        try {
            await onCreate(form);
            onClose();
        } catch (err) {
            setError(err?.message || '创建失败');
        } finally {
            setCreating(false);
        }
    }

    return (
        <div
            className="modal-overlay"
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className="modal-card max-w-2xl p-8" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-xl font-bold">添加 Provider</h2>
                    <button
                        type="button"
                        onClick={onClose}
                        className="p-2 rounded-lg hover:bg-white/10 text-white/70 transition-colors"
                    >
                        <i className="fas fa-times"></i>
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="form-label">显示名称 *</label>
                            <input
                                value={form.name}
                                onChange={(e) => update({ name: e.target.value })}
                                className="form-input"
                                placeholder="OpenAI GPT-4o"
                                required
                            />
                        </div>
                        <div>
                            <label className="form-label">模型名称 *</label>
                            <input
                                value={form.modelName}
                                onChange={(e) => update({ modelName: e.target.value })}
                                className="form-input font-mono"
                                placeholder="gpt-4o / deepseek-chat"
                                required
                            />
                        </div>
                    </div>

                    <div>
                        <label className="form-label">API Base URL *</label>
                        <input
                            value={form.baseUrl}
                            onChange={(e) => update({ baseUrl: e.target.value })}
                            className="form-input font-mono"
                            placeholder="https://api.openai.com"
                            required
                        />
                        <p className="text-xs text-text-muted mt-1">不要带 /v1，系统自动拼接</p>
                    </div>

                    <div>
                        <label className="form-label">API 协议 *</label>
                        <select
                            value={form.protocol}
                            onChange={(e) => update({ protocol: e.target.value })}
                            className="form-input font-mono"
                            required
                        >
                            <option value="" disabled>请选择协议</option>
                            {protocolOptions.map((o) => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="form-label">API Key</label>
                        <input
                            value={form.apiKey}
                            onChange={(e) => update({ apiKey: e.target.value })}
                            type="password"
                            className="form-input font-mono"
                            placeholder="sk-..."
                            autoComplete="off"
                        />
                        <p className="text-xs text-text-muted mt-1">保存后不再回显，可通过复制 Provider 复用同一 Key</p>
                    </div>

                    {/* 高级设置折叠 */}
                    <div>
                        <button
                            type="button"
                            className="flex items-center gap-2 text-sm text-text-muted hover:text-text transition-colors"
                            onClick={() => setShowAdvanced((v) => !v)}
                        >
                            <i className={['fas text-xs', showAdvanced ? 'fa-chevron-up' : 'fa-chevron-down'].join(' ')}></i>
                            高级设置
                        </button>

                        {showAdvanced ? (
                            <div className="mt-3 space-y-4 pl-4 border-l border-border-light/10">
                                <div>
                                    <label className="form-label">Provider ID（可选）</label>
                                    <input
                                        value={form.id}
                                        onChange={(e) => update({ id: e.target.value })}
                                        className="form-input font-mono"
                                        placeholder="自动生成"
                                    />
                                    <p className="text-xs text-text-muted mt-1">只允许字母/数字/._-，必须以字母或数字开头</p>
                                </div>

                                <div>
                                    <label className="form-label">API Key ENV（可选）</label>
                                    <input
                                        value={form.apiKeyEnv}
                                        onChange={(e) => update({ apiKeyEnv: e.target.value })}
                                        className="form-input font-mono"
                                        placeholder="OPENAI_API_KEY"
                                    />
                                    <p className="text-xs text-text-muted mt-1">设置后 ENV 优先，UI 无法覆盖</p>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <div>
                                        <label className="form-label">Thinking Mode</label>
                                        <select
                                            value={form.thinkingMode}
                                            onChange={(e) => update({ thinkingMode: e.target.value })}
                                            className="form-input font-mono"
                                        >
                                            {thinkingModeOptions.map((o) => (
                                                <option key={o.value} value={o.value}>{o.label}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="form-label">Max Tokens</label>
                                        <input
                                            value={form.maxTokens ?? ''}
                                            onChange={(e) => update({ maxTokens: e.target.value === '' ? undefined : Number(e.target.value) })}
                                            type="number"
                                            className="form-input font-mono"
                                        />
                                    </div>
                                    <div>
                                        <label className="form-label">Temperature</label>
                                        <input
                                            value={form.temperature ?? ''}
                                            onChange={(e) => update({ temperature: e.target.value === '' ? undefined : Number(e.target.value) })}
                                            type="number"
                                            step="0.1"
                                            className="form-input font-mono"
                                        />
                                    </div>
                                </div>

                                <div className="flex items-center gap-3">
                                    <input
                                        id="add_supportsVision"
                                        type="checkbox"
                                        checked={Boolean(form.supportsVision)}
                                        onChange={(e) => update({ supportsVision: e.target.checked })}
                                        className="rounded border-border-light/20 bg-white/5"
                                    />
                                    <label className="form-label mb-0" htmlFor="add_supportsVision">
                                        Supports Vision
                                    </label>
                                </div>

                                <div>
                                    <label className="form-label">描述</label>
                                    <textarea
                                        value={form.description}
                                        onChange={(e) => update({ description: e.target.value })}
                                        className="form-input min-h-[72px]"
                                        rows={2}
                                        placeholder="Provider 描述..."
                                    />
                                </div>
                            </div>
                        ) : null}
                    </div>

                    {error ? <div className="form-error">{error}</div> : null}

                    <div className="flex gap-3 pt-2">
                        <button type="submit" className="btn btn-primary flex-1" disabled={creating}>
                            <i className={creating ? 'fas fa-spinner fa-spin' : 'fas fa-save'}></i>
                            {creating ? '创建中...' : '创建'}
                        </button>
                        <button type="button" className="btn btn-secondary flex-1" onClick={onClose}>
                            <i className="fas fa-times"></i>
                            取消
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

export default function AIProvidersTab() {
    const { socket } = useSocket();

    const [providers, setProviders] = useState([]);
    const [rtAgentData, setRtAgentData] = useState({ agents: [], providers: [] });
    const [lensConfig, setLensConfig] = useState({ roles: { lens: null, newser: null, researcher: null, auditor: null } });
    const [isLoading, setIsLoading] = useState(false);
    const [showAddModal, setShowAddModal] = useState(false);
    const [toast, setToast] = useState({ show: false, message: '', type: 'info' });

    // 角色映射草稿
    const [rtDraft, setRtDraft] = useState({});
    const [lensDraft, setLensDraft] = useState({});
    const [savingRt, setSavingRt] = useState(false);
    const [savingLens, setSavingLens] = useState(false);

    // 正在"使用"某 provider 的操作锁
    const [applyingId, setApplyingId] = useState('');

    const showToast = useCallback((message, type = 'info') => {
        setToast({ show: true, message, type });
        window.setTimeout(() => setToast((prev) => ({ ...prev, show: false })), 3000);
    }, []);

    const loadProviders = useCallback(async () => {
        const res = await authedFetch('/api/ai-providers');
        if (!res.ok) throw new Error('加载 Provider 失败');
        return res.json();
    }, []);

    const loadRtAgents = useCallback(async () => {
        const res = await authedFetch('/api/roundtable/agent-providers');
        if (!res.ok) return { agents: [], providers: [] };
        return res.json();
    }, []);

    const loadLensConfig = useCallback(async () => {
        const res = await authedFetch('/api/provider-config');
        if (!res.ok) return { roles: { lens: null, newser: null, researcher: null, auditor: null } };
        return res.json();
    }, []);

    const loadAll = useCallback(async () => {
        setIsLoading(true);
        try {
            const [provList, rtData, lensData] = await Promise.all([
                loadProviders(),
                loadRtAgents(),
                loadLensConfig(),
            ]);
            setProviders(provList || []);
            setRtAgentData(rtData || { agents: [], providers: [] });
            setLensConfig(lensData || { roles: { lens: null, newser: null, researcher: null, auditor: null } });

            // 初始化草稿
            const rtInit = {};
            for (const a of (rtData?.agents || [])) {
                rtInit[a.name] = a.overrideProviderRef ?? null;
            }
            setRtDraft(rtInit);
            setLensDraft({ ...(lensData?.roles || {}) });
        } catch (err) {
            showToast(err?.message || '加载失败', 'error');
        } finally {
            setIsLoading(false);
        }
    }, [loadLensConfig, loadProviders, loadRtAgents, showToast]);

    const createProvider = useCallback(async (formData) => {
        const { apiKey, ...body } = formData;
        const res = await authedFetch('/api/ai-providers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...body, ...(apiKey ? { apiKey } : {}) }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || '创建失败');
        await loadAll();
        showToast('Provider 已创建', 'success');
    }, [loadAll, showToast]);

    const updateProvider = useCallback(async (providerData) => {
        const res = await authedFetch(`/api/ai-providers/${providerData.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(providerData),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || '更新失败');
        await loadAll();
        showToast('Provider 已更新', 'success');
    }, [loadAll, showToast]);

    const deleteProvider = useCallback(async (id) => {
        const res = await authedFetch(`/api/ai-providers/${id}`, { method: 'DELETE' });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || '删除失败');
        await loadAll();
        showToast('Provider 已删除', 'success');
    }, [loadAll, showToast]);

    const copyProvider = useCallback(async (id) => {
        const res = await authedFetch(`/api/ai-providers/${id}/copy`, { method: 'POST' });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || '复制失败');
        await loadAll();
        showToast('Provider 已复制', 'success');
    }, [loadAll, showToast]);

    const applyProvider = useCallback(async (providerId, scope) => {
        if (applyingId) return;
        setApplyingId(providerId);
        try {
            if (scope === 'all' || scope === 'roundtable' || scope.startsWith('rt:')) {
                let overridesMap = {};
                if (scope === 'all' || scope === 'roundtable') {
                    for (const a of rtAgentData.agents) {
                        overridesMap[a.name] = providerId;
                    }
                } else {
                    overridesMap[scope.slice(3)] = providerId;
                }
                const res = await authedFetch('/api/roundtable/agent-providers', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ overrides: overridesMap }),
                });
                if (!res.ok) {
                    const d = await res.json().catch(() => null);
                    throw new Error(d?.error || 'Roundtable 应用失败');
                }
            }

            if (scope === 'all' || scope === 'lens' || scope.startsWith('lr:')) {
                const current = lensConfig.roles || {};
                const LENS_KEYS = ['lens', 'newser', 'researcher', 'auditor'];
                let roles;
                if (scope === 'all' || scope === 'lens') {
                    roles = Object.fromEntries(LENS_KEYS.map((k) => [k, providerId]));
                } else {
                    const role = scope.slice(3);
                    roles = { ...current, [role]: providerId };
                    // 补全缺失 key
                    for (const k of LENS_KEYS) {
                        if (!(k in roles)) roles[k] = current[k] ?? null;
                    }
                }
                const res = await authedFetch('/api/provider-config', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ roles }),
                });
                if (!res.ok) {
                    const d = await res.json().catch(() => null);
                    throw new Error(d?.error || 'Lens 应用失败');
                }
            }

            await loadAll();
            showToast('已应用', 'success');
        } catch (err) {
            showToast(err?.message || '应用失败', 'error');
        } finally {
            setApplyingId('');
        }
    }, [applyingId, lensConfig.roles, loadAll, rtAgentData.agents, showToast]);

    const saveRtOverrides = useCallback(async () => {
        setSavingRt(true);
        try {
            const res = await authedFetch('/api/roundtable/agent-providers', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ overrides: rtDraft }),
            });
            const data = await res.json().catch(() => null);
            if (!res.ok) throw new Error(data?.error || '保存失败');
            await loadAll();
            showToast('Roundtable 角色映射已保存', 'success');
        } catch (err) {
            showToast(err?.message || '保存失败', 'error');
        } finally {
            setSavingRt(false);
        }
    }, [loadAll, rtDraft, showToast]);

    const saveLensConfig = useCallback(async () => {
        setSavingLens(true);
        try {
            const res = await authedFetch('/api/provider-config', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ roles: lensDraft }),
            });
            const data = await res.json().catch(() => null);
            if (!res.ok) throw new Error(data?.error || '保存失败');
            await loadAll();
            showToast('Lens 角色映射已保存', 'success');
        } catch (err) {
            showToast(err?.message || '保存失败', 'error');
        } finally {
            setSavingLens(false);
        }
    }, [lensDraft, loadAll, showToast]);

    useEffect(() => {
        loadAll();
        const handler = () => loadAll();
        socket.on('providers-updated', handler);
        return () => socket.off('providers-updated', handler);
    }, [loadAll, socket]);

    const providerList = useMemo(() => providers || [], [providers]);

    // 角色使用情况：provider id → 标签列表
    const rolesByProviderId = useMemo(() => {
        const map = {};
        for (const [role, pid] of Object.entries(lensConfig.roles || {})) {
            if (!pid) continue;
            if (!map[pid]) map[pid] = [];
            map[pid].push(LENS_ROLE_LABELS[role] || role);
        }
        for (const a of (rtAgentData.agents || [])) {
            const effectivePid = a.effectiveProviderRef;
            if (!effectivePid) continue;
            if (!map[effectivePid]) map[effectivePid] = [];
            if (!map[effectivePid].includes(a.name)) map[effectivePid].push(a.name);
        }
        return map;
    }, [lensConfig.roles, rtAgentData.agents]);

    const rtMainAgents = useMemo(
        () => (rtAgentData.agents || []).filter((a) => !a.isSubagent).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
        [rtAgentData.agents],
    );
    const rtSubagents = useMemo(
        () => (rtAgentData.agents || []).filter((a) => a.isSubagent).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
        [rtAgentData.agents],
    );
    const lensRoleKeys = useMemo(() => Object.keys(lensConfig.roles || {}), [lensConfig.roles]);

    // 合并保存：RT + Lens 改动都在一次操作里提交
    const saveAll = useCallback(async () => {
        setSavingRt(true);
        setSavingLens(true);
        try {
            await Promise.all([saveRtOverrides(), saveLensConfig()]);
        } finally {
            setSavingRt(false);
            setSavingLens(false);
        }
    }, [saveLensConfig, saveRtOverrides]);

    return (
        <div className="space-y-6">
            {/* 顶部标题 + 添加按钮 */}
            <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
                <div>
                    <div className="text-xs tracking-wide text-text-muted">AI Models Management</div>
                    <h1 className="text-2xl md:text-3xl font-bold mt-2">模型</h1>
                    <p className="text-sm text-text-muted mt-2">
                        管理 Provider 定义与密钥，密钥永不回显
                    </p>
                </div>
                <button type="button" onClick={() => setShowAddModal(true)} className="btn btn-primary">
                    <i className="fas fa-plus"></i>
                    添加 Provider
                </button>
            </div>

            {/* Provider 列表 */}
            {isLoading ? (
                <div className="card p-8 flex items-center justify-center">
                    <div className="flex items-center gap-3 text-text-muted">
                        <i className="fas fa-spinner fa-spin"></i>
                        <span className="text-sm">加载中...</span>
                    </div>
                </div>
            ) : providerList.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                    {providerList.map((provider) => (
                        <div key={provider.id} className="flex flex-col gap-2">
                            <ProviderCard
                                provider={provider}
                                usedRoles={rolesByProviderId[provider.id] || []}
                                onUpdate={updateProvider}
                                onDelete={deleteProvider}
                            />
                            {/* 复制 / 使用 操作栏 */}
                            <div className="flex items-center gap-2 px-1">
                                <button
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => copyProvider(provider.id)}
                                >
                                    <i className="fas fa-copy"></i>
                                    复制
                                </button>
                                <UseDropdown
                                    providerId={provider.id}
                                    providerName={provider.name}
                                    rtAgents={rtMainAgents}
                                    lensRoleKeys={lensRoleKeys}
                                    onApply={applyProvider}
                                    applying={applyingId === provider.id}
                                />
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="card card-hover p-10 text-center">
                    <div className="w-16 h-16 rounded-2xl bg-white/5 border border-border-light/10 flex items-center justify-center mx-auto">
                        <i className="fas fa-brain text-white/40 text-3xl"></i>
                    </div>
                    <h3 className="text-lg font-semibold mt-5">暂无 Provider</h3>
                    <p className="text-sm text-text-muted mt-2">点击上方按钮添加第一个 AI Provider</p>
                    <div className="mt-6">
                        <button type="button" onClick={() => setShowAddModal(true)} className="btn btn-primary">
                            <i className="fas fa-plus"></i>
                            添加 Provider
                        </button>
                    </div>
                </div>
            )}

            {/* 角色映射（页面下方，低频操作） */}
            {(rtMainAgents.length > 0 || rtSubagents.length > 0 || lensRoleKeys.length > 0) ? (
                <RoleMappingPanel
                    rtMainAgents={rtMainAgents}
                    rtSubagents={rtSubagents}
                    lensRoleKeys={lensRoleKeys}
                    rtDraft={rtDraft}
                    lensDraft={lensDraft}
                    providerList={providerList}
                    onRtChange={(name, pid) => setRtDraft((prev) => ({ ...prev, [name]: pid }))}
                    onLensChange={(role, pid) => setLensDraft((prev) => ({ ...prev, [role]: pid }))}
                    onResetRt={() => {
                        const reset = {};
                        for (const a of rtAgentData.agents) reset[a.name] = null;
                        setRtDraft(reset);
                    }}
                    onSave={saveAll}
                    saving={savingRt || savingLens}
                />
            ) : null}

            {/* 添加 Provider 弹窗 */}
            {showAddModal ? (
                <AddProviderModal
                    onClose={() => setShowAddModal(false)}
                    onCreate={createProvider}
                />
            ) : null}

            {/* Toast */}
            {toast.show ? (
                <div className="toast">
                    <i className={[
                        'fas',
                        toast.type === 'success' ? 'fa-check-circle text-success'
                            : toast.type === 'error' ? 'fa-exclamation-circle text-error'
                                : 'fa-info-circle text-accent-light',
                    ].join(' ')}></i>
                    <span className="text-sm text-text">{toast.message}</span>
                </div>
            ) : null}
        </div>
    );
}

// 单列展开式角色映射面板，视觉风格跟随 Battlefield sidebar
function RoleMappingPanel({
    rtMainAgents,
    rtSubagents,
    lensRoleKeys,
    rtDraft,
    lensDraft,
    providerList,
    onRtChange,
    onLensChange,
    onResetRt,
    onSave,
    saving,
}) {
    // 展开状态：同时只有一行展开
    const [expandedKey, setExpandedKey] = useState(null);

    const providerById = useMemo(() => {
        const map = {};
        for (const p of providerList) map[p.id] = p;
        return map;
    }, [providerList]);

    function getDraft(type, name, defaultRef) {
        if (type === 'rt') {
            const v = rtDraft[name];
            return v === undefined ? null : v;
        }
        return lensDraft[name] ?? null;
    }

    function assign(type, name, pid) {
        if (type === 'rt') onRtChange(name, pid === '' ? null : pid);
        else onLensChange(name, pid === '' ? null : pid);
    }

    function toggle(key) {
        setExpandedKey((prev) => (prev === key ? null : key));
    }

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <div>
                    <div className="text-xs tracking-wide text-text-muted">Role Mapping</div>
                    <h2 className="text-xl font-bold mt-1">角色映射</h2>
                </div>
                <div className="flex gap-2">
                    <button type="button" className="btn btn-secondary btn-sm" onClick={onResetRt}>
                        重置 Roundtable
                    </button>
                    <button type="button" className="btn btn-primary btn-sm" onClick={onSave} disabled={saving}>
                        <i className={saving ? 'fas fa-spinner fa-spin' : 'fas fa-save'}></i>
                        保存
                    </button>
                </div>
            </div>

            <div className="card p-4 space-y-4">
                {/* Roundtable 主 agents */}
                {rtMainAgents.length > 0 ? (
                    <RoleSection
                        label="Roundtable"
                        agents={rtMainAgents.map((a) => ({ type: 'rt', name: a.name, role: a.role, defaultRef: a.defaultProviderRef }))}
                        expandedKey={expandedKey}
                        onToggle={toggle}
                        getDraft={getDraft}
                        providerById={providerById}
                        providerList={providerList}
                        onAssign={assign}
                    />
                ) : null}

                {/* Roundtable subagents */}
                {rtSubagents.length > 0 ? (
                    <RoleSection
                        label="Subagents"
                        agents={rtSubagents.map((a) => ({ type: 'rt', name: a.name, role: a.role, defaultRef: a.defaultProviderRef }))}
                        expandedKey={expandedKey}
                        onToggle={toggle}
                        getDraft={getDraft}
                        providerById={providerById}
                        providerList={providerList}
                        onAssign={assign}
                    />
                ) : null}

                {/* Lens */}
                {lensRoleKeys.length > 0 ? (
                    <RoleSection
                        label="Lens"
                        agents={lensRoleKeys.map((k) => ({ type: 'lens', name: k, role: LENS_ROLE_LABELS[k] || k }))}
                        expandedKey={expandedKey}
                        onToggle={toggle}
                        getDraft={getDraft}
                        providerById={providerById}
                        providerList={providerList}
                        onAssign={assign}
                    />
                ) : null}
            </div>
        </div>
    );
}

function RoleSection({ label, agents, expandedKey, onToggle, getDraft, providerById, providerList, onAssign }) {
    return (
        <div className="space-y-1.5">
            <div className="text-[10px] tracking-[0.1em] uppercase font-semibold text-text-muted/50 px-1 pb-0.5">
                {label}
            </div>
            {agents.map((agent) => {
                const rowKey = `${agent.type}:${agent.name}`;
                const isExpanded = expandedKey === rowKey;
                const draftPid = getDraft(agent.type, agent.name, agent.defaultRef);
                // RT：null → 使用 defaultRef；Lens：null → 未设置
                const effectivePid = agent.type === 'rt' ? (draftPid ?? agent.defaultRef) : (draftPid ?? null);
                const currentProvider = effectivePid ? providerById[effectivePid] : null;
                const isOverridden = agent.type === 'rt' ? Boolean(draftPid) : Boolean(draftPid);

                // 展开时展示的「当前选中」pid（空字符串 = 清除/默认）
                const activePid = draftPid === null ? '' : draftPid;

                return (
                    <div key={rowKey} className="space-y-1">
                        {/* 角色行 */}
                        <button
                            type="button"
                            onClick={() => onToggle(rowKey)}
                            className={[
                                'rt-bf-agent-chip w-full',
                                isExpanded ? 'border-accent/30 bg-accent/6' : '',
                            ].join(' ')}
                        >
                            <span className={[
                                'rt-bf-avatar flex-shrink-0',
                                isOverridden ? 'rt-bf-camp-bull' : '',
                            ].join(' ')}>
                                {agent.name.slice(0, 1).toUpperCase()}
                            </span>

                            <span className="min-w-0 flex-1 text-left">
                                <span className="rt-bf-agent-name">{agent.name}</span>
                                <span className="rt-bf-agent-role">{agent.role}</span>
                            </span>

                            <span className="flex items-center gap-2 flex-shrink-0">
                                {currentProvider ? (
                                    <span className={['badge text-[10px]', isOverridden ? 'badge-accent' : 'badge-muted'].join(' ')}>
                                        {currentProvider.name}
                                    </span>
                                ) : (
                                    <span className="badge badge-muted text-[10px] text-text-muted/50">未设置</span>
                                )}
                                <i className={[
                                    'fas text-[10px] text-text-muted transition-transform',
                                    isExpanded ? 'fa-chevron-up' : 'fa-chevron-down',
                                ].join(' ')}></i>
                            </span>
                        </button>

                        {/* 展开的 provider 选择区 */}
                        {isExpanded ? (
                            <div className="rt-bf-panel ml-1 flex flex-wrap gap-1.5">
                                {/* 默认 / 清空选项 */}
                                <button
                                    type="button"
                                    onClick={() => onAssign(agent.type, agent.name, '')}
                                    className={[
                                        'text-xs rounded-full border px-2.5 py-0.5 transition-all',
                                        activePid === ''
                                            ? 'border-accent/60 bg-accent/15 text-text'
                                            : 'border-border-light/15 bg-white/5 text-text-muted hover:border-white/20 hover:text-text',
                                    ].join(' ')}
                                >
                                    {agent.type === 'rt' ? `默认 (${agent.defaultRef ?? '—'})` : '不使用'}
                                </button>

                                {/* Provider 选项 */}
                                {providerList.map((p) => {
                                    const isActive = activePid === p.id;
                                    return (
                                        <button
                                            key={p.id}
                                            type="button"
                                            onClick={() => onAssign(agent.type, agent.name, p.id)}
                                            className={[
                                                'text-xs rounded-full border px-2.5 py-0.5 transition-all flex items-center gap-1.5',
                                                isActive
                                                    ? 'border-accent/60 bg-accent/15 text-text'
                                                    : 'border-border-light/15 bg-white/5 text-text-muted hover:border-white/20 hover:text-text',
                                            ].join(' ')}
                                        >
                                            {p.name}
                                            {!p.hasKey ? (
                                                <i className="fas fa-exclamation-triangle text-[9px] text-error/80"></i>
                                            ) : null}
                                        </button>
                                    );
                                })}
                            </div>
                        ) : null}
                    </div>
                );
            })}
        </div>
    );
}
