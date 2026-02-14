import { io } from 'socket.io-client';
import { ref } from 'vue';

const TOKEN_KEY = 'arkanis_session_token';

function readToken() {
    try {
        return localStorage.getItem(TOKEN_KEY);
    } catch {
        return null;
    }
}

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

function syncSocketAuth() {
    const token = readToken();
    socket.auth = token ? { token } : {};
}

export function useSocket() {
    syncSocketAuth();
    if (!socket.connected) {
        socket.connect();
    }
    return { socket, isConnected };
}

export function disconnectSocket() {
    if (socket.connected) socket.disconnect();
}
