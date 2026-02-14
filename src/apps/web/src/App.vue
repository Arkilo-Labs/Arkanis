<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import MainTab from './components/MainTab.vue';
import BacktestTab from './components/BacktestTab.vue';
import ConfigTab from './components/ConfigTab.vue';
import AIProvidersTab from './components/AIProvidersTab.vue';
import RunTab from './components/RunTab.vue';
import SetupPage from './SetupPage.vue';
import LoginPage from './LoginPage.vue';
import { useAuth } from './composables/useAuth';
import { useSocket } from './composables/useSocket';

const currentTab = ref('main');
const toast = ref({ show: false, message: '', type: 'info' });
const socketRef = ref(null);

const setupToken = (() => {
  const path = window.location.pathname || '/';
  const match = path.match(/^\/_setup\/([^/]+)(?:\/|$)/);
  return match ? match[1] : null;
})();
const isSetupPath = Boolean(setupToken);

const { status, loading, error, checkStatus, logout } = useAuth();
const isAuthed = computed(() => status.value.allowNoAuth || status.value.authed);
const needsSetup = computed(() => status.value.setupRequired || (!status.value.initialized && !status.value.allowNoAuth));

if (!isSetupPath) {
  checkStatus().catch(() => null);
}

const CurrentComponent = computed(() => {
  switch (currentTab.value) {
    case 'main': return MainTab;
    case 'run': return RunTab;
    case 'backtest': return BacktestTab;
    case 'config': return ConfigTab;
    case 'ai-providers': return AIProvidersTab;
    default: return MainTab;
  }
});

const tabs = [
  { id: 'main', label: '策略', labelEn: 'Strategy', icon: 'fas fa-chart-line' },
  { id: 'run', label: '自动运行', labelEn: 'Run', icon: 'fas fa-robot' },
  { id: 'backtest', label: '回测', labelEn: 'Backtest', icon: 'fas fa-history' },
  { id: 'config', label: '配置', labelEn: 'Config', icon: 'fas fa-cog' },
  { id: 'ai-providers', label: 'AI Provider', labelEn: 'AI Models', icon: 'fas fa-brain' }
];

function showToast(message, type = 'info') {
  toast.value = { show: true, message, type };
  setTimeout(() => {
    toast.value.show = false;
  }, 3000);
}

function onConfigReload(data) {
  const fileName = data.file === '.env' ? '环境配置' : '桥接配置';
  showToast(`${fileName}已更新，脚本将自动使用新配置`, 'success');
}

async function onLogout() {
  await logout().catch(() => null);
  currentTab.value = 'main';
  showToast('已登出', 'success');
}

function handleMouseMove(e) {
  // 更新背景发光位置
  const appContainer = document.querySelector('.app-container');
  if (appContainer) {
    appContainer.style.setProperty('--mouse-x', `${e.clientX}px`);
    appContainer.style.setProperty('--mouse-y', `${e.clientY}px`);
  }

  // 更新卡片、标签、下拉框、按钮和开关的发光位置
  const elements = document.querySelectorAll('.glass-card, .menu-item, .custom-select, .btn-glass, .toggle-glass');
  elements.forEach(element => {
    const rect = element.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    element.style.setProperty('--mouse-x', `${x}px`);
    element.style.setProperty('--mouse-y', `${y}px`);
  });
}

onMounted(() => {
  document.addEventListener('mousemove', handleMouseMove);
});

watch(isAuthed, (authed) => {
  if (isSetupPath) return;
  if (authed) {
    const { socket } = useSocket();
    socketRef.value = socket;
    socket.on('config-reload', onConfigReload);
    return;
  }
  if (socketRef.value) {
    socketRef.value.off('config-reload', onConfigReload);
    socketRef.value = null;
  }
}, { immediate: true });

onUnmounted(() => {
  if (socketRef.value) {
    socketRef.value.off('config-reload', onConfigReload);
  }
  document.removeEventListener('mousemove', handleMouseMove);
});
</script>

