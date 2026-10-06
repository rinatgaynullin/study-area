# 14. Справочник публичного API

## Назначение

Сигнатуры всех экспортов, как они объявлены в `packages/editor-core/src/index.ts`
и `packages/editor-vue/src/index.ts`. Поведение описано в тематических
разделах; здесь — только контракт.

## `@rich-editor/core`

### Движок и вход документа

```ts
class RichEditorCore {                                               // 02-core.md
  constructor(options: RichEditorCoreOptions);
  readonly uploads: UploadPipeline;
  getHTML(): string; getText(): string;
  setHTML(html: string, options?: { emitUpdate?: boolean }): void;
  isEmpty(): boolean; focus(): void; setEditable(editable: boolean): void;
  whenFormulasReady(): Promise<void>;
  setLocale(locale: string): void; setMessages(messages: Record<string, Messages> | undefined): void;
  t(key: string, params?: Record<string, string | number>): string;
  setLimits(limits: Partial<EditorLimits>): void; getLimits(): EditorLimits;
  setOptions(next: RichEditorCoreLiveOptions): void;
  insertFormula(mathml: string, type?: FormulaType): boolean;
  updateFormulaAt(pos: number, mathml: string, type?: FormulaType): boolean;
  deleteFormulaAt(pos: number): boolean;
  insertImageFile(file: File, at?: number): Promise<boolean>;
  insertImageUrl(result: UploadResult, at?: number): boolean;
  insertRecording(blob: Blob, meta: { duration: number; peaks?: string; name?: string }): Promise<boolean>;
  insertAudio(attributes: AudioAttributes): boolean;
  attachTextFile(file: File): Promise<boolean>;
  insertAttachment(attributes: AttachmentAttributes): boolean;
  insertTextFileContent(file: File): Promise<boolean>;
  destroy(): void;
}

interface RichEditorCoreOptions {
  element: HTMLElement; content?: string; editable?: boolean; placeholder?: string; ariaLabel?: string;
  locale?: string; messages?: Record<string, Messages>; limits?: Partial<EditorLimits>;
  uploadImage?: UploadAdapter; uploadAudio?: UploadAdapter; uploadFile?: UploadAdapter;
  formulaScale?: number; extensions?: unknown[] | ((context: { t: Translate }) => unknown[]); legacy?: boolean;
  onChange?: (html: string) => void; onSelectionUpdate?: () => void;
  onTransaction?: () => void; onFocus?: () => void; onBlur?: () => void;
  onUpload?: (event: UploadEvent) => void; onFormulaEdit?: (payload: FormulaPayload) => void;
  onError?: (error: RichEditorError) => void;
}
type RichEditorCoreLiveOptions = Pick<RichEditorCoreOptions,
  'editable' | 'locale' | 'messages' | 'limits' | 'placeholder' | 'ariaLabel' | 'uploadImage' | 'uploadAudio' | 'uploadFile'>;

interface PrepareIncomingHtmlOptions { legacy?: boolean }
const prepareIncomingHtml: (html: string, options?: PrepareIncomingHtmlOptions) => string;
const upgradeLegacyHtml: (html: string) => string;
const decodeWirisMathml: (raw: string) => string;
```

### Контракт документа (санитайзер)

```ts
const HTML_TAGS: string[]; const HTML_ATTRS: string[];                // 11-security.md
const MATHML_TAGS: string[]; const MATHML_ATTRS: string[];
const SVG_EXTRA_ATTRS: string[]; const ALLOWED_URI_SCHEMES: string[];
const sanitizeHtml: (html: string) => string;
const sanitizeMathML: (mathml: string) => string;                      // '' если не <math>
const sanitizeSvg: (svg: string) => string;
const resetSanitizers: () => void;                                     // тестовый шов
```

### Интерфейс на голом DOM

