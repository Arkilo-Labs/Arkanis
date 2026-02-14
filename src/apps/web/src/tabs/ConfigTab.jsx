import { useCallback, useEffect, useMemo, useState } from 'react';
import CustomSelect from '../components/CustomSelect.jsx';
import { authedFetch } from '../composables/useAuth.js';

const groupIcons = {
    database: 'fas fa-database',
    vlm: 'fas fa-magic',
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

    const getSelectOptions = useCallback(
        (key) => {
            const options = selectOptions[key] || [];
            return options.map((opt) => ({ value: opt, label: opt }));
        },
        [selectOptions],
    );

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
            <div className="glass-card p-8 animate-slide-up">
                <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
                    <div>
                        <span className="text-subtitle-en mb-2 block">Environment Variables</span>
                        <h1 className="text-hero-cn text-apple-gradient">系统配置</h1>
                    </div>
                    <div className="flex items-center gap-4">
                        <button
                            type="button"
                            onClick={saveConfig}
                            disabled={isSaving}
                            className="btn-glass h-14 px-8"
                        >
                            <i className={isSaving ? 'fas fa-spinner fa-spin' : 'fas fa-save'}></i>
                            <span className="font-bold">保存配置</span>
                        </button>
                    </div>
                </div>
            </div>

            {saveStatus === 'success' ? (
                <div className="glass-card p-4 flex items-center gap-3 border-green-500/30">
                    <i className="fas fa-check-circle text-green-400"></i>
                    <span className="text-green-400">
                        保存成功，重启后生效 Saved. Restart to apply.
                    </span>
                </div>
            ) : saveStatus === 'error' ? (
                <div className="glass-card p-4 flex items-center gap-3 border-red-500/30">
                    <i className="fas fa-exclamation-circle text-red-400"></i>
                    <span className="text-red-400">保存失败 Failed to save.</span>
                </div>
            ) : null}

            {isLoading ? (
                <div className="flex justify-center py-20">
                    <div className="flex flex-col items-center gap-4">
                        <i className="fas fa-spinner fa-spin text-4xl text-white/30"></i>
                        <span className="text-white/50">Loading configuration...</span>
                    </div>
                </div>
            ) : (
                <div className="space-y-6">
                    {schemaEntries.map(([groupKey, group]) => (
                        <div key={groupKey} className="glass-card p-6 animate-slide-up">
                            <h2 className="text-label flex items-center gap-2 mb-6 pb-4 border-b border-white/10">
                                <i className={groupIcons[groupKey] || 'fas fa-sliders-h'}></i>
                                {group.label}
                            </h2>

                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                {group.items.map((key) => (
                                    <div key={key}>
                                        <label
                                            className="text-label block mb-2 truncate"
                                            title={key}
                                        >
                                            {key}
                                        </label>
                                        {hasSelectOptions(key) ? (
                                            <CustomSelect
                                                value={config[key] ?? ''}
                                                options={getSelectOptions(key)}
                                                onChange={(nextValue) =>
                                                    setConfig((prev) => ({
                                                        ...prev,
                                                        [key]: nextValue,
                                                    }))
                                                }
                                            />
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
                                                className="input-glass font-mono text-sm"
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
