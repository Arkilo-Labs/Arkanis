<template>
    <div class="app-layout">
        <aside class="sidebar">
            <div class="sidebar-header">
                <div class="logo">
                    <img src="/logo.png" alt="Arkilo" />
                    <span>Arkilo Console</span>
                </div>
            </div>

            <nav class="nav-menu">
                <RouterLink class="nav-item" to="/app">概览</RouterLink>
                <RouterLink class="nav-item" to="/app/subscription">订阅</RouterLink>
                <RouterLink v-if="isAdmin" class="nav-item" to="/app/admin/codes">激活码</RouterLink>
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
                    <div class="user-info">
                        <span class="user-name">{{ userLabel }}</span>
                        <span class="user-email">{{ email }}</span>
                    </div>
                </div>
            </header>

            <div class="content-wrapper">
                <slot />
            </div>
        </main>
    </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { api } from '../lib/apiClient.js';
import { useAuthStore } from '../stores/authStore.js';

defineProps({
    title: { type: String, required: true },
    subtitle: { type: String, default: '' },
});

const auth = useAuthStore();
const router = useRouter();

const email = computed(() => auth.user.value?.email || '');
const userLabel = computed(() => auth.user.value?.display_name || auth.user.value?.email || '用户');
const isAdmin = ref(false);

async function onLogout() {
    await auth.logout();
    await router.push('/login');
}

onMounted(async () => {
    try {
        await api.request('/api/admin/activation-codes?limit=1&offset=0');
        isAdmin.value = true;
    } catch {
        isAdmin.value = false;
    }
});
</script>

