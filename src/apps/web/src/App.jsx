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
        if (isSetupPath) return;
        checkStatus().catch(() => null);
    }, [checkStatus, isSetupPath]);

    return (
        <>
            {isSetupPath ? (
                <div className="auth-page">
                    <div className="auth-container">
                        <SetupPage setupToken={setupToken} />
                    </div>
                </div>
            ) : loading ? (
                <div className="auth-page">
                    <div className="card p-6 flex items-center gap-3">
                        <i className="fas fa-spinner fa-spin text-white/60"></i>
                        <span className="text-sm text-text-muted">
                            正在检测登录状态...
                        </span>
                    </div>
                </div>
            ) : error ? (
                <div className="auth-page">
                    <div className="card p-8 w-full max-w-xl">
                        <div className="mb-6">
                            <div className="text-xs tracking-wide text-text-muted">
                                Backend offline
                            </div>
                            <h1 className="text-3xl font-bold mt-2">
                                无法连接后端
                            </h1>
                            <p className="text-sm text-text-muted mt-2">
                                请先启动 <span className="font-mono">pnpm dev:server</span>，然后重试。
                            </p>
                        </div>
                        <button
                            className="btn btn-primary btn-full"
                            type="button"
                            onClick={() => checkStatus().catch(() => null)}
                        >
                            <i className="fas fa-rotate-right"></i>
                            重试
                        </button>
                    </div>
                </div>
            ) : needsSetup ? (
                <div className="auth-page">
                    <div className="card p-8 w-full max-w-xl">
                        <div className="mb-6">
                            <div className="text-xs tracking-wide text-text-muted">
                                Setup required
                            </div>
                            <h1 className="text-3xl font-bold mt-2">需要初始化</h1>
                            <p className="text-sm text-text-muted mt-2">
                                请查看 server 控制台输出的 URL，然后访问{' '}
                                <span className="font-mono">/_setup/&lt;token&gt;</span>{' '}
                                完成初始化。
                            </p>
                        </div>
                        <button
                            className="btn btn-primary btn-full"
                            type="button"
                            onClick={() => checkStatus().catch(() => null)}
                        >
                            <i className="fas fa-rotate-right"></i>
                            重新检测
                        </button>
                    </div>
                </div>
            ) : !isAuthed ? (
                <div className="auth-page">
                    <div className="auth-container">
                        <LoginPage />
                    </div>
                </div>
            ) : (
                <ErrorBoundary>
                    <ConsoleShell />
                </ErrorBoundary>
            )}
        </>
    );
}
