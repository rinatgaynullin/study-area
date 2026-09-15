import { createApp } from 'vue';
// MathLive resolves its glyphs from this stylesheet; the bundler emits the
// font files, so `MathfieldElement.fontsDirectory` can stay null.
import 'mathlive/fonts.css';
import '@rich-editor/vue/styles.css';
// Compat-слой для старой разметки Froala подключается отдельно: хост без
// legacy-данных его не скачивает.
import '@rich-editor/vue/legacy.css';
import App from './app.vue';
import './styles.css';

createApp(App).mount('#app');
