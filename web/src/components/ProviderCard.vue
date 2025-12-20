<script setup>
import { ref, computed } from 'vue';
import CustomSelect from './CustomSelect.vue';

const props = defineProps({
  provider: {
    type: Object,
    required: true
  }
});

const emit = defineEmits(['update', 'delete', 'activate']);

const showDetailModal = ref(false);
const isEditing = ref(false);
const editForm = ref({ ...props.provider });

const thinkingModeOptions = [
  { value: 'enabled', label: 'Enabled' },
  { value: 'disabled', label: 'Disabled' },
  { value: 'none', label: 'None' }
];

const activeClass = computed(() =>
  props.provider.isActive ? 'border-green-500/50 bg-green-500/5' : ''
);

function openDetailModal() {
  showDetailModal.value = true;
  isEditing.value = false;
  editForm.value = { ...props.provider };
}

function closeDetailModal() {
  showDetailModal.value = false;
  isEditing.value = false;
  editForm.value = { ...props.provider };
}

function startEdit() {
  isEditing.value = true;
  editForm.value = { ...props.provider };
}

function cancelEdit() {
  isEditing.value = false;
  editForm.value = { ...props.provider };
}

function saveEdit() {
  emit('update', editForm.value);
  isEditing.value = false;
}

function handleDelete() {
  if (confirm(`确定删除 Provider "${props.provider.name}"？`)) {
    emit('delete', props.provider.id);
    closeDetailModal();
  }
}

function handleActivate() {
  if (!props.provider.isActive) {
    emit('activate', props.provider.id);
  }
}
</script>

