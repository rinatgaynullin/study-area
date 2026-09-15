import './styles/index.css';

import type { App, Plugin } from 'vue';
import RichContent from './components/RichContent.vue';
import RichEditor from './components/RichEditor.vue';

export { RichContent, RichEditor };
export { default as EditorToolbar } from './components/EditorToolbar.vue';
export { default as RteIcon } from './components/RteIcon.vue';
export { default as RteModal } from './components/RteModal.vue';
export { default as FormulaDialog } from './components/dialogs/FormulaDialog.vue';
export { default as AudioRecorderDialog } from './components/dialogs/AudioRecorderDialog.vue';

export { ICONS, type IconName } from './components/icons';
export {
  TOOLBAR_PRESETS,
  resolveToolbar,
  type ToolbarConfig,
  type ToolbarGroup,
  type ToolbarItemId,
  type ToolbarPreset,
} from './toolbar/presets';
export {
  emptyToolbarState,
  readToolbarState,
  type ToolbarState,
} from './composables/toolbarState';
export { useEditorI18n } from './composables/useEditorI18n';
export { MATHLIVE_STRINGS, mathliveRu } from './i18n/mathlive';
export { clearPreviewCache, renderLatexPreview } from './composables/useFormulaPreview';

// Re-exported so hosts need only this package for typing adapters and messages.
export {
  DEFAULT_LIMITS,
  RichEditorCore,
  RichEditorError,
  en as enMessages,
  ru as ruMessages,
  buildMathML,
  latexToMathML,
  mathmlToLatex,
  normalizeMathML,
  renderMathML,
  type EditorLimits,
  type FormulaPayload,
  type FormulaType,
  type MessagesTree,
  type UploadAdapter,
  type UploadContext,
  type UploadKind,
  type UploadResult,
} from '@rich-editor/core';

/** `app.use(RichEditorPlugin)` registers `<RichEditor />` and `<RichContent />`. */
export const RichEditorPlugin: Plugin = {
  install(app: App) {
    app.component('RichEditor', RichEditor);
    app.component('RichContent', RichContent);
  },
};

export default RichEditor;