```ts
const createRichEditor: (options: RichEditorUiOptions) => RichEditorUi;   // 03-vanilla-ui.md
interface RichEditorUiOptions extends Omit<RichEditorCoreOptions, 'element'> {
  element: HTMLElement; toolbar?: ToolbarConfig; toolbarItems?: Record<string, ToolbarItemDescriptor>;
  features?: EditorFeature[]; linkStyles?: LinkStyle[]; mathliveFontsDirectory?: string | null;
  collapseBelow?: number; textSwatches?: string[]; highlightSwatches?: string[];
  minHeight?: string; statusLine?: boolean; theme?: EditorTheme;
}
interface RichEditorUi {
  readonly core: RichEditorCore; readonly element: HTMLElement;
  setOptions(options: RichEditorLiveOptions): void;
  setEditable(editable: boolean): void; setLocale(locale: string): void;
  setMessages(messages: Record<string, Messages> | undefined): void; refreshLabels(): void;
  setLimits(limits: Partial<EditorLimits>): void; setTheme(theme: EditorTheme): void; destroy(): void;
}
type RichEditorLiveOptions = RichEditorCoreLiveOptions
  & Pick<RichEditorUiOptions, 'theme' | 'minHeight' | 'statusLine' | 'linkStyles'>;

const createRichContent: (options: RichContentOptions) => RichContent;    // 06-viewer.md
interface RichContentOptions {
  element: HTMLElement; html?: string; formulaScale?: number; legacy?: boolean; theme?: EditorTheme;
  onRendered?(): void;
}
type RichContentUpdate = Partial<Pick<RichContentOptions, 'html' | 'formulaScale' | 'legacy' | 'theme'>>;
interface RichContent {
  readonly element: HTMLElement; update(next: RichContentUpdate): Promise<void>;
  renderPendingFormulas(): Promise<void>; destroy(): void;
}

type EditorTheme = 'light' | 'dark' | 'auto';                             // 08-theming.md
const DARK_THEME_CLASS = 'rte-theme-dark';
const applyTheme: (element: HTMLElement, theme: EditorTheme) => () => void;

type ToolbarPreset = 'full' | 'standard' | 'minimal';
type ToolbarConfig = ToolbarPreset | ToolbarGroupConfig[];
interface ToolbarGroupConfig { id: string; items: string[]; collapsible?: boolean }
const TOOLBAR_PRESETS: Record<ToolbarPreset, ToolbarGroupConfig[]>;
const resolveToolbar: (config: ToolbarConfig | undefined) => ToolbarGroupConfig[];
interface ToolbarOptions { groups: ToolbarGroupConfig[]; items: Record<string, ToolbarItemDescriptor>; collapseBelow?: number }
interface Toolbar extends UiComponent {
  syncState(): void; setDisabled(disabled: boolean): void; rebuild(): void; layout(width: number): void; focus(): void;
}
const createToolbar: (context: EditorUiContext, options: ToolbarOptions) => Toolbar;
const SIMPLE_TOOLBAR_ITEMS: Record<string, ToolbarItemDescriptor>;
interface LinkStyle { labelKey: string; className: string }
const DEFAULT_LINK_STYLES: LinkStyle[];
const DEFAULT_TEXT_SWATCHES: string[]; const DEFAULT_HIGHLIGHT_SWATCHES: string[];

interface EditorUiContext {
  editor: Editor; t: Translate; limits: EditorLimits; uploads: UploadPipeline;
  editFormula(payload: FormulaPayload): void;
}
interface UiComponent { readonly element: HTMLElement; destroy(): void }
interface DialogComponent<TPayload = void> extends UiComponent {
  open(payload: TPayload): void; close(): void; readonly isVisible: boolean;
}
interface ToolbarItemDescriptor {
  id: string; icon?: string; dynamicIcon?(editor: Editor): string; text?(context: EditorUiContext): string;
  labelKey: string; shortcut?: string; kind?: 'button' | 'dropdown';
  run?(context: EditorUiContext, payload?: unknown): void;
  isActive?(editor: Editor): boolean; isDisabled?(editor: Editor): boolean;
  renderPanel?(context: EditorUiContext, close: () => void): HTMLElement;
}
interface EditorFeature {
  id: string; extensions?(options: FeatureBuildOptions): unknown[];
  toolbarItems?(): ToolbarItemDescriptor[]; dialogs?(context: EditorUiContext): UiComponent[];
}
interface FeatureBuildOptions {
  t: Translate; legacy: boolean; placeholder?: string; formulaScale: number;
  onFormulaEdit?: (payload: FormulaPayload) => void;
}
```

### Примитивы

