import { Extension, type Editor } from '@tiptap/core';
import { RichEditorCore } from '../rich-editor-core';
import { DEFAULT_LOCALE } from '../i18n';
import { IMAGE_ACCEPT, TEXT_FILE_ACCEPT } from '../media/upload';
import type {
  EditorLimits,
  FormulaPayload,
  Messages,
  RichEditorCoreOptions,
  RichEditorError,
  UploadEvent,
  UploadKind,
} from '../types';
import { focusEditorView } from '../utils/focus-editor-view';
import { createDisposer, el, on } from './dom';
import { createAudioRecorderDialog } from './dialogs/audio-recorder-dialog';
import { createFormulaDialog } from './dialogs/formula-dialog';
import { createLinkDialog, type LinkDialogPayload } from './dialogs/link-dialog';
import { createTableDialog } from './dialogs/create-table-dialog';
import { createLinkPopover, type LinkPopover } from './link-popover';
import { MODAL_CLOSE_EVENT } from './modal';
import type { LinkStyle } from './link-styles';
import { resolveToolbar, type ToolbarConfig } from './presets';
import { applyTheme, type EditorTheme } from './theme';
import { createToolbar, type Toolbar, type ToolbarGroupConfig } from './toolbar';
import { SIMPLE_TOOLBAR_ITEMS } from './toolbar-items';
import { createPanelToolbarItems } from './toolbar-panels';
import type {
  DialogComponent,
  EditorFeature,
  EditorUiContext,
  FeatureBuildOptions,
  ToolbarItemDescriptor,
  UiComponent,
} from './types';

export interface RichEditorUiOptions extends Omit<RichEditorCoreOptions, 'element'> {
  /** Куда смонтировать редактор целиком: тулбар и область ввода. */
  element: HTMLElement;
  /** Пресет или собственный список групп. */
  toolbar?: ToolbarConfig;
  /** Дополнительные пункты тулбара поверх встроенных. */
  toolbarItems?: Record<string, ToolbarItemDescriptor>;
  /**
   * Возможности поверх встроенных: расширения схемы, пункты тулбара и диалоги
   * одним объявлением. Пункты, не упомянутые в конфигурации тулбара, встают
   * своей группой в конец — подключённую возможность должно быть видно.
   */
  features?: EditorFeature[];
  /** Варианты оформления ссылки в поповере. */
  linkStyles?: LinkStyle[];
  /** Откуда MathLive берёт шрифты; `null` — CSS уже подключён. */
  mathliveFontsDirectory?: string | null;
  /** Ниже этой ширины схлопываемые группы уезжают в меню. */
  collapseBelow?: number;
  textSwatches?: string[];
  highlightSwatches?: string[];
  minHeight?: string;
  /**
   * Строка под тулбаром с идущими загрузками и последней ошибкой. Включена
   * по умолчанию; хост с собственными уведомлениями выключает её.
   */
  statusLine?: boolean;
  /**
   * Тема интерфейса. `auto` следует за системной настройкой. То же самое
   * даёт класс `rte-theme-dark` на элементе или любом его предке.
   */
  theme?: EditorTheme;
}

/** Сколько держать ошибку в строке статуса: прочитать успеют, навсегда не останется. */
const ERROR_VISIBLE_MS = 6000;

/**
 * Сочетания клавиш оболочки — про интерфейс, а не про документ, поэтому их
 * вешает оболочка, а не расширения схемы. Alt+F10 ведёт из документа в
 * тулбар, как в других редакторах; Mod+K открывает ссылку — иначе до неё с
 * клавиатуры только через тулбар.
 */
const createUiShortcuts = (handlers: { focusToolbar(): void; editLink(): void }) =>
  Extension.create({
    name: 'richEditorUiShortcuts',
    addKeyboardShortcuts: () => ({
      'Alt-F10': () => {
        handlers.focusToolbar();

        return true;
      },
      'Mod-k': () => {
        handlers.editLink();

        return true;
      },
    }),
  });

