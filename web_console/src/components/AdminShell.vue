<template>
    <div class="app-layout">
        <aside class="sidebar">
            <div class="sidebar-header">
                <div class="logo">
                    <img src="/logo.png" alt="Arkilo" />
                    <span>Arkilo Admin</span>
                </div>
            </div>

            <nav class="nav-menu">
                <RouterLink class="nav-item" to="/admin/overview">概览</RouterLink>
                <RouterLink class="nav-item" to="/admin/users">用户管理</RouterLink>
                <RouterLink class="nav-item" to="/admin/organizations">组织管理</RouterLink>
                <RouterLink class="nav-item" to="/admin/subscriptions">订阅管理</RouterLink>
                <RouterLink class="nav-item" to="/admin/activation-codes">激活码</RouterLink>
                <RouterLink class="nav-item" to="/admin/providers">服务商管理</RouterLink>
                <RouterLink class="nav-item" to="/app">返回控制台</RouterLink>
            </nav>

            <div class="sidebar-footer">
                <button class="btn btn-secondary btn-full" type="button" @click="onLogout">退出登录</button>
            </div>
        </aside>

        <main class="main-content">
            <header class="topbar">
                <div class="topbar-title">
                    <h1>{{ title }}</h1>
                    <p v-if="subtitle">{{ subtitle }}</p>
                </div>
                <div class="topbar-user">
                    <span class="user-name">{{ userLabel }}</span>
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

async function onLogout() {
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

