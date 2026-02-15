import { SOCKET_EVENTS } from './events.js';

export function registerSocketHandlers({ io, activeProcesses }) {
    io.on('connection', (socket) => {
        console.log('Client connected:', socket.id);

        socket.on('disconnect', () => {
            console.log('Client disconnected:', socket.id);
        });

        socket.on(SOCKET_EVENTS.KILL_PROCESS, (pid) => {
            if (!activeProcesses.has(pid)) return;
            const child = activeProcesses.get(pid);
            try {
                child.kill();
            } catch {
                // 忽略
            }
            activeProcesses.delete(pid);
            socket.emit(SOCKET_EVENTS.PROCESS_KILLED, pid);
        });
    });
}

