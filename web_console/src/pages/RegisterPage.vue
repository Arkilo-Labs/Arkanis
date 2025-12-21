<template>
    <div class="auth-page">
        <div class="auth-container">
            <div class="auth-card">
                <div class="auth-header">
                    <div class="auth-logo">
                        <img src="/logo.png" alt="Arkilo" />
                        <span>Arkilo</span>
                    </div>
                    <h1 class="auth-title">注册</h1>
                    <p class="auth-subtitle">创建工作区并开始使用</p>
                </div>

                <form @submit.prevent="onSubmit">
                    <div class="form-group">
                        <label class="form-label" for="displayName">昵称（可选）</label>
                        <input id="displayName" v-model="displayName" class="form-input" type="text" maxlength="80" />
                    </div>

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
                            autocomplete="new-password"
                            required
                        />
                        <p v-if="error" class="form-error">{{ error }}</p>
                    </div>

                    <button class="btn btn-primary btn-full" type="submit" :disabled="submitting">
                        {{ submitting ? '注册中...' : '注册' }}
                    </button>
                </form>

                <div class="auth-footer">
                    <p>
                        已有账号？
                        <RouterLink class="link" to="/login">登录</RouterLink>
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

const displayName = ref('');
const email = ref('');
const password = ref('');
const error = ref('');
const submitting = ref(false);

async function onSubmit() {
    error.value = '';
    submitting.value = true;
    try {
        await auth.register({
            email: email.value.trim(),
            password: password.value,
            displayName: displayName.value.trim(),
        });
        await router.push('/app');
    } catch (e) {
        error.value = e?.message || '注册失败';
    } finally {
        submitting.value = false;
    }
}
</script>

