<template>
    <div class="auth-page">
        <div class="auth-container">
            <div class="auth-card">
                <div class="auth-header">
                    <div class="auth-logo">
                        <img src="/logo.png" alt="Arkanis" />
                        <span>Arkanis</span>
                    </div>
                    <h1 class="auth-title">邮箱验证</h1>
                    <p class="auth-subtitle">验证完成后即可使用订阅与 AI 功能</p>
                </div>

                <div class="card-content">
                    <p v-if="status === 'idle'" class="text-muted">准备验证...</p>
                    <p v-if="status === 'verifying'" class="text-muted">验证中...</p>
                    <p v-if="status === 'success'" class="form-success">验证成功</p>
                    <p v-if="status === 'error'" class="form-error">{{ error }}</p>

                    <div v-if="status === 'error'" class="input-with-button">
                        <button class="btn btn-primary btn-full" type="button" @click="verify">
                            重新验证
                        </button>
                    </div>

                    <div class="auth-footer">
                        <RouterLink class="link" to="/login">返回登录</RouterLink>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { api } from '../lib/apiClient.js';
import { useAuthStore } from '../stores/authStore.js';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const token = computed(() => String(route.query.token || '').trim());
const status = ref('idle'); // idle | verifying | success | error
const error = ref('');

async function verify() {
    error.value = '';
    if (!token.value) {
        status.value = 'error';
        error.value = '缺少 token';
        return;
    }

    status.value = 'verifying';
    try {
        await api.request('/api/auth/email-verifications/verify', { method: 'POST', body: { token: token.value } });
        status.value = 'success';
        await auth.refreshUser().catch(() => null);
        if (auth.user.value) await router.push('/app');
    } catch (e) {
        status.value = 'error';
        error.value = e?.message || '验证失败';
    }
}

onMounted(verify);
</script>
