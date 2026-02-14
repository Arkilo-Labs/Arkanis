<script setup>
import { ref, onMounted } from 'vue';
import { useSocket } from '../composables/useSocket';
import ProviderCard from './ProviderCard.vue';
import CustomSelect from './CustomSelect.vue';

const { socket } = useSocket();
const providers = ref([]);
const isLoading = ref(false);
const showAddModal = ref(false);
const toast = ref({ show: false, message: '', type: 'info' });

const newProvider = ref({
  name: '',
  baseUrl: '',
  modelName: '',
  apiKey: '',
  thinkingMode: 'disabled',
  maxTokens: 8192,
  temperature: 0.2,
  description: ''
});

const thinkingModeOptions = [
  { value: 'enabled', label: 'Enabled' },
  { value: 'disabled', label: 'Disabled' },
  { value: 'none', label: 'None' }
];

async function loadProviders() {
  isLoading.value = true;
  try {
    const res = await fetch('/api/ai-providers');
    if (res.ok) {
      providers.value = await res.json();
    } else {
      showToast('加载 Provider 失败', 'error');
    }
  } catch (error) {
    console.error('加载 Provider 失败:', error);
    showToast('加载 Provider 失败', 'error');
  } finally {
    isLoading.value = false;
  }
}

async function createProvider() {
  if (!validateForm(newProvider.value)) {
    showToast('请填写所有必填字段', 'error');
    return;
  }

  try {
    const res = await fetch('/api/ai-providers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newProvider.value)
    });

    if (res.ok) {
      await loadProviders();
      showAddModal.value = false;
      resetForm();
      showToast('Provider 创建成功', 'success');
    } else {
      const data = await res.json();
      showToast(data.error || '创建失败', 'error');
    }
  } catch (error) {
    console.error('创建 Provider 失败:', error);
    showToast('创建 Provider 失败', 'error');
  }
}

