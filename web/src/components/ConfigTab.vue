<script setup>
import { ref, onMounted } from 'vue';
import { Settings, Save, Loader2, CheckCircle2, AlertCircle, Database, Key, BarChart2, FileText, Sliders } from 'lucide-vue-next';

const config = ref({});
const schema = ref({});
const isLoading = ref(false);
const isSaving = ref(false);
const saveStatus = ref(null);

const groupIcons = { database: Database, openai: Key, chart: BarChart2, log: FileText, defaults: Sliders };
const inputTypes = {
  DB_PORT: 'number', DB_POOL_MIN: 'number', DB_POOL_MAX: 'number', DB_PASSWORD: 'password',
  OPENAI_API_KEY: 'password', OPENAI_MAX_TOKENS: 'number', OPENAI_TEMPERATURE: 'number', OPENAI_TIMEOUT: 'number',
  CHART_WIDTH: 'number', CHART_HEIGHT: 'number', CHART_VOLUME_PANE_HEIGHT: 'number', DEFAULT_BARS: 'number'
};
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
function hasSelectOptions(key) { return key in selectOptions; }
function getSelectOptions(key) { return selectOptions[key] || []; }

onMounted(loadConfig);
</script>

<template>
  <div class="space-y-5">
    <!-- Header -->
    <div class="liquid-glass p-5 flex justify-between items-center animate-slide-up">
      <div class="flex items-center gap-3">
        <div class="flex items-center justify-center w-9 h-9 rounded-xl bg-ink shadow">
          <Settings class="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 class="text-lg font-semibold text-ink">Configuration</h1>
          <p class="text-xs text-ink-tertiary">Environment variables</p>
        </div>
      </div>
      
      <button @click="saveConfig" :disabled="isSaving" class="btn-liquid flex items-center gap-2">
        <Loader2 v-if="isSaving" class="w-4 h-4 animate-spin" />
        <Save v-else class="w-4 h-4" />
        Save
      </button>
    </div>

    <!-- Status -->
    <transition enter-active-class="transition duration-200" leave-active-class="transition duration-150"
      enter-from-class="opacity-0 -translate-y-1" leave-to-class="opacity-0 -translate-y-1">
      <div v-if="saveStatus === 'success'" class="liquid-glass p-3 flex items-center gap-2 text-green text-sm">
        <CheckCircle2 class="w-4 h-4" /> Saved. Restart to apply.
      </div>
      <div v-else-if="saveStatus === 'error'" class="liquid-glass p-3 flex items-center gap-2 text-red text-sm">
        <AlertCircle class="w-4 h-4" /> Failed.
      </div>
    </transition>

    <!-- Loading -->
    <div v-if="isLoading" class="flex justify-center py-12">
      <Loader2 class="w-8 h-8 animate-spin text-ink-muted" />
    </div>

    <!-- Groups -->
    <div v-else class="space-y-5">
      <div v-for="(group, groupKey) in schema" :key="groupKey" class="liquid-glass p-5 animate-slide-up">
        <h2 class="text-xs font-semibold text-ink-tertiary uppercase tracking-wider mb-4 flex items-center gap-2 border-b border-black/[0.04] pb-3">
          <component :is="groupIcons[groupKey]" class="w-4 h-4" />
          {{ group.label }}
        </h2>
        
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          <div v-for="key in group.items" :key="key">
            <label class="block text-xs font-medium text-ink-secondary mb-1.5 truncate">{{ key }}</label>
            <select v-if="hasSelectOptions(key)" v-model="config[key]" class="select-liquid">
              <option v-for="opt in getSelectOptions(key)" :key="opt" :value="opt">{{ opt }}</option>
            </select>
            <input v-else v-model="config[key]" :type="getInputType(key)" class="input-liquid font-mono text-sm" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
