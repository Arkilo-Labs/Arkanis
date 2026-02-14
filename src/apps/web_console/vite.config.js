import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

const SERVER_URL = process.env.VITE_DEV_SERVER_PROXY_TARGET || 'http://localhost:3000';

export default defineConfig({
    plugins: [vue()],
    publicDir: 'assets',
    server: {
        port: 5174,
        proxy: {
            '/api': SERVER_URL,
            '/outputs': SERVER_URL,
            '/socket.io': { target: SERVER_URL, ws: true },
        },
    },
});