export interface RichEditorUi {
  /** Движок: документ, команды, загрузки. */
  readonly core: RichEditorCore;
  readonly element: HTMLElement;
  /** Переключает режим чтения: вместе с движком прячет и тулбар. */
  setEditable(editable: boolean): void;
  /** Меняет язык и пересобирает интерфейс: подписи приходят из переводчика. */
  setLocale(locale: string): void;
  /** Меняет таблицы переводов и пересобирает интерфейс. */
  setMessages(messages: Record<string, Messages> | undefined): void;
  /** Пересобирает интерфейс, если таблицу переводов изменили на месте. */
  refreshLabels(): void;
  /** Меняет пределы загрузок и записи у живого редактора. */
  setLimits(limits: Partial<EditorLimits>): void;
  /** Переключает тему; `auto` начинает следить за системной настройкой. */
  setTheme(theme: EditorTheme): void;
  destroy(): void;
}

/** Оверлеи оболочки: диалоги, поповер и диалоги возможностей. */
interface Overlays {
  link: DialogComponent<LinkDialogPayload>;
  table: DialogComponent;
  recorder: DialogComponent<void>;
  formula: DialogComponent<FormulaPayload | null>;
  linkPopover: LinkPopover;
  extra: UiComponent[];
}

const listOverlays = (overlays: Overlays): UiComponent[] => [
  overlays.link,
  overlays.table,
  overlays.recorder,
  overlays.formula,
  overlays.linkPopover,
  ...overlays.extra,
];

/** Пункты каждой возможности, запрошенные один раз: дескрипторы не пересоздаются. */
interface FeatureItems {
  feature: EditorFeature;
  items: ToolbarItemDescriptor[];
}

/**
 * Пункты возможностей, которых нет в конфигурации тулбара, встают своей
 * группой в конец. Явно перечисленные остаются там, куда их поставил хост:
 * конфигурация тулбара главнее умолчания возможности.
 */
const withFeatureGroups = (
  groups: ToolbarGroupConfig[],
  features: FeatureItems[],
): ToolbarGroupConfig[] => {
  const mentioned = new Set(groups.flatMap((group) => group.items));

  const extra = features.flatMap(({ feature, items }) => {
    const ids = items.map((item) => item.id).filter((id) => !mentioned.has(id));

    return ids.length > 0 ? [{ id: feature.id, items: ids }] : [];
  });

  // Пресеты — общие константы, дописывать в них нельзя.
  return extra.length > 0 ? [...groups, ...extra] : groups;
};

/**
 * Контекст для тулбара, диалогов и поповера. Пределы читаются с движка при
 * каждом обращении: setLimits меняет их у живого редактора, а снимок оставил
 * бы диалог записи со старыми.
 */
const createUiContext = (
  core: RichEditorCore,
  editFormula: (payload: FormulaPayload) => void,
): EditorUiContext => ({
  editor: core.editor,
  t: (key, params) => core.t(key, params),
  get limits() {
    return core.getLimits();
  },
  uploads: core.uploads,
  editFormula,
});

/**
 * Ванильная оболочка редактора: тулбар, строка статуса, область ввода,
 * скрытые поля выбора файлов и оверлеи.
 *
 * Части ссылаются друг на друга крест-накрест: ядро зовёт обновление тулбара,
 * расширения — диалог ссылки и фокус тулбара, тулбар и диалоги — оверлеи,
 * которые пересоздаются при смене языка. Поэтому состояние живёт в полях, а
 * операции — в методах, которым не важен порядок объявления.
 */
class RichEditorUiController implements RichEditorUi {
  readonly core: RichEditorCore;

  /** Корень оболочки: тулбар, строка статуса, область ввода и скрытые поля. */
  readonly element: HTMLElement;

  private readonly options: RichEditorUiOptions;

  private readonly disposer = createDisposer();

  private releaseTheme: () => void;

  /**
   * Строка статуса: идущие загрузки и последняя ошибка. Хост получает то же
   * через onUpload и onError, но пользователь должен видеть, что файл
   * грузится и почему не вставился, без обвязки со стороны хоста.
   */
  private readonly status: HTMLElement;

  private readonly hasStatusLine: boolean;

  /** Загрузки в полёте, по видам: параллельных может быть несколько. */
  private readonly uploading = new Map<UploadKind, number>();

  private errorText = '';

  private errorTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Скрытые поля выбора файлов: системный диалог нельзя открыть иначе.
   * Фильтр — тот же, что у пайплайна загрузки, иначе пикер прячет файлы,
   * которые редактор принял бы перетаскиванием.
   */
  private readonly imageInput: HTMLInputElement;

  private readonly fileInput: HTMLInputElement;

  private fileMode: 'attach' | 'insert' = 'attach';

