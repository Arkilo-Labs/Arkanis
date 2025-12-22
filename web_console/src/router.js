import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from './stores/authStore.js';

import LoginPage from './pages/LoginPage.vue';
import RegisterPage from './pages/RegisterPage.vue';
import VerifyEmailPage from './pages/VerifyEmailPage.vue';
import DashboardPage from './pages/DashboardPage.vue';
import SubscriptionPage from './pages/SubscriptionPage.vue';
import AdminActivationCodesPage from './pages/AdminActivationCodesPage.vue';
import AIStrategyPage from './pages/AIStrategyPage.vue';
import AIProvidersPage from './pages/AIProvidersPage.vue';
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
    { path: '/app/admin/codes', component: AdminActivationCodesPage, meta: { requiresAuth: true } },
    { path: '/app/admin/providers', component: AdminAIProvidersPage, meta: { requiresAuth: true } },
];

export const router = createRouter({
    history: createWebHistory(),
    routes,
});

router.beforeEach(async (to) => {
    const auth = useAuthStore();
    if (!auth.initialized.value) await auth.init();

    if (to.meta.requiresAuth && !auth.user.value) return '/login';
    if (to.meta.guestOnly && auth.user.value) return '/app';
    return true;
});
