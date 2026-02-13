<template>
    <div class="auth-page">
        <div class="auth-container">
            <div class="auth-card">
                <div class="auth-header">
                    <div class="auth-logo">
                        <img src="/logo.png" alt="Arkanis" />
                        <span>Arkanis</span>
                    </div>
                    <h1 class="auth-title">登录</h1>
                    <p class="auth-subtitle">进入 SaaS 控制台</p>
                </div>

                <form @submit.prevent="onSubmit">
                    <div class="form-group">
                        <label class="form-label" for="email">邮箱</label>
                        <input id="email" v-model="email" class="form-input" type="email" autocomplete="email" required />
                    </div>

                    <div class="form-group">
                        <label class="form-label" for="password">密码</label>
                        <input
                            id="password"
                            v-model="password"
                            class="form-input"
                            type="password"
                            autocomplete="current-password"
                            required
                        />
                        <p v-if="error" class="form-error">{{ error }}</p>
                    </div>

                    <button class="btn btn-primary btn-full" type="submit" :disabled="submitting">
                        {{ submitting ? '登录中...' : '登录' }}
                    </button>
                </form>

                <div class="auth-footer">
                    <p>
                        还没有账号？
                        <RouterLink class="link" to="/register">注册</RouterLink>
                    </p>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/authStore.js';

const auth = useAuthStore();
const router = useRouter();

const email = ref('');
const password = ref('');
const error = ref('');
const submitting = ref(false);

async function onSubmit() {
    error.value = '';
    submitting.value = true;
    try {
        await auth.login({ email: email.value.trim(), password: password.value });
        await router.push('/app');
    } catch (e) {
        error.value = e?.message || '登录失败';
    } finally {
        submitting.value = false;
    }
}
</script>
