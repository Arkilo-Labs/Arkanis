<script setup>
import { ref, onMounted } from 'vue';

const config = ref({});
const schema = ref({});
const isLoading = ref(false);
const isSaving = ref(false);
const saveStatus = ref(null);

const groupIcons = { 
  database: 'fas fa-database', 
  openai: 'fas fa-key', 
  chart: 'fas fa-chart-bar', 
  log: 'fas fa-file-alt', 
  defaults: 'fas fa-sliders-h' 
};

const inputTypes = {
  DB_PORT: 'number', DB_POOL_MIN: 'number', DB_POOL_MAX: 'number', DB_PASSWORD: 'password',
  OPENAI_API_KEY: 'password', OPENAI_MAX_TOKENS: 'number', OPENAI_TEMPERATURE: 'number', OPENAI_TIMEOUT: 'number',
  CHART_WIDTH: 'number', CHART_HEIGHT: 'number', CHART_VOLUME_PANE_HEIGHT: 'number', DEFAULT_BARS: 'number'
};

const selectOptions = ref({
  OPENAI_ENABLE_THINKING: ['true', 'false'],
  LOG_LEVEL: ['debug', 'info', 'warn', 'error', 'silent'],
  DEFAULT_TIMEFRAME: ['1m', '5m', '15m', '30m', '1h', '4h', '1d'],
  PROMPT_NAME: ['default'] // Default, will be updated from API
});

async function loadConfig() {
  isLoading.value = true;
  try {
    const [resConfig, resPrompts] = await Promise.all([
      fetch('/api/config'),
      fetch('/api/prompts')
    ]);
    
    const data = await resConfig.json();
    if (data.error) throw new Error(data.error);
    config.value = data.config;
    schema.value = data.schema;

    const prompts = await resPrompts.json();
    if (Array.isArray(prompts)) {
      selectOptions.value.PROMPT_NAME = prompts;
    }
  } catch (e) { console.error(e); }
  finally { isLoading.value = false; }
}

async function saveConfig() {
  isSaving.value = true;
  saveStatus.value = null;
  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: config.value })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    saveStatus.value = 'success';
    setTimeout(() => saveStatus.value = null, 3000);
  } catch (e) { saveStatus.value = 'error'; }
  finally { isSaving.value = false; }
}

function getInputType(key) { return inputTypes[key] || 'text'; }
function hasSelectOptions(key) { return key in selectOptions.value; }
function getSelectOptions(key) { return selectOptions.value[key] || []; }

onMounted(loadConfig);
</script>

<template>
  <div class="space-y-6">
    <!-- Hero Section -->
    <div class="glass-card p-8 animate-slide-up">
      <div class="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
        <div>
          <span class="text-subtitle-en mb-2 block">Environment Variables</span>
          <h1 class="text-hero-cn text-apple-gradient">系统配置</h1>
        </div>
        <div class="flex items-center gap-4">
          <button 
            @click="saveConfig" 
            :disabled="isSaving"
            class="btn-glass h-14 px-8"
          >
            <i :class="isSaving ? 'fas fa-spinner fa-spin' : 'fas fa-save'"></i>
            <span class="font-bold">保存配置</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Status Toast -->
    <transition 
      enter-active-class="transition duration-200" 
      leave-active-class="transition duration-150"
      enter-from-class="opacity-0 -translate-y-2" 
      leave-to-class="opacity-0 -translate-y-2"
    >
      <div v-if="saveStatus === 'success'" class="glass-card p-4 flex items-center gap-3 border-green-500/30">
        <i class="fas fa-check-circle text-green-400"></i>
        <span class="text-green-400">保存成功，重启后生效 Saved. Restart to apply.</span>
      </div>
      <div v-else-if="saveStatus === 'error'" class="glass-card p-4 flex items-center gap-3 border-red-500/30">
        <i class="fas fa-exclamation-circle text-red-400"></i>
        <span class="text-red-400">保存失败 Failed to save.</span>
      </div>
    </transition>

    <!-- Loading -->
    <div v-if="isLoading" class="flex justify-center py-20">
      <div class="flex flex-col items-center gap-4">
        <i class="fas fa-spinner fa-spin text-4xl text-white/30"></i>
        <span class="text-white/50">Loading configuration...</span>
      </div>
    </div>

    <!-- Config Groups -->
    <div v-else class="space-y-6">
      <div 
        v-for="(group, groupKey) in schema" 
        :key="groupKey" 
        class="glass-card p-6 animate-slide-up"
      >
        <h2 class="text-label flex items-center gap-2 mb-6 pb-4 border-b border-white/10">
          <i :class="groupIcons[groupKey]"></i>
          {{ group.label }}
        </h2>
        
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          <div v-for="key in group.items" :key="key">
            <label class="text-label block mb-2 truncate" :title="key">{{ key }}</label>
            <select 
              v-if="hasSelectOptions(key)" 
              v-model="config[key]" 
              class="input-glass select-glass"
            >
              <option v-for="opt in getSelectOptions(key)" :key="opt" :value="opt">{{ opt }}</option>
            </select>
            <input 
              v-else 
              v-model="config[key]" 
              :type="getInputType(key)" 
              class="input-glass font-mono text-sm"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