  private readonly features: EditorFeature[];

  /** Пункты возможностей, запрошенные один раз: дескрипторы не пересоздаются. */
  private readonly featureItems: FeatureItems[];

  /** Текущий язык: нужен MathLive, у которого своя локаль. */
  private locale: string;

  private readonly context: EditorUiContext;

  private readonly toolbar: Toolbar;

  /**
   * Оверлеи пересоздаются при смене языка, поэтому ссылка на них одна,
   * подменяемая, а тулбар и движок ходят через неё.
   */
  private overlays: Overlays;

  /**
   * Тулбар и оверлеи собраны. Ядро может дёрнуть onTransaction ещё при
   * создании, когда обновлять нечего.
   */
  private isAssembled = false;

  constructor(options: RichEditorUiOptions) {
    this.options = options;
    this.element = el('div', { class: 'rte-root' });
    this.releaseTheme = applyTheme(this.element, options.theme ?? 'light');

    const host = el('div', { class: 'rte-host' });
    const surface = el('div', { class: 'rte-surface', children: [host] });

    if (options.minHeight) host.style.minHeight = options.minHeight;

    // Живая область должна существовать до того, как в ней появится текст:
    // регион, который показывают и наполняют одновременно, читалки часто
    // пропускают. Поэтому строка не прячется атрибутом hidden — пустую её
    // схлопывают стили.
    this.status = el('div', {
      class: 'rte-status',
      attrs: { role: 'status', 'aria-live': 'polite' },
    });

    this.hasStatusLine = options.statusLine !== false;

    this.imageInput = el('input', {
      class: 'rte-hidden-input',
      attrs: { type: 'file', accept: IMAGE_ACCEPT },
    });

    this.fileInput = el('input', {
      class: 'rte-hidden-input',
      attrs: { type: 'file', accept: TEXT_FILE_ACCEPT },
    });

    this.features = options.features ?? [];
    this.locale = options.locale ?? DEFAULT_LOCALE;

    this.core = new RichEditorCore({
      ...options,
      element: host,
      extensions: this.buildExtensions,
      onError: this.reportError,
      onUpload: this.onUpload,
      onTransaction: this.onTransaction,
      onFormulaEdit: this.onFormulaEdit,
    });

    this.context = createUiContext(this.core, this.editFormula);

    this.featureItems = this.features.map((feature) => ({
      feature,
      items: feature.toolbarItems?.() ?? [],
    }));

    const items: Record<string, ToolbarItemDescriptor> = {
      ...SIMPLE_TOOLBAR_ITEMS,
      ...createPanelToolbarItems({
        textSwatches: options.textSwatches,
        highlightSwatches: options.highlightSwatches,
        insertTable: () => this.overlays.table.open(),
        editLink: this.editLink,
        pickImage: () => this.imageInput.click(),
        pickFile: (mode) => {
          this.fileMode = mode;
          this.fileInput.click();
        },
        recordAudio: () => this.overlays.recorder.open(),
        insertFormula: (type) => this.overlays.formula.open({ mathml: '', type, pos: null }),
      }),
      ...Object.fromEntries(
        this.featureItems.flatMap(({ items: featureToolbarItems }) =>
          featureToolbarItems.map((item) => [item.id, item]),
        ),
      ),
      // Пункты, переданные напрямую, главнее: ими хост точечно правит и
      // встроенные пункты, и пункты возможностей.
      ...options.toolbarItems,
    };

    this.toolbar = createToolbar(this.context, {
      groups: withFeatureGroups(resolveToolbar(options.toolbar), this.featureItems),
      items,
      collapseBelow: options.collapseBelow,
    });

    this.element.append(
      this.toolbar.element,
      ...(this.hasStatusLine ? [this.status] : []),
      surface,
      this.imageInput,
      this.fileInput,
    );

    options.element.appendChild(this.element);
    this.overlays = this.buildOverlays();
    this.isAssembled = true;

    this.refresh();

    this.disposer.add(on(this.element, MODAL_CLOSE_EVENT, this.onModalClose));
    this.disposer.add(on(this.imageInput, 'change', this.onImageInputChange));
    this.disposer.add(on(this.fileInput, 'change', this.onFileInputChange));

    this.applyEditable(this.core.editor.isEditable);
  }

  setEditable(editable: boolean): void {
    this.core.setEditable(editable);
    this.applyEditable(editable);
  }

