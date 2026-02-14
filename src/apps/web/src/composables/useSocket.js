import { io } from 'socket.io-client';
import { useEffect, useSyncExternalStore } from 'react';

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

let connected = socket.connected;
const listeners = new Set();

socket.on('connect', () => {
    connected = true;
    listeners.forEach((listener) => listener());
});

socket.on('disconnect', () => {
    connected = false;
    listeners.forEach((listener) => listener());
});

function syncSocketAuth() {
    const token = readToken();
    socket.auth = token ? { token } : {};
}

export function useSocket() {
    const isConnected = useSyncExternalStore(
        (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        () => connected,
        () => connected,
    );

    useEffect(() => {
        syncSocketAuth();
        if (!socket.connected) socket.connect();
    }, []);

    return { socket, isConnected };
}

export function disconnectSocket() {
    if (socket.connected) socket.disconnect();
}
