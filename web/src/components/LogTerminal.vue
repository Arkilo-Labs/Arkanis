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
    class="terminal-liquid text-xs p-4 overflow-y-auto h-full min-h-[inherit] scrollbar-liquid text-left"
  >
    <div v-if="logs.length === 0" class="text-gray-500 italic">
      Waiting for output...
    </div>
    <div 
      v-for="(log, index) in logs" 
      :key="index" 
      class="whitespace-pre-wrap break-all mb-1 leading-relaxed flex"
    >
      <span class="text-ink-muted select-none mr-3 flex-shrink-0 tabular-nums">
        [{{ new Date(log.timestamp).toLocaleTimeString() }}]
      </span>
      <span :class="{
        'text-ink-secondary': log.type === 'stdout',
        'text-orange': log.type === 'stderr',
        'text-red font-semibold': log.type === 'error'
      }">{{ log.data }}</span>
    </div>
  </div>
</template>
