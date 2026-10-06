import { Editor, type Extensions } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import TextAlign from '@tiptap/extension-text-align';
import { TableKit } from '@tiptap/extension-table';
import { Color, FontSize } from '@tiptap/extension-text-style';
import { Placeholder } from '@tiptap/extensions';

import {
  DEFAULT_LIMITS,
  RichEditorError,
  type AttachmentAttributes,
  type AudioAttributes,
  type EditorLimits,
  type FormulaType,
  type Messages,
  type RichEditorCoreLiveOptions,
  type RichEditorCoreOptions,
  type UploadResult,
} from './types';
import { createI18n, type I18n } from './i18n';
import { prepareIncomingHtml } from './prepare-html';
import { StrictTextStyle } from './extensions/strict-text-style';
import { LegacyHighlight } from './legacy/legacy-highlight';
import { whenFormulasReady } from './formula/mathjax';
import { normalizeMathML } from './formula/mathml';
import { AttachmentNode } from './nodes/attachment';
import { AudioNode } from './nodes/audio';
import { FormulaNode } from './nodes/formula';
import { LegacyEmbedNode } from './nodes/legacy-embed-node';
import { UploadPipeline, isImageFile, isTextFile } from './media/upload';
import { readTextFile, textToParagraphs } from './media/text-file';

// Стили редактируемой области. Импорт живёт здесь, а не в index.ts,
// который по соглашению содержит только реэкспорты.
import './styles.css';

/** Ниже этого размера картинку уже не за что ухватить. */
const IMAGE_MIN_SIZE = 40;

/** Расширение файла голосового сообщения по MIME-типу контейнера. */
const MIME_EXTENSIONS: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
};

const extensionFor = (mime: string): string => {
  const base = (mime.split(';')[0] ?? mime).trim();

  return MIME_EXTENSIONS[base] ?? 'webm';
};

/**
 * Ядро редактора: собирает TipTap с набором расширений пакета и даёт хосту
 * (vanilla-интерфейсу, Vue-обёртке) единый API для контента, формул и медиа.
 */
export class RichEditorCore {
  /**
   * TipTap-движок. Не часть публичного API: нужен интерфейсу и тестам пакета,
   * из опубликованных типов вырезается (`@internal` + `stripInternal`). Хосту
   * достаточно методов этого класса; расширениям TipTap доступен через
   * `EditorUiContext.editor`.
   *
   * @internal
   */
  readonly editor: Editor;

  readonly uploads: UploadPipeline;

  private i18n: I18n;

  private limits: EditorLimits;

  private options: RichEditorCoreOptions;

  constructor(options: RichEditorCoreOptions) {
    this.options = options;
    this.i18n = createI18n({ locale: options.locale, messages: options.messages });
    this.limits = { ...DEFAULT_LIMITS, ...options.limits };

    this.uploads = new UploadPipeline({
      limits: this.limits,
      t: this.i18n.t,
      adapters: {
        image: options.uploadImage,
        audio: options.uploadAudio,
        file: options.uploadFile,
      },
      onError: (error) => this.reportError(error),
      onUpload: (event) => options.onUpload?.(event),
    });

    this.editor = new Editor({
      element: options.element,
      content: options.content
        ? prepareIncomingHtml(options.content, { legacy: options.legacy })
        : '',
      editable: options.editable ?? true,
      extensions: this.buildExtensions(),
      editorProps: {
        attributes: this.buildEditorAttributes(),
        // Every externally authored fragment goes through the sanitizer.
        transformPastedHTML: (html) => prepareIncomingHtml(html, { legacy: this.options.legacy }),
        handlePaste: (_view, event) => this.insertFiles(event.clipboardData?.files),
        handleDrop: (view, event, _slice, moved) => {
          if (moved) return false;

          const dropEvent = event as DragEvent;
          const pos = view.posAtCoords({ left: dropEvent.clientX, top: dropEvent.clientY });

          return this.insertFiles(dropEvent.dataTransfer?.files, pos?.pos);
        },
      },
      onUpdate: () => options.onChange?.(this.getHTML()),
      onSelectionUpdate: () => options.onSelectionUpdate?.(),
      onTransaction: () => options.onTransaction?.(),
      onFocus: () => options.onFocus?.(),
      onBlur: () => options.onBlur?.(),
    });
  }