  setLocale(locale: string): void {
    this.locale = locale;
    this.core.setLocale(locale);
    this.refreshLabels();
  }

  setMessages(messages: Record<string, Messages> | undefined): void {
    this.core.setMessages(messages);
    this.refreshLabels();
  }

  /** Пересобирает всё, что запекает подписи при создании: тулбар и оверлеи. */
  refreshLabels(): void {
    this.destroyOverlays();
    this.overlays = this.buildOverlays();
    this.toolbar.rebuild();
    this.refreshStatus();
  }

  setLimits(limits: Partial<EditorLimits>): void {
    this.core.setLimits(limits);
  }

  setTheme(theme: EditorTheme): void {
    this.releaseTheme();
    this.releaseTheme = applyTheme(this.element, theme);
  }

  destroy(): void {
    this.releaseTheme();

    if (this.errorTimer) clearTimeout(this.errorTimer);

    this.disposer.dispose();
    this.toolbar.destroy();
    this.destroyOverlays();
    this.core.destroy();
    this.element.remove();
  }

  /** Расширения хоста и возможностей; переводчик приходит из движка. */
  private readonly buildExtensions = ({ t }: { t: FeatureBuildOptions['t'] }): unknown[] => {
    const { options, features } = this;

    const own =
      typeof options.extensions === 'function'
        ? options.extensions({ t })
        : (options.extensions ?? []);

    const build: FeatureBuildOptions = {
      t,
      legacy: options.legacy ?? false,
      placeholder: options.placeholder,
      formulaScale: options.formulaScale ?? 1,
      onFormulaEdit: this.editFormula,
    };

    return [
      ...own,
      ...features.flatMap((feature) => feature.extensions?.(build) ?? []),
      // Тулбар создаётся после движка, но обработчики зовутся ещё позже —
      // когда всё уже собрано.
      createUiShortcuts({ focusToolbar: () => this.toolbar.focus(), editLink: this.editLink }),
    ];
  };

  /**
   * Собирает диалоги и поповер. Подписи в них запекаются при создании — как и
   * в тулбаре, — поэтому смена языка пересобирает их заново: закрытые они
   * без состояния, а держать реактивные подписи ради редкой операции —
   * лишний слой.
   */
  private buildOverlays(): Overlays {
    const { context, core, options } = this;

    const link = createLinkDialog(context, {
      onApply: ({ href, targetBlank }) => {
        core.editor
          .chain()
          .focus()
          .extendMarkRange('link')
          .setLink({ href, target: targetBlank ? '_blank' : null })
          .run();
      },
      onRemove: () => {
        core.editor.chain().focus().extendMarkRange('link').unsetLink().run();
      },
    });

    const table = createTableDialog(context, {
      onInsert: (payload) => {
        core.editor.chain().focus().insertTable(payload).run();
      },
    });

    const recorder = createAudioRecorderDialog(context, {
      onInsert: (payload) => {
        core.insertRecording(payload.blob, { duration: payload.duration, peaks: payload.peaks });
      },
      // Рекордер живёт в диалоге, а не в движке, так что его ошибки — нет
      // разрешения на микрофон, превышен предел — движок не видит. Идут тем
      // же путём, что ошибки загрузки: в строку статуса и хосту.
      onError: this.reportError,
    });

    const formula = createFormulaDialog(context, {
      fontsDirectory: options.mathliveFontsDirectory,
      locale: this.locale,
      onSave: (payload: FormulaPayload) => {
        if (payload.pos === null) core.insertFormula(payload.mathml, payload.type);
        else core.updateFormulaAt(payload.pos, payload.mathml, payload.type);
      },
      onRemove: (pos) => {
        core.deleteFormulaAt(pos);
      },
    });

    const linkPopover = createLinkPopover(context, { styles: options.linkStyles });

    // Диалоги возможностей живут и умирают вместе с оболочкой, как встроенные.
    const extra = this.features.flatMap((feature) => feature.dialogs?.(context) ?? []);

    const built: Overlays = { link, table, recorder, formula, linkPopover, extra };

    listOverlays(built).forEach((overlay) => {
      this.element.appendChild(overlay.element);
    });

    return built;
  }

  private destroyOverlays(): void {
    listOverlays(this.overlays).forEach((overlay) => {
      overlay.destroy();
    });
  }