<template>
  <div class="min-h-screen relative app-container">
    <div class="mouse-glow"></div>

    <div v-if="isSetupPath" class="min-h-screen flex items-center justify-center px-4 py-12 relative z-10">
      <SetupPage :setupToken="setupToken" />
    </div>

    <template v-else>
      <div v-if="loading" class="min-h-screen flex items-center justify-center px-4 py-12 relative z-10">
        <div class="glass-card px-6 py-4 flex items-center gap-3">
          <i class="fas fa-spinner fa-spin text-white/40"></i>
          <span class="text-sm text-white/70">正在检测登录状态...</span>
        </div>
      </div>

      <div v-else-if="error" class="min-h-screen flex items-center justify-center px-4 py-12 relative z-10">
        <div class="glass-card w-full max-w-xl p-8">
          <span class="text-subtitle-en mb-2 block">Backend offline</span>
          <h1 class="text-hero-cn text-apple-gradient">无法连接后端</h1>
          <p class="text-sm text-white/50 mt-2">请先启动 `pnpm dev:server`，然后重试。</p>
          <button class="btn-glass w-full h-14 justify-center mt-6" @click="checkStatus">
            <i class="fas fa-rotate-right"></i>
            <span class="font-bold">重试</span>
          </button>
        </div>
      </div>

      <div v-else-if="needsSetup" class="min-h-screen flex items-center justify-center px-4 py-12 relative z-10">
        <div class="glass-card w-full max-w-xl p-8">
          <span class="text-subtitle-en mb-2 block">Setup required</span>
          <h1 class="text-hero-cn text-apple-gradient">需要初始化</h1>
          <p class="text-sm text-white/50 mt-2">
            请查看 server 控制台输出的 URL，然后访问
            <span class="font-mono text-white/80">/_setup/&lt;token&gt;</span>
            完成初始化。
          </p>
          <button class="btn-glass w-full h-14 justify-center mt-6" @click="checkStatus">
            <i class="fas fa-rotate-right"></i>
            <span class="font-bold">重新检测</span>
          </button>
        </div>
      </div>

      <div v-else-if="!isAuthed" class="min-h-screen flex items-center justify-center px-4 py-12 relative z-10">
        <LoginPage />
      </div>

      <template v-else>
        <!-- Header -->
        <header class="fixed top-0 left-0 right-0 z-50">
          <div class="glass-card !rounded-none !border-x-0 !border-t-0 !rounded-b-2xl mx-4 mt-0">
            <div class="max-w-[1800px] mx-auto px-6 h-16 flex justify-between items-center">
              <!-- Logo -->
              <div>
                <h1 class="text-lg font-bold text-white tracking-tight">VLM Trade</h1>
                <span class="text-subtitle-en text-[10px] opacity-60">AI Trading Analysis</span>
              </div>

              <!-- Tabs -->
              <nav class="flex gap-1 p-1 rounded-xl bg-white/5 backdrop-blur-sm border border-white/10">
                <button 
                  v-for="tab in tabs"
                  :key="tab.id"
                  @click="currentTab = tab.id"
                  :class="[
                    'menu-item px-4 py-2 text-sm font-medium transition-all duration-200 flex items-center gap-2',
                    currentTab === tab.id 
                      ? 'active text-white' 
                      : 'text-white/50 hover:text-white/80'
                  ]"
                >
                  <i :class="[tab.icon, 'text-xs']"></i>
                  <span class="font-semibold">{{ tab.label }}</span>
                  <span class="text-[10px] opacity-50 hidden sm:inline">{{ tab.labelEn }}</span>
                </button>
              </nav>

              <!-- Status Indicator & Social Links -->
              <div class="flex items-center gap-4">
                <div class="hidden md:flex items-center gap-2">
                  <span class="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                  <span class="text-xs text-white/50">Online</span>
                </div>
                
                <!-- Social Icons -->
                <div class="flex items-center gap-3">
                  <a 
                    href="https://x.com/qqqqqf5" 
                    target="_blank"
                    rel="noopener noreferrer"
                    class="social-icon-link"
                  >
                    <i class="fa-brands fa-x-twitter"></i>
                  </a>
                  <a 
                    href="https://github.com/qqqqqf-q" 
                    target="_blank"
                    rel="noopener noreferrer"
                    class="social-icon-link"
                  >
                    <i class="fab fa-github"></i>
                  </a>
                </div>

                <button class="btn-glass-secondary h-10 px-4" @click="onLogout">
                  <i class="fas fa-arrow-right-from-bracket"></i>
                  <span class="font-semibold">登出</span>
                </button>
              </div>
            </div>
          </div>
        </header>

        <!-- Main Content -->
        <main class="max-w-[1800px] mx-auto pt-24 px-4 pb-8">
          <KeepAlive>
            <component :is="CurrentComponent" @switchTab="currentTab = $event" />
          </KeepAlive>
        </main>

        <!-- Footer Gradient -->
        <div class="fixed bottom-0 left-0 right-0 h-24 pointer-events-none bg-gradient-to-t from-[#0a0a0f] to-transparent"></div>

        <!-- Toast Notification -->
        <Transition name="toast">
          <div 
            v-if="toast.show"
            :class="[
              'fixed top-24 right-4 z-50 glass-card px-6 py-3 flex items-center gap-3',
              'shadow-xl animate-slide-up'
            ]"
          >
            <i :class="[
              'fas',
              toast.type === 'success' ? 'fa-check-circle text-green-400' :
              toast.type === 'error' ? 'fa-exclamation-circle text-red-400' :
              'fa-info-circle text-blue-400'
            ]"></i>
            <span class="text-sm text-white/90">{{ toast.message }}</span>
          </div>
        </Transition>
      </template>
    </template>
  </div>
</template>

<style scoped>
.app-container {
  --mouse-x: 50%;
  --mouse-y: 50%;
}

.mouse-glow {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 1;
  opacity: 0.4;
  background: radial-gradient(
    500px circle at var(--mouse-x) var(--mouse-y),
    rgba(255, 255, 255, 0.08),
    rgba(255, 255, 255, 0.02) 40%,
    transparent 100%
  );
  transition: opacity 0.3s ease;
}

.toast-enter-active,
.toast-leave-active {
  transition: all 0.3s ease;
}

.toast-enter-from {
  opacity: 0;
  transform: translateX(100px);
}

.toast-leave-to {
  opacity: 0;
  transform: translateY(-20px);
}

.social-icon-link {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.6);
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  font-size: 16px;
  position: relative;
  overflow: hidden;
}

.social-icon-link::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 10px;
  padding: 1px;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.2), rgba(255, 255, 255, 0.05));
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  opacity: 0;
  transition: opacity 0.3s ease;
}

.social-icon-link::after {
  content: '';
  position: absolute;
  inset: -2px;
  border-radius: 12px;
  background: radial-gradient(circle at center, rgba(255, 255, 255, 0.3), transparent 70%);
  opacity: 0;
  transition: opacity 0.3s ease;
  filter: blur(8px);
}

.social-icon-link:hover {
  transform: translateY(-3px);
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.2);
  color: rgba(255, 255, 255, 0.95);
  box-shadow: 
    0 0 20px rgba(255, 255, 255, 0.1),
    0 0 40px rgba(255, 255, 255, 0.05);
}

.social-icon-link:hover::before {
  opacity: 1;
}

.social-icon-link:hover::after {
  opacity: 1;
}

.social-icon-link:active {
  transform: translateY(-1px);
}
</style>
