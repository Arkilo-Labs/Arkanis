import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router.js';
import { useAuthStore } from './stores/authStore.js';
import './styles.css';

const app = createApp(App);

const auth = useAuthStore();
await auth.init();

app.use(router);
app.mount('#app');

