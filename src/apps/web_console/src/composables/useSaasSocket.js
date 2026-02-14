import { computed, onUnmounted, watch } from 'vue';
import { io } from 'socket.io-client';
import { useAuthStore } from '../stores/authStore.js';

let socket = null;

export function useSaasSocket() {
    const auth = useAuthStore();
    const token = computed(() => auth.token.value);

    function ensureConnected() {
        if (!token.value) return;
        if (socket && socket.connected) return;

        socket = io('/saas', {
            transports: ['websocket', 'polling'],
            auth: { token: token.value },
        });
    }

    function disconnect() {
        if (!socket) return;
        socket.disconnect();
        socket = null;
    }

    watch(token, (next) => {
        if (!next) return disconnect();
        disconnect();
        ensureConnected();
    });

    ensureConnected();
    onUnmounted(disconnect);

    return { socket: () => socket };
}

