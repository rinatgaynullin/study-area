import { RichEditorCore } from '../editor';
import type { FormulaPayload, RichEditorCoreOptions } from '../types';
import { createDisposer, el, on } from './dom';
import { createAudioRecorderDialog } from './dialogs/audio-recorder-dialog';
import { createFormulaDialog } from './dialogs/formula-dialog';
import { createLinkDialog } from './dialogs/link-dialog';
import { createTableDialog } from './dialogs/table-dialog';
import { createLinkPopover } from './link-popover';
import { MODAL_CLOSE_EVENT } from './modal';
import type { LinkStyle } from './link-styles';
import { resolveToolbar, type ToolbarConfig } from './presets';
import { createToolbar, type Toolbar, type ToolbarGroupConfig } from './toolbar';
import { SIMPLE_TOOLBAR_ITEMS } from './toolbar-items';
import { createPanelToolbarItems } from './toolbar-panels';
import type {
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
}

export interface RichEditorUi {
  /** Движок: документ, команды, загрузки. */
  readonly core: RichEditorCore;
  readonly element: HTMLElement;
  /** Переключает режим чтения: вместе с движком прячет и тулбар. */
  setEditable(editable: boolean): void;
  /** Меняет язык и пересобирает тулбар: подписи приходят из переводчика. */
  setLocale(locale: string): void;
  /** Пересобирает тулбар после смены таблицы переводов. */
  refreshLabels(): void;
  destroy(): void;
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
  const host = el('div', { class: 'rte-host' });
  const surface = el('div', { class: 'rte-surface', children: [host] });
  if (options.minHeight) host.style.minHeight = options.minHeight;

  // Скрытые поля выбора файлов: системный диалог нельзя открыть иначе.
  const imageInput = el('input', {
    class: 'rte-hidden-input',
    attrs: { type: 'file', accept: 'image/*' },
  });
  const fileInput = el('input', {
    class: 'rte-hidden-input',
    attrs: { type: 'file', accept: 'text/*,.txt,.md,.csv,.json' },
  });

  let fileMode: 'attach' | 'insert' = 'attach';

  /**
   * Обновление тулбара по транзакции. Ядро зовёт колбэк из опций, а тулбар
   * создаётся позже него — поэтому ссылка подменяется, а не передаётся сразу.
   */
  let refresh = (): void => {};

  const features = options.features ?? [];

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
      onFormulaEdit: (payload) => formulaDialog.open(payload),
    };

    return [...own, ...features.flatMap((feature) => feature.extensions?.(build) ?? [])];
  }

  const core = new RichEditorCore({
    ...options,
    element: host,
    extensions: buildExtensions,
    onTransaction: (editor) => {
      refresh();
      options.onTransaction?.(editor);
    },
    // Клик по формуле в документе открывает её редактор. Колбэк хоста при
    // этом не теряется: он может вести собственный учёт правок.
    onFormulaEdit: (payload) => {
      formulaDialog.open(payload);
      options.onFormulaEdit?.(payload);
    },
  });

  const context: EditorUiContext = {
    editor: core.editor,
    t: (key, params) => core.t(key, params),
    limits: core.getLimits(),
    uploads: core.uploads,
    editFormula: (payload) => formulaDialog.open(payload),
  };

  const linkDialog = createLinkDialog(context, {
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

  const tableDialog = createTableDialog(context, {
    onInsert: (payload) => void core.editor.chain().focus().insertTable(payload).run(),
  });

  const recorderDialog = createAudioRecorderDialog(context, {
    onInsert: (payload) =>
      void core.insertRecording(payload.blob, {
        duration: payload.duration,
        peaks: payload.peaks,
      }),
    // Рекордер живёт в диалоге, а не в движке, так что его ошибки — нет
    // разрешения на микрофон, превышен предел — движок не видит. Хосту они
    // нужны наравне с ошибками загрузки: показать уведомление, залогировать.
    onError: (error) => options.onError?.(error),
  });

  const formulaDialog = createFormulaDialog(context, {
    fontsDirectory: options.mathliveFontsDirectory,
    locale: options.locale ?? 'ru',
    onSave: (payload: FormulaPayload) => {
      if (payload.pos === null) core.insertFormula(payload.mathml, payload.type);
      else core.updateFormulaAt(payload.pos, payload.mathml, payload.type);
    },
    onRemove: (pos) => void core.deleteFormulaAt(pos),
  });

  const linkPopover = createLinkPopover(context, { styles: options.linkStyles });

  const featureItems: FeatureItems[] = features.map((feature) => ({
    feature,
    items: feature.toolbarItems?.() ?? [],
  }));

  const items: Record<string, ToolbarItemDescriptor> = {
    ...SIMPLE_TOOLBAR_ITEMS,
    ...createPanelToolbarItems({
      textSwatches: options.textSwatches,
      highlightSwatches: options.highlightSwatches,
      insertTable: () => tableDialog.open(),
      editLink: () =>
        linkDialog.open({
          href: (core.editor.getAttributes('link').href as string) ?? '',
          targetBlank: core.editor.getAttributes('link').target === '_blank',
          canRemove: core.editor.isActive('link'),
        }),
      pickImage: () => imageInput.click(),
      pickFile: (mode) => {
        fileMode = mode;
        fileInput.click();
      },
      recordAudio: () => recorderDialog.open(),
      insertFormula: (type) => formulaDialog.open({ mathml: '', type, pos: null }),
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

  root.append(toolbar.element, surface, imageInput, fileInput);
  options.element.appendChild(root);

  const overlays: UiComponent[] = [
    linkDialog,
    tableDialog,
    recorderDialog,
    formulaDialog,
    linkPopover,
    // Диалоги возможностей живут и умирают вместе с редактором, как встроенные.
    ...features.flatMap((feature) => feature.dialogs?.(context) ?? []),
  ];
  for (const overlay of overlays) root.appendChild(overlay.element);

  // Тулбар и поповер ссылки зависят от выделения, поэтому обновляются на
  // каждой транзакции, а не только на изменении документа.
  refresh = () => {
    toolbar.syncState();
    linkPopover.sync();
  };
  refresh();

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
    setLocale: (locale: string) => {
      core.setLocale(locale);
      toolbar.rebuild();
    },
    refreshLabels: () => toolbar.rebuild(),
    destroy: () => {
      disposer.dispose();
      toolbar.destroy();
      for (const overlay of overlays) overlay.destroy();
      core.destroy();
      root.remove();
    },
  };
}
