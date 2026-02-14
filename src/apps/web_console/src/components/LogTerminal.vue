<template>
    <div ref="container" class="terminal">
        <div v-if="logs.length === 0" class="terminal-empty">等待输出...</div>
        <div v-for="(log, idx) in logs" :key="idx" class="terminal-line">
            <span class="terminal-time">[{{ formatTime(log.timestamp) }}]</span>
            <span :class="lineClass(log.type)">{{ log.data }}</span>
        </div>
    </div>
</template>

<script setup>
import { nextTick, ref, watch } from 'vue';

const props = defineProps({
    logs: { type: Array, default: () => [] },
});

const container = ref(null);

function formatTime(ts) {
    try {
        return new Date(ts).toLocaleTimeString('zh-CN');
    } catch {
        return '';
    }
}

function lineClass(type) {
    if (type === 'stderr') return 'terminal-stderr';
    if (type === 'error') return 'terminal-error';
    return 'terminal-stdout';
}

watch(
    () => props.logs.length,
    async () => {
        await nextTick();
        if (!container.value) return;
        container.value.scrollTop = container.value.scrollHeight;
    }
);
</script>

