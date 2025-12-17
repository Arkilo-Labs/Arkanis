<script setup>
import { ref, watch, nextTick } from 'vue';

const props = defineProps({
  logs: {
    type: Array,
    default: () => []
  }
});

const containerRef = ref(null);

watch(() => props.logs.length, async () => {
  await nextTick();
  if (containerRef.value) {
    containerRef.value.scrollTop = containerRef.value.scrollHeight;
  }
});
</script>

<template>
  <div 
    ref="containerRef"
    class="terminal-glass p-4 overflow-y-auto h-full min-h-[inherit] scrollbar-glass text-left"
  >
    <div v-if="logs.length === 0" class="flex items-center gap-2 text-white/30 italic">
      <i class="fas fa-terminal"></i>
      <span>Waiting for output...</span>
    </div>
    <div 
      v-for="(log, index) in logs" 
      :key="index" 
      class="whitespace-pre-wrap break-all mb-1 leading-relaxed flex"
    >
      <span class="log-time select-none mr-3 flex-shrink-0 tabular-nums">
        [{{ new Date(log.timestamp).toLocaleTimeString() }}]
      </span>
      <span :class="{
        'log-stdout': log.type === 'stdout',
        'log-stderr': log.type === 'stderr',
        'log-error': log.type === 'error'
      }">{{ log.data }}</span>
    </div>
  </div>
</template>
