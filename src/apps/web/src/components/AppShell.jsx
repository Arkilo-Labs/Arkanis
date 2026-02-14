import { useEffect, useMemo, useState } from 'react';

export default function AppShell({
    tabs = [],
    currentTab,
    onTabChange,
    userLabel,
    onLogout,
    children,
}) {
    const [drawerOpen, setDrawerOpen] = useState(false);

    const firstTabId = useMemo(() => tabs?.[0]?.id || 'main', [tabs]);

    useEffect(() => {
        function onKeyDown(e) {
            if (e.key === 'Escape') setDrawerOpen(false);
        }

        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, []);

    useEffect(() => {
        if (!drawerOpen) return;
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = prevOverflow;
        };
    }, [drawerOpen]);

    function gotoTab(id) {
        onTabChange?.(id);
        setDrawerOpen(false);
    }

    return (
        <div className="app-layout">
            <nav className="floating-navbar">
                <div className="nav-container">
                    <button
                        className="menu-toggle"
                        type="button"
                        onClick={() => setDrawerOpen((v) => !v)}
                        aria-label="打开菜单"
                    >
                        <svg
                            width="20"
                            height="20"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                        >
                            <path d="M3 12h18M3 6h18M3 18h18" />
                        </svg>
                    </button>

                    <button
                        type="button"
                        className="logo"
                        onClick={() => gotoTab(firstTabId)}
                        aria-label="返回首页"
                    >
                        <img src="/logo.png" alt="Arkanis" />
                        <span>Arkanis</span>
                    </button>

                    <div className="nav-links">
                        {tabs.map((tab) => (
                            <button
                                key={tab.id}
                                type="button"
                                className={[
                                    'nav-link',
                                    currentTab === tab.id ? 'nav-link-active' : '',
                                ].join(' ')}
                                onClick={() => gotoTab(tab.id)}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>

                    <div className="nav-user">
                        {userLabel ? <span className="user-name">{userLabel}</span> : null}
                        <button
                            className="btn btn-sm btn-secondary"
                            type="button"
                            onClick={onLogout}
                        >
                            退出
                        </button>
                    </div>
                </div>
            </nav>

            <div
                className={['drawer-overlay', drawerOpen ? 'active' : ''].join(' ')}
                onClick={() => setDrawerOpen(false)}
            ></div>

            <aside className={['drawer', drawerOpen ? 'open' : ''].join(' ')}>
                <div className="drawer-header">
                    <button
                        type="button"
                        className="logo"
                        onClick={() => gotoTab(firstTabId)}
                    >
                        <img src="/logo.png" alt="Arkanis" />
                        <span>Arkanis</span>
                    </button>

                    <button
                        className="drawer-close"
                        type="button"
                        onClick={() => setDrawerOpen(false)}
                        aria-label="关闭菜单"
                    >
                        <svg
                            width="20"
                            height="20"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                        >
                            <path d="M18 6L6 18M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <nav className="drawer-nav">
                    {tabs.map((tab) => (
                        <button
                            key={tab.id}
                            type="button"
                            className={[
                                'drawer-link',
                                currentTab === tab.id ? 'drawer-link-active' : '',
                            ].join(' ')}
                            onClick={() => gotoTab(tab.id)}
                        >
                            {tab.label}
                        </button>
                    ))}
                </nav>

                <div className="drawer-footer">
                    {userLabel ? <div className="user-name">{userLabel}</div> : null}
                    <button
                        className="btn btn-secondary btn-full"
                        type="button"
                        onClick={() => {
                            setDrawerOpen(false);
                            onLogout?.();
                        }}
                    >
                        退出登录
                    </button>
                </div>
            </aside>

            <main className="main-content">{children}</main>
        </div>
    );
}
