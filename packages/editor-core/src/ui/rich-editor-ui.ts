import { Extension } from '@tiptap/core';
import { RichEditorCore } from '../editor';
import { DEFAULT_LOCALE } from '../i18n';
import { IMAGE_ACCEPT, TEXT_FILE_ACCEPT } from '../media/upload';
import type {
  EditorLimits,
  FormulaPayload,
  Messages,
  RichEditorCoreOptions,
  RichEditorError,
  UploadKind,
} from '../types';
import { createDisposer, el, on } from './dom';
import { createAudioRecorderDialog } from './dialogs/audio-recorder-dialog';
import { createFormulaDialog } from './dialogs/formula-dialog';
import { createLinkDialog, type LinkDialogPayload } from './dialogs/link-dialog';
import { createTableDialog } from './dialogs/table-dialog';
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
function createUiShortcuts(handlers: { focusToolbar(): void; editLink(): void }) {
  return Extension.create({
    name: 'richEditorUiShortcuts',
    addKeyboardShortcuts() {
      return {
        'Alt-F10': () => {
          handlers.focusToolbar();
          return true;
        },
        'Mod-k': () => {
          handlers.editLink();
          return true;
        },
      };
    },
  });
}

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

function listOverlays(overlays: Overlays): UiComponent[] {
  return [
    overlays.link,
    overlays.table,
    overlays.recorder,
    overlays.formula,
    overlays.linkPopover,
    ...overlays.extra,
  ];
}

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
function withFeatureGroups(
  groups: ToolbarGroupConfig[],
  features: FeatureItems[],
): ToolbarGroupConfig[] {
  const mentioned = new Set(groups.flatMap((group) => group.items));

  const extra = features.flatMap(({ feature, items }) => {
    const ids = items.map((item) => item.id).filter((id) => !mentioned.has(id));
    return ids.length > 0 ? [{ id: feature.id, items: ids }] : [];
  });

  // Пресеты — общие константы, дописывать в них нельзя.
  return extra.length > 0 ? [...groups, ...extra] : groups;
}

/**
 * Собирает редактор целиком: тулбар, область ввода и диалоги.
 *
 * Это и есть «ванильный редактор»: ему не нужен фреймворк, а обёртки под Vue
 * или React монтируют готовый интерфейс и пробрасывают пропы, вместо того
 * чтобы пересобирать его заново.
 */
