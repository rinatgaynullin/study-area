/**
 * Возможность «Распознать фото»: кнопка тулбара, выбор снимков, адаптер хоста
 * и вставка результата в документ.
 *
 * Само распознавание делает бэкенд хоста — как и хранение файлов при
 * загрузке. Редактор знает только контракт адаптера: снимки на входе, текст
 * PinQueen на выходе. Пакет не привязан к адресам и токенам чьего-то API, а
 * хост подключает распознавание так же, как загрузку картинок — одной
 * функцией.
 */
import {
  ICONS,
  IMAGE_ACCEPT,
  RichEditorError,
  createDisposer,
  el,
  formatBytes,
  isImageFile,
  on,
  type EditorFeature,
  type EditorUiContext,
  type Messages,
  type ToolbarItemDescriptor,
  type Translate,
  type UiComponent,
} from '@rich-editor/core';
import { OCR_MESSAGES } from './messages';
import { ocrTextToHtml, type OcrMetadata, type OcrSubject } from './ocr-to-html';

const STROKE =
  'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';

// Видоискатель с искрой: иконка регистрируется в общем наборе ядра.
ICONS.scan =
  `<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" ${STROKE} />`
  + `<path d="M12 8.5l1 2.5 2.5 1-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1z" ${STROKE} />`;

export const OCR_FEATURE_ID = 'ocr';

/** Идентификатор пункта тулбара. */
export const OCR_TOOLBAR_ITEM_ID = 'ocr-recognize';

/** Что хост получил от своего бэкенда. */
export interface RecognizeResult {
  /** Текст в формате PinQueen: Markdown, LaTeX, маркеры чертежей, `\chemfig`. */
  text: string;
  /** Предмет, если бэкенд его определил; главнее настройки возможности. */
  subject?: OcrSubject;
  metadata?: OcrMetadata;
  /**
   * Адреса снимков в хранилище хоста — для панели сканов рядом с
   * конструктором чертежей. Без них берутся локальные адреса выбранных файлов.
   */
  scans?: string[];
}

export interface RecognizeContext {
  /** Прерывается при уничтожении редактора. */
  signal: AbortSignal;
  t: Translate;
  subject?: OcrSubject;
}

/**
 * Адаптер распознавания: снимки → текст. Как `UploadAdapter`, но на выходе не
 * адрес, а ответ бэкенда. Исключение отменяет вставку и приходит в `onError`
 * с кодом `recognize-failed`.
 */
export type RecognizeAdapter = (files: File[], context: RecognizeContext) => Promise<RecognizeResult>;

export interface OcrFeatureOptions {
  recognize: RecognizeAdapter;
  /** Предмет для разбора текста; функция — если он меняется на лету. */
  subject?: OcrSubject | (() => OcrSubject | undefined);
  /** Сколько снимков принимает одно распознавание. */
  maxFiles?: number;
  /** Вставлять результат вместо документа, а не в позицию курсора. */
  replace?: boolean;
  /** Оборачивать голый LaTeX в `$`; см. `ocrTextToHtml`. */
  wrapBareLatex?: boolean;
  /** Пункт тулбара не нужен — например, снимки выбирает интерфейс хоста. */
  toolbarItem?: boolean;
}

/** Возможность с доступом к снимкам последнего распознавания. */
export interface OcrFeature extends EditorFeature {
  /** Адреса снимков последнего распознавания — для `createDrawingsFeature({ scans })`. */
  scans(): string[];
  /**
   * Распознаёт файлы, выбранные интерфейсом хоста, минуя системный диалог.
   * `false` — снимки отклонены, редактор занят или адаптер не ответил.
   */
  recognize(files: File[]): Promise<boolean>;
}

const DEFAULT_MAX_FILES = 3;

/**
 * Класс: кнопка, скрытое поле выбора и вызов адаптера делят контекст
 * оболочки, снимки последнего распознавания и признак «уже идёт».
 */
class RecognizeFeature implements OcrFeature {
  readonly id = OCR_FEATURE_ID;

  readonly messages: Record<string, Messages> = OCR_MESSAGES;

  private context: EditorUiContext | null = null;

  private input: HTMLInputElement | null = null;

  private scanUrls: string[] = [];

  /** Локальные адреса снимков — освобождаются при следующем распознавании и с оболочкой. */
  private objectUrls: string[] = [];

  private controller = new AbortController();

  private busy = false;

  constructor(private readonly options: OcrFeatureOptions) {}

  readonly scans = (): string[] => [...this.scanUrls];

