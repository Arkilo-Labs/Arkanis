import { useCallback, useEffect, useMemo, useState } from 'react';
import AIProvidersTab from './tabs/AIProvidersTab.jsx';
import BacktestTab from './tabs/BacktestTab.jsx';
import ConfigTab from './tabs/ConfigTab.jsx';
import MainTab from './tabs/MainTab.jsx';
import RunTab from './tabs/RunTab.jsx';
import { useAuth } from './composables/useAuth.js';
import { useSocket } from './composables/useSocket.js';

export default function ConsoleShell() {
    const [currentTab, setCurrentTab] = useState('main');
    const [toast, setToast] = useState({ show: false, message: '', type: 'info' });
    const { logout } = useAuth();
    const { socket } = useSocket();

    const tabs = useMemo(
        () => [
            { id: 'main', label: '策略', labelEn: 'Strategy', icon: 'fas fa-chart-line' },
            { id: 'run', label: '自动运行', labelEn: 'Run', icon: 'fas fa-robot' },
            { id: 'backtest', label: '回测', labelEn: 'Backtest', icon: 'fas fa-history' },
            { id: 'config', label: '配置', labelEn: 'Config', icon: 'fas fa-cog' },
            { id: 'ai-providers', label: 'AI Provider', labelEn: 'AI Models', icon: 'fas fa-brain' },
        ],
        [],
    );

    const showToast = useCallback((message, type = 'info') => {
        setToast({ show: true, message, type });
        window.setTimeout(() => {
            setToast((prev) => ({ ...prev, show: false }));
        }, 3000);
    }, []);

    useEffect(() => {
        function onConfigReload(data) {
            const fileName = data?.file === '.env' ? '环境配置' : '桥接配置';
            showToast(`${fileName}已更新，脚本将自动使用新配置`, 'success');
        }

        socket.on('config-reload', onConfigReload);
        return () => socket.off('config-reload', onConfigReload);
    }, [showToast, socket]);

    const onLogout = useCallback(async () => {
        await logout().catch(() => null);
        setCurrentTab('main');
        showToast('已登出', 'success');
    }, [logout, showToast]);

    return (
        <>
            <header className="fixed top-0 left-0 right-0 z-50">
                <div className="glass-card !rounded-none !border-x-0 !border-t-0 !rounded-b-2xl mx-4 mt-0">
                    <div className="max-w-[1800px] mx-auto px-6 h-16 flex justify-between items-center">
                        <div>
                            <h1 className="text-lg font-bold text-white tracking-tight">
                                VLM Trade
                            </h1>
                            <span className="text-subtitle-en text-[10px] opacity-60">
                                AI Trading Analysis
                            </span>
                        </div>

                        <nav className="flex gap-1 p-1 rounded-xl bg-white/5 backdrop-blur-sm border border-white/10">
                            {tabs.map((tab) => (
                                <button
                                    key={tab.id}
                                    type="button"
                                    onClick={() => setCurrentTab(tab.id)}
                                    className={[
                                        'menu-item px-4 py-2 text-sm font-medium transition-all duration-200 flex items-center gap-2',
                                        currentTab === tab.id
                                            ? 'active text-white'
                                            : 'text-white/50 hover:text-white/80',
                                    ].join(' ')}
                                >
                                    <i className={`${tab.icon} text-xs`}></i>
                                    <span className="font-semibold">{tab.label}</span>
                                    <span className="text-[10px] opacity-50 hidden sm:inline">
                                        {tab.labelEn}
                                    </span>
                                </button>
                            ))}
                        </nav>

                        <div className="flex items-center gap-4">
                            <div className="hidden md:flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                                <span className="text-xs text-white/50">Online</span>
                            </div>

                            <div className="flex items-center gap-3">
                                <a
                                    href="https://x.com/qqqqqf5"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="social-icon-link"
                                >
                                    <i className="fa-brands fa-x-twitter"></i>
                                </a>
                                <a
                                    href="https://github.com/qqqqqf-q"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="social-icon-link"
                                >
                                    <i className="fab fa-github"></i>
                                </a>
                            </div>

                            <button
                                type="button"
                                className="btn-glass-secondary h-10 px-4"
                                onClick={onLogout}
                            >
                                <i className="fas fa-arrow-right-from-bracket"></i>
                                <span className="font-semibold">登出</span>
                            </button>
                        </div>
                    </div>
                </div>
            </header>

            <main className="max-w-[1800px] mx-auto pt-24 px-4 pb-8">
                <div className={currentTab === 'main' ? '' : 'hidden'}>
                    <MainTab />
                </div>
                <div className={currentTab === 'run' ? '' : 'hidden'}>
                    <RunTab />
                </div>
                <div className={currentTab === 'backtest' ? '' : 'hidden'}>
                    <BacktestTab />
                </div>
                <div className={currentTab === 'config' ? '' : 'hidden'}>
                    <ConfigTab />
                </div>
                <div className={currentTab === 'ai-providers' ? '' : 'hidden'}>
                    <AIProvidersTab />
                </div>
            </main>

            <div className="fixed bottom-0 left-0 right-0 h-24 pointer-events-none bg-gradient-to-t from-[#0a0a0f] to-transparent"></div>

            {toast.show ? (
                <div className="fixed top-24 right-4 z-50 glass-card px-6 py-3 flex items-center gap-3 shadow-xl animate-slide-up">
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
        </>
    );
}
