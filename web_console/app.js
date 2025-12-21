// Arkilo Console - 主应用脚本
// 路由、认证、页面渲染

(function () {
  'use strict';

  // 管理员配置（硬编码）
  const adminConfig = {
    admins: [
      { username: 'admin', email: 'admin@arkilo.ai', password: 'admin123' }
    ],
    settings: {
      defaultSubscriptionDays: { monthly: 30, yearly: 365 },
      codeExpirationDays: 90
    }
  };

  // 状态管理
  const state = {
    user: null,
    currentPage: 'login',
    activationCodes: [
      { code: 'ARKILO-MONTHLY-001', type: 'monthly', used: false, usedBy: null, createdAt: '2025-12-01', expiresAt: '2026-03-01' },
      { code: 'ARKILO-YEARLY-001', type: 'yearly', used: false, usedBy: null, createdAt: '2025-12-01', expiresAt: '2026-03-01' },
      { code: 'ARKILO-MONTHLY-002', type: 'monthly', used: true, usedBy: 'demo@example.com', createdAt: '2025-11-01', expiresAt: '2026-02-01' }
    ],
    users: [
      { id: 1, username: 'admin', email: 'admin@arkilo.ai', role: 'admin', subscription: null },
      { id: 2, username: 'demo', email: 'demo@example.com', role: 'user', subscription: { type: 'monthly', expiresAt: '2025-01-21' } }
    ]
  };

  // 从 localStorage 恢复认证状态
  function restoreAuth() {
    const savedUser = localStorage.getItem('arkilo_user');
    if (savedUser) {
      try {
        state.user = JSON.parse(savedUser);
        return true;
      } catch (e) {
        localStorage.removeItem('arkilo_user');
      }
    }
    return false;
  }

  // 保存认证状态
  function saveAuth(user) {
    state.user = user;
    localStorage.setItem('arkilo_user', JSON.stringify(user));
  }

  // 清除认证状态
  function clearAuth() {
    state.user = null;
    localStorage.removeItem('arkilo_user');
  }

  // 路由处理
  function handleRoute() {
    const hash = window.location.hash.slice(1) || 'login';

    // 需要认证的页面
    const protectedRoutes = ['dashboard', 'subscription', 'history', 'settings', 'admin'];

    // 管理员专属页面
    const adminRoutes = ['admin'];

    if (adminRoutes.includes(hash) && state.user?.role !== 'admin') {
      navigate('dashboard');
      return;
    }

    if (protectedRoutes.includes(hash) && !state.user) {
      navigate('login');
      return;
    }

    if ((hash === 'login' || hash === 'register') && state.user) {
      navigate('dashboard');
      return;
    }

    state.currentPage = hash;
    render();
  }

  // 导航
  function navigate(page) {
    window.location.hash = page;
  }

  // SVG 图标
  const icons = {
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    creditCard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>',
    history: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
    mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>',
    key: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>',
    package: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>',
    zap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
    barChart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg>',
    alertCircle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    gift: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>'
  };

  // 页面模板
  const pages = {
    // 登录页
    login: () => `
      <div class="auth-page">
        <div class="auth-container">
          <div class="auth-card">
            <div class="auth-header">
              <div class="auth-logo">
                <img src="assets/logo.png" alt="Arkilo">
                <span>Arkilo</span>
              </div>
              <h1 class="auth-title">欢迎回来</h1>
              <p class="auth-subtitle">登录您的账户以继续</p>
            </div>
            
            <form id="loginForm">
              <div class="form-group">
                <label class="form-label" for="account">用户名或邮箱</label>
                <input type="text" id="account" class="form-input" placeholder="用户名或邮箱地址" required>
                <p class="form-error hidden" id="accountError"></p>
              </div>
              
              <div class="form-group">
                <label class="form-label" for="password">密码</label>
                <input type="password" id="password" class="form-input" placeholder="输入密码" required>
                <p class="form-error hidden" id="passwordError"></p>
              </div>
              
              <div class="form-row">
                <label class="form-checkbox">
                  <input type="checkbox" id="remember">
                  <span>记住我</span>
                </label>
                <a href="#" class="form-link">忘记密码?</a>
              </div>
              
              <button type="submit" class="btn btn-primary">登录</button>
            </form>
            
            <div class="auth-footer">
              <p>还没有账户? <a href="#register">立即注册</a></p>
            </div>
          </div>
        </div>
      </div>
    `,

    // 注册页
    register: () => `
      <div class="auth-page">
        <div class="auth-container">
          <div class="auth-card">
            <div class="auth-header">
              <div class="auth-logo">
                <img src="assets/logo.png" alt="Arkilo">
                <span>Arkilo</span>
              </div>
              <h1 class="auth-title">创建账户</h1>
              <p class="auth-subtitle">开始使用 AI 驱动的交易分析</p>
            </div>
            
            <form id="registerForm">
              <div class="form-group">
                <label class="form-label" for="username">用户名</label>
                <input type="text" id="username" class="form-input" placeholder="输入用户名" required>
                <p class="form-error hidden" id="usernameError"></p>
              </div>
              
              <div class="form-group">
                <label class="form-label" for="email">邮箱地址</label>
                <input type="email" id="email" class="form-input" placeholder="your@email.com" required>
                <p class="form-error hidden" id="emailError"></p>
              </div>
              
              <div class="form-group">
                <label class="form-label" for="password">密码</label>
                <input type="password" id="password" class="form-input" placeholder="至少 8 位字符" required>
                <p class="form-error hidden" id="passwordError"></p>
              </div>
              
              <div class="form-group">
                <label class="form-label" for="confirmPassword">确认密码</label>
                <input type="password" id="confirmPassword" class="form-input" placeholder="再次输入密码" required>
                <p class="form-error hidden" id="confirmPasswordError"></p>
              </div>
              
              <div class="form-group">
                <label class="form-checkbox">
                  <input type="checkbox" id="terms" required>
                  <span>我同意 <a href="#" class="form-link">服务条款</a> 和 <a href="#" class="form-link">隐私政策</a></span>
                </label>
              </div>
              
              <button type="submit" class="btn btn-primary">创建账户</button>
            </form>
            
            <div class="auth-footer">
              <p>已有账户? <a href="#login">立即登录</a></p>
            </div>
          </div>
        </div>
      </div>
    `,

    // Dashboard
    dashboard: () => `
      <div class="dashboard">
        ${renderSidebar()}
        <main class="main-content">
          <div class="topbar">
            <div class="topbar-title">
              <h1>控制台</h1>
              <p>欢迎回来, ${state.user?.username || 'User'}</p>
            </div>
            <div class="topbar-actions">
              <div class="user-menu" id="userMenu">
                <div class="user-avatar">${(state.user?.username || 'U')[0].toUpperCase()}</div>
                <div class="user-info">
                  <span class="user-name">${state.user?.username || 'User'}</span>
                  <span class="user-email">${state.user?.email || 'user@example.com'}</span>
                </div>
              </div>
            </div>
          </div>
          
          <div class="grid grid-2" style="margin-bottom: var(--spacing-xl);">
            <!-- 用户信息卡片 -->
            <div class="card">
              <div class="card-header">
                <h2 class="card-title">账户信息</h2>
                <span class="badge badge-success">已验证</span>
              </div>
              <div class="stat-card">
                <div class="stat-icon">${icons.user}</div>
                <div class="stat-content">
                  <h3>${state.user?.username || 'User'}</h3>
                  <p>${state.user?.email || 'user@example.com'}</p>
                </div>
              </div>
            </div>
            
            <!-- 订阅状态卡片 -->
            <div class="card">
              <div class="card-header">
                <h2 class="card-title">订阅状态</h2>
                <span class="badge badge-muted">未激活</span>
              </div>
              <div class="subscription-status">
                ${icons.package}
                <h3>暂无订阅</h3>
                <p>升级到高级计划，解锁全部 AI 分析功能</p>
                <button class="btn btn-primary" style="width: auto;">查看订阅计划</button>
              </div>
            </div>
          </div>
          
          <!-- 快捷操作 -->
          <div class="card">
            <div class="card-header">
              <h2 class="card-title">快捷操作</h2>
            </div>
            <div class="quick-actions">
              <div class="quick-action">
                ${icons.zap}
                <span>开始分析</span>
              </div>
              <div class="quick-action">
                ${icons.barChart}
                <span>查看历史</span>
              </div>
              <div class="quick-action">
                ${icons.key}
                <span>API 密钥</span>
              </div>
              <div class="quick-action">
                ${icons.mail}
                <span>验证邮箱</span>
              </div>
            </div>
          </div>
        </main>
      </div>
    `,

    // 订阅管理页面
    subscription: () => {
      const userSub = state.user?.subscription;
      return `
      <div class="dashboard">
        ${renderSidebar('subscription')}
        <main class="main-content">
          <div class="topbar">
            <div class="topbar-title">
              <h1>订阅管理</h1>
              <p>管理您的订阅计划</p>
            </div>
          </div>
          
          ${userSub ? `
          <div class="card" style="margin-bottom: var(--spacing-xl);">
            <div class="card-header">
              <h2 class="card-title">当前订阅</h2>
              <span class="badge badge-success">有效</span>
            </div>
            <div class="stat-card">
              <div class="stat-icon">${icons.package}</div>
              <div class="stat-content">
                <h3>${userSub.type === 'monthly' ? '月度订阅' : '年度订阅'}</h3>
                <p>到期时间: ${userSub.expiresAt}</p>
              </div>
            </div>
          </div>
          ` : ''}
          
          <div class="card" style="margin-bottom: var(--spacing-xl);">
            <div class="card-header">
              <h2 class="card-title">选择订阅计划</h2>
            </div>
            <div class="pricing-grid">
              <div class="pricing-card">
                <div class="pricing-header">
                  <h3>月度订阅</h3>
                  <div class="pricing-price">
                    <span class="price-amount">$29</span>
                    <span class="price-period">/月</span>
                  </div>
                </div>
                <ul class="pricing-features">
                  <li>${icons.check} 无限 AI 分析次数</li>
                  <li>${icons.check} 实时市场监控</li>
                  <li>${icons.check} 多时间框架分析</li>
                  <li>${icons.check} Telegram 推送</li>
                </ul>
                <button class="btn btn-secondary" style="width: 100%;">选择月度</button>
              </div>
              
              <div class="pricing-card featured">
                <div class="pricing-badge">推荐</div>
                <div class="pricing-header">
                  <h3>年度订阅</h3>
                  <div class="pricing-price">
                    <span class="price-amount">$199</span>
                    <span class="price-period">/年</span>
                  </div>
                  <p class="pricing-save">节省 $149</p>
                </div>
                <ul class="pricing-features">
                  <li>${icons.check} 月度订阅全部功能</li>
                  <li>${icons.check} 优先技术支持</li>
                  <li>${icons.check} API 访问权限</li>
                  <li>${icons.check} 历史数据导出</li>
                </ul>
                <button class="btn btn-primary" style="width: 100%;">选择年度</button>
              </div>
            </div>
          </div>
          
          <div class="card">
            <div class="card-header">
              <h2 class="card-title">激活码兑换</h2>
            </div>
            <form id="activationForm" class="activation-form">
              <div class="form-group" style="margin-bottom: 0;">
                <div class="input-with-button">
                  <input type="text" id="activationCode" class="form-input" placeholder="输入激活码，例如 ARKILO-XXXXX-XXX">
                  <button type="submit" class="btn btn-primary">激活</button>
                </div>
                <p class="form-error hidden" id="activationCodeError"></p>
                <p class="form-success hidden" id="activationCodeSuccess"></p>
              </div>
            </form>
          </div>
        </main>
      </div>
    `;
    },

    // 历史记录页面
    history: () => `
      <div class="dashboard">
        ${renderSidebar('history')}
        <main class="main-content">
          <div class="topbar">
            <div class="topbar-title">
              <h1>历史记录</h1>
              <p>查看您的分析历史</p>
            </div>
          </div>
          
          <div class="card">
            <div class="empty-state">
              ${icons.history}
              <h3>暂无记录</h3>
              <p>您还没有进行过任何分析，开始使用 AI 分析功能后这里将显示历史记录</p>
            </div>
          </div>
        </main>
      </div>
    `,

    // 设置页面
    settings: () => `
      <div class="dashboard">
        ${renderSidebar('settings')}
        <main class="main-content">
          <div class="topbar">
            <div class="topbar-title">
              <h1>设置</h1>
              <p>管理您的账户设置</p>
            </div>
          </div>
          
          <div class="card">
            <div class="card-header">
              <h2 class="card-title">账户信息</h2>
            </div>
            <div class="stat-card">
              <div class="stat-icon">${icons.user}</div>
              <div class="stat-content">
                <h3>${state.user?.username || 'User'}</h3>
                <p>${state.user?.email || 'user@example.com'}</p>
              </div>
            </div>
          </div>
          
          <div class="card" style="margin-top: var(--spacing-xl);">
            <div class="card-header">
              <h2 class="card-title">功能开发中</h2>
            </div>
            <div class="empty-state">
              ${icons.settings}
              <h3>更多设置即将上线</h3>
              <p>密码修改、通知设置、API密钥管理等功能正在开发中</p>
            </div>
          </div>
        </main>
      </div>
    `,

    // 管理员页面
    admin: () => {
      if (state.user?.role !== 'admin') return pages.dashboard();

      const totalUsers = state.users.length;
      const activeSubscriptions = state.users.filter(u => u.subscription).length;
      const unusedCodes = state.activationCodes.filter(c => !c.used).length;

      return `
      <div class="dashboard">
        ${renderSidebar('admin')}
        <main class="main-content">
          <div class="topbar">
            <div class="topbar-title">
              <h1>管理员控制台</h1>
              <p>系统数据与管理</p>
            </div>
          </div>
          
          <div class="grid grid-3" style="margin-bottom: var(--spacing-xl);">
            <div class="card">
              <div class="stat-card">
                <div class="stat-icon">${icons.users}</div>
                <div class="stat-content">
                  <h3>${totalUsers}</h3>
                  <p>注册用户</p>
                </div>
              </div>
            </div>
            <div class="card">
              <div class="stat-card">
                <div class="stat-icon">${icons.creditCard}</div>
                <div class="stat-content">
                  <h3>${activeSubscriptions}</h3>
                  <p>有效订阅</p>
                </div>
              </div>
            </div>
            <div class="card">
              <div class="stat-card">
                <div class="stat-icon">${icons.gift}</div>
                <div class="stat-content">
                  <h3>${unusedCodes}</h3>
                  <p>可用激活码</p>
                </div>
              </div>
            </div>
          </div>
          
          <div class="card" style="margin-bottom: var(--spacing-xl);">
            <div class="card-header">
              <h2 class="card-title">激活码管理</h2>
              <div class="card-actions">
                <button class="btn btn-secondary" id="batchGenerateBtn" style="margin-right: var(--spacing-sm);">
                  批量生成
                </button>
                <button class="btn btn-primary" id="generateCodeBtn">
                  ${icons.plus} 生成激活码
                </button>
              </div>
            </div>
            <table class="data-table">
              <thead>
                <tr>
                  <th>激活码</th>
                  <th>类型</th>
                  <th>状态</th>
                  <th>到期时间</th>
                  <th>使用者</th>
                </tr>
              </thead>
              <tbody>
                ${state.activationCodes.map(code => {
        const isExpired = code.expiresAt && new Date(code.expiresAt) < new Date();
        let statusBadge = '';
        if (code.used) {
          statusBadge = '<span class="badge badge-muted">已使用</span>';
        } else if (isExpired) {
          statusBadge = '<span class="badge badge-error">已过期</span>';
        } else {
          statusBadge = '<span class="badge badge-success">可用</span>';
        }
        return `
                <tr>
                  <td><code>${code.code}</code></td>
                  <td>${code.type === 'monthly' ? '月度' : '年度'}</td>
                  <td>${statusBadge}</td>
                  <td>${code.expiresAt || '-'}</td>
                  <td>${code.usedBy || '-'}</td>
                </tr>
                `;
      }).join('')}
              </tbody>
            </table>
          </div>
          
          <div class="card">
            <div class="card-header">
              <h2 class="card-title">用户管理</h2>
            </div>
            <table class="data-table">
              <thead>
                <tr>
                  <th>用户名</th>
                  <th>邮箱</th>
                  <th>角色</th>
                  <th>订阅状态</th>
                </tr>
              </thead>
              <tbody>
                ${state.users.map(user => `
                <tr>
                  <td>${user.username}</td>
                  <td>${user.email}</td>
                  <td><span class="badge ${user.role === 'admin' ? 'badge-warning' : 'badge-muted'}">${user.role === 'admin' ? '管理员' : '用户'}</span></td>
                  <td>${user.subscription ? `<span class="badge badge-success">${user.subscription.type === 'monthly' ? '月度' : '年度'}</span>` : '<span class="badge badge-muted">无</span>'}</td>
                </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </main>
      </div>
    `;
    }
  };

  // 渲染侧边栏
  function renderSidebar(activePage = 'dashboard') {
    return `
      <aside class="sidebar">
        <div class="sidebar-header">
          <div class="sidebar-logo">
            <img src="assets/logo.png" alt="Arkilo">
            <span>Arkilo</span>
          </div>
        </div>
        
        <nav class="sidebar-nav">
          <div class="nav-section">
            <div class="nav-section-title">主菜单</div>
            <div class="nav-item ${activePage === 'dashboard' ? 'active' : ''}" data-page="dashboard">
              ${icons.home}
              <span>控制台</span>
            </div>
            <div class="nav-item ${activePage === 'subscription' ? 'active' : ''}" data-page="subscription">
              ${icons.creditCard}
              <span>订阅管理</span>
            </div>
            <div class="nav-item ${activePage === 'history' ? 'active' : ''}" data-page="history">
              ${icons.history}
              <span>历史记录</span>
            </div>
          </div>
          
          <div class="nav-section">
            <div class="nav-section-title">账户</div>
            <div class="nav-item ${activePage === 'settings' ? 'active' : ''}" data-page="settings">
              ${icons.settings}
              <span>设置</span>
            </div>
            ${state.user?.role === 'admin' ? `
            <div class="nav-item ${activePage === 'admin' ? 'active' : ''}" data-page="admin">
              ${icons.shield}
              <span>管理员</span>
            </div>
            ` : ''}
          </div>
        </nav>
        
        <div class="sidebar-footer">
          <div class="nav-item" id="logoutBtn">
            ${icons.logout}
            <span>退出登录</span>
          </div>
        </div>
      </aside>
    `;
  }

  // 渲染页面
  function render() {
    const app = document.getElementById('app');
    const pageRenderer = pages[state.currentPage] || pages.login;
    app.innerHTML = pageRenderer();
    bindEvents();
  }

  // 绑定事件
  function bindEvents() {
    // 登录表单
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
      loginForm.addEventListener('submit', handleLogin);
    }

    // 注册表单
    const registerForm = document.getElementById('registerForm');
    if (registerForm) {
      registerForm.addEventListener('submit', handleRegister);
    }

    // 退出登录
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', handleLogout);
    }

    // 激活码表单
    const activationForm = document.getElementById('activationForm');
    if (activationForm) {
      activationForm.addEventListener('submit', handleActivation);
    }

    // 生成激活码按钮
    const generateCodeBtn = document.getElementById('generateCodeBtn');
    if (generateCodeBtn) {
      generateCodeBtn.addEventListener('click', handleGenerateCode);
    }

    // 批量生成激活码按钮
    const batchGenerateBtn = document.getElementById('batchGenerateBtn');
    if (batchGenerateBtn) {
      batchGenerateBtn.addEventListener('click', handleBatchGenerate);
    }

    // 侧边栏导航
    document.querySelectorAll('.nav-item[data-page]').forEach(item => {
      item.addEventListener('click', () => {
        const page = item.dataset.page;
        if (page) navigate(page);
      });
    });
  }

  // 表单验证
  function validateEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
  }

  function showError(inputId, message) {
    const input = document.getElementById(inputId);
    const error = document.getElementById(inputId + 'Error');
    if (input) input.classList.add('error');
    if (error) {
      error.textContent = message;
      error.classList.remove('hidden');
    }
  }

  function clearErrors() {
    document.querySelectorAll('.form-input').forEach(input => {
      input.classList.remove('error');
    });
    document.querySelectorAll('.form-error').forEach(error => {
      error.classList.add('hidden');
    });
  }

  // 登录处理
  function handleLogin(e) {
    e.preventDefault();
    clearErrors();

    const account = document.getElementById('account').value.trim();
    const password = document.getElementById('password').value;

    let valid = true;

    if (account.length < 2) {
      showError('account', '请输入用户名或邮箱');
      valid = false;
    }

    if (password.length < 6) {
      showError('password', '密码至少需要 6 位字符');
      valid = false;
    }

    if (!valid) return;

    // 判断输入是邮箱还是用户名
    const isEmail = validateEmail(account);
    const username = isEmail ? account.split('@')[0] : account;
    const email = isEmail ? account : `${account}@arkilo.ai`;

    // 检查是否是管理员账户
    const isAdmin = account === 'admin' || email === 'admin@arkilo.ai';

    // 查找已存在用户或创建新用户
    let existingUser = state.users.find(u => u.email === email || u.username === username);

    const user = existingUser || {
      id: Date.now(),
      username: username,
      email: email,
      role: isAdmin ? 'admin' : 'user',
      subscription: null
    };

    if (!existingUser) {
      state.users.push(user);
    }

    saveAuth(user);
    navigate('dashboard');
  }

  // 激活码处理
  function handleActivation(e) {
    e.preventDefault();
    const codeInput = document.getElementById('activationCode');
    const errorEl = document.getElementById('activationCodeError');
    const successEl = document.getElementById('activationCodeSuccess');

    const code = codeInput.value.trim().toUpperCase();

    errorEl.classList.add('hidden');
    successEl.classList.add('hidden');

    if (!code) {
      errorEl.textContent = '请输入激活码';
      errorEl.classList.remove('hidden');
      return;
    }

    const codeData = state.activationCodes.find(c => c.code === code);

    if (!codeData) {
      errorEl.textContent = '无效的激活码';
      errorEl.classList.remove('hidden');
      return;
    }

    if (codeData.used) {
      errorEl.textContent = '该激活码已被使用';
      errorEl.classList.remove('hidden');
      return;
    }

    // 激活成功
    codeData.used = true;
    codeData.usedBy = state.user.email;

    const expiresAt = new Date();
    if (codeData.type === 'monthly') {
      expiresAt.setMonth(expiresAt.getMonth() + 1);
    } else {
      expiresAt.setFullYear(expiresAt.getFullYear() + 1);
    }

    state.user.subscription = {
      type: codeData.type,
      expiresAt: expiresAt.toISOString().split('T')[0]
    };

    saveAuth(state.user);

    successEl.textContent = `激活成功! 已开通${codeData.type === 'monthly' ? '月度' : '年度'}订阅`;
    successEl.classList.remove('hidden');
    codeInput.value = '';

    setTimeout(() => render(), 1500);
  }

  // 生成激活码
  function handleGenerateCode() {
    const types = ['monthly', 'yearly'];
    const type = types[Math.floor(Math.random() * types.length)];
    const suffix = Math.random().toString(36).substring(2, 5).toUpperCase();

    const createdAt = new Date();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + adminConfig.settings.codeExpirationDays);

    const newCode = {
      code: `ARKILO-${type.toUpperCase().substring(0, 3)}-${Date.now().toString(36).toUpperCase()}-${suffix}`,
      type: type,
      used: false,
      usedBy: null,
      createdAt: createdAt.toISOString().split('T')[0],
      expiresAt: expiresAt.toISOString().split('T')[0]
    };

    state.activationCodes.unshift(newCode);
    render();
  }

  // 批量生成激活码
  function handleBatchGenerate() {
    const count = prompt('请输入要生成的激活码数量:', '5');
    if (!count) return;

    const num = parseInt(count, 10);
    if (isNaN(num) || num < 1 || num > 100) {
      alert('请输入 1-100 之间的数字');
      return;
    }

    const typeChoice = prompt('请选择类型: 1=月度, 2=年度, 3=随机', '3');
    let typeFilter = null;
    if (typeChoice === '1') typeFilter = 'monthly';
    else if (typeChoice === '2') typeFilter = 'yearly';

    const expirationDays = prompt('请输入激活码有效天数:', String(adminConfig.settings.codeExpirationDays));
    const days = parseInt(expirationDays, 10) || adminConfig.settings.codeExpirationDays;

    for (let i = 0; i < num; i++) {
      const types = ['monthly', 'yearly'];
      const type = typeFilter || types[Math.floor(Math.random() * types.length)];
      const suffix = Math.random().toString(36).substring(2, 5).toUpperCase();

      const createdAt = new Date();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + days);

      const newCode = {
        code: `ARKILO-${type.toUpperCase().substring(0, 3)}-${Date.now().toString(36).toUpperCase()}-${suffix}${i}`,
        type: type,
        used: false,
        usedBy: null,
        createdAt: createdAt.toISOString().split('T')[0],
        expiresAt: expiresAt.toISOString().split('T')[0]
      };

      state.activationCodes.unshift(newCode);
    }

    alert(`已生成 ${num} 个激活码`);
    render();
  }

  // 注册处理
  function handleRegister(e) {
    e.preventDefault();
    clearErrors();

    const username = document.getElementById('username').value.trim();
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    const terms = document.getElementById('terms').checked;

    let valid = true;

    if (username.length < 2) {
      showError('username', '用户名至少需要 2 个字符');
      valid = false;
    }

    if (!validateEmail(email)) {
      showError('email', '请输入有效的邮箱地址');
      valid = false;
    }

    if (password.length < 8) {
      showError('password', '密码至少需要 8 位字符');
      valid = false;
    }

    if (password !== confirmPassword) {
      showError('confirmPassword', '两次输入的密码不一致');
      valid = false;
    }

    if (!terms) {
      alert('请同意服务条款和隐私政策');
      valid = false;
    }

    if (!valid) return;

    // 模拟注册成功
    const user = {
      id: Date.now(),
      username: username,
      email: email
    };

    saveAuth(user);
    navigate('dashboard');
  }

  // 退出登录
  function handleLogout() {
    clearAuth();
    navigate('login');
  }

  // 初始化
  function init() {
    restoreAuth();
    window.addEventListener('hashchange', handleRoute);
    handleRoute();
  }

  // 启动应用
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
