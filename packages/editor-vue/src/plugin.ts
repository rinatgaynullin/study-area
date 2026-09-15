import type { App, Plugin } from 'vue';
import RichContent from './components/rich-content.vue';
import RichEditor from './components/rich-editor.vue';

/** `app.use(RichEditorPlugin)` registers `<RichEditor />` and `<RichContent />`. */
export const RichEditorPlugin: Plugin = {
  install(app: App) {
    app.component('RichEditor', RichEditor);
    app.component('RichContent', RichContent);
  },
};
