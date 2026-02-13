import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from './stores/authStore.js';

import LoginPage from './pages/LoginPage.vue';
import RegisterPage from './pages/RegisterPage.vue';
import VerifyEmailPage from './pages/VerifyEmailPage.vue';
import DashboardPage from './pages/DashboardPage.vue';
import SubscriptionPage from './pages/SubscriptionPage.vue';
import AIStrategyPage from './pages/AIStrategyPage.vue';
import AIProvidersPage from './pages/AIProvidersPage.vue';
import AdminDashboardPage from './pages/AdminDashboardPage.vue';
import AdminUsersPage from './pages/AdminUsersPage.vue';
import AdminOrganizationsPage from './pages/AdminOrganizationsPage.vue';
import AdminSubscriptionsPage from './pages/AdminSubscriptionsPage.vue';
import AdminActivationCodesPage from './pages/AdminActivationCodesPage.vue';
import AdminAIProvidersPage from './pages/AdminAIProvidersPage.vue';

const routes = [
    { path: '/', redirect: '/app' },
    { path: '/login', component: LoginPage, meta: { guestOnly: true } },
    { path: '/register', component: RegisterPage, meta: { guestOnly: true } },
    { path: '/verify-email', component: VerifyEmailPage },
    { path: '/app', component: DashboardPage, meta: { requiresAuth: true } },
    { path: '/app/ai', component: AIStrategyPage, meta: { requiresAuth: true } },
    { path: '/app/providers', component: AIProvidersPage, meta: { requiresAuth: true } },
    { path: '/app/subscription', component: SubscriptionPage, meta: { requiresAuth: true } },

    // 旧入口保留：统一跳转到独立 Admin 后台
    { path: '/app/admin/codes', redirect: '/admin/activation-codes' },
    { path: '/app/admin/providers', redirect: '/admin/providers' },

    // Admin 后台
    { path: '/admin', redirect: '/admin/overview' },
    { path: '/admin/overview', component: AdminDashboardPage, meta: { requiresAuth: true, requiresAdmin: true } },
    { path: '/admin/users', component: AdminUsersPage, meta: { requiresAuth: true, requiresAdmin: true } },
    { path: '/admin/organizations', component: AdminOrganizationsPage, meta: { requiresAuth: true, requiresAdmin: true } },
    { path: '/admin/subscriptions', component: AdminSubscriptionsPage, meta: { requiresAuth: true, requiresAdmin: true } },
    { path: '/admin/activation-codes', component: AdminActivationCodesPage, meta: { requiresAuth: true, requiresAdmin: true } },
    { path: '/admin/providers', component: AdminAIProvidersPage, meta: { requiresAuth: true, requiresAdmin: true } },
];

export const router = createRouter({
    history: createWebHistory(),
    routes,
});

router.beforeEach(async (to) => {
    const auth = useAuthStore();
    if (!auth.initialized.value) await auth.init();

    if (to.meta.requiresAuth && !auth.user.value) return '/login';
    if (to.meta.requiresAdmin && !auth.isAdmin.value) return '/app';
    if (to.meta.guestOnly && auth.user.value) return '/app';
    return true;
});