```ts
const createModal: (options: ModalOptions) => Modal;
interface ModalOptions { title: string; closeLabel: string; wide?: boolean; onClose?(): void }
interface Modal extends DialogComponent { readonly body: HTMLElement; readonly footer: HTMLElement; setTitle(title: string): void }
const MODAL_CLOSE_EVENT = 'rte:modal-close';

const createPopover: (options?: PopoverOptions) => Popover;
type PopoverCloseReason = 'escape' | 'outside' | 'api';
interface PopoverOptions {
  offset?: number; role?: string; className?: string; labelledBy?: string; label?: string;
  align?: 'center' | 'start'; isInside?(target: Node): boolean; onClose?(reason: PopoverCloseReason): void;
}
interface Popover extends UiComponent {
  open(anchor: DOMRect): void; close(reason?: PopoverCloseReason): void;
  readonly isVisible: boolean; readonly body: HTMLElement; reposition(anchor: DOMRect): void;
}

const createDropdown: (options: DropdownOptions) => Dropdown;
interface DropdownOptions { label: string; iconName?: string; text?: string; renderPanel(close: () => void): HTMLElement }
interface Dropdown extends UiComponent {
  readonly button: HTMLButtonElement; close(): void; setActive(active: boolean): void;
  setDisabled(disabled: boolean): void; setText(text: string): void; setIcon(name: string): void;
}
type MenuItemRole = 'menuitem' | 'menuitemradio' | 'menuitemcheckbox';
interface MenuItemOptions {
  label: string; iconName?: string; active?: boolean; disabled?: boolean; role?: MenuItemRole;
  labelClass?: string; onSelect(): void;
}
const createMenuItem: (options: MenuItemOptions) => HTMLButtonElement;
const createMenuSeparator: () => HTMLElement;

const ICONS: Record<string, string>; type IconName = keyof typeof ICONS;
// bold italic underline strike heading paragraph subscript superscript bulletList orderedList blockquote
// code codeBlock horizontalRule link unlink table alignLeft alignCenter alignRight alignJustify textColor
// highlight clearFormat undo redo image audio file formulaMath formulaChem more chevronDown close check
// openLink trash play pause stop record noColor
```

### Формулы

```ts
const MATHML_NS = 'http://www.w3.org/1998/Math/MathML';                 // 04-formulas.md
const TEX_ANNOTATION_ENCODING = 'application/x-tex';
const buildMathML: (body: string, latex: string, type: FormulaType) => string;
const extractTexAnnotation: (mathml: string) => string | null;
const extractFormulaType: (mathml: string) => FormulaType;
const latexToMathML: (latex: string, type?: FormulaType) => Promise<string>;
const mathmlToLatex: (mathml: string) => Promise<string>;
const repairMathML: (mathml: string) => string;
const isMathMLEmpty: (mathml: string) => boolean;
const normalizeMathML: (mathml: string) => string;
const inlineMathMLToFormulaNodes: (html: string) => string;

const DEFAULT_FORMULA_FONT_SIZE_PX = 15;
interface RenderOptions { display?: boolean; fontSizePx?: number }
const renderMathML: (mathml: string, options?: RenderOptions) => Promise<string>;
const getCachedFormulaSvg: (mathml: string, fontSizePx?: number) => string | undefined;
const whenFormulasReady: () => Promise<void>;
const resetMathJax: () => void;                                            // тестовый шов
const renderLatexPreview: (latex: string, type?: FormulaType, scale?: number) => Promise<string>;
const getCachedLatexPreview: (latex: string, type?: FormulaType, scale?: number) => string | undefined;
const clearPreviewCache: () => void;

type TemplateCategoryId = 'basic' | 'fractions' | 'roots' | 'scripts' | 'sums' | 'integrals' | 'limits'
  | 'matrices' | 'greek' | 'relations' | 'functions' | 'chemReactions' | 'chemStates' | 'chemIsotopes' | 'chemPatterns';
interface FormulaTemplate { id: string; category: TemplateCategoryId; latex: string; preview: string }
interface TemplateCategory { id: TemplateCategoryId; type: FormulaType; labelKey: string; templates: FormulaTemplate[] }
const TEMPLATE_CATEGORIES: TemplateCategory[];
const getTemplateCategories: (type: FormulaType) => TemplateCategory[];
const findTemplate: (id: string) => FormulaTemplate | undefined;

const FormulaNode: Node<FormulaOptions>; const FORMULA_NODE_NAME = 'formula';
interface FormulaOptions { onEdit: ((payload: FormulaPayload) => void) | null; scale: number; HTMLAttributes: Record<string, unknown> }
const AudioNode: Node<AudioOptions>; const AUDIO_NODE_NAME = 'audioMessage';
const AttachmentNode: Node<AttachmentOptions>; const ATTACHMENT_NODE_NAME = 'attachment';
interface AudioOptions { t: Translate; HTMLAttributes: Record<string, unknown> }
interface AttachmentOptions { t: Translate; HTMLAttributes: Record<string, unknown> }
// Команды TipTap: insertFormula({ mathml, type? }), updateFormula({ pos, mathml, type? }), deleteFormulaAt(pos),
// insertAudio(attributes), insertAttachment(attributes)
```