<template>
  <div 
    :class="[
      'provider-card glass-card p-6 transition-all duration-300 cursor-pointer',
      { 'provider-card-active': provider.isActive }
    ]" 
    @click="openDetailModal"
  >
    <div class="flex items-start justify-between">
      <div class="flex-1">
        <!-- Header -->
        <div class="flex items-center gap-3 mb-3">
          <div class="provider-icon">
            <i class="fas fa-brain"></i>
          </div>
          <div class="flex-1">
            <div class="flex items-center gap-2 mb-1">
              <h3 class="text-base font-bold text-white">{{ provider.name }}</h3>
              <transition name="badge-fade">
                <span
                  v-if="provider.isActive"
                  class="badge-glass badge-green animate-pulse-subtle"
                >
                  <span class="status-dot"></span>
                  当前使用
                </span>
              </transition>
            </div>
            <div class="text-xs text-white/40 font-mono">{{ provider.modelName }}</div>
          </div>
        </div>

        <!-- Info -->
        <div class="space-y-2 text-sm text-white/50">
          <div class="flex items-center gap-2">
            <i class="fas fa-link text-xs w-4"></i>
            <span class="font-mono truncate text-xs">{{ provider.baseUrl }}</span>
          </div>
          <div class="flex items-center gap-3 text-xs">
            <div class="flex items-center gap-1.5">
              <i class="fas fa-layer-group w-4"></i>
              <span>{{ provider.thinkingMode || 'none' }}</span>
            </div>
            <div class="flex items-center gap-1.5">
              <i class="fas fa-temperature-half w-4"></i>
              <span>{{ provider.temperature || 'N/A' }}</span>
            </div>
            <div class="flex items-center gap-1.5">
              <i class="fas fa-gauge w-4"></i>
              <span>{{ provider.maxTokens || 'N/A' }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Actions -->
      <div class="flex items-center gap-2 ml-4">
        <button
          v-if="!provider.isActive"
          @click.stop="handleActivate"
          class="action-btn action-btn-activate"
          title="激活此 Provider"
        >
          <i class="fas fa-check-circle"></i>
        </button>
      </div>
    </div>
  </div>

  <!-- Detail Modal -->
  <transition
    enter-active-class="transition duration-200 ease-out"
    leave-active-class="transition duration-150 ease-in"
    enter-from-class="opacity-0"
    leave-to-class="opacity-0"
  >
    <div
      v-if="showDetailModal"
      class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      @click.self="closeDetailModal"
    >
      <div class="glass-card max-w-3xl w-full max-h-[90vh] overflow-y-auto p-8 animate-modal-in" @click.stop>
        <div class="flex items-center justify-between mb-6">
          <div>
            <h2 class="text-2xl font-bold text-white mb-1">{{ provider.name }}</h2>
            <p class="text-sm text-white/50 font-mono">{{ provider.modelName }}</p>
          </div>
          <button
            @click="closeDetailModal"
            class="p-2 rounded-lg hover:bg-white/10 text-white/60 transition-colors"
          >
            <i class="fas fa-times"></i>
          </button>
        </div>

        <div v-if="!isEditing" class="space-y-4">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label class="text-label block mb-2">
                <i class="fas fa-link text-xs mr-1"></i>
                API Base URL
              </label>
              <div class="font-mono text-sm text-white/70 bg-white/5 p-3 rounded-lg">
                {{ provider.baseUrl }}
              </div>
            </div>

            <div>
              <label class="text-label block mb-2">
                <i class="fas fa-key text-xs mr-1"></i>
                API Key
              </label>
              <div class="font-mono text-sm text-white/70 bg-white/5 p-3 rounded-lg">
                {{ provider.apiKey.substring(0, 20) }}...
              </div>
            </div>

            <div>
              <label class="text-label block mb-2">Thinking Mode</label>
              <div class="text-sm text-white/70 bg-white/5 p-3 rounded-lg">
                {{ provider.thinkingMode || 'none' }}
              </div>
            </div>

            <div>
              <label class="text-label block mb-2">Max Tokens</label>
              <div class="text-sm text-white/70 bg-white/5 p-3 rounded-lg">
                {{ provider.maxTokens || 'N/A' }}
              </div>
            </div>

            <div>
              <label class="text-label block mb-2">Temperature</label>
              <div class="text-sm text-white/70 bg-white/5 p-3 rounded-lg">
                {{ provider.temperature || 'N/A' }}
              </div>
            </div>
          </div>

          <div v-if="provider.description">
            <label class="text-label block mb-2">描述</label>
            <div class="text-sm text-white/70 bg-white/5 p-3 rounded-lg">
              {{ provider.description }}
            </div>
          </div>

          <div class="flex gap-3 pt-4">
            <button @click.stop="startEdit" class="btn-glass flex-1">
              <i class="fas fa-edit"></i>
              <span>编辑</span>
            </button>
            <button
              @click.stop="handleDelete"
              class="btn-glass btn-glass-danger flex-1"
            >
              <i class="fas fa-trash"></i>
              <span>删除</span>
            </button>
          </div>
        </div>

        <div v-else class="space-y-4">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label class="text-label block mb-2">显示名称 *</label>
              <input v-model="editForm.name" type="text" class="input-glass" required />
            </div>

            <div>
              <label class="text-label block mb-2">API Base URL *</label>
              <input v-model="editForm.baseUrl" type="text" class="input-glass" required />
            </div>

            <div>
              <label class="text-label block mb-2">模型名称 *</label>
              <input v-model="editForm.modelName" type="text" class="input-glass" required />
            </div>

            <div>
              <label class="text-label block mb-2">API Key *</label>
              <input v-model="editForm.apiKey" type="password" class="input-glass" required />
            </div>

            <div>
              <label class="text-label block mb-2">Thinking Mode</label>
              <CustomSelect
                v-model="editForm.thinkingMode"
                :options="thinkingModeOptions"
              />
            </div>

            <div>
              <label class="text-label block mb-2">Max Tokens</label>
              <input v-model.number="editForm.maxTokens" type="number" class="input-glass" />
            </div>

            <div>
              <label class="text-label block mb-2">Temperature</label>
              <input v-model.number="editForm.temperature" type="number" step="0.1" class="input-glass" />
            </div>
          </div>

          <div>
            <label class="text-label block mb-2">描述</label>
            <textarea v-model="editForm.description" class="input-glass min-h-[80px]" rows="3"></textarea>
          </div>

          <div class="flex gap-3 pt-4">
            <button @click.stop="saveEdit" class="btn-glass flex-1 btn-glass-success">
              <i class="fas fa-save"></i>
              <span>保存</span>
            </button>
            <button @click.stop="cancelEdit" class="btn-glass btn-glass-secondary flex-1">
              <i class="fas fa-times"></i>
              <span>取消</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.provider-card {
  position: relative;
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  box-shadow: 
    inset 0 1px 0 0 rgba(255, 255, 255, 0.1),
    0 8px 24px rgba(0, 0, 0, 0.2);
}

.provider-card-active {
  background: rgba(52, 199, 89, 0.06);
  border-color: rgba(52, 199, 89, 0.4);
  box-shadow: 
    inset 0 1px 0 0 rgba(52, 199, 89, 0.3),
    0 0 0 1px rgba(52, 199, 89, 0.2),
    0 8px 32px rgba(52, 199, 89, 0.15);
}

.provider-card-active::before {
  background: radial-gradient(
    600px circle at var(--mouse-x) var(--mouse-y),
    rgba(52, 199, 89, 0.5),
    rgba(52, 199, 89, 0.15) 40%,
    transparent 100%
  );
}

.provider-card-active::after {
  background: radial-gradient(
    400px circle at var(--mouse-x) var(--mouse-y),
    rgba(52, 199, 89, 0.25),
    rgba(52, 199, 89, 0.08) 40%,
    transparent 100%
  );
}

.provider-card:hover {
  transform: translateY(-4px);
  box-shadow: 
    inset 0 1px 0 0 rgba(255, 255, 255, 0.15),
    0 0 0 1px rgba(255, 255, 255, 0.1),
    0 16px 40px rgba(0, 0, 0, 0.3);
  backdrop-filter: blur(32px) saturate(200%);
  -webkit-backdrop-filter: blur(32px) saturate(200%);
}

.provider-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.7);
  font-size: 18px;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 
    inset 0 1px 0 0 rgba(255, 255, 255, 0.1),
    0 2px 8px rgba(0, 0, 0, 0.1);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.provider-card-active .provider-icon {
  background: rgba(52, 199, 89, 0.12);
  border-color: rgba(52, 199, 89, 0.4);
  color: #34c759;
  box-shadow: 
    inset 0 1px 0 0 rgba(52, 199, 89, 0.2),
    0 0 0 1px rgba(52, 199, 89, 0.15),
    0 4px 12px rgba(52, 199, 89, 0.2);
}

