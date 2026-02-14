import { useEffect, useMemo } from 'react';
import ConsoleShell from './ConsoleShell.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import LoginPage from './pages/LoginPage.jsx';
import SetupPage from './pages/SetupPage.jsx';
import { useAuth } from './composables/useAuth.js';

export default function App() {
    const setupToken = useMemo(() => {
        const path = window.location.pathname || '/';
        const match = path.match(/^\/_setup\/([^/]+)(?:\/|$)/);
        return match ? match[1] : null;
    }, []);

    const isSetupPath = Boolean(setupToken);
    const { status, loading, error, checkStatus } = useAuth();

    const isAuthed = status.allowNoAuth || status.authed;
    const needsSetup =
        status.setupRequired || (!status.initialized && !status.allowNoAuth);

    useEffect(() => {
        function handleMouseMove(e) {
            const appContainer = document.querySelector('.app-container');
            if (appContainer) {
                appContainer.style.setProperty('--mouse-x', `${e.clientX}px`);
                appContainer.style.setProperty('--mouse-y', `${e.clientY}px`);
            }

            const elements = document.querySelectorAll(
                '.glass-card, .menu-item, .custom-select, .btn-glass, .toggle-glass',
            );
            elements.forEach((element) => {
                const rect = element.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                element.style.setProperty('--mouse-x', `${x}px`);
                element.style.setProperty('--mouse-y', `${y}px`);
            });
        }

        document.addEventListener('mousemove', handleMouseMove);
        return () => document.removeEventListener('mousemove', handleMouseMove);
    }, []);

    useEffect(() => {
        if (isSetupPath) return;
        checkStatus().catch(() => null);
    }, [checkStatus, isSetupPath]);

    return (
        <div className="min-h-screen relative app-container">
            <div className="mouse-glow"></div>

            {isSetupPath ? (
                <div className="min-h-screen flex items-center justify-center px-4 py-12 relative z-10">
                    <SetupPage setupToken={setupToken} />
                </div>
            ) : loading ? (
                <div className="min-h-screen flex items-center justify-center px-4 py-12 relative z-10">
                    <div className="glass-card px-6 py-4 flex items-center gap-3">
                        <i className="fas fa-spinner fa-spin text-white/40"></i>
                        <span className="text-sm text-white/70">
                            正在检测登录状态...
                        </span>
                    </div>
                </div>
            ) : error ? (
                <div className="min-h-screen flex items-center justify-center px-4 py-12 relative z-10">
                    <div className="glass-card w-full max-w-xl p-8">
                        <span className="text-subtitle-en mb-2 block">
                            Backend offline
                        </span>
                        <h1 className="text-hero-cn text-apple-gradient">
                            无法连接后端
                        </h1>
                        <p className="text-sm text-white/50 mt-2">
                            请先启动 `pnpm dev:server`，然后重试。
                        </p>
                        <button
                            className="btn-glass w-full h-14 justify-center mt-6"
                            onClick={() => checkStatus().catch(() => null)}
                        >
                            <i className="fas fa-rotate-right"></i>
                            <span className="font-bold">重试</span>
                        </button>
                    </div>
                </div>
            ) : needsSetup ? (
                <div className="min-h-screen flex items-center justify-center px-4 py-12 relative z-10">
                    <div className="glass-card w-full max-w-xl p-8">
                        <span className="text-subtitle-en mb-2 block">
                            Setup required
                        </span>
                        <h1 className="text-hero-cn text-apple-gradient">
                            需要初始化
                        </h1>
                        <p className="text-sm text-white/50 mt-2">
                            请查看 server 控制台输出的 URL，然后访问{' '}
                            <span className="font-mono text-white/80">
                                /_setup/&lt;token&gt;
                            </span>{' '}
                            完成初始化。
                        </p>
                        <button
                            className="btn-glass w-full h-14 justify-center mt-6"
                            onClick={() => checkStatus().catch(() => null)}
                        >
                            <i className="fas fa-rotate-right"></i>
                            <span className="font-bold">重新检测</span>
                        </button>
                    </div>
                </div>
            ) : !isAuthed ? (
                <div className="min-h-screen flex items-center justify-center px-4 py-12 relative z-10">
                    <LoginPage />
                </div>
            ) : (
                <ErrorBoundary>
                    <ConsoleShell />
                </ErrorBoundary>
            )}
        </div>
    );
}
