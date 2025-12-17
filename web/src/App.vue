<script setup>
import { ref, computed } from 'vue';
import MainTab from './components/MainTab.vue';
import BacktestTab from './components/BacktestTab.vue';
import ConfigTab from './components/ConfigTab.vue';

const currentTab = ref('main');

const CurrentComponent = computed(() => {
  switch (currentTab.value) {
    case 'main': return MainTab;
    case 'backtest': return BacktestTab;
    case 'config': return ConfigTab;
    default: return MainTab;
  }
});

const tabs = [
  { id: 'main', label: '策略', labelEn: 'Strategy', icon: 'fas fa-chart-line' },
  { id: 'backtest', label: '回测', labelEn: 'Backtest', icon: 'fas fa-history' },
  { id: 'config', label: '配置', labelEn: 'Config', icon: 'fas fa-cog' }
];
</script>

<template>
  <div class="min-h-screen relative">

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

          <!-- Status Indicator -->
          <div class="hidden md:flex items-center gap-2">
            <span class="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
            <span class="text-xs text-white/50">Online</span>
          </div>
        </div>
      </div>
    </header>

    <!-- Main Content -->
    <main class="max-w-[1800px] mx-auto pt-24 px-4 pb-8">
      <KeepAlive>
        <component :is="CurrentComponent" />
      </KeepAlive>
    </main>

    <!-- Footer Gradient -->
    <div class="fixed bottom-0 left-0 right-0 h-24 pointer-events-none bg-gradient-to-t from-[#0a0a0f] to-transparent"></div>
  </div>
</template>
