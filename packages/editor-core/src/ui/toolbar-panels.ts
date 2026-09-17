import { createColorPanel } from './color-panel';
import { createMenuItem, createMenuSeparator } from './dropdown';
import { el } from './dom';
import { ALIGNMENTS, HEADING_LEVELS, TABLE_ACTIONS, tableActionLabelKey } from './toolbar-items';
import type { EditorUiContext, ToolbarItemDescriptor } from './types';

/**
 * Пункты тулбара с выпадающей панелью.
 *
 * Панель пересобирается на каждом открытии: в ней отражается текущее
 * выделение — активный уровень заголовка, выбранный цвет, доступность
 * действий над таблицей.
 */

/** Цвета текста по умолчанию. */
export const DEFAULT_TEXT_SWATCHES = [
  '#000000', '#424242', '#757575', '#1976d2', '#0288d1', '#00897b',
  '#388e3c', '#f9a825', '#ef6c00', '#d32f2f', '#c2185b', '#7b1fa2',
];

/** Цвета выделения по умолчанию. */
export const DEFAULT_HIGHLIGHT_SWATCHES = [
  '#fff59d', '#ffe082', '#ffcc80', '#ffab91', '#f48fb1', '#ce93d8',
  '#b39ddb', '#90caf9', '#80deea', '#a5d6a7', '#e6ee9c', '#eeeeee',
];

export interface PanelItemOptions {
  textSwatches?: string[];
  highlightSwatches?: string[];
  /** Открывает диалог вставки таблицы. */
  insertTable(): void;
  /** Открывает диалог ссылки. */
  editLink(): void;
  /** Открывает выбор файла: картинка. */
  pickImage(): void;
  /** Открывает выбор файла: текстовый файл. `insert` — вставить содержимое. */
  pickFile(mode: 'attach' | 'insert'): void;
  /** Открывает запись голосового сообщения. */
  recordAudio(): void;
  /** Открывает редактор формул. */
  insertFormula(type: 'math' | 'chem'): void;
}

function headingPanel(context: EditorUiContext, close: () => void): HTMLElement {
  const panel = el('div');

  panel.appendChild(
    createMenuItem({
      label: context.t('toolbar_paragraph'),
      active: context.editor.isActive('paragraph'),
      onSelect: () => {
        context.editor.chain().focus().setParagraph().run();
        close();
      },
    }),
  );

  for (const level of HEADING_LEVELS) {
    panel.appendChild(
      createMenuItem({
        label: context.t('toolbar_heading_level', { level }),
        active: context.editor.isActive('heading', { level }),
        // Подпись показывается кеглем своего уровня — так виден результат.
        labelClass: `rte-menu__heading--${level}`,
        onSelect: () => {
          context.editor.chain().focus().toggleHeading({ level }).run();
          close();
        },
      }),
    );
  }

  return panel;
}

function alignPanel(context: EditorUiContext, close: () => void): HTMLElement {
  const panel = el('div');

  for (const alignment of ALIGNMENTS) {
    const suffix = alignment.charAt(0).toUpperCase() + alignment.slice(1);
    panel.appendChild(
      createMenuItem({
        label: context.t(`toolbar_align_${alignment}`),
        iconName: `align${suffix}`,
        active: context.editor.isActive({ textAlign: alignment }),
        onSelect: () => {
          context.editor.chain().focus().setTextAlign(alignment).run();
          close();
        },
      }),
    );
  }

  return panel;
}

function tablePanel(
  context: EditorUiContext,
  close: () => void,
  options: PanelItemOptions,
): HTMLElement {
  const panel = el('div');

  panel.appendChild(
    createMenuItem({
      label: context.t('table_insert'),
      iconName: 'table',
      onSelect: () => {
        options.insertTable();
        close();
      },
    }),
  );

  // Действия над таблицей осмысленны только внутри неё.
  if (!context.editor.isActive('table')) return panel;

  panel.appendChild(createMenuSeparator());

  const commands = context.editor.chain() as unknown as Record<
    string,
    (() => { run: () => boolean }) | undefined
  >;

  for (const action of TABLE_ACTIONS) {
    panel.appendChild(
      createMenuItem({
        label: context.t(tableActionLabelKey(action)),
        onSelect: () => {
          commands[action]?.().run();
          close();
        },
      }),
    );
  }

  return panel;
}

