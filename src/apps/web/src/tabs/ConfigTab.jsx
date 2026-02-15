import { useCallback, useEffect, useMemo, useState } from 'react';
import { authedFetch } from '../composables/useAuth.js';

const groupIcons = {
    database: 'fas fa-database',
    lens: 'fas fa-magic',
    chart: 'fas fa-chart-bar',
    log: 'fas fa-file-alt',
    defaults: 'fas fa-sliders-h',
};

const inputTypes = {
    DB_PORT: 'number',
    DB_POOL_MIN: 'number',
    DB_POOL_MAX: 'number',
    DB_PASSWORD: 'password',
    CHART_WIDTH: 'number',
    CHART_HEIGHT: 'number',
    CHART_VOLUME_PANE_HEIGHT: 'number',
    DEFAULT_BARS: 'number',
};

export default function ConfigTab() {
    const [config, setConfig] = useState({});
    const [schema, setSchema] = useState({});
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [saveStatus, setSaveStatus] = useState(null);

    const [selectOptions, setSelectOptions] = useState({
        LOG_LEVEL: ['debug', 'info', 'warn', 'error', 'silent'],
        DEFAULT_TIMEFRAME: ['1m', '5m', '15m', '30m', '1h', '4h', '1d'],
        PROMPT_NAME: ['default'],
    });

    const hasSelectOptions = useCallback((key) => key in selectOptions, [selectOptions]);
    const getInputType = useCallback((key) => inputTypes[key] || 'text', []);

    const loadConfig = useCallback(async () => {
        setIsLoading(true);
        try {
            const [resConfig, resPrompts] = await Promise.all([
                authedFetch('/api/config'),
                authedFetch('/api/prompts'),
            ]);

            const data = await resConfig.json();
            if (data.error) throw new Error(data.error);
            setConfig(data.config);
            setSchema(data.schema);

            const prompts = await resPrompts.json();
            if (Array.isArray(prompts)) {
                setSelectOptions((prev) => ({ ...prev, PROMPT_NAME: prompts }));
            }
        } catch (e) {
            console.error(e);
        } finally {
            setIsLoading(false);
        }
    }, []);

    const saveConfig = useCallback(async () => {
        setIsSaving(true);
        setSaveStatus(null);
        try {
            const res = await authedFetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ config }),
            });
            const data = await res.json();
            if (data.error) throw new Error(data.error);
            setSaveStatus('success');
            window.setTimeout(() => setSaveStatus(null), 3000);
        } catch {
            setSaveStatus('error');
        } finally {
            setIsSaving(false);
        }
    }, [config]);

    useEffect(() => {
        loadConfig();
    }, [loadConfig]);

    const schemaEntries = useMemo(() => Object.entries(schema || {}), [schema]);

    return (
        <div className="space-y-6">
            <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
                <div>
                    <div className="text-xs tracking-wide text-text-muted">
                        Environment Variables
                    </div>
                    <h1 className="text-2xl md:text-3xl font-bold mt-2">
                        系统配置
                    </h1>
                </div>

                <button
                    type="button"
                    onClick={saveConfig}
                    disabled={isSaving}
                    className="btn btn-primary"
                >
                    <i className={isSaving ? 'fas fa-spinner fa-spin' : 'fas fa-save'}></i>
                    保存配置
                </button>
            </div>

            {saveStatus === 'success' ? (
                <div className="card p-4 border-success/25 bg-success/10">
                    <div className="flex items-center gap-3 text-success">
                        <i className="fas fa-check-circle"></i>
                        <span className="text-sm font-medium">
                            保存成功，重启后生效
                        </span>
                    </div>
                </div>
            ) : saveStatus === 'error' ? (
                <div className="card p-4 border-error/25 bg-error/10">
                    <div className="flex items-center gap-3 text-error">
                        <i className="fas fa-exclamation-circle"></i>
                        <span className="text-sm font-medium">保存失败</span>
                    </div>
                </div>
            ) : null}

            {isLoading ? (
                <div className="card p-8 flex items-center justify-center">
                    <div className="flex items-center gap-3 text-text-muted">
                        <i className="fas fa-spinner fa-spin"></i>
                        <span className="text-sm">Loading configuration...</span>
                    </div>
                </div>
            ) : (
                <div className="space-y-6">
                    {schemaEntries.map(([groupKey, group]) => (
                        <div key={groupKey} className="card card-hover p-6">
                            <div className="flex items-center justify-between gap-4 mb-4 pb-4 border-b border-border-light/10">
                                <div className="flex items-center gap-2">
                                    <i className={groupIcons[groupKey] || 'fas fa-sliders-h'}></i>
                                    <span className="text-sm font-semibold">
                                        {group.label}
                                    </span>
                                </div>
                                <span className="text-xs text-text-muted">
                                    {groupKey}
                                </span>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                {group.items.map((key) => (
                                    <div key={key}>
                                        <label className="form-label truncate" title={key}>
                                            {key}
                                        </label>
                                        {hasSelectOptions(key) ? (
                                            <select
                                                value={config[key] ?? ''}
                                                onChange={(e) =>
                                                    setConfig((prev) => ({
                                                        ...prev,
                                                        [key]: e.target.value,
                                                    }))
                                                }
                                                className="form-input font-mono text-sm"
                                            >
                                                {(selectOptions[key] || []).map((opt) => (
                                                    <option key={opt} value={opt}>
                                                        {opt}
                                                    </option>
                                                ))}
                                            </select>
                                        ) : (
                                            <input
                                                value={config[key] ?? ''}
                                                onChange={(e) =>
                                                    setConfig((prev) => ({
                                                        ...prev,
                                                        [key]: e.target.value,
                                                    }))
                                                }
                                                type={getInputType(key)}
                                                className="form-input font-mono text-sm"
                                            />
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
