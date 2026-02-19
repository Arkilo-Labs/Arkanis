import { useCallback, useEffect, useMemo, useState } from 'react';
import AppShell from './components/AppShell.jsx';
import AIProvidersTab from './tabs/AIProvidersTab.jsx';
import ConfigTab from './tabs/ConfigTab.jsx';
import MainTab from './tabs/MainTab.jsx';
import RoundtableTab from './tabs/RoundtableTab.jsx';
import { authedFetch, useAuth } from './composables/useAuth.js';
import { useSocket } from './composables/useSocket.js';

export default function ConsoleShell() {
  const [currentTab, setCurrentTab] = useState('main');
  const [toast, setToast] = useState({ show: false, message: '', type: 'info' });
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const { logout, status } = useAuth();
  const { socket } = useSocket();

  const tabs = useMemo(
    () => [
      { id: 'main', label: '策略' },
      { id: 'roundtable', label: '圆桌' },
      { id: 'config', label: '配置' },
      { id: 'ai-providers', label: '模型' },
    ],
    []
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

  const checkOnboarding = useCallback(async () => {
    try {
      const res = await authedFetch('/api/ai-providers');
      if (!res.ok) return;
      const providers = await res.json();
      const hasReady = Array.isArray(providers) && providers.some((p) => p.hasKey);
      setNeedsOnboarding(!hasReady);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    checkOnboarding();
    socket.on('providers-updated', checkOnboarding);
    return () => socket.off('providers-updated', checkOnboarding);
  }, [checkOnboarding, socket]);

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
          <div className={currentTab === 'roundtable' ? '' : 'hidden'}>
            <RoundtableTab />
          </div>
          <div className={currentTab === 'config' ? '' : 'hidden'}>
            <ConfigTab />
          </div>
          <div className={currentTab === 'ai-providers' ? '' : 'hidden'}>
            <AIProvidersTab />
          </div>
        </div>
      </AppShell>

      {currentTab === 'main' && needsOnboarding ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="card p-10 max-w-md text-center space-y-5">
            <div className="w-16 h-16 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center mx-auto">
              <i className="fas fa-wand-magic-sparkles text-accent text-2xl"></i>
            </div>
            <h2 className="text-xl font-bold">Welcome to Arkanis</h2>
            <p className="text-sm text-text-muted">
              检测到尚未配置任何可用的 AI Provider，请先前往模型设置页面添加至少一个 Provider 并配置
              API Key。
            </p>
            <button
              type="button"
              className="btn btn-primary w-full"
              onClick={() => setCurrentTab('ai-providers')}
            >
              <i className="fas fa-arrow-right"></i>
              前往模型设置
            </button>
          </div>
        </div>
      ) : null}

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