export function createRichEditor(options: RichEditorUiOptions): RichEditorUi {
  const disposer = createDisposer();

  const root = el('div', { class: 'rte-root' });
  let releaseTheme = applyTheme(root, options.theme ?? 'light');
  const host = el('div', { class: 'rte-host' });
  const surface = el('div', { class: 'rte-surface', children: [host] });
  if (options.minHeight) host.style.minHeight = options.minHeight;

  /**
   * Строка статуса: идущие загрузки и последняя ошибка. Хост получает то же
   * через onUpload и onError, но пользователь должен видеть, что файл
   * грузится и почему не вставился, без обвязки со стороны хоста.
   */
  // Живая область должна существовать до того, как в ней появится текст:
  // регион, который показывают и наполняют одновременно, читалки часто
  // пропускают. Поэтому строка не прячется атрибутом hidden — пустую её
  // схлопывают стили.
  const status = el('div', {
    class: 'rte-status',
    attrs: { role: 'status', 'aria-live': 'polite' },
  });
  const hasStatusLine = options.statusLine !== false;

  /** Загрузки в полёте, по видам: параллельных может быть несколько. */
  const uploading = new Map<UploadKind, number>();
  let errorText = '';
  let errorTimer: ReturnType<typeof setTimeout> | null = null;

  function refreshStatus(): void {
    if (!hasStatusLine) return;
    const busy = [...uploading.entries()].find(([, count]) => count > 0)?.[0];
    const text = errorText || (busy ? core.t(`upload_${busy}`) : '');
    status.textContent = text;
    status.classList.toggle('rte-status--error', errorText !== '');
  }

  function reportError(error: RichEditorError): void {
    errorText = error.message;
    if (errorTimer) clearTimeout(errorTimer);
    errorTimer = setTimeout(() => {
      errorText = '';
      errorTimer = null;
      refreshStatus();
    }, ERROR_VISIBLE_MS);
    refreshStatus();
    options.onError?.(error);
  }

  // Скрытые поля выбора файлов: системный диалог нельзя открыть иначе.
  // Фильтр — тот же, что у пайплайна загрузки, иначе пикер прячет файлы,
  // которые редактор принял бы перетаскиванием.
  const imageInput = el('input', {
    class: 'rte-hidden-input',
    attrs: { type: 'file', accept: IMAGE_ACCEPT },
  });
  const fileInput = el('input', {
    class: 'rte-hidden-input',
    attrs: { type: 'file', accept: TEXT_FILE_ACCEPT },
  });

  let fileMode: 'attach' | 'insert' = 'attach';

  /**
   * Обновление тулбара по транзакции. Ядро зовёт колбэк из опций, а тулбар
   * создаётся позже него — поэтому ссылка подменяется, а не передаётся сразу.
   */
  let refresh = (): void => {};

  const features = options.features ?? [];

  /** Текущий язык: нужен MathLive, у которого своя локаль. */
  let locale = options.locale ?? DEFAULT_LOCALE;

  /**
   * Оверлеи пересоздаются при смене языка, поэтому ссылка на них — одна,
   * подменяемая, а замыкания тулбара и движка ходят через неё.
   */
  let overlays: Overlays;

  /** Расширения хоста и возможностей; переводчик приходит из движка. */
  function buildExtensions({ t }: { t: FeatureBuildOptions['t'] }): unknown[] {
    const own =
      typeof options.extensions === 'function'
        ? options.extensions({ t })
        : (options.extensions ?? []);

    const build: FeatureBuildOptions = {
      t,
      legacy: options.legacy ?? false,
      placeholder: options.placeholder,
      formulaScale: options.formulaScale ?? 1,
      onFormulaEdit: (payload) => overlays.formula.open(payload),
    };

    return [
      ...own,
      ...features.flatMap((feature) => feature.extensions?.(build) ?? []),
      // Тулбар создаётся после движка, но обработчики зовутся ещё позже —
      // когда всё уже собрано.
      createUiShortcuts({ focusToolbar: () => toolbar.focus(), editLink }),
    ];
  }

  const core = new RichEditorCore({
    ...options,
    element: host,
    extensions: buildExtensions,
    onError: reportError,
    onUpload: (event) => {
      const count = uploading.get(event.kind) ?? 0;
      uploading.set(event.kind, event.phase === 'start' ? count + 1 : Math.max(0, count - 1));
      refreshStatus();
      options.onUpload?.(event);
    },
    onTransaction: (editor) => {
      refresh();
      options.onTransaction?.(editor);
    },
    // Клик по формуле в документе открывает её редактор. Колбэк хоста при
    // этом не теряется: он может вести собственный учёт правок.
    onFormulaEdit: (payload) => {
      overlays.formula.open(payload);
      options.onFormulaEdit?.(payload);
    },
  });

  const context: EditorUiContext = {
    editor: core.editor,
    t: (key, params) => core.t(key, params),
    // Пределы читаются с движка при каждом обращении: setLimits меняет их у
    // живого редактора, а снимок оставил бы диалог записи со старыми.
    get limits() {
      return core.getLimits();
    },
    uploads: core.uploads,
    editFormula: (payload) => overlays.formula.open(payload),
  };

  /**
   * Собирает диалоги и поповер. Подписи в них запекаются при создании — как и
   * в тулбаре, — поэтому смена языка пересобирает их заново: закрытые они
   * без состояния, а держать реактивные подписи ради редкой операции —
   * лишний слой.
   */
  function buildOverlays(): Overlays {
    const link = createLinkDialog(context, {
      onApply: ({ href, targetBlank }) => {
        core.editor
          .chain()
          .focus()
          .extendMarkRange('link')
          .setLink({ href, target: targetBlank ? '_blank' : null })
          .run();
      },
      onRemove: () => void core.editor.chain().focus().extendMarkRange('link').unsetLink().run(),
    });

    const table = createTableDialog(context, {
      onInsert: (payload) => void core.editor.chain().focus().insertTable(payload).run(),
    });

    const recorder = createAudioRecorderDialog(context, {
      onInsert: (payload) =>
        void core.insertRecording(payload.blob, {
          duration: payload.duration,
          peaks: payload.peaks,
        }),
      // Рекордер живёт в диалоге, а не в движке, так что его ошибки — нет
      // разрешения на микрофон, превышен предел — движок не видит. Идут тем
      // же путём, что ошибки загрузки: в строку статуса и хосту.
      onError: reportError,
    });

    const formula = createFormulaDialog(context, {
      fontsDirectory: options.mathliveFontsDirectory,
      locale,
      onSave: (payload: FormulaPayload) => {
        if (payload.pos === null) core.insertFormula(payload.mathml, payload.type);
        else core.updateFormulaAt(payload.pos, payload.mathml, payload.type);
      },
      onRemove: (pos) => void core.deleteFormulaAt(pos),
    });

    const linkPopover = createLinkPopover(context, { styles: options.linkStyles });

    // Диалоги возможностей живут и умирают вместе с оболочкой, как встроенные.
    const extra = features.flatMap((feature) => feature.dialogs?.(context) ?? []);

    const built: Overlays = { link, table, recorder, formula, linkPopover, extra };
    for (const overlay of listOverlays(built)) root.appendChild(overlay.element);
    return built;
  }

  function destroyOverlays(): void {
    for (const overlay of listOverlays(overlays)) overlay.destroy();
  }

  const featureItems: FeatureItems[] = features.map((feature) => ({
    feature,
    items: feature.toolbarItems?.() ?? [],
  }));

  /** Диалог ссылки: с кнопки тулбара и по Mod+K из документа. */
  function editLink(): void {
    overlays.link.open({
      href: (core.editor.getAttributes('link').href as string) ?? '',
      targetBlank: core.editor.getAttributes('link').target === '_blank',
      canRemove: core.editor.isActive('link'),
    });
  }

  const items: Record<string, ToolbarItemDescriptor> = {
    ...SIMPLE_TOOLBAR_ITEMS,
    ...createPanelToolbarItems({
      textSwatches: options.textSwatches,
      highlightSwatches: options.highlightSwatches,
      insertTable: () => overlays.table.open(),
      editLink,
      pickImage: () => imageInput.click(),
      pickFile: (mode) => {
        fileMode = mode;
        fileInput.click();
      },
      recordAudio: () => overlays.recorder.open(),
      insertFormula: (type) => overlays.formula.open({ mathml: '', type, pos: null }),
    }),
    ...Object.fromEntries(featureItems.flatMap(({ items }) => items.map((item) => [item.id, item]))),
    // Пункты, переданные напрямую, главнее: ими хост точечно правит и
    // встроенные пункты, и пункты возможностей.
    ...options.toolbarItems,
  };

  const toolbar: Toolbar = createToolbar(context, {
    groups: withFeatureGroups(resolveToolbar(options.toolbar), featureItems),
    items,
    collapseBelow: options.collapseBelow,
  });

  root.append(toolbar.element, ...(hasStatusLine ? [status] : []), surface, imageInput, fileInput);
  options.element.appendChild(root);
  overlays = buildOverlays();

  // Тулбар и поповер ссылки зависят от выделения, поэтому обновляются на
  // каждой транзакции, а не только на изменении документа.
  refresh = () => {
    toolbar.syncState();
    overlays.linkPopover.sync();
  };
  refresh();

  /** Всё, что запекает подписи при создании: тулбар и оверлеи. */
  function rebuildChrome(): void {
    destroyOverlays();
    overlays = buildOverlays();
    toolbar.rebuild();
    refreshStatus();
  }

  disposer.add(
    on(root, MODAL_CLOSE_EVENT, (event) => {
      // Диалог открывают кнопкой тулбара или кликом по узлу, и сама по себе
      // модалка вернула бы фокус туда же. Дом фокуса в редакторе — документ:
      // иначе после «Отмены» Backspace не удалит выделенную формулу, а уйдёт
      // в кнопку. Выделение при этом сохраняется: `focus()` без позиции его
      // не трогает.
      event.preventDefault();
      // Без прокрутки: выделение было на виду, когда диалог открывали, и
      // возвращать к нему экран не надо.
      core.editor.commands.focus(null, { scrollIntoView: false });
    }),
  );

  disposer.add(
    on(imageInput, 'change', () => {
      const file = imageInput.files?.[0];
      if (file) void core.insertImageFile(file);
      // Сбрасываем значение: иначе выбор того же файла второй раз не сработает.
      imageInput.value = '';
    }),
  );

  disposer.add(
    on(fileInput, 'change', () => {
      const file = fileInput.files?.[0];
      if (file) {
        void (fileMode === 'insert' ? core.insertTextFileContent(file) : core.attachTextFile(file));
      }
      fileInput.value = '';
    }),
  );

  /** В режиме чтения тулбар не просто отключён, а скрыт — как и во Vue-версии. */
  function applyEditable(editable: boolean): void {
    root.classList.toggle('rte-root--readonly', !editable);
    toolbar.element.hidden = !editable;
  }

  applyEditable(core.editor.isEditable);

  return {
    core,
    element: root,
    setEditable: (editable: boolean) => {
      core.setEditable(editable);
      applyEditable(editable);
    },
    setLocale: (next: string) => {
      locale = next;
      core.setLocale(next);
      rebuildChrome();
    },
    setMessages: (messages) => {
      core.setMessages(messages);
      rebuildChrome();
    },
    refreshLabels: rebuildChrome,
    setLimits: (limits) => core.setLimits(limits),
    setTheme: (theme) => {
      releaseTheme();
      releaseTheme = applyTheme(root, theme);
    },
    destroy: () => {
      releaseTheme();
      if (errorTimer) clearTimeout(errorTimer);
      disposer.dispose();
      toolbar.destroy();
      destroyOverlays();
      core.destroy();
      root.remove();
    },
  };
}