async function updateProvider(providerData) {
  try {
    const res = await fetch(`/api/ai-providers/${providerData.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(providerData)
    });

    if (res.ok) {
      await loadProviders();
      showToast('Provider 更新成功', 'success');
    } else {
      const data = await res.json();
      showToast(data.error || '更新失败', 'error');
    }
  } catch (error) {
    console.error('更新 Provider 失败:', error);
    showToast('更新 Provider 失败', 'error');
  }
}

async function deleteProvider(id) {
  try {
    const res = await fetch(`/api/ai-providers/${id}`, {
      method: 'DELETE'
    });

    if (res.ok) {
      await loadProviders();
      showToast('Provider 删除成功', 'success');
    } else {
      const data = await res.json();
      showToast(data.error || '删除失败', 'error');
    }
  } catch (error) {
    console.error('删除 Provider 失败:', error);
    showToast('删除 Provider 失败', 'error');
  }
}

async function activateProvider(id) {
  try {
    const res = await fetch(`/api/ai-providers/${id}/activate`, {
      method: 'POST'
    });

    if (res.ok) {
      await loadProviders();
      showToast('Provider 已激活', 'success');
    } else {
      const data = await res.json();
      showToast(data.error || '激活失败', 'error');
    }
  } catch (error) {
    console.error('激活 Provider 失败:', error);
    showToast('激活 Provider 失败', 'error');
  }
}

function validateForm(data) {
  return data.name && data.baseUrl && data.modelName && data.apiKey;
}

function resetForm() {
  newProvider.value = {
    name: '',
    baseUrl: '',
    modelName: '',
    apiKey: '',
    thinkingMode: 'disabled',
    maxTokens: 8192,
    temperature: 0.2,
    description: ''
  };
}

function showToast(message, type = 'info') {
  toast.value = { show: true, message, type };
  setTimeout(() => {
    toast.value.show = false;
  }, 3000);
}

function openAddModal() {
  resetForm();
  showAddModal.value = true;
}

onMounted(() => {
  loadProviders();

  socket.on('providers-updated', () => {
    loadProviders();
  });
});
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="glass-card p-8 animate-slide-up">
      <div class="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
        <div>
          <span class="text-subtitle-en mb-2 block">AI Models Management</span>
          <h1 class="text-hero-cn text-apple-gradient">AI Provider</h1>
          <p class="text-sm text-white/50 mt-2">管理多个 AI Provider 配置</p>
        </div>
        <button @click="openAddModal" class="btn-glass h-14 px-8">
          <i class="fas fa-plus"></i>
          <span class="font-bold">添加 Provider</span>
        </button>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="isLoading" class="flex justify-center py-20">
      <div class="flex flex-col items-center gap-4">
        <i class="fas fa-spinner fa-spin text-4xl text-white/30"></i>
        <span class="text-white/50">Loading providers...</span>
      </div>
    </div>

    <!-- Provider List -->
    <transition-group 
      v-if="providers.length > 0" 
      name="provider-list"
      tag="div"
      class="provider-list-grid"
    >
      <ProviderCard
        v-for="(provider, index) in providers"
        :key="provider.id"
        :provider="provider"
        :style="{ 'animation-delay': `${index * 0.05}s` }"
        class="animate-slide-up"
        @update="updateProvider"
        @delete="deleteProvider"
        @activate="activateProvider"
      />
    </transition-group>

    <!-- Empty State -->
    <div v-else class="glass-card p-12 text-center animate-slide-up">
      <div class="empty-state-icon">
        <i class="fas fa-brain"></i>
      </div>
      <h3 class="text-xl text-white/70 mb-2 font-semibold">暂无 Provider</h3>
      <p class="text-sm text-white/50 mb-6">点击上方按钮添加您的第一个 AI Provider</p>
      <button @click="openAddModal" class="btn-glass">
        <i class="fas fa-plus"></i>
        <span>添加 Provider</span>
      </button>
    </div>

    <!-- Add Modal -->
    <transition
      enter-active-class="transition duration-200 ease-out"
      leave-active-class="transition duration-150 ease-in"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <div
        v-if="showAddModal"
        class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
        @click.self="showAddModal = false"
      >
        <div class="glass-card max-w-3xl w-full max-h-[90vh] overflow-y-auto p-8">
          <div class="flex items-center justify-between mb-6">
            <h2 class="text-2xl font-bold text-white">添加 Provider</h2>
            <button
              @click="showAddModal = false"
              class="p-2 rounded-lg hover:bg-white/10 text-white/60 transition-colors"
            >
              <i class="fas fa-times"></i>
            </button>
          </div>

          <div class="space-y-4">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label class="text-label block mb-2">
                  <i class="fas fa-tag text-xs mr-1"></i>
                  显示名称 *
                </label>
                <input v-model="newProvider.name" type="text" class="input-glass" placeholder="Claude Sonnet 4.5" required />
              </div>

              <div>
                <label class="text-label block mb-2">
                  <i class="fas fa-link text-xs mr-1"></i>
                  API Base URL *
                </label>
                <input v-model="newProvider.baseUrl" type="text" class="input-glass" placeholder="https://api.example.com" required />
              </div>

              <div>
                <label class="text-label block mb-2">
                  <i class="fas fa-cube text-xs mr-1"></i>
                  模型名称 *
                </label>
                <input v-model="newProvider.modelName" type="text" class="input-glass" placeholder="claude-sonnet-4-5" required />
              </div>

              <div>
                <label class="text-label block mb-2">
                  <i class="fas fa-key text-xs mr-1"></i>
                  API Key *
                </label>
                <input v-model="newProvider.apiKey" type="password" class="input-glass" placeholder="sk-..." required />
              </div>

              <div>
                <label class="text-label block mb-2">Thinking Mode</label>
                <CustomSelect
                  v-model="newProvider.thinkingMode"
                  :options="thinkingModeOptions"
                />
              </div>

              <div>
                <label class="text-label block mb-2">Max Tokens</label>
                <input v-model.number="newProvider.maxTokens" type="number" class="input-glass" />
              </div>

              <div>
                <label class="text-label block mb-2">Temperature</label>
                <input v-model.number="newProvider.temperature" type="number" step="0.1" class="input-glass" />
              </div>
            </div>

            <div>
              <label class="text-label block mb-2">描述</label>
              <textarea v-model="newProvider.description" class="input-glass min-h-[80px]" rows="3" placeholder="Provider 描述..."></textarea>
            </div>

            <div class="flex gap-3 pt-4">
              <button @click="createProvider" class="btn-glass flex-1 !border-green-500/30 !text-green-400">
                <i class="fas fa-save"></i>
                <span>创建</span>
              </button>
              <button @click="showAddModal = false" class="btn-glass flex-1">
                <i class="fas fa-times"></i>
                <span>取消</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </transition>

    <!-- Toast -->
    <transition
      enter-active-class="transition duration-200"
      leave-active-class="transition duration-150"
      enter-from-class="opacity-0 translate-x-full"
      leave-to-class="opacity-0 translate-x-full"
    >
      <div
        v-if="toast.show"
        :class="[
          'fixed top-24 right-4 z-50 glass-card px-6 py-3 flex items-center gap-3',
          'shadow-xl'
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
    </transition>
  </div>
</template>

<style scoped>
.provider-list-grid {
  display: grid;
  grid-template-columns: repeat(1, 1fr);
  gap: 1.5rem;
}

@media (min-width: 1024px) {
  .provider-list-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (min-width: 1536px) {
  .provider-list-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}

.provider-list-enter-active,
.provider-list-leave-active {
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.provider-list-enter-from {
  opacity: 0;
  transform: translateY(20px) scale(0.95);
}

.provider-list-leave-to {
  opacity: 0;
  transform: translateX(-20px) scale(0.95);
}

.provider-list-move {
  transition: transform 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.empty-state-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 80px;
  height: 80px;
  margin: 0 auto 1.5rem;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  font-size: 2rem;
  color: rgba(255, 255, 255, 0.3);
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  box-shadow: 
    inset 0 1px 0 0 rgba(255, 255, 255, 0.08),
    0 4px 16px rgba(0, 0, 0, 0.1);
}

.empty-state-icon:hover {
  transform: translateY(-4px) scale(1.05);
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.2);
  color: rgba(255, 255, 255, 0.5);
  box-shadow: 
    inset 0 1px 0 0 rgba(255, 255, 255, 0.12),
    0 0 0 1px rgba(255, 255, 255, 0.08),
    0 8px 24px rgba(0, 0, 0, 0.15);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}

.input-glass {
  width: 100%;
  padding: 0.75rem;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 0.5rem;
  color: white;
  font-size: 0.875rem;
  transition: all 0.2s;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  box-shadow: 
    inset 0 1px 0 0 rgba(255, 255, 255, 0.05),
    0 2px 6px rgba(0, 0, 0, 0.08);
}

.input-glass:focus {
  outline: none;
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.2);
  box-shadow: 
    inset 0 1px 0 0 rgba(255, 255, 255, 0.08),
    0 0 0 1px rgba(255, 255, 255, 0.08),
    0 4px 12px rgba(0, 0, 0, 0.1);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

.input-glass:hover:not(:focus) {
  border-color: rgba(255, 255, 255, 0.15);
  background: rgba(255, 255, 255, 0.06);
}

.input-glass::placeholder {
  color: rgba(255, 255, 255, 0.3);
}
</style>