.status-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  animation: pulse-dot 2s ease-in-out infinite;
}

@keyframes pulse-dot {
  0%, 100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.5;
    transform: scale(0.9);
  }
}

.animate-pulse-subtle {
  animation: pulse-subtle 3s ease-in-out infinite;
}

@keyframes pulse-subtle {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.85;
  }
}

.action-btn {
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
  font-size: 14px;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  box-shadow: 
    inset 0 1px 0 0 rgba(255, 255, 255, 0.08),
    0 2px 6px rgba(0, 0, 0, 0.1);
}

.action-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  border-color: rgba(255, 255, 255, 0.2);
  color: rgba(255, 255, 255, 0.9);
  transform: translateY(-2px);
  box-shadow: 
    inset 0 1px 0 0 rgba(255, 255, 255, 0.12),
    0 0 0 1px rgba(255, 255, 255, 0.08),
    0 4px 12px rgba(0, 0, 0, 0.2);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

.action-btn:active {
  transform: translateY(0);
}

.action-btn-activate {
  color: #34c759;
  background: rgba(52, 199, 89, 0.08);
  border-color: rgba(52, 199, 89, 0.25);
  box-shadow: 
    inset 0 1px 0 0 rgba(52, 199, 89, 0.15),
    0 2px 8px rgba(52, 199, 89, 0.15);
}

.action-btn-activate:hover {
  background: rgba(52, 199, 89, 0.15);
  border-color: rgba(52, 199, 89, 0.4);
  box-shadow: 
    inset 0 1px 0 0 rgba(52, 199, 89, 0.2),
    0 0 0 1px rgba(52, 199, 89, 0.15),
    0 4px 16px rgba(52, 199, 89, 0.25);
}

.badge-fade-enter-active,
.badge-fade-leave-active {
  transition: all 0.3s ease;
}

.badge-fade-enter-from {
  opacity: 0;
  transform: scale(0.8);
}

.badge-fade-leave-to {
  opacity: 0;
  transform: scale(0.8);
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
}

.input-glass:focus {
  outline: none;
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.2);
}

.input-glass::placeholder {
  color: rgba(255, 255, 255, 0.3);
}

.btn-glass-success {
  background: rgba(52, 199, 89, 0.12);
  border-color: rgba(52, 199, 89, 0.35);
  color: #34c759;
  box-shadow: 
    inset 0 1px 0 0 rgba(52, 199, 89, 0.2),
    0 0 0 1px rgba(52, 199, 89, 0.1),
    0 4px 12px rgba(52, 199, 89, 0.15);
}

.btn-glass-success:hover {
  background: rgba(52, 199, 89, 0.2);
  border-color: rgba(52, 199, 89, 0.5);
  box-shadow: 
    inset 0 1px 0 0 rgba(52, 199, 89, 0.25),
    0 0 0 1px rgba(52, 199, 89, 0.2),
    0 6px 20px rgba(52, 199, 89, 0.25);
}

@keyframes modal-in {
  from {
    opacity: 0;
    transform: scale(0.95) translateY(20px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

.animate-modal-in {
  animation: modal-in 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
</style>