  readonly toolbarItems = (): ToolbarItemDescriptor[] =>
    this.options.toolbarItem === false
      ? []
      : [
          {
            id: OCR_TOOLBAR_ITEM_ID,
            icon: 'scan',
            labelKey: 'ocr_recognize',
            kind: 'button',
            run: () => this.input?.click(),
          },
        ];

  /**
   * «Диалог» возможности — скрытое поле выбора файлов: системный диалог
   * нельзя открыть иначе. Живёт и умирает с оболочкой, как остальные.
   */
  readonly dialogs = (context: EditorUiContext): UiComponent[] => {
    this.context = context;

    const input = el('input', {
      class: 'rte-hidden-input rte-ocr-input',
      attrs: { type: 'file', accept: IMAGE_ACCEPT, multiple: '' },
    });
    const disposer = createDisposer();

    disposer.add(
      on(input, 'change', () => {
        const files = [...(input.files ?? [])];

        // Сброс — чтобы те же снимки можно было выбрать повторно.
        input.value = '';
        void this.recognize(files);
      }),
    );
    this.input = input;

    return [
      {
        element: input,
        destroy: () => {
          disposer.dispose();
          this.controller.abort();
          this.controller = new AbortController();
          this.releaseScans();

          if (this.input === input) this.input = null;

          if (this.context === context) this.context = null;
        },
      },
    ];
  };

  readonly recognize = async (files: File[]): Promise<boolean> => {
    const context = this.context;

    if (!context || files.length === 0 || this.busy || !this.accept(files, context)) return false;

    const { t } = context;
    const subject = this.currentSubject();
    const { signal } = this.controller;

    this.busy = true;
    context.setBusy(OCR_FEATURE_ID, t('ocr_recognizing'));

    try {
      const result = await this.options.recognize(files, { signal, t, subject });

      if (signal.aborted) return false;

      if (typeof result?.text !== 'string' || result.text.trim() === '') {
        throw new RichEditorError('recognize-failed', t('error_recognize_empty'));
      }

      this.rememberScans(files, result.scans);

      const html = await ocrTextToHtml(result.text, {
        subject: result.subject ?? subject,
        metadata: result.metadata,
        wrapBareLatex: this.options.wrapBareLatex,
      });

      if (signal.aborted) return false;

      return context.insertHtml(html, { replace: this.options.replace });
    } catch (cause) {
      if (signal.aborted) return false;

      context.reportError(
        cause instanceof RichEditorError
          ? cause
          : new RichEditorError('recognize-failed', t('error_recognize_failed'), cause),
      );

      return false;
    } finally {
      this.busy = false;

      // После уничтожения оболочки строки статуса уже нет.
      if (!signal.aborted) context.setBusy(OCR_FEATURE_ID, null);
    }
  };

  private currentSubject(): OcrSubject | undefined {
    const { subject } = this.options;

    return typeof subject === 'function' ? subject() : subject;
  }

  /** Те же проверки, что у загрузки картинок, плюс предел на число снимков. */
  private accept(files: File[], context: EditorUiContext): boolean {
    const { t, limits } = context;
    const max = this.options.maxFiles ?? DEFAULT_MAX_FILES;

    if (files.length > max) {
      context.reportError(new RichEditorError('recognize-failed', t('error_recognize_too_many', { max })));

      return false;
    }

    for (const file of files) {
      if (!isImageFile(file)) {
        context.reportError(
          new RichEditorError('unsupported-type', t('error_unsupported_type', { type: file.type || file.name })),
        );

        return false;
      }

      if (file.size > limits.maxImageSizeBytes) {
        context.reportError(
          new RichEditorError(
            'file-too-large',
            t('error_file_too_large', {
              name: file.name,
              size: formatBytes(file.size),
              max: formatBytes(limits.maxImageSizeBytes),
            }),
          ),
        );

        return false;
      }
    }

    return true;
  }

  /** Снимки последнего распознавания: адреса хоста, иначе локальные. */
  private rememberScans(files: File[], scans: string[] | undefined): void {
    this.releaseScans();

    if (scans && scans.length > 0) {
      this.scanUrls = [...scans];

      return;
    }

    this.objectUrls = files.map((file) => URL.createObjectURL(file));
    this.scanUrls = [...this.objectUrls];
  }

  private releaseScans(): void {
    this.objectUrls.forEach((url) => URL.revokeObjectURL(url));
    this.objectUrls = [];
    this.scanUrls = [];
  }
}

export const createOcrFeature = (options: OcrFeatureOptions): OcrFeature => new RecognizeFeature(options);
