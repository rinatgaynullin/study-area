import { createApp } from 'vue';
// MathLive resolves its glyphs from this stylesheet; the bundler emits the
// font files, so `MathfieldElement.fontsDirectory` can stay null.
import 'mathlive/fonts.css';
import '@rich-editor/vue/styles.css';
import App from './App.vue';
import './styles.css';

createApp(App).mount('#app');
