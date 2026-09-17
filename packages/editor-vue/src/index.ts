export { default as RichContent } from './components/rich-content.vue';
export { default as RichEditor } from './components/rich-editor.vue';
export { default as RteIcon } from './components/rte-icon.vue';

/*
 * Интерфейс редактора — тулбар, диалоги, поповеры — целиком живёт в ядре и
 * собран на голом DOM; Vue-обёртка его монтирует. Поэтому прежние
 * Vue-компоненты интерфейса (`EditorToolbar`, `RteModal`, `RtePopover`,
 * `LinkPopover`, `FormulaDialog`, `AudioRecorderDialog`) заменены
 * фабриками из `@rich-editor/core` и реэкспортируются отсюда, чтобы хосту
 * по-прежнему хватало одного пакета.
 */
export {
  createRichEditor,
  createToolbar,
  createModal,
  createPopover,
  createDropdown,
  TOOLBAR_PRESETS,
  resolveToolbar,
  SIMPLE_TOOLBAR_ITEMS,
  DEFAULT_LINK_STYLES,
  MATHLIVE_STRINGS,
  mathliveRu,
  clearPreviewCache,
  renderLatexPreview,
  type Dropdown,
  type LinkStyle,
  type MathliveStrings,
  type Modal,
  type Popover,
  type RichEditorUi,
  type RichEditorUiOptions,
  type Toolbar,
  type ToolbarConfig,
  type ToolbarGroupConfig,
  type ToolbarItemDescriptor,
  type ToolbarPreset,
  type DialogComponent,
  type EditorUiContext,
  type UiComponent,
} from '@rich-editor/core';

/** @deprecated Переименована в `ToolbarGroupConfig`. */
export type { ToolbarGroupConfig as ToolbarGroup } from '@rich-editor/core';

/**
 * Идентификатор пункта тулбара.
 *
 * Раньше это был закрытый союз литералов: набор кнопок был зашит в пакет.
 * Реестр пунктов открыт — хост передаёт свои через `toolbarItems`, — поэтому
 * идентификатор больше не ограничен встроенным списком.
 */
export type ToolbarItemId = string;

// Реэкспорт ядра, чтобы для типизации адаптеров и сообщений хватало одного пакета.
export {
  DEFAULT_LIMITS,
  RichEditorCore,
  RichEditorError,
  ICONS,
  type IconName,
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
  type UploadEvent,
  type UploadKind,
  type UploadResult,
} from '@rich-editor/core';

export { RichEditorPlugin } from './plugin';

export { default } from './components/rich-editor.vue';
