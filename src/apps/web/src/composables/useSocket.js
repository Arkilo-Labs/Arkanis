import { io } from 'socket.io-client';
import { ref } from 'vue';

const socket = io('/', {
    autoConnect: false,
});

const isConnected = ref(false);

socket.on('connect', () => {
    isConnected.value = true;
});

socket.on('disconnect', () => {
    isConnected.value = false;
});

export function useSocket() {
    if (!socket.connected) {
        socket.connect();
    }
    return { socket, isConnected };
}