### Медиа

```ts
type UploadKind = 'image' | 'audio' | 'file';                             // 05-media-and-uploads.md
interface UploadResult { url: string; name?: string; mime?: string; size?: number; meta?: Record<string, unknown> }
interface UploadContext { kind: UploadKind; signal: AbortSignal; t: Translate }
type UploadAdapter = (file: File, context: UploadContext) => Promise<UploadResult>;
interface UploadEvent { kind: UploadKind; file: File; phase: 'start' | 'done' | 'failed' }
interface EditorLimits { maxAudioDurationSec: number; maxAudioSizeBytes: number; maxImageSizeBytes: number; maxFileSizeBytes: number }
const DEFAULT_LIMITS: EditorLimits;   // 300 с, 10 МБ, 10 МБ, 5 МБ

interface UploadPipelineOptions {
  limits: EditorLimits; t: Translate; adapters: Partial<Record<UploadKind, UploadAdapter | undefined>>;
  onError?: (error: RichEditorError) => void; onUpload?: (event: UploadEvent) => void;
}
class UploadPipeline {
  constructor(options: UploadPipelineOptions);
  setOptions(options: Partial<UploadPipelineOptions>): void;
  upload(kind: UploadKind, file: File): Promise<UploadResult | null>;
  toObjectUrl(file: Blob, name?: string, mime?: string): UploadResult;
  destroy(): void;
}
const IMAGE_ACCEPT: string; const TEXT_FILE_ACCEPT: string; const TEXT_FILE_EXTENSIONS: string[];
const isAudioFile: (file: File) => boolean; const isImageFile: (file: File) => boolean; const isTextFile: (file: File) => boolean;

type RecorderState = 'idle' | 'recording' | 'paused' | 'stopped';
type RecorderLimit = 'duration' | 'size';
interface RecordingResult { blob: Blob; mime: string; duration: number; peaks: string }
interface VoiceRecorderOptions {
  t: Translate; maxDurationSec: number; maxSizeBytes: number;
  onTick?: (elapsedSec: number) => void; onStateChange?: (state: RecorderState) => void;
  onLimit?: (reason: RecorderLimit) => void; onLevel?: (level: number) => void; onError?: (error: RichEditorError) => void;
}
class VoiceRecorder {
  constructor(options: VoiceRecorderOptions);
  getState(): RecorderState; getElapsed(): number;
  start(): Promise<void>; pause(): void; resume(): void; stop(): Promise<RecordingResult>; cancel(): void;
}
const isRecordingSupported: () => boolean; const pickAudioMimeType: () => string | undefined;
const readTextFile: (file: File, t: Translate) => Promise<string>;
const textToParagraphs: (text: string) => string[];
const formatBytes: (bytes: number) => string; const formatDuration: (seconds: number) => string;
```

### Типы, ошибки, i18n

```ts
interface Messages { [key: string]: string }                               // 09-i18n.md
type Translate = (key: string, params?: Record<string, string | number>) => string;
type FormulaType = 'math' | 'chem';
interface FormulaPayload { mathml: string; type: FormulaType; pos: number | null }
interface AudioAttributes { src: string; name?: string | null; mime?: string | null; duration?: number | null; peaks?: string | null }
interface AttachmentAttributes { href: string; name: string; size?: number | null; mime?: string | null }
type RichEditorErrorCode = 'file-too-large' | 'unsupported-type' | 'upload-failed' | 'recorder-unsupported'
  | 'recorder-permission-denied' | 'recorder-failed' | 'file-read-failed' | 'invalid-mathml';
class RichEditorError extends Error { readonly code: RichEditorErrorCode; constructor(code: RichEditorErrorCode, message: string, cause?: unknown) }

const DEFAULT_LOCALE = 'ru';
interface I18nOptions { locale?: string; messages?: Record<string, Messages> }
interface I18n { readonly locale: string; t: Translate; setLocale(locale: string): void; setMessages(messages: Record<string, Messages> | undefined): void }
const createI18n: (options?: I18nOptions) => I18n;
const ru: Messages; const en: Messages;
const mathliveRu: Record<string, string>;
interface MathliveStrings { [locale: string]: Record<string, string> }
const MATHLIVE_STRINGS: MathliveStrings;

// Только для авторов возможностей: TipTap-редактор приходит в EditorUiContext.editor.
export type { Editor } from '@tiptap/core';
// и типы опций установленных расширений TipTap (StarterKitOptions, TableKitOptions, TextAlignOptions, ColorOptions,
// TextStyleOptions, HighlightOptions, ImageOptions, Subscript/SuperscriptExtensionOptions, PlaceholderOptions, UndoRedoOptions)
```

