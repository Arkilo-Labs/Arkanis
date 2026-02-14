<script setup>
import { computed, ref } from 'vue';
import { login } from './composables/useAuth';

const username = ref('');
const password = ref('');
const isSubmitting = ref(false);
const error = ref('');

const canSubmit = computed(() => username.value.trim() && password.value);

async function submit() {
  error.value = '';
  if (!canSubmit.value) return;

  isSubmitting.value = true;
  try {
    await login({ username: username.value.trim(), password: password.value });
  } catch (e) {
    error.value = e?.message || String(e);
  } finally {
    isSubmitting.value = false;
  }
}
</script>

<template>
  <div class="glass-card w-full max-w-xl p-8">
    <div class="mb-6">
      <span class="text-subtitle-en mb-2 block">Admin sign in</span>
      <h1 class="text-hero-cn text-apple-gradient">登录</h1>
      <p class="text-sm text-white/50 mt-2">请输入管理员账号密码。</p>
    </div>

    <form class="space-y-4" @submit.prevent="submit">
      <div>
        <label class="text-label block mb-2">用户名</label>
        <input v-model="username" class="input-glass" type="text" autocomplete="username" />
      </div>

      <div>
        <label class="text-label block mb-2">密码</label>
        <input v-model="password" class="input-glass" type="password" autocomplete="current-password" />
      </div>

      <div v-if="error" class="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-200 text-sm">
        {{ error }}
      </div>

      <button class="btn-glass w-full h-14 justify-center" :disabled="!canSubmit || isSubmitting">
        <i :class="isSubmitting ? 'fas fa-spinner fa-spin' : 'fas fa-right-to-bracket'"></i>
        <span class="font-bold">登录</span>
      </button>
    </form>
  </div>
</template>

