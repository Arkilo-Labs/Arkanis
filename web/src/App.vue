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
</script>

<template>
  <div class="min-h-screen">
    <!-- Premium Header -->
    <header class="fixed top-0 left-0 right-0 z-50 bg-obsidian/80 backdrop-blur-md border-b border-white/5 shadow-glass">
      <div class="max-w-7xl mx-auto px-6 h-20 flex justify-between items-center">
        <!-- Logo Area -->
        <h1 class="text-2xl font-bold flex items-center gap-3 tracking-tight">
          <div class="relative flex items-center justify-center w-10 h-10 rounded-lg bg-gradient-to-br from-deep-teal to-neon-teal shadow-glow">
            <Activity class="w-6 h-6 text-obsidian" />
          </div>
          <span class="bg-gradient-to-r from-snow to-mist bg-clip-text text-transparent">VLM Trade</span>
        </h1>

        <!-- Navigation -->
        <nav class="flex gap-2 bg-charcoal/50 p-1.5 rounded-xl border border-white/5">
          <button 
            @click="currentTab = 'main'"
            :class="['px-5 py-2.5 rounded-lg text-sm font-medium transition-all duration-300 flex items-center gap-2', 
              currentTab === 'main' 
                ? 'bg-gradient-to-r from-deep-teal to-neon-teal text-obsidian shadow-lg shadow-neon-teal/20' 
                : 'text-mist hover:text-snow hover:bg-white/5']"
          >
            <TrendingUp class="w-4 h-4" />
            Strategy
          </button>
          <button 
            @click="currentTab = 'backtest'"
            :class="['px-5 py-2.5 rounded-lg text-sm font-medium transition-all duration-300 flex items-center gap-2', 
              currentTab === 'backtest' 
                ? 'bg-gradient-to-r from-purple-500 to-indigo-400 text-white shadow-lg shadow-purple-500/20' 
                : 'text-mist hover:text-snow hover:bg-white/5']"
          >
            <Terminal class="w-4 h-4" />
            Backtest
          </button>
          <button 
            @click="currentTab = 'config'"
            :class="['px-5 py-2.5 rounded-lg text-sm font-medium transition-all duration-300 flex items-center gap-2', 
              currentTab === 'config' 
                ? 'bg-gradient-to-r from-amber-500 to-orange-400 text-white shadow-lg shadow-amber-500/20' 
                : 'text-mist hover:text-snow hover:bg-white/5']"
          >
            <Settings class="w-4 h-4" />
            Config
          </button>
        </nav>
      </div>
    </header>

    <!-- Main Content Area -->
    <main class="max-w-7xl mx-auto pt-28 px-6 pb-12 animate-fade-in">
      <KeepAlive>
        <component :is="CurrentComponent" />
      </KeepAlive>
    </main>
  </div>
</template>

