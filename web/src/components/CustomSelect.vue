<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue';

const props = defineProps({
  modelValue: String,
  options: Array,
  placeholder: String
});

const emit = defineEmits(['update:modelValue']);

const isOpen = ref(false);
const triggerRef = ref(null);
const dropdownRef = ref(null);
const dropdownStyle = ref({});

const selectedLabel = computed(() => {
  const option = props.options.find(opt => opt.value === props.modelValue);
  return option ? option.label : props.placeholder || 'Select';
});

function updateDropdownPosition() {
  if (!triggerRef.value || !isOpen.value) return;

  const rect = triggerRef.value.getBoundingClientRect();
  dropdownStyle.value = {
    position: 'fixed',
    top: `${rect.bottom + 8}px`,
    left: `${rect.left}px`,
    width: `${rect.width}px`,
    zIndex: 9999
  };
}

async function toggleDropdown() {
  isOpen.value = !isOpen.value;
  if (isOpen.value) {
    await nextTick();
    updateDropdownPosition();
  }
}

function selectOption(value) {
  emit('update:modelValue', value);
  isOpen.value = false;
}

function handleClickOutside(e) {
  if (!triggerRef.value?.contains(e.target) && !dropdownRef.value?.contains(e.target)) {
    isOpen.value = false;
  }
}

function handleKeydown(e) {
  if (e.key === 'Escape') {
    isOpen.value = false;
  }
}

function handleScroll() {
  if (isOpen.value) {
    updateDropdownPosition();
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside);
  document.addEventListener('keydown', handleKeydown);
  window.addEventListener('scroll', handleScroll, true);
  window.addEventListener('resize', handleScroll);
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
  document.removeEventListener('keydown', handleKeydown);
  window.removeEventListener('scroll', handleScroll, true);
  window.removeEventListener('resize', handleScroll);
});
</script>

<template>
  <div class="custom-select" :class="{ 'is-open': isOpen }">
    <button
      ref="triggerRef"
      type="button"
      class="select-trigger input-glass"
      @click="toggleDropdown"
    >
      <span class="selected-value">{{ selectedLabel }}</span>
      <svg
        class="dropdown-icon"
        :class="{ 'rotate': isOpen }"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <path d="M6 9l6 6 6-6"/>
      </svg>
    </button>

    <Teleport to="body">
      <Transition name="dropdown">
        <div
          v-if="isOpen"
          ref="dropdownRef"
          class="dropdown-menu"
          :style="dropdownStyle"
        >
          <div
            v-for="option in options"
            :key="option.value"
            class="dropdown-item"
            :class="{ 'is-selected': option.value === modelValue }"
            @click="selectOption(option.value)"
          >
            <span>{{ option.label }}</span>
            <i v-if="option.value === modelValue" class="fas fa-check"></i>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.custom-select {
  position: relative;
  width: 100%;
  --mouse-x: 50%;
  --mouse-y: 50%;
}

.select-trigger {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  text-align: left;
  cursor: pointer;
  transition: all 0.2s ease;
  position: relative;
  isolation: isolate;
}

.select-trigger::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  padding: 1.5px;
  background: 
    radial-gradient(
      300px circle at var(--mouse-x) var(--mouse-y),
      rgba(255, 255, 255, 0.6),
      rgba(255, 255, 255, 0.1) 40%,
      transparent 100%
    );
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  opacity: 0;
  transition: opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  pointer-events: none;
}

.select-trigger:hover {
  border-color: rgba(255, 255, 255, 0.2);
}

.select-trigger:hover::before {
  opacity: 1;
}

.selected-value {
  flex: 1;
  font-family: 'Inter', monospace;
  font-size: 0.875rem;
  color: rgba(255, 255, 255, 0.9);
}

.dropdown-icon {
  flex-shrink: 0;
  color: rgba(255, 255, 255, 0.5);
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.dropdown-icon.rotate {
  transform: rotate(180deg);
}

.dropdown-menu {
  /* Position is now controlled by inline styles */
  background: rgba(26, 26, 36, 0.98);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 1rem;
  overflow: hidden;
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.6),
    0 0 0 1px rgba(255, 255, 255, 0.05);
  max-height: 300px;
  overflow-y: auto;
}

.dropdown-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1rem;
  font-family: 'Inter', monospace;
  font-size: 0.875rem;
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  transition: all 0.15s ease;
  border-left: 2px solid transparent;
}

.dropdown-item:hover {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.95);
  border-left-color: rgba(0, 122, 255, 0.6);
}

.dropdown-item.is-selected {
  background: linear-gradient(90deg, rgba(0, 122, 255, 0.15), transparent);
  color: white;
  border-left-color: rgba(0, 122, 255, 0.8);
}

.dropdown-item i {
  font-size: 0.75rem;
  color: rgba(0, 122, 255, 0.8);
}

.dropdown-menu::-webkit-scrollbar {
  width: 6px;
}

.dropdown-menu::-webkit-scrollbar-track {
  background: transparent;
}

.dropdown-menu::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.15);
  border-radius: 3px;
}

.dropdown-menu::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.25);
}

.dropdown-enter-active {
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.dropdown-leave-active {
  transition: all 0.15s cubic-bezier(0.4, 0, 1, 1);
}

.dropdown-enter-from {
  opacity: 0;
  transform: translateY(-8px) scale(0.96);
}

.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
