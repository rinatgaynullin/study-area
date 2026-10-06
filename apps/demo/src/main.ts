import { createApp } from 'vue';
// Стили редактора, compat-слой и шрифты MathLive приезжают вместе с
// компонентами: руками подключать нечего.
import App from './app.vue';
import './styles.css';

createApp(App).mount('#app');
