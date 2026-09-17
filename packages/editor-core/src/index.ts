export { RichEditorCore, prepareIncomingHtml } from './editor';
export type { PrepareIncomingHtmlOptions } from './editor';
export { decodeWirisMathml, upgradeLegacyHtml } from './legacy';
export { DEFAULT_FORMULA_FONT_SIZE_PX } from './formula/mathjax';

export {
  DEFAULT_LIMITS,
  RichEditorError,
  type AttachmentAttributes,
  type AudioAttributes,
  type EditorLimits,
  type FormulaPayload,
  type FormulaType,
  type Messages,
  type RichEditorCoreOptions,
  type RichEditorErrorCode,
  type Translate,
  type UploadAdapter,
  type UploadContext,
  type UploadKind,
  type UploadResult,
} from './types';

export { createI18n, DEFAULT_LOCALE, en, ru, type I18n, type I18nOptions } from './i18n';

export { sanitizeHtml, sanitizeMathML, sanitizeSvg, resetSanitizers } from './security/sanitize';

export {
  buildMathML,
  extractFormulaType,
  extractTexAnnotation,
  isMathMLEmpty,
  latexToMathML,
  mathmlToLatex,
  normalizeMathML,
  repairMathML,
  MATHML_NS,
  TEX_ANNOTATION_ENCODING,
} from './formula/mathml';

export {
  getCachedFormulaSvg,
  renderMathML,
  resetMathJax,
  whenFormulasReady,
  type RenderOptions,
} from './formula/mathjax';

export { inlineMathMLToFormulaNodes } from './formula/import';

export {
  findTemplate,
  getTemplateCategories,
  TEMPLATE_CATEGORIES,
  type FormulaTemplate,
  type TemplateCategory,
  type TemplateCategoryId,
} from './formula/templates';

export { FormulaNode, FORMULA_NODE_NAME, type FormulaOptions } from './nodes/formula';
export { AudioNode, AUDIO_NODE_NAME, type AudioOptions } from './nodes/audio';
export { AttachmentNode, ATTACHMENT_NODE_NAME, type AttachmentOptions } from './nodes/attachment';

export {
  IMAGE_ACCEPT,
  TEXT_FILE_ACCEPT,
  TEXT_FILE_EXTENSIONS,
  UploadPipeline,
  isAudioFile,
  isImageFile,
  isTextFile,
  type UploadPipelineOptions,
} from './media/upload';

export {
  VoiceRecorder,
  isRecordingSupported,
  pickAudioMimeType,
  type RecorderState,
  type RecordingResult,
  type VoiceRecorderOptions,
} from './media/recorder';

export { readTextFile, textToParagraphs } from './media/text-file';

export { formatBytes, formatDuration } from './utils/format';

export type { Editor } from '@tiptap/core';

/**
 * TipTap declares its commands by augmenting `@tiptap/core` from each extension
 * module. Those augmentations only reach a consumer whose type graph references
 * the modules, and side-effect imports are dropped from emitted `.d.ts` files —
 * so re-export one type from every extension the editor installs. Without this,
 * `editor.chain().setColor(...)` and friends do not type-check downstream.
 */
export type { StarterKitOptions } from '@tiptap/starter-kit';
export type { TableKitOptions } from '@tiptap/extension-table';
export type { TextAlignOptions } from '@tiptap/extension-text-align';
export type { ColorOptions, TextStyleOptions } from '@tiptap/extension-text-style';
export type { HighlightOptions } from '@tiptap/extension-highlight';
export type { ImageOptions } from '@tiptap/extension-image';
export type { SubscriptExtensionOptions } from '@tiptap/extension-subscript';
export type { SuperscriptExtensionOptions } from '@tiptap/extension-superscript';
export type { PlaceholderOptions, UndoRedoOptions } from '@tiptap/extensions';
