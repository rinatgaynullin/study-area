import { RichEditorCore } from '../editor';
import type { FormulaPayload, RichEditorCoreOptions } from '../types';
import { createDisposer, el, on } from './dom';
import { createAudioRecorderDialog } from './dialogs/audio-recorder-dialog';
import { createFormulaDialog } from './dialogs/formula-dialog';
import { createLinkDialog } from './dialogs/link-dialog';
import { createTableDialog } from './dialogs/table-dialog';
import { createLinkPopover } from './link-popover';
import type { LinkStyle } from './link-styles';
import { resolveToolbar, type ToolbarConfig } from './presets';
import { createToolbar, type Toolbar } from './toolbar';
import { SIMPLE_TOOLBAR_ITEMS } from './toolbar-items';
import { createPanelToolbarItems } from './toolbar-panels';
import type { EditorUiContext, ToolbarItemDescriptor, UiComponent } from './types';

export interface RichEditorUiOptions extends Omit<RichEditorCoreOptions, 'element'> {
  /** Куда смонтировать редактор целиком: тулбар и область ввода. */
  element: HTMLElement;
  /** Пресет или собственный список групп. */
  toolbar?: ToolbarConfig;
  /** Дополнительные пункты тулбара поверх встроенных. */
  toolbarItems?: Record<string, ToolbarItemDescriptor>;
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
  destroy(): void;
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

  const core = new RichEditorCore({
    ...options,
    element: host,
    onTransaction: (editor) => {
      refresh();
      options.onTransaction?.(editor);
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
    onError: () => {
      // Ошибку уже показал сам движок через onError — здесь глотать нечего.
    },
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
    ...options.toolbarItems,
  };

  const toolbar: Toolbar = createToolbar(context, {
    groups: resolveToolbar(options.toolbar),
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

  return {
    core,
    element: root,
    destroy: () => {
      disposer.dispose();
      toolbar.destroy();
      for (const overlay of overlays) overlay.destroy();
      core.destroy();
      root.remove();
    },
  };
}