Subpath-экспорты: `@rich-editor/core/styles.css`, `@rich-editor/core/legacy.css`.

## `@rich-editor/vue`

```ts
export { RichEditor, RichContent, RteIcon };   // default export — RichEditor; 07-vue.md
export const RichEditorPlugin: Plugin;          // app.use(): регистрирует RichEditor и RichContent

// реэкспорт из ядра без изменений
export {
  createRichEditor, createRichContent, applyTheme, DARK_THEME_CLASS, createToolbar, createModal, createPopover,
  createDropdown, TOOLBAR_PRESETS, resolveToolbar, SIMPLE_TOOLBAR_ITEMS, DEFAULT_LINK_STYLES, MATHLIVE_STRINGS,
  mathliveRu, clearPreviewCache, renderLatexPreview, DEFAULT_LIMITS, RichEditorCore, RichEditorError, ICONS,
  buildMathML, latexToMathML, mathmlToLatex, normalizeMathML, renderMathML,
};
export { en as enMessages, ru as ruMessages };
export type {
  Dropdown, LinkStyle, MathliveStrings, Modal, Popover, RichEditorUi, RichEditorUiOptions, RichEditorLiveOptions,
  RichContent as RichContentViewer, RichContentOptions, EditorTheme, Toolbar, ToolbarConfig, ToolbarGroupConfig,
  ToolbarItemDescriptor, ToolbarPreset, DialogComponent, EditorUiContext, UiComponent, IconName,
  EditorLimits, FormulaPayload, FormulaType, Messages, UploadAdapter, UploadContext, UploadEvent, UploadKind, UploadResult,
};
export type ToolbarItemId = string;
/** @deprecated */ export type ToolbarGroup = ToolbarGroupConfig;
```

Subpath-экспорты: `@rich-editor/vue/styles.css`, `@rich-editor/vue/legacy.css`.
Остальное (`EditorFeature`, `prepareIncomingHtml`, санитайзер, узлы,
`UploadPipeline`, `VoiceRecorder`, `createI18n`, шаблоны, палитры)
импортируется из `@rich-editor/core` — он зависимость Vue-пакета.

## `@rich-editor/standalone`

`./editor` (`dist/editor.js`): всё из `@rich-editor/core`, плюс
`MATHLIVE_FONTS_DIRECTORY: string` и `createRichEditor` с умолчанием
`mathliveFontsDirectory`. `./viewer` (`dist/viewer.js`): `createRichContent`,
`applyTheme`, `DARK_THEME_CLASS`, `prepareIncomingHtml`, `upgradeLegacyHtml`
и типы вьюера. Плюс `./styles.css`, `./legacy.css`.

## `django-rich-editor`

```python
rich_editor.widgets.RichEditorWidget(attrs=None, *, toolbar=None, theme=None, legacy=None,
                                     min_height=None, placeholder=None, locale=None, uploads=None, limits=None)
rich_editor.forms.RichTextFormField(*args, sanitize: bool = True, **kwargs)
rich_editor.fields.RichTextField(*args, legacy: bool | None = None, **kwargs)
rich_editor.sanitize.sanitize_html(html: str) -> str
rich_editor.sanitize.HTML_TAGS, HTML_ATTRS, MATHML_TAGS, MATHML_ATTRS, ALLOWED_URI_SCHEMES, STYLE_PROPERTIES
rich_editor.views.UploadView, ImageUploadView, AudioUploadView, FileUploadView   # has_permission, get_storage, get_upload_path
rich_editor.urls   # app_name='rich_editor': upload_image, upload_audio, upload_file
rich_editor.conf.DEFAULTS, get_setting(name)
rich_editor.templatetags.rich_editor: rich_editor_assets(legacy=False), rich_viewer_assets(legacy=False),
                                      rich_content(html, legacy=False, sanitize=False)
```
