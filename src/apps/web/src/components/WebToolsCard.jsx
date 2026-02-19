import { useCallback, useEffect, useMemo, useState } from 'react';
import { authedFetch } from '../composables/useAuth.js';

const SEARCH_PROVIDERS = [
    { id: 'searxng', label: 'SearXNG', desc: '开源自部署' },
    { id: 'tavily', label: 'Tavily', desc: 'SaaS' },
];

const FETCH_PROVIDERS = [
    { id: 'firecrawl', label: 'Firecrawl', desc: '开源自部署 / SaaS' },
    { id: 'jina', label: 'Jina', desc: 'SaaS' },
];

const DEFAULT_SETTINGS = {
    search_provider: 'searxng',
    fetch_provider: 'firecrawl',
    searxng: { base_url: 'http://localhost:8080', timeout_ms: 15000, docker_fallback_container: 'searxng' },
    tavily: { timeout_ms: 15000 },
    firecrawl: { base_url: 'http://localhost:3002', timeout_ms: 30000 },
    jina: { base_url: 'https://r.jina.ai', timeout_ms: 30000 },
};

function KeyRow({ service, label, hasKey, onSet, onDelete, saving }) {
    const [editing, setEditing] = useState(false);
    const [value, setValue] = useState('');

    function handleSet() {
        if (!value.trim()) return;
        onSet(service, value.trim());
        setValue('');
        setEditing(false);
    }

    function handleDelete() {
        if (!confirm(`确定清除 ${label} API Key？`)) return;
        onDelete(service);
    }

    return (
        <div className="flex flex-col gap-2">
            <label className="form-label">{label} API Key</label>
            {hasKey && !editing ? (
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="badge badge-success">已配置</span>
                    <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => setEditing(true)}
                        disabled={saving}
                    >
                        更新
                    </button>
                    <button
                        type="button"
                        className="btn btn-sm"
                        style={{ borderColor: 'var(--color-error)', color: 'var(--color-error)' }}
                        onClick={handleDelete}
                        disabled={saving}
                    >
                        清除
                    </button>
                </div>
            ) : (
                <div className="flex gap-2">
                    <input
                        type="password"
                        className="form-input flex-1 font-mono text-sm"
                        placeholder={hasKey ? '输入新 Key 覆盖...' : '输入 API Key...'}
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSet()}
                        autoComplete="off"
                    />
                    <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={handleSet}
                        disabled={!value.trim() || saving}
                    >
                        {saving ? <i className="fas fa-spinner fa-spin"></i> : '设置'}
                    </button>
                    {hasKey && (
                        <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => { setEditing(false); setValue(''); }}
                        >
                            取消
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}

function ProviderSelect({ providers, selected, onChange, disabled }) {
    return (
        <select
            value={selected}
            onChange={(e) => onChange(e.target.value)}
            className="form-input font-mono text-sm"
            disabled={disabled}
        >
            {providers.map((p) => (
                <option key={p.id} value={p.id}>
                    {p.label}
                </option>
            ))}
        </select>
    );
}

export default function WebToolsCard({ settings, onSettingsChange, isSaving = false }) {
    const [keyStatus, setKeyStatus] = useState({ tavily: { hasKey: false }, jina: { hasKey: false }, firecrawl: { hasKey: false } });
    const [keysLoading, setKeysLoading] = useState(true);
    const [keySaving, setKeySaving] = useState('');

    const resolvedSettings = useMemo(() => {
        if (settings && typeof settings === 'object') return settings;
        return null;
    }, [settings]);

    const isLoading = !resolvedSettings || keysLoading;

    const loadKeys = useCallback(async () => {
        setKeysLoading(true);
        try {
            const resKeys = await authedFetch('/api/web-tools/keys/status');
            const keysData = await resKeys.json();
            if (keysData.status) setKeyStatus(keysData.status);
        } catch (e) {
            console.error('[WebToolsCard] Key 状态加载失败', e);
        } finally {
            setKeysLoading(false);
        }
    }, []);

    useEffect(() => { loadKeys(); }, [loadKeys]);

    const setKey = useCallback(async (service, apiKey) => {
        setKeySaving(service);
        try {
            const res = await authedFetch(`/api/web-tools/keys/${service}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ apiKey }),
            });
            const data = await res.json();
            if (data.error) throw new Error(data.error);
            setKeyStatus((prev) => ({ ...prev, [service]: { hasKey: true } }));
        } catch (e) {
            alert(`设置 ${service} Key 失败：${e.message}`);
        } finally {
            setKeySaving('');
        }
    }, []);

    const deleteKey = useCallback(async (service) => {
        setKeySaving(service);
        try {
            const res = await authedFetch(`/api/web-tools/keys/${service}`, { method: 'DELETE' });
            const data = await res.json();
            if (data.error) throw new Error(data.error);
            setKeyStatus((prev) => ({ ...prev, [service]: { hasKey: false } }));
        } catch (e) {
            alert(`清除 ${service} Key 失败：${e.message}`);
        } finally {
            setKeySaving('');
        }
    }, []);

    function patchSettings(path, value) {
        if (!onSettingsChange) return;
        onSettingsChange((prev) => {
            const base = prev ?? resolvedSettings ?? DEFAULT_SETTINGS;
            if (!base || typeof base !== 'object') return base;

            if (path.includes('.')) {
                const [top, key] = path.split('.');
                return { ...base, [top]: { ...(base[top] || {}), [key]: value } };
            }
            return { ...base, [path]: value };
        });
    }

    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="card p-6">
                <div className="flex items-center justify-between gap-4 mb-6 pb-4 border-b border-border-light/10">
                    <div className="flex items-center gap-2">
                        <i className="fas fa-search"></i>
                        <span className="text-sm font-semibold">搜索</span>
                    </div>
                </div>

                {isLoading ? (
                    <div className="flex items-center gap-3 text-text-muted py-4">
                        <i className="fas fa-spinner fa-spin"></i>
                        <span className="text-sm">加载中...</span>
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div>
                            <label className="form-label">Provider</label>
                            <ProviderSelect
                                providers={SEARCH_PROVIDERS}
                                selected={resolvedSettings.search_provider}
                                onChange={(v) => patchSettings('search_provider', v)}
                                disabled={isSaving}
                            />
                        </div>

                        {resolvedSettings.search_provider === 'searxng' ? (
                            <div className="space-y-3 pt-1">
                                <div>
                                    <label className="form-label">Base URL</label>
                                    <input
                                        className="form-input font-mono text-sm"
                                        value={resolvedSettings.searxng?.base_url ?? ''}
                                        onChange={(e) => patchSettings('searxng.base_url', e.target.value)}
                                        placeholder="http://localhost:8080"
                                        disabled={isSaving}
                                    />
                                </div>
                                <div>
                                    <label className="form-label">Docker Fallback Container</label>
                                    <input
                                        className="form-input font-mono text-sm"
                                        value={resolvedSettings.searxng?.docker_fallback_container ?? ''}
                                        onChange={(e) => patchSettings('searxng.docker_fallback_container', e.target.value)}
                                        placeholder="searxng"
                                        disabled={isSaving}
                                    />
                                </div>
                                <div>
                                    <label className="form-label">Timeout (ms)</label>
                                    <input
                                        type="number"
                                        className="form-input font-mono text-sm"
                                        value={resolvedSettings.searxng?.timeout_ms ?? 15000}
                                        onChange={(e) => patchSettings('searxng.timeout_ms', Number(e.target.value))}
                                        disabled={isSaving}
                                    />
                                </div>
                            </div>
                        ) : resolvedSettings.search_provider === 'tavily' ? (
                            <div className="space-y-3 pt-1">
                                <KeyRow
                                    service="tavily"
                                    label="Tavily"
                                    hasKey={keyStatus.tavily?.hasKey}
                                    onSet={setKey}
                                    onDelete={deleteKey}
                                    saving={keySaving === 'tavily'}
                                />
                                <div>
                                    <label className="form-label">Timeout (ms)</label>
                                    <input
                                        type="number"
                                        className="form-input font-mono text-sm"
                                        value={resolvedSettings.tavily?.timeout_ms ?? 15000}
                                        onChange={(e) => patchSettings('tavily.timeout_ms', Number(e.target.value))}
                                        disabled={isSaving}
                                    />
                                </div>
                            </div>
                        ) : null}
                    </div>
                )}
            </div>

            <div className="card p-6">
                <div className="flex items-center justify-between gap-4 mb-6 pb-4 border-b border-border-light/10">
                    <div className="flex items-center gap-2">
                        <i className="fas fa-download"></i>
                        <span className="text-sm font-semibold">抓取</span>
                    </div>
                </div>

                {isLoading ? (
                    <div className="flex items-center gap-3 text-text-muted py-4">
                        <i className="fas fa-spinner fa-spin"></i>
                        <span className="text-sm">加载中...</span>
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div>
                            <label className="form-label">Provider</label>
                            <ProviderSelect
                                providers={FETCH_PROVIDERS}
                                selected={resolvedSettings.fetch_provider}
                                onChange={(v) => patchSettings('fetch_provider', v)}
                                disabled={isSaving}
                            />
                        </div>

                        {resolvedSettings.fetch_provider === 'firecrawl' ? (
                            <div className="space-y-3 pt-1">
                                <div>
                                    <label className="form-label">Base URL</label>
                                    <input
                                        className="form-input font-mono text-sm"
                                        value={resolvedSettings.firecrawl?.base_url ?? ''}
                                        onChange={(e) => patchSettings('firecrawl.base_url', e.target.value)}
                                        placeholder="http://localhost:3002"
                                        disabled={isSaving}
                                    />
                                </div>
                                <div>
                                    <label className="form-label">Timeout (ms)</label>
                                    <input
                                        type="number"
                                        className="form-input font-mono text-sm"
                                        value={resolvedSettings.firecrawl?.timeout_ms ?? 30000}
                                        onChange={(e) => patchSettings('firecrawl.timeout_ms', Number(e.target.value))}
                                        disabled={isSaving}
                                    />
                                </div>
                                <KeyRow
                                    service="firecrawl"
                                    label="Firecrawl"
                                    hasKey={keyStatus.firecrawl?.hasKey}
                                    onSet={setKey}
                                    onDelete={deleteKey}
                                    saving={keySaving === 'firecrawl'}
                                />
                            </div>
                        ) : resolvedSettings.fetch_provider === 'jina' ? (
                            <div className="space-y-3 pt-1">
                                <KeyRow
                                    service="jina"
                                    label="Jina"
                                    hasKey={keyStatus.jina?.hasKey}
                                    onSet={setKey}
                                    onDelete={deleteKey}
                                    saving={keySaving === 'jina'}
                                />
                                <div>
                                    <label className="form-label">Base URL</label>
                                    <input
                                        className="form-input font-mono text-sm"
                                        value={resolvedSettings.jina?.base_url ?? ''}
                                        onChange={(e) => patchSettings('jina.base_url', e.target.value)}
                                        placeholder="https://r.jina.ai"
                                        disabled={isSaving}
                                    />
                                </div>
                                <div>
                                    <label className="form-label">Timeout (ms)</label>
                                    <input
                                        type="number"
                                        className="form-input font-mono text-sm"
                                        value={resolvedSettings.jina?.timeout_ms ?? 30000}
                                        onChange={(e) => patchSettings('jina.timeout_ms', Number(e.target.value))}
                                        disabled={isSaving}
                                    />
                                </div>
                            </div>
                        ) : null}
                    </div>
                )}
            </div>
        </div>
    );
}
