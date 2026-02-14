<script setup>
import { computed, ref } from 'vue';
import { setToken } from './composables/useAuth';

const props = defineProps({
  setupToken: { type: String, required: true },
});

const USERNAME_REGEX = /^[a-zA-Z0-9_-]{3,64}$/;

const username = ref('');
const password = ref('');
const confirmPassword = ref('');
const isSubmitting = ref(false);
const error = ref('');

const validationMessage = computed(() => {
  const trimmedUsername = username.value.trim();
  if (!trimmedUsername) return '请输入用户名（3-64 位，字母/数字/_/-）';
  if (!USERNAME_REGEX.test(trimmedUsername)) return '用户名需为 3-64 位字母/数字/_/-';
  if (!password.value) return '请输入密码（至少 8 位）';
  if (password.value.length < 8) return '密码至少 8 位';
  if (!confirmPassword.value) return '请再次输入密码';
  if (password.value !== confirmPassword.value) return '两次密码不一致';
  return '';
});

const canSubmit = computed(() => validationMessage.value === '');

async function submit() {
  error.value = '';
  if (!canSubmit.value) {
    error.value = validationMessage.value;
    return;
  }

  isSubmitting.value = true;
  try {
    const res = await fetch(`/_setup/${props.setupToken}/api/setup/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username.value.trim(), password: password.value }),
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      const message =
        payload && typeof payload === 'object' && payload.error
          ? String(payload.error)
          : `请求失败: ${res.status}`;
      throw new Error(message);
    }

    setToken(payload.token);
    window.location.assign('/');
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
      <span class="text-subtitle-en mb-2 block">First time setup</span>
      <h1 class="text-hero-cn text-apple-gradient">初始化管理员</h1>
      <p class="text-sm text-white/50 mt-2">首次部署需要创建管理员账号，用于后续登录。</p>
    </div>

    <form class="space-y-4" @submit.prevent="submit">
      <div>
        <label class="text-label block mb-2">用户名</label>
        <input v-model="username" class="input-glass" type="text" placeholder="admin" autocomplete="username" />
        <p class="text-xs text-white/40 mt-2">仅允许字母/数字/_/-，长度 3-64。</p>
      </div>

      <div>
        <label class="text-label block mb-2">密码</label>
        <input
          v-model="password"
          class="input-glass"
          type="password"
          placeholder="至少 8 位"
          autocomplete="new-password"
        />
      </div>

      <div>
        <label class="text-label block mb-2">确认密码</label>
        <input
          v-model="confirmPassword"
          class="input-glass"
          type="password"
          placeholder="再输入一次"
          autocomplete="new-password"
        />
      </div>

      <p v-if="!error && !canSubmit" class="text-xs text-white/40">
        {{ validationMessage }}
      </p>

      <div v-if="error" class="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-200 text-sm">
        {{ error }}
      </div>

      <button class="btn-glass w-full h-14 justify-center" :disabled="isSubmitting">
        <i :class="isSubmitting ? 'fas fa-spinner fa-spin' : 'fas fa-wrench'"></i>
        <span class="font-bold">完成初始化</span>
      </button>
    </form>
  </div>
</template>