  /** Атрибуты области ввода: класс, роль и подписи для читалки. */
  private buildEditorAttributes(): Record<string, string> {
    return {
      class: this.options.legacy ? 'rte-content rte-legacy' : 'rte-content',
      role: 'textbox',
      'aria-multiline': 'true',
      'aria-label': this.options.ariaLabel ?? this.i18n.t('editor_aria_label'),
      // Подсказка пустого поля рисуется псевдоэлементом, читалке её не
      // видно — сообщаем отдельно.
      'aria-placeholder': this.options.placeholder ?? this.i18n.t('editor_placeholder'),
    };
  }

  private refreshEditorAttributes(): void {
    if (this.editor.isDestroyed) return;

    this.editor.setOptions({
      editorProps: { ...this.editor.options.editorProps, attributes: this.buildEditorAttributes() },
    });
  }

  /**
   * Подсказка задана функцией, которую плагин зовёт при отрисовке: достаточно
   * перерисовать документ пустой транзакцией.
   */
  private refreshPlaceholder(): void {
    if (this.editor.isDestroyed) return;

    this.editor.view.dispatch(this.editor.state.tr);
  }

  private buildExtensions(): Extensions {
    const { t } = this.i18n;

    return [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4, 5, 6] },
        link: {
          openOnClick: false,
          autolink: true,
          // Mirrors the sanitizer: no `javascript:` or other executable schemes.
          protocols: ['http', 'https', 'mailto', 'tel'],
          HTMLAttributes: { rel: 'noopener noreferrer' },
        },
        codeBlock: { HTMLAttributes: { class: 'rte-code-block' } },
      }),
      StrictTextStyle,
      Color,
      // Размер шрифта из инлайнового стиля. Без него разметка старого
      // редактора теряет кегль: текст в 72px отрисовывается базовым.
      // Не привязано к legacy-режиму намеренно — иначе один документ выглядел
      // бы по-разному в зависимости от флага.
      FontSize,
      // В legacy-режиме подсветка приходит инлайновым стилем, а не <mark>.
      (this.options.legacy ? LegacyHighlight : Highlight).configure({ multicolor: true }),
      Subscript,
      Superscript,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      TableKit.configure({
        table: { resizable: true, HTMLAttributes: { class: 'rte-table' } },
      }),
      Image.configure({
        // В разметке Froala картинка всегда лежит внутри абзаца, а блочный вид
        // ей задаёт класс (fr-dib). Блочный узел разорвал бы такой абзац на
        // два, поэтому в legacy-режиме картинка инлайновая, а «блочность»
        // остаётся вопросом стилей.
        inline: this.options.legacy ?? false,
        allowBase64: true,
        HTMLAttributes: { class: 'rte-image' },
        // Ручки по углам, как в старом редакторе. Пропорции держим всегда:
        // растянутая по одной оси картинка — почти всегда промах мышью, а не
        // намерение.
        resize: {
          enabled: true,
          alwaysPreserveAspectRatio: true,
          minWidth: IMAGE_MIN_SIZE,
          minHeight: IMAGE_MIN_SIZE,
        },
      }),
      Placeholder.configure({
        // Функция, а не строка: текст читается при каждой отрисовке, поэтому
        // смена подсказки или языка не требует пересоздания расширения.
        placeholder: () => this.options.placeholder ?? this.i18n.t('editor_placeholder'),
      }),
      FormulaNode.configure({
        onEdit: (payload) => this.options.onFormulaEdit?.(payload),
        scale: this.options.formulaScale ?? 1,
      }),
      AudioNode.configure({ t }),
      AttachmentNode.configure({ t }),
      // Узел нужен только там, где включён legacy-режим: иначе он просто
      // расширяет схему тем, что никогда не встретится.
      ...(this.options.legacy ? [LegacyEmbedNode] : []),
      ...(this.resolveExtraExtensions() as Extensions),
    ];
  }

  private resolveExtraExtensions(): unknown[] {
    const { extensions } = this.options;

    if (typeof extensions === 'function') return extensions({ t: this.i18n.t });

    return extensions ?? [];
  }

  // ---------------------------------------------------------------- content

  getHTML(): string {
    return this.editor.getHTML();
  }

  /** ProseMirror-JSON документа. Формат внутренний, наружу не отдаётся. @internal */
  getJSON(): Record<string, unknown> {
    return this.editor.getJSON() as Record<string, unknown>;
  }

  getText(): string {
    return this.editor.getText();
  }

  setHTML(html: string, options: { emitUpdate?: boolean } = {}): void {
    this.editor.commands.setContent(prepareIncomingHtml(html, { legacy: this.options.legacy }), {
      emitUpdate: options.emitUpdate ?? false,
    });
  }

  isEmpty(): boolean {
    return this.editor.isEmpty;
  }

  focus(): void {
    this.editor.commands.focus();
  }

  setEditable(editable: boolean): void {
    this.editor.setEditable(editable);
  }

  /**
   * Меняет у живого редактора всё, что не требует пересоздания: режим,
   * язык и таблицы переводов, пределы, подсказку, имя для читалки и адаптеры
   * загрузки. Ключ, которого нет в объекте, не трогается.
   */
  setOptions(next: RichEditorCoreLiveOptions): void {
    if (next.editable !== undefined) this.setEditable(next.editable);

    if (next.locale !== undefined) this.i18n.setLocale(next.locale);

    if ('messages' in next) this.i18n.setMessages(next.messages);

    if (next.limits) this.setLimits(next.limits);

    if ('placeholder' in next || 'ariaLabel' in next) {
      this.options = {
        ...this.options,
        ...('placeholder' in next ? { placeholder: next.placeholder } : {}),
        ...('ariaLabel' in next ? { ariaLabel: next.ariaLabel } : {}),
      };
    }

    if ('uploadImage' in next || 'uploadAudio' in next || 'uploadFile' in next) {
      this.options = {
        ...this.options,
        ...('uploadImage' in next ? { uploadImage: next.uploadImage } : {}),
        ...('uploadAudio' in next ? { uploadAudio: next.uploadAudio } : {}),
        ...('uploadFile' in next ? { uploadFile: next.uploadFile } : {}),
      };
      this.uploads.setOptions({
        adapters: {
          image: this.options.uploadImage,
          audio: this.options.uploadAudio,
          file: this.options.uploadFile,
        },
      });
    }

    // Подсказка и имя по умолчанию переводятся, поэтому обновляются и при
    // смене языка, а не только когда их задали явно.
    this.refreshEditorAttributes();
    this.refreshPlaceholder();
  }

  /**
   * Resolves once pending MathJax renders settle, so `getHTML()` includes SVG.
   * Уничтоженному редактору ждать нечего: его формулы уже не отрисуются.
   */
  async whenFormulasReady(): Promise<void> {
    if (this.editor.isDestroyed) return;

    await whenFormulasReady();
  }

  // ---------------------------------------------------------------- i18n

  setLocale(locale: string): void {
    this.setOptions({ locale });
  }

  setMessages(messages: Record<string, Messages> | undefined): void {
    this.setOptions({ messages });
  }

  t(key: string, params?: Record<string, string | number>): string {
    return this.i18n.t(key, params);
  }

  setLimits(limits: Partial<EditorLimits>): void {
    this.limits = { ...this.limits, ...limits };
    this.uploads.setOptions({ limits: this.limits });
  }

  getLimits(): EditorLimits {
    return this.limits;
  }

  // ---------------------------------------------------------------- formulas

  insertFormula(mathml: string, type: FormulaType = 'math'): boolean {
    const safe = normalizeMathML(mathml);

    if (!safe) {
      this.reportError(new RichEditorError('invalid-mathml', this.i18n.t('error_invalid_mathml')));

      return false;
    }

    return this.editor.chain().focus().insertFormula({ mathml: safe, type }).run();
  }

  updateFormulaAt(pos: number, mathml: string, type: FormulaType = 'math'): boolean {
    const safe = normalizeMathML(mathml);

    if (!safe) {
      this.reportError(new RichEditorError('invalid-mathml', this.i18n.t('error_invalid_mathml')));

      return false;
    }

    return this.editor.chain().focus().updateFormula({ pos, mathml: safe, type }).run();
  }

  deleteFormulaAt(pos: number): boolean {
    return this.editor.chain().focus().deleteFormulaAt(pos).run();
  }

  // ---------------------------------------------------------------- media

  async insertImageFile(file: File, at?: number): Promise<boolean> {
    const result = await this.uploads.upload('image', file);

    if (!result) return false;

    return this.insertImageUrl(result, at);
  }

  insertImageUrl(result: UploadResult, at?: number): boolean {
    const chain = this.editor.chain();

    if (typeof at === 'number') chain.focus(at);
    else chain.focus();

    return chain.setImage({ src: result.url, alt: result.name ?? '' }).run();
  }

  /** Inserts a recorded voice message, uploading it through the audio adapter. */
  async insertRecording(
    blob: Blob,
    meta: { duration: number; peaks?: string; name?: string },
  ): Promise<boolean> {
    const fileName = meta.name ?? `voice-${Date.now()}.${extensionFor(blob.type)}`;
    const file = new File([blob], fileName, { type: blob.type });

    const result = this.options.uploadAudio
      ? await this.uploads.upload('audio', file)
      : this.uploads.toObjectUrl(file);

    if (!result) return false;

    return this.insertAudio({
      src: result.url,
      name: result.name ?? fileName,
      mime: result.mime ?? blob.type,
      duration: meta.duration,
      peaks: meta.peaks ?? null,
    });
  }

  insertAudio(attributes: AudioAttributes): boolean {
    return this.editor.chain().focus().insertAudio(attributes).run();
  }

  /** Attaches a text file as a download chip (the documented default UX). */
  async attachTextFile(file: File): Promise<boolean> {
    const result = await this.uploads.upload('file', file);

    if (!result) return false;

    return this.insertAttachment({
      href: result.url,
      name: result.name ?? file.name,
      size: result.size ?? file.size,
      mime: result.mime ?? file.type,
    });
  }

  insertAttachment(attributes: AttachmentAttributes): boolean {
    return this.editor.chain().focus().insertAttachment(attributes).run();
  }

  /**
   * Inserts a text file's contents as plain paragraphs. Markdown is never
   * parsed — the raw text is what the user sees.
   */
  async insertTextFileContent(file: File): Promise<boolean> {
    if (file.size > this.limits.maxFileSizeBytes) {
      await this.uploads.upload('file', file); // Reuses the localized size error.

      return false;
    }

    try {
      const text = await readTextFile(file, this.i18n.t);

      const paragraphs = textToParagraphs(text).map((line) => ({
        type: 'paragraph',
        content: line ? [{ type: 'text', text: line }] : [],
      }));

      return this.editor.chain().focus().insertContent(paragraphs).run();
    } catch (error) {
      if (error instanceof RichEditorError) this.reportError(error);

      return false;
    }
  }

  /**
   * Routes dropped or pasted files to the right plugin. Returns `true` when at
   * least one file was claimed, which stops ProseMirror's default handling.
   */
  private insertFiles(files: FileList | null | undefined, at?: number): boolean {
    if (!files || files.length === 0) return false;

    const candidates = Array.from(files).filter(
      (file) => isImageFile(file) || isTextFile(file) || file.type.startsWith('audio/'),
    );

    if (candidates.length === 0) return false;

    // ProseMirror ждёт синхронный ответ, а каждый шаг сам сообщает о своих
    // ошибках через onError — поэтому цепочка вставок не ожидается.
    this.insertFilesInOrder(candidates, at);

    return true;
  }

  /**
   * Вставляет файлы строго по очереди: каждая вставка двигает курсор, и
   * параллельные загрузки перемешали бы порядок содержимого.
   */
  private insertFilesInOrder(files: File[], at?: number): Promise<void> {
    return files.reduce(async (previous, file) => {
      await previous;

      if (isImageFile(file)) await this.insertImageFile(file, at);
      else if (file.type.startsWith('audio/')) await this.insertAudioFile(file);
      else await this.attachTextFile(file);
    }, Promise.resolve());
  }

  private async insertAudioFile(file: File): Promise<boolean> {
    const result = await this.uploads.upload('audio', file);

    if (!result) return false;

    return this.insertAudio({
      src: result.url,
      name: result.name ?? file.name,
      mime: result.mime ?? file.type,
      duration: null,
      peaks: null,
    });
  }

  private reportError(error: RichEditorError): void {
    this.options.onError?.(error);
  }

  destroy(): void {
    this.uploads.destroy();
    this.editor.destroy();
  }
}
