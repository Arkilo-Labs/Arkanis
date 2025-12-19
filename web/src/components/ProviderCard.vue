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

const isExpanded = ref(false);
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

function toggleExpand() {
  isExpanded.value = !isExpanded.value;
  if (!isExpanded.value) {
    isEditing.value = false;
    editForm.value = { ...props.provider };
  }
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
  }
}

function handleActivate() {
  if (!props.provider.isActive) {
    emit('activate', props.provider.id);
  }
}
</script>

<template>
  <div :class="['glass-card p-6 cursor-pointer transition-all duration-200', activeClass]" @click="toggleExpand">
    <div class="flex items-start justify-between" @click.stop>
      <div class="flex-1" @click="toggleExpand">
        <div class="flex items-center gap-3 mb-2">
          <h3 class="text-label font-bold">{{ provider.name }}</h3>
          <span
            v-if="provider.isActive"
            class="px-2 py-1 text-xs bg-green-500/20 text-green-400 rounded-lg border border-green-500/30"
          >
            当前使用
          </span>
        </div>

        <div class="text-sm text-white/50 space-y-1">
          <div class="flex items-center gap-2">
            <i class="fas fa-link text-xs"></i>
            <span class="font-mono truncate">{{ provider.baseUrl }}</span>
          </div>
          <div class="flex items-center gap-2">
            <i class="fas fa-cube text-xs"></i>
            <span class="font-mono">{{ provider.modelName }}</span>
          </div>
        </div>
      </div>

      <div class="flex items-center gap-2">
        <button
          v-if="!provider.isActive"
          @click.stop="handleActivate"
          class="p-2 rounded-lg hover:bg-green-500/10 text-green-400 transition-colors"
          title="激活此 Provider"
        >
          <i class="fas fa-check-circle"></i>
        </button>

        <button
          @click.stop="toggleExpand"
          class="p-2 rounded-lg hover:bg-white/10 text-white/60 transition-colors"
        >
          <i :class="isExpanded ? 'fas fa-chevron-up' : 'fas fa-chevron-down'"></i>
        </button>
      </div>
    </div>

    <transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0 -translate-y-2"
      leave-active-class="transition duration-150 ease-in"
      leave-to-class="opacity-0 -translate-y-2"
    >
      <div v-if="isExpanded" class="mt-6 pt-6 border-t border-white/10" @click.stop>
        <div v-if="!isEditing" class="space-y-4">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label class="text-label block mb-2">API Key</label>
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

          <div class="flex gap-3 pt-2">
            <button @click.stop="startEdit" class="btn-glass flex-1">
              <i class="fas fa-edit"></i>
              <span>编辑</span>
            </button>
            <button
              @click.stop="handleDelete"
              class="btn-glass flex-1 !border-red-500/30 !text-red-400 hover:!bg-red-500/10"
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

          <div class="flex gap-3 pt-2">
            <button @click.stop="saveEdit" class="btn-glass flex-1 !border-green-500/30 !text-green-400">
              <i class="fas fa-save"></i>
              <span>保存</span>
            </button>
            <button @click.stop="cancelEdit" class="btn-glass flex-1">
              <i class="fas fa-times"></i>
              <span>取消</span>
            </button>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<style scoped>
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
</style>