function filePanel(
  context: EditorUiContext,
  close: () => void,
  options: PanelItemOptions,
): HTMLElement {
  const panel = el('div');

  for (const mode of ['attach', 'insert'] as const) {
    panel.appendChild(
      createMenuItem({
        label: context.t(mode === 'attach' ? 'file_attach' : 'file_insert_content'),
        iconName: 'file',
        onSelect: () => {
          options.pickFile(mode);
          close();
        },
      }),
    );
  }

  return panel;
}

function colorItem(
  id: string,
  labelKey: string,
  iconName: string,
  markName: string,
  attributeName: string,
  swatches: string[],
  apply: (context: EditorUiContext, color: string | null) => void,
): ToolbarItemDescriptor {
  return {
    id,
    icon: iconName,
    labelKey,
    kind: 'dropdown',
    isActive: (editor) => editor.isActive(markName),
    renderPanel: (context, close) =>
      createColorPanel({
        t: context.t,
        palette: swatches,
        activeColor: (context.editor.getAttributes(markName)[attributeName] as string) ?? '',
        onSelect: (color) => {
          apply(context, color);
          close();
        },
        onReset: () => {
          apply(context, null);
          close();
        },
      }),
  };
}

/** Дескрипторы пунктов с панелью и пунктов, открывающих диалоги. */
export function createPanelToolbarItems(
  options: PanelItemOptions,
): Record<string, ToolbarItemDescriptor> {
  const textSwatches = options.textSwatches ?? DEFAULT_TEXT_SWATCHES;
  const highlightSwatches = options.highlightSwatches ?? DEFAULT_HIGHLIGHT_SWATCHES;

  return {
    heading: {
      id: 'heading',
      icon: 'heading',
      labelKey: 'toolbar_heading',
      kind: 'dropdown',
      isActive: (editor) => editor.isActive('heading'),
      renderPanel: headingPanel,
    },
    align: {
      id: 'align',
      icon: 'alignLeft',
      labelKey: 'toolbar_align',
      kind: 'dropdown',
      renderPanel: alignPanel,
    },
    textColor: colorItem(
      'textColor',
      'toolbar_text_color',
      'textColor',
      'textStyle',
      'color',
      textSwatches,
      (context, color) => {
        const chain = context.editor.chain().focus();
        if (color === null) chain.unsetColor().run();
        else chain.setColor(color).run();
      },
    ),
    highlight: colorItem(
      'highlight',
      'toolbar_highlight',
      'highlight',
      'highlight',
      'color',
      highlightSwatches,
      (context, color) => {
        const chain = context.editor.chain().focus();
        if (color === null) chain.unsetHighlight().run();
        else chain.setHighlight({ color }).run();
      },
    ),
    table: {
      id: 'table',
      icon: 'table',
      labelKey: 'toolbar_table',
      kind: 'dropdown',
      isActive: (editor) => editor.isActive('table'),
      renderPanel: (context, close) => tablePanel(context, close, options),
    },
    file: {
      id: 'file',
      icon: 'file',
      labelKey: 'toolbar_file',
      kind: 'dropdown',
      renderPanel: (context, close) => filePanel(context, close, options),
    },
    link: {
      id: 'link',
      icon: 'link',
      labelKey: 'toolbar_link',
      kind: 'button',
      isActive: (editor) => editor.isActive('link'),
      run: () => options.editLink(),
    },
    image: {
      id: 'image',
      icon: 'image',
      labelKey: 'toolbar_image',
      kind: 'button',
      run: () => options.pickImage(),
    },
    audio: {
      id: 'audio',
      icon: 'audio',
      labelKey: 'toolbar_audio',
      kind: 'button',
      run: () => options.recordAudio(),
    },
    formulaMath: {
      id: 'formulaMath',
      icon: 'formulaMath',
      labelKey: 'toolbar_formula_math',
      kind: 'button',
      run: () => options.insertFormula('math'),
    },
    formulaChem: {
      id: 'formulaChem',
      icon: 'formulaChem',
      labelKey: 'toolbar_formula_chem',
      kind: 'button',
      run: () => options.insertFormula('chem'),
    },
  };
}
