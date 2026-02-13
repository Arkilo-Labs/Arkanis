<template>
    <div class="app-layout">
        <nav class="floating-navbar">
            <div class="nav-container">
                <button class="menu-toggle" type="button" @click="toggleDrawer">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M3 12h18M3 6h18M3 18h18" />
                    </svg>
                </button>

                <RouterLink to="/admin" class="logo">
                    <img src="/logo.png" alt="Arkanis" />
                    <span>Admin</span>
                </RouterLink>

                <div class="nav-links">
                    <RouterLink class="nav-link" to="/admin/overview">概览</RouterLink>
                    <RouterLink class="nav-link" to="/admin/users">用户</RouterLink>
                    <RouterLink class="nav-link" to="/admin/subscriptions">订阅</RouterLink>
                    <RouterLink class="nav-link" to="/admin/activation-codes">激活码</RouterLink>
                    <RouterLink class="nav-link" to="/admin/providers">模型</RouterLink>
                    <RouterLink class="nav-link" to="/app">控制台</RouterLink>
                </div>

                <div class="nav-user">
                    <span class="user-name">{{ userLabel }}</span>
                    <button class="btn btn-sm btn-secondary" type="button" @click="onLogout">退出</button>
                </div>
            </div>
        </nav>

        <!-- 移动端抽屉菜单 -->
        <div class="drawer-overlay" :class="{ active: drawerOpen }" @click="closeDrawer"></div>
        <aside class="drawer" :class="{ open: drawerOpen }">
            <div class="drawer-header">
                <RouterLink to="/admin" class="logo" @click="closeDrawer">
                    <img src="/logo.png" alt="Arkanis" />
                    <span>Admin</span>
                </RouterLink>
                <button class="drawer-close" type="button" @click="closeDrawer">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                </button>
            </div>
            <nav class="drawer-nav">
                <RouterLink class="drawer-link" to="/admin/overview" @click="closeDrawer">概览</RouterLink>
                <RouterLink class="drawer-link" to="/admin/users" @click="closeDrawer">用户管理</RouterLink>
                <RouterLink class="drawer-link" to="/admin/subscriptions" @click="closeDrawer">订阅管理</RouterLink>
                <RouterLink class="drawer-link" to="/admin/activation-codes" @click="closeDrawer">激活码</RouterLink>
                <RouterLink class="drawer-link" to="/admin/providers" @click="closeDrawer">模型管理</RouterLink>
                <div class="drawer-divider"></div>
                <RouterLink class="drawer-link" to="/app" @click="closeDrawer">返回控制台</RouterLink>
            </nav>
            <div class="drawer-footer">
                <div class="drawer-user">{{ userLabel }}</div>
                <button class="btn btn-secondary btn-full" type="button" @click="onLogout">退出登录</button>
            </div>
        </aside>

        <main class="main-content">
            <header class="topbar">
                <div class="topbar-title">
                    <h1>{{ title }}</h1>
                    <p v-if="subtitle">{{ subtitle }}</p>
                </div>
            </header>

            <div class="content-wrapper">
                <div v-if="showEmailVerifyBanner" class="card card-warn">
                    <div class="card-content banner-row">
                        <div>
                            <div class="banner-title">邮箱未验证</div>
                            <div class="text-muted">部分功能需要先完成邮箱验证。</div>
                            <div v-if="bannerMsg" class="banner-msg">{{ bannerMsg }}</div>
                        </div>
                        <button class="btn btn-primary" type="button" :disabled="sending" @click="onSendVerify">
                            {{ sending ? '发送中...' : '发送验证邮件' }}
                        </button>
                    </div>
                    <div v-if="debugLink" class="card-content">
                        <div class="text-muted">开发模式：未配置 SMTP，直接打开此链接完成验证：</div>
                        <a class="link" :href="debugLink">{{ debugLink }}</a>
                    </div>
                </div>
                <slot />
            </div>
        </main>
    </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/authStore.js';
import { api } from '../lib/apiClient.js';

