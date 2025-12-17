<script setup>
import { ref, computed } from 'vue';
import { Terminal, Activity, TrendingUp, Settings } from 'lucide-vue-next';
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
  { id: 'main', label: 'Strategy', icon: TrendingUp },
  { id: 'backtest', label: 'Backtest', icon: Terminal },
  { id: 'config', label: 'Config', icon: Settings }
];
</script>

<template>
  <div class="min-h-screen">
    <!-- Header -->
    <header class="fixed top-0 left-0 right-0 z-50 liquid-glass !rounded-none !border-x-0 !border-t-0">
      <div class="max-w-7xl mx-auto px-8 h-16 flex justify-between items-center">
        <!-- Logo -->
        <h1 class="text-xl font-semibold flex items-center gap-3 text-ink">
          <div class="flex items-center justify-center w-9 h-9 rounded-xl bg-blue shadow-button">
            <Activity class="w-5 h-5 text-white" />
          </div>
          VLM Trade
        </h1>

        <!-- Tabs -->
        <nav class="flex gap-1 p-1 rounded-xl bg-white/60 backdrop-blur-sm border border-black/[0.04] shadow-glass-sm">
          <button 
            v-for="tab in tabs"
            :key="tab.id"
            @click="currentTab = tab.id"
            :class="[
              'px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 flex items-center gap-2',
              currentTab === tab.id 
                ? 'bg-white text-ink shadow-glass-sm' 
                : 'text-ink-tertiary hover:text-ink-secondary hover:bg-white/50'
            ]"
          >
            <component :is="tab.icon" class="w-4 h-4" />
            {{ tab.label }}
          </button>
        </nav>
      </div>
    </header>

    <!-- Main -->
    <main class="max-w-7xl mx-auto pt-24 px-8 pb-12 animate-fade-in">
      <KeepAlive>
        <component :is="CurrentComponent" />
      </KeepAlive>
    </main>
  </div>
</template>
