export { default as RichContent } from './components/rich-content.vue';
export { default as RichEditor } from './components/rich-editor.vue';
export { default as EditorToolbar } from './components/editor-toolbar.vue';
export { default as RteIcon } from './components/rte-icon.vue';
export { default as RteModal } from './components/rte-modal.vue';
export { default as FormulaDialog } from './components/dialogs/formula-dialog.vue';
export { default as AudioRecorderDialog } from './components/dialogs/audio-recorder-dialog.vue';

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
} from './composables/toolbar-state';
export { useEditorI18n } from './composables/use-editor-i18n';
export { MATHLIVE_STRINGS, mathliveRu } from './i18n/mathlive';
export { clearPreviewCache, renderLatexPreview } from './composables/use-formula-preview';

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
  type Messages,
  type UploadAdapter,
  type UploadContext,
  type UploadKind,
  type UploadResult,
} from '@rich-editor/core';

export { RichEditorPlugin } from './plugin';

export { default } from './components/rich-editor.vue';
