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

function handleMouseMove(e) {
  if (!triggerRef.value) return;
  const rect = triggerRef.value.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  triggerRef.value.style.setProperty('--mouse-x', `${x}px`);
  triggerRef.value.style.setProperty('--mouse-y', `${y}px`);
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside);
  document.addEventListener('keydown', handleKeydown);
  document.addEventListener('mousemove', handleMouseMove);
  window.addEventListener('scroll', handleScroll, true);
  window.addEventListener('resize', handleScroll);
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
  document.removeEventListener('keydown', handleKeydown);
  document.removeEventListener('mousemove', handleMouseMove);
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
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
  isolation: isolate;
  backdrop-filter: blur(12px) saturate(180%);
  -webkit-backdrop-filter: blur(12px) saturate(180%);
  box-shadow: 
    inset 0 1px 0 0 rgba(255, 255, 255, 0.08),
    0 2px 8px rgba(0, 0, 0, 0.1);
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
      rgba(255, 255, 255, 0.15) 40%,
      transparent 100%
    );
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  opacity: 0;
  transition: opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  pointer-events: none;
  z-index: 1;
}

.select-trigger::after {
  content: '';
  position: absolute;
  inset: -8px;
  border-radius: calc(var(--radius-md) + 4px);
  background: 
    radial-gradient(
      200px circle at var(--mouse-x) var(--mouse-y), 
      rgba(255, 255, 255, 0.15), 
      transparent 70%
    );
  opacity: 0;
  filter: blur(12px);
  transition: opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  z-index: -1;
  pointer-events: none;
}

.select-trigger:hover {
  border-color: rgba(255, 255, 255, 0.25);
  background: rgba(255, 255, 255, 0.08);
  box-shadow: 
    inset 0 1px 0 0 rgba(255, 255, 255, 0.12),
    0 0 0 1px rgba(255, 255, 255, 0.1),
    0 4px 12px rgba(0, 0, 0, 0.15);
  backdrop-filter: blur(16px) saturate(180%);
  -webkit-backdrop-filter: blur(16px) saturate(180%);
}

.select-trigger:hover::before,
.select-trigger:hover::after {
  opacity: 1;
}

.select-trigger.is-open,
.custom-select.is-open .select-trigger {
  border-color: rgba(255, 255, 255, 0.3);
  background: rgba(255, 255, 255, 0.1);
  box-shadow: 
    inset 0 1px 0 0 rgba(255, 255, 255, 0.15),
    0 0 0 1px rgba(255, 255, 255, 0.15),
    0 6px 16px rgba(0, 0, 0, 0.2);
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
  background: rgba(18, 18, 26, 0.95);
  backdrop-filter: blur(32px) saturate(180%);
  -webkit-backdrop-filter: blur(32px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 1rem;
  overflow: hidden;
  box-shadow:
    inset 0 1px 0 0 rgba(255, 255, 255, 0.15),
    0 0 0 1px rgba(255, 255, 255, 0.08),
    0 12px 48px rgba(0, 0, 0, 0.5),
    0 4px 16px rgba(0, 0, 0, 0.3);
  max-height: 300px;
  overflow-y: auto;
  padding: 0.5rem;
}

.dropdown-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1rem;
  font-family: 'Inter', monospace;
  font-size: 0.875rem;
  color: rgba(255, 255, 255, 0.65);
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  border-radius: 0.625rem;
  position: relative;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  margin-bottom: 0.25rem;
}

.dropdown-item:last-child {
  margin-bottom: 0;
}

.dropdown-item::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 0;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.8), rgba(255, 255, 255, 0.4));
  border-radius: 0 2px 2px 0;
  transition: height 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.dropdown-item:hover {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.95);
  box-shadow: 
    inset 0 1px 0 0 rgba(255, 255, 255, 0.1),
    0 2px 8px rgba(0, 0, 0, 0.1);
  transform: translateX(2px);
}

.dropdown-item:hover::before {
  height: 60%;
}

.dropdown-item.is-selected {
  background: rgba(255, 255, 255, 0.12);
  color: white;
  font-weight: 500;
  box-shadow: 
    inset 0 1px 0 0 rgba(255, 255, 255, 0.15),
    0 0 0 1px rgba(255, 255, 255, 0.1),
    0 2px 12px rgba(255, 255, 255, 0.08);
}

.dropdown-item.is-selected::before {
  height: 70%;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.9), rgba(255, 255, 255, 0.6));
  box-shadow: 0 0 8px rgba(255, 255, 255, 0.3);
}

.dropdown-item i {
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.9);
  margin-left: 0.5rem;
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
