import type { Editor } from '@tiptap/core';
import type { ToolbarItemDescriptor } from './types';

/**
 * Пункты тулбара, у которых есть иконка и одна команда.
 *
 * Раньше иконка, подпись, команда и чтение активного состояния для каждого
 * пункта жили в четырёх разных картах в разных файлах, и добавление пункта
 * означало правку всех четырёх. Здесь пункт описан целиком в одном месте.
 */

interface SimpleItemSpec {
  id: string;
  icon: string;
  labelKey: string;
  /** Имя марки или узла для подсветки. Без него пункт не подсвечивается. */
  activeName?: string;
  /** Сочетание клавиш, которое вешает расширение TipTap, — для подсказки. */
  shortcut?: string;
  run(editor: Editor): void;
  isDisabled?(editor: Editor): boolean;
}

const SIMPLE_ITEMS: SimpleItemSpec[] = [
  {
    id: 'undo',
    shortcut: 'Mod-Z',
    icon: 'undo',
    labelKey: 'toolbar_undo',
    run: (editor) => void editor.chain().focus().undo().run(),
    isDisabled: (editor) => !editor.can().undo(),
  },
  {
    id: 'redo',
    shortcut: 'Mod-Shift-Z',
    icon: 'redo',
    labelKey: 'toolbar_redo',
    run: (editor) => void editor.chain().focus().redo().run(),
    isDisabled: (editor) => !editor.can().redo(),
  },
  {
    id: 'bold',
    shortcut: 'Mod-B',
    icon: 'bold',
    labelKey: 'toolbar_bold',
    activeName: 'bold',
    run: (editor) => void editor.chain().focus().toggleBold().run(),
  },
  {
    id: 'italic',
    shortcut: 'Mod-I',
    icon: 'italic',
    labelKey: 'toolbar_italic',
    activeName: 'italic',
    run: (editor) => void editor.chain().focus().toggleItalic().run(),
  },
  {
    id: 'underline',
    shortcut: 'Mod-U',
    icon: 'underline',
    labelKey: 'toolbar_underline',
    activeName: 'underline',
    run: (editor) => void editor.chain().focus().toggleUnderline().run(),
  },
  {
    id: 'strike',
    shortcut: 'Mod-Shift-S',
    icon: 'strike',
    labelKey: 'toolbar_strike',
    activeName: 'strike',
    run: (editor) => void editor.chain().focus().toggleStrike().run(),
  },
  {
    id: 'subscript',
    shortcut: 'Mod-,',
    icon: 'subscript',
    labelKey: 'toolbar_subscript',
    activeName: 'subscript',
    run: (editor) => void editor.chain().focus().toggleSubscript().run(),
  },
  {
    id: 'superscript',
    shortcut: 'Mod-.',
    icon: 'superscript',
    labelKey: 'toolbar_superscript',
    activeName: 'superscript',
    run: (editor) => void editor.chain().focus().toggleSuperscript().run(),
  },
  {
    id: 'bulletList',
    shortcut: 'Mod-Shift-8',
    icon: 'bulletList',
    labelKey: 'toolbar_bullet_list',
    activeName: 'bulletList',
    run: (editor) => void editor.chain().focus().toggleBulletList().run(),
  },
  {
    id: 'orderedList',
    shortcut: 'Mod-Shift-7',
    icon: 'orderedList',
    labelKey: 'toolbar_ordered_list',
    activeName: 'orderedList',
    run: (editor) => void editor.chain().focus().toggleOrderedList().run(),
  },
  {
    id: 'blockquote',
    shortcut: 'Mod-Shift-B',
    icon: 'blockquote',
    labelKey: 'toolbar_blockquote',
    activeName: 'blockquote',
    run: (editor) => void editor.chain().focus().toggleBlockquote().run(),
  },
  {
    id: 'code',
    shortcut: 'Mod-E',
    icon: 'code',
    labelKey: 'toolbar_code',
    activeName: 'code',
    run: (editor) => void editor.chain().focus().toggleCode().run(),
  },
  {
    id: 'codeBlock',
    shortcut: 'Mod-Alt-C',
    icon: 'codeBlock',
    labelKey: 'toolbar_code_block',
    activeName: 'codeBlock',
    run: (editor) => void editor.chain().focus().toggleCodeBlock().run(),
  },
  {
    id: 'horizontalRule',
    icon: 'horizontalRule',
    labelKey: 'toolbar_horizontal_rule',
    run: (editor) => void editor.chain().focus().setHorizontalRule().run(),
  },
  {
    id: 'clearFormat',
    icon: 'clearFormat',
    labelKey: 'toolbar_clear_format',
    run: (editor) => void editor.chain().focus().unsetAllMarks().clearNodes().run(),
  },
];

/** Уровни заголовков, предлагаемые в выпадающем списке. */
export const HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const;

/** Варианты выравнивания. */
export const ALIGNMENTS = ['left', 'center', 'right', 'justify'] as const;

/** Действия над таблицей в её выпадающем меню. */
export const TABLE_ACTIONS = [
  'addRowBefore',
  'addRowAfter',
  'deleteRow',
  'addColumnBefore',
  'addColumnAfter',
  'deleteColumn',
  'mergeCells',
  'splitCell',
  'toggleHeaderRow',
  'toggleHeaderColumn',
  'deleteTable',
] as const;

export type TableAction = (typeof TABLE_ACTIONS)[number];

/** Ключ перевода для действия над таблицей. */
export function tableActionLabelKey(action: TableAction): string {
  // addRowBefore -> table_add_row_before
  const snake = action.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  return `table_${snake}`;
}

/** Дескрипторы пунктов с одной командой, по идентификатору. */
export const SIMPLE_TOOLBAR_ITEMS: Record<string, ToolbarItemDescriptor> = Object.fromEntries(
  SIMPLE_ITEMS.map((spec) => [
    spec.id,
    {
      id: spec.id,
      icon: spec.icon,
      labelKey: spec.labelKey,
      kind: 'button',
      shortcut: spec.shortcut,
      run: ({ editor }) => spec.run(editor),
      isActive: spec.activeName ? (editor) => editor.isActive(spec.activeName!) : undefined,
      isDisabled: spec.isDisabled,
    } satisfies ToolbarItemDescriptor,
  ]),
);