  /**
   * Тулбар и поповер ссылки зависят от выделения, поэтому обновляются на
   * каждой транзакции, а не только на изменении документа.
   */
  private refresh(): void {
    if (!this.isAssembled) return;

    this.toolbar.syncState();
    this.overlays.linkPopover.sync();
  }

  private refreshStatus(): void {
    if (!this.hasStatusLine) return;

    const busy = [...this.uploading.entries()].find(([, count]) => count > 0)?.[0];
    const text = this.errorText || (busy ? this.core.t(`upload_${busy}`) : '');

    this.status.textContent = text;
    this.status.classList.toggle('rte-status--error', this.errorText !== '');
  }

  /** В режиме чтения тулбар не просто отключён, а скрыт — как и во Vue-версии. */
  private applyEditable(editable: boolean): void {
    this.element.classList.toggle('rte-root--readonly', !editable);
    this.toolbar.element.hidden = !editable;
  }

  /** Ошибка — в строку статуса на время и хосту. */
  private readonly reportError = (error: RichEditorError): void => {
    this.errorText = error.message;

    if (this.errorTimer) clearTimeout(this.errorTimer);

    this.errorTimer = setTimeout(() => {
      this.errorText = '';
      this.errorTimer = null;
      this.refreshStatus();
    }, ERROR_VISIBLE_MS);

    this.refreshStatus();
    this.options.onError?.(error);
  };

  /** Открывает визуальный редактор формул: из документа, тулбара и расширений. */
  private readonly editFormula = (payload: FormulaPayload): void => {
    this.overlays.formula.open(payload);
  };

  /** Диалог ссылки: с кнопки тулбара и по Mod+K из документа. */
  private readonly editLink = (): void => {
    const { editor } = this.core;

    this.overlays.link.open({
      href: (editor.getAttributes('link').href as string) ?? '',
      targetBlank: editor.getAttributes('link').target === '_blank',
      canRemove: editor.isActive('link'),
    });
  };

  private readonly onUpload = (event: UploadEvent): void => {
    const count = this.uploading.get(event.kind) ?? 0;

    this.uploading.set(event.kind, event.phase === 'start' ? count + 1 : Math.max(0, count - 1));
    this.refreshStatus();
    this.options.onUpload?.(event);
  };

  private readonly onTransaction = (editor: Editor): void => {
    this.refresh();
    this.options.onTransaction?.(editor);
  };

  /**
   * Клик по формуле в документе открывает её редактор. Колбэк хоста при
   * этом не теряется: он может вести собственный учёт правок.
   */
  private readonly onFormulaEdit = (payload: FormulaPayload): void => {
    this.editFormula(payload);
    this.options.onFormulaEdit?.(payload);
  };

  /**
   * Диалог открывают кнопкой тулбара или кликом по узлу, и сама по себе
   * модалка вернула бы фокус туда же. Дом фокуса в редакторе — документ:
   * иначе после «Отмены» Backspace не удалит выделенную формулу, а уйдёт
   * в кнопку. Выделение при этом сохраняется: `focus()` без позиции его
   * не трогает.
   */
  private readonly onModalClose = (event: Event): void => {
    event.preventDefault();
    // Без прокрутки: выделение было на виду, когда диалог открывали, и
    // возвращать к нему экран не надо.
    focusEditorView(this.core.editor);
  };

  private readonly onImageInputChange = (): void => {
    const file = this.imageInput.files?.[0];

    // Ошибки загрузки движок сам отдаёт в onError — сюда они возвращаются
    // строкой статуса, поэтому промис не ждём.
    if (file) this.core.insertImageFile(file);

    // Сбрасываем значение: иначе выбор того же файла второй раз не сработает.
    this.imageInput.value = '';
  };

  private readonly onFileInputChange = (): void => {
    const file = this.fileInput.files?.[0];

    if (file) {
      if (this.fileMode === 'insert') this.core.insertTextFileContent(file);
      else this.core.attachTextFile(file);
    }

    this.fileInput.value = '';
  };
}

/**
 * Собирает редактор целиком: тулбар, область ввода и диалоги.
 *
 * Это и есть «ванильный редактор»: ему не нужен фреймворк, а обёртки под Vue
 * или React монтируют готовый интерфейс и пробрасывают пропы, вместо того
 * чтобы пересобирать его заново.
 */
export const createRichEditor = (options: RichEditorUiOptions): RichEditorUi =>
  new RichEditorUiController(options);
