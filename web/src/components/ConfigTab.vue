<script setup>
import { ref, onMounted, computed } from 'vue';
import { Settings, Save, Loader2, CheckCircle2, AlertCircle, Database, Key, BarChart2, FileText, Sliders } from 'lucide-vue-next';

const config = ref({});
const schema = ref({});
const isLoading = ref(false);
const isSaving = ref(false);
const saveStatus = ref(null);

// 图标映射
const groupIcons = {
  database: Database,
  openai: Key,
  chart: BarChart2,
  log: FileText,
  defaults: Sliders
};

// 输入类型映射
const inputTypes = {
  DB_PORT: 'number',
  DB_POOL_MIN: 'number',
  DB_POOL_MAX: 'number',
  DB_PASSWORD: 'password',
  OPENAI_API_KEY: 'password',
  OPENAI_MAX_TOKENS: 'number',
  OPENAI_TEMPERATURE: 'number',
  OPENAI_TIMEOUT: 'number',
  CHART_WIDTH: 'number',
  CHART_HEIGHT: 'number',
  CHART_VOLUME_PANE_HEIGHT: 'number',
  DEFAULT_BARS: 'number'
};

// Select 选项
const selectOptions = {
  OPENAI_ENABLE_THINKING: ['true', 'false'],
  LOG_LEVEL: ['debug', 'info', 'warn', 'error', 'silent'],
  DEFAULT_TIMEFRAME: ['1m', '5m', '15m', '30m', '1h', '4h', '1d']
};

async function loadConfig() {
  isLoading.value = true;
  try {
    const res = await fetch('/api/config');
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    config.value = data.config;
    schema.value = data.schema;
  } catch (e) {
    console.error('加载配置失败:', e);
  } finally {
    isLoading.value = false;
  }
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
  } catch (e) {
    console.error('保存配置失败:', e);
    saveStatus.value = 'error';
  } finally {
    isSaving.value = false;
  }
}

function getInputType(key) {
  return inputTypes[key] || 'text';
}

function hasSelectOptions(key) {
  return key in selectOptions;
}

function getSelectOptions(key) {
  return selectOptions[key] || [];
}

onMounted(loadConfig);
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="glass-card p-6 flex justify-between items-center">
      <div>
        <h1 class="text-2xl font-bold text-snow flex items-center gap-3">
          <Settings class="w-6 h-6 text-neon-teal" />
          Configuration
        </h1>
        <p class="text-mist text-sm mt-1">管理环境变量配置</p>
      </div>
      
      <button 
        @click="saveConfig"
        :disabled="isSaving"
        class="btn-primary flex items-center gap-2"
      >
        <Loader2 v-if="isSaving" class="w-5 h-5 animate-spin" />
        <Save v-else class="w-5 h-5" />
        {{ isSaving ? 'Saving...' : 'Save Config' }}
      </button>
    </div>

    <!-- Save Status -->
    <transition name="fade">
      <div v-if="saveStatus === 'success'" class="flex items-center gap-2 text-neon-teal bg-neon-teal/10 px-4 py-3 rounded-lg border border-neon-teal/30">
        <CheckCircle2 class="w-5 h-5" />
        <span>配置已保存成功，重启服务后生效</span>
      </div>
      <div v-else-if="saveStatus === 'error'" class="flex items-center gap-2 text-red-400 bg-red-500/10 px-4 py-3 rounded-lg border border-red-500/30">
        <AlertCircle class="w-5 h-5" />
        <span>保存失败，请检查服务器状态</span>
      </div>
    </transition>

    <!-- Loading -->
    <div v-if="isLoading" class="flex justify-center py-12">
      <Loader2 class="w-8 h-8 animate-spin text-neon-teal" />
    </div>

    <!-- Config Groups -->
    <div v-else class="space-y-6">
      <div 
        v-for="(group, groupKey) in schema" 
        :key="groupKey"
        class="glass-card p-6 animate-slide-up"
      >
        <h2 class="text-sm font-bold text-mist uppercase tracking-widest mb-6 flex items-center gap-2 border-b border-white/5 pb-4">
          <component :is="groupIcons[groupKey]" class="w-4 h-4 text-neon-teal" />
          {{ group.label }}
        </h2>
        
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          <div v-for="key in group.items" :key="key" class="group">
            <label class="block text-xs font-semibold text-mist uppercase tracking-wider mb-2 group-focus-within:text-neon-teal transition-colors">
              {{ key }}
            </label>
            
            <!-- Select -->
            <select 
              v-if="hasSelectOptions(key)"
              v-model="config[key]"
              class="input-premium cursor-pointer"
            >
              <option v-for="opt in getSelectOptions(key)" :key="opt" :value="opt">{{ opt }}</option>
            </select>
            
            <!-- Input -->
            <input 
              v-else
              v-model="config[key]"
              :type="getInputType(key)"
              class="input-premium font-mono"
              :placeholder="key"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
