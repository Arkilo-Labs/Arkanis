<script setup>
import { ref, watch, nextTick } from 'vue';

const props = defineProps({
  logs: {
    type: Array, // Array of { type: 'stdout'|'stderr'|'error', data: string, timestamp: number }
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
    class="bg-obsidian/50 text-xs font-mono p-4 rounded-lg overflow-y-auto h-full min-h-[inherit] border border-charcoal shadow-inner scrollbar-thin text-left"
  >
    <div v-if="logs.length === 0" class="text-mist/30 italic font-light tracking-wide">Waiting for process output...</div>
    <div v-for="(log, index) in logs" :key="index" class="whitespace-pre-wrap break-all mb-0.5 leading-relaxed">
      <span class="text-mist/40 select-none mr-2">[{{ new Date(log.timestamp).toLocaleTimeString() }}]</span>
      <span :class="{
        'text-mist': log.type === 'stdout',
        'text-yellow-400': log.type === 'stderr',
        'text-red-400 font-bold': log.type === 'error'
      }">{{ log.data }}</span>
    </div>
  </div>
</template>