defineProps({
    title: { type: String, required: true },
    subtitle: { type: String, default: '' },
});

const auth = useAuthStore();
const router = useRouter();

const userLabel = computed(() => auth.user.value?.display_name || auth.user.value?.email || '用户');
const showEmailVerifyBanner = computed(() => !!auth.user.value && !auth.user.value?.email_verified_at);

const sending = ref(false);
const bannerMsg = ref('');
const debugLink = ref('');

const drawerOpen = ref(false);

function toggleDrawer() {
    drawerOpen.value = !drawerOpen.value;
}

function closeDrawer() {
    drawerOpen.value = false;
}

async function onLogout() {
    closeDrawer();
    await auth.logout();
    await router.push('/login');
}

async function onSendVerify() {
    bannerMsg.value = '';
    debugLink.value = '';
    sending.value = true;
    try {
        const res = await api.request('/api/auth/email-verifications/send', { method: 'POST' });
        bannerMsg.value = res?.alreadyVerified ? '邮箱已验证' : '已发送，请查收邮箱';
        debugLink.value = res?.debugLink || '';
        await auth.refreshUser().catch(() => null);
    } catch (e) {
        bannerMsg.value = e?.message || '发送失败';
    } finally {
        sending.value = false;
    }
}
</script>

<style scoped>
.menu-toggle {
    display: none;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
    border-radius: var(--radius-md);
    transition: background var(--transition-fast);
}

.menu-toggle:hover {
    background: rgba(255, 255, 255, 0.1);
}

.drawer-overlay {
    display: none;
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(4px);
    z-index: 200;
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--transition-base);
}

.drawer-overlay.active {
    opacity: 1;
    pointer-events: auto;
}

.drawer {
    display: none;
    position: fixed;
    top: 0;
    left: 0;
    width: 280px;
    height: 100vh;
    background: rgba(20, 20, 20, 0.95);
    backdrop-filter: blur(20px);
    border-right: 1px solid var(--color-border-light);
    z-index: 201;
    transform: translateX(-100%);
    transition: transform var(--transition-base);
    flex-direction: column;
}

.drawer.open {
    transform: translateX(0);
}

.drawer-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--spacing-lg);
    border-bottom: 1px solid var(--color-border-light);
}

.drawer-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--color-text-muted);
    cursor: pointer;
    border-radius: var(--radius-md);
    transition: all var(--transition-fast);
}

.drawer-close:hover {
    background: rgba(255, 255, 255, 0.1);
    color: var(--color-text);
}

.drawer-nav {
    display: flex;
    flex-direction: column;
    padding: var(--spacing-lg) var(--spacing-md);
    gap: var(--spacing-xs);
    flex: 1;
    overflow-y: auto;
}

.drawer-link {
    display: block;
    padding: var(--spacing-md) var(--spacing-lg);
    color: var(--color-text-muted);
    text-decoration: none;
    border-radius: var(--radius-lg);
    font-size: var(--font-size-base);
    font-weight: 500;
    transition: all var(--transition-fast);
    position: relative;
}

.drawer-link:hover {
    background: rgba(255, 255, 255, 0.04);
    color: var(--color-text);
}

.drawer-link.router-link-active {
    color: var(--color-accent);
    background: transparent;
}

.drawer-link.router-link-active::before {
    content: '';
    position: absolute;
    left: 0;
    top: 50%;
    transform: translateY(-50%);
    width: 3px;
    height: 20px;
    background: var(--color-accent);
    border-radius: 2px;
}

.drawer-divider {
    height: 1px;
    background: var(--color-border-light);
    margin: var(--spacing-md) var(--spacing-lg);
}

.drawer-footer {
    padding: var(--spacing-lg);
    border-top: 1px solid var(--color-border-light);
}

.drawer-user {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
    margin-bottom: var(--spacing-md);
    padding: 0 var(--spacing-sm);
}

@media (max-width: 768px) {
    .menu-toggle {
        display: flex;
    }

    .drawer-overlay {
        display: block;
    }

    .drawer {
        display: flex;
    }
}
</style>
