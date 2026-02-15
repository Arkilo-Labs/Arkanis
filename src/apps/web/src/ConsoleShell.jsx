import { useCallback, useEffect, useMemo, useState } from 'react';
import AppShell from './components/AppShell.jsx';
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
    const { logout, status } = useAuth();
    const { socket } = useSocket();

    const tabs = useMemo(
        () => [
            { id: 'main', label: '策略' },
            { id: 'run', label: '自动运行' },
            { id: 'backtest', label: '回测' },
            { id: 'config', label: '配置' },
            { id: 'ai-providers', label: '模型' },
        ],
        [],
    );

    const userLabel = useMemo(() => {
        if (status?.user?.username) return status.user.username;
        if (status?.allowNoAuth) return '免登录';
        return '管理员';
    }, [status?.allowNoAuth, status?.user?.username]);

    const showToast = useCallback((message, type = 'info') => {
        setToast({ show: true, message, type });
        window.setTimeout(() => {
            setToast((prev) => ({ ...prev, show: false }));
        }, 3000);
    }, []);

    useEffect(() => {
        function onConfigReload(data) {
            const file = String(data?.file || '').trim();
            const fileName =
                file === '.env'
                    ? '环境配置'
                    : file === 'ai-providers.json'
                      ? 'Provider 定义'
                      : file === 'secrets.json'
                        ? '密钥配置'
                        : file === 'provider-config.json'
                          ? 'Provider 角色配置'
                          : '配置';
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
            <AppShell
                tabs={tabs}
                currentTab={currentTab}
                onTabChange={setCurrentTab}
                userLabel={userLabel}
                onLogout={onLogout}
            >
                <div className="space-y-6">
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
                </div>
            </AppShell>

            {toast.show ? (
                <div className="toast">
                    <i
                        className={[
                            'fas',
                            toast.type === 'success'
                                ? 'fa-check-circle text-green-400'
                                : toast.type === 'error'
                                  ? 'fa-exclamation-circle text-red-400'
                                  : 'fa-info-circle text-orange-400',
                        ].join(' ')}
                    ></i>
                    <span className="text-sm text-text">{toast.message}</span>
                </div>
            ) : null}
        </>
    );
}
