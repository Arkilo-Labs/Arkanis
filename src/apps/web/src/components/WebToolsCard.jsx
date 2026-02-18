import { useCallback, useEffect, useState } from 'react';
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

function ProviderTab({ providers, selected, onChange }) {
    return (
        <div className="flex gap-1 p-1 bg-bg-deep/50 rounded-lg w-fit">
            {providers.map((p) => (
                <button
                    key={p.id}
                    type="button"
                    onClick={() => onChange(p.id)}
                    className={[
                        'px-3 py-1.5 rounded-md text-xs font-medium transition-all',
                        selected === p.id
                            ? 'bg-accent text-white shadow-sm'
                            : 'text-text-muted hover:text-text',
                    ].join(' ')}
                >
                    {p.label}
                    <span className="ml-1 opacity-60 text-[10px]">{p.desc}</span>
                </button>
            ))}
        </div>
    );
}

export default function WebToolsCard() {
    const [settings, setSettings] = useState(DEFAULT_SETTINGS);
    const [keyStatus, setKeyStatus] = useState({ tavily: { hasKey: false }, jina: { hasKey: false }, firecrawl: { hasKey: false } });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [keySaving, setKeySaving] = useState('');
    const [status, setStatus] = useState(null); // 'success' | 'error' | null

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [resSettings, resKeys] = await Promise.all([
                authedFetch('/api/web-tools/settings'),
                authedFetch('/api/web-tools/keys/status'),
            ]);
            const settingsData = await resSettings.json();
            const keysData = await resKeys.json();
            if (settingsData.settings) setSettings(settingsData.settings);
            if (keysData.status) setKeyStatus(keysData.status);
        } catch (e) {
            console.error('[WebToolsCard] 加载失败', e);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const save = useCallback(async () => {
        setSaving(true);
        setStatus(null);
        try {
            const res = await authedFetch('/api/web-tools/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ settings }),
            });
            const data = await res.json();
            if (data.error) throw new Error(data.error);
            setStatus('success');
            window.setTimeout(() => setStatus(null), 3000);
        } catch {
            setStatus('error');
        } finally {
            setSaving(false);
        }
    }, [settings]);

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
        setSettings((prev) => {
            if (path.includes('.')) {
                const [top, key] = path.split('.');
                return { ...prev, [top]: { ...prev[top], [key]: value } };
            }
            return { ...prev, [path]: value };
        });
    }

    return (
        <div className="card p-6">
            <div className="flex items-center justify-between gap-4 mb-6 pb-4 border-b border-border-light/10">
                <div className="flex items-center gap-2">
                    <i className="fas fa-globe"></i>
                    <span className="text-sm font-semibold">Web 工具</span>
                </div>
                <span className="text-xs text-text-muted">search &amp; fetch providers</span>
            </div>

            {loading ? (
                <div className="flex items-center gap-3 text-text-muted py-4">
                    <i className="fas fa-spinner fa-spin"></i>
                    <span className="text-sm">加载中...</span>
                </div>
            ) : (
                <>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                        {/* Search Provider */}
                        <div className="space-y-4">
                            <div className="text-xs font-semibold text-text-muted uppercase tracking-wide">
                                搜索 (Web Search)
                            </div>
                            <ProviderTab
                                providers={SEARCH_PROVIDERS}
                                selected={settings.search_provider}
                                onChange={(v) => patchSettings('search_provider', v)}
                            />

                            {settings.search_provider === 'searxng' && (
                                <div className="space-y-3 pt-1">
                                    <div>
                                        <label className="form-label">Base URL</label>
                                        <input
                                            className="form-input font-mono text-sm"
                                            value={settings.searxng?.base_url ?? ''}
                                            onChange={(e) => patchSettings('searxng.base_url', e.target.value)}
                                            placeholder="http://localhost:8080"
                                        />
                                    </div>
                                    <div>
                                        <label className="form-label">Docker Fallback Container</label>
                                        <input
                                            className="form-input font-mono text-sm"
                                            value={settings.searxng?.docker_fallback_container ?? ''}
                                            onChange={(e) => patchSettings('searxng.docker_fallback_container', e.target.value)}
                                            placeholder="searxng"
                                        />
                                    </div>
                                    <div>
                                        <label className="form-label">Timeout (ms)</label>
                                        <input
                                            type="number"
                                            className="form-input font-mono text-sm"
                                            value={settings.searxng?.timeout_ms ?? 15000}
                                            onChange={(e) => patchSettings('searxng.timeout_ms', Number(e.target.value))}
                                        />
                                    </div>
                                </div>
                            )}

                            {settings.search_provider === 'tavily' && (
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
                                            value={settings.tavily?.timeout_ms ?? 15000}
                                            onChange={(e) => patchSettings('tavily.timeout_ms', Number(e.target.value))}
                                        />
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Fetch Provider */}
                        <div className="space-y-4">
                            <div className="text-xs font-semibold text-text-muted uppercase tracking-wide">
                                抓取 (Web Fetch)
                            </div>
                            <ProviderTab
                                providers={FETCH_PROVIDERS}
                                selected={settings.fetch_provider}
                                onChange={(v) => patchSettings('fetch_provider', v)}
                            />

                            {settings.fetch_provider === 'firecrawl' && (
                                <div className="space-y-3 pt-1">
                                    <div>
                                        <label className="form-label">Base URL</label>
                                        <input
                                            className="form-input font-mono text-sm"
                                            value={settings.firecrawl?.base_url ?? ''}
                                            onChange={(e) => patchSettings('firecrawl.base_url', e.target.value)}
                                            placeholder="http://localhost:3002"
                                        />
                                    </div>
                                    <div>
                                        <label className="form-label">Timeout (ms)</label>
                                        <input
                                            type="number"
                                            className="form-input font-mono text-sm"
                                            value={settings.firecrawl?.timeout_ms ?? 30000}
                                            onChange={(e) => patchSettings('firecrawl.timeout_ms', Number(e.target.value))}
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
                            )}

                            {settings.fetch_provider === 'jina' && (
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
                                            value={settings.jina?.base_url ?? ''}
                                            onChange={(e) => patchSettings('jina.base_url', e.target.value)}
                                            placeholder="https://r.jina.ai"
                                        />
                                    </div>
                                    <div>
                                        <label className="form-label">Timeout (ms)</label>
                                        <input
                                            type="number"
                                            className="form-input font-mono text-sm"
                                            value={settings.jina?.timeout_ms ?? 30000}
                                            onChange={(e) => patchSettings('jina.timeout_ms', Number(e.target.value))}
                                        />
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="mt-6 pt-4 border-t border-border-light/10 flex items-center justify-between gap-4">
                        {status === 'success' ? (
                            <span className="text-xs text-success flex items-center gap-1.5">
                                <i className="fas fa-check-circle"></i>已保存
                            </span>
                        ) : status === 'error' ? (
                            <span className="text-xs text-error flex items-center gap-1.5">
                                <i className="fas fa-exclamation-circle"></i>保存失败
                            </span>
                        ) : (
                            <span className="text-xs text-text-muted">
                                修改 Provider 或 URL 后点击保存
                            </span>
                        )}
                        <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            onClick={save}
                            disabled={saving}
                        >
                            <i className={saving ? 'fas fa-spinner fa-spin' : 'fas fa-save'}></i>
                            保存
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}
