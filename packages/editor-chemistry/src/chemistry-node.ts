import { Node, mergeAttributes } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { NodeSelection, type EditorState } from '@tiptap/pm/state';
import type { Translate } from '@rich-editor/core';
import { paintChemistryNode } from './paint-chemistry';
import { CHEMISTRY_NODE_NAME, type ChemistryPayload, type ChemistryType } from './types';

export interface ChemistryOptions {
  /** Переводчик редактора — для имени узла, которое едет в экспорт. */
  t: Translate | null;
  /** Открывает диалог структуры: новой или существующей. */
  onEdit: ((payload: ChemistryPayload) => void) | null;
  /** Масштаб картинки; совпадает с `formulaScale`. */
  scale: number;
  HTMLAttributes: Record<string, unknown>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    chemistry: {
      insertChemistry: (options: { code: string; type?: ChemistryType }) => ReturnType;
      updateChemistry: (options: { pos: number; code: string }) => ReturnType;
      deleteChemistryAt: (pos: number) => ReturnType;
    };
  }
}

/** Имя для читалки: «Структурная формула: CH_3-CH_2-OH». Код — единственный текст, который у структуры есть. */
const accessibleName = (t: Translate | null, code: string): string =>
  t ? `${t('chemistry_aria_label')}: ${code}` : code;

/** Структура под выделением узла — та, которую можно открыть по Enter. */
const selectedChemistry = (state: EditorState): { node: PMNode; pos: number } | null => {
  const { selection } = state;

  if (!(selection instanceof NodeSelection) || selection.node.type.name !== CHEMISTRY_NODE_NAME) {
    return null;
  }

  return { node: selection.node, pos: selection.from };
};

const readCode = (element: HTMLElement): string =>
  (element.getAttribute('data-chemistry-code') ?? '').trim();

/**
 * Атомарный инлайновый узел структурной формулы.
 *
 * Источник истины — код chemfig в `data-chemistry-code`; SVG рисуется при
 * показе и в HTML не хранится: рендер синхронный и дешёвый, а документ без
 * картинки вдвое короче. Разметка совместима с PinQueen: читаются и `span`,
 * и `div` с этим атрибутом.
 */
export const ChemistryNode = Node.create<ChemistryOptions>({
  name: CHEMISTRY_NODE_NAME,
  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,
  draggable: false,

  addOptions: () => ({ t: null, onEdit: null, scale: 1, HTMLAttributes: {} }),

  addAttributes: () => ({
    code: {
      default: '',
      parseHTML: (element) => readCode(element),
      renderHTML: (attributes) => ({ 'data-chemistry-code': attributes.code as string }),
    },
    chemistryType: {
      default: 'chemfig' as ChemistryType,
      // Другой записи пока нет: всё, что пришло, читаем как chemfig.
      parseHTML: () => 'chemfig' as ChemistryType,
      renderHTML: (attributes) => ({ 'data-chemistry-type': attributes.chemistryType as string }),
    },
  }),

  parseHTML: () => [
    { tag: 'span[data-chemistry-code]', getAttrs: (element) => (readCode(element) ? null : false) },
    { tag: 'div[data-chemistry-code]', getAttrs: (element) => (readCode(element) ? null : false) },
  ],

  renderHTML({ node, HTMLAttributes }) {
    const code = String(node.attrs.code ?? '');

    return [
      'span',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-chemistry': 'true',
        class: 'rte-chemistry',
        contenteditable: 'false',
        // Экспортированный документ читают и без редактора — имя едет с ним.
        role: 'img',
        'aria-label': accessibleName(this.options.t, code),
      }),
    ];
  },

  addNodeView() {
    const { options } = this;

    return ({ node, getPos, editor }) => {
      const dom = document.createElement('span');

      dom.setAttribute('data-chemistry', 'true');
      dom.setAttribute('data-chemistry-type', String(node.attrs.chemistryType ?? 'chemfig'));
      dom.setAttribute('contenteditable', 'false');

      let currentCode = '';

      const paint = (code: string): void => {
        currentCode = code;
        dom.setAttribute('data-chemistry-code', code);
        paintChemistryNode(dom, code, {
          scale: options.scale,
          accessibleName: accessibleName(options.t, code),
        });
      };

      paint(String(node.attrs.code ?? ''));

      const openEditor = (event: MouseEvent): void => {
        if (!editor.isEditable) return;

        event.preventDefault();
        event.stopPropagation();

        const pos = typeof getPos === 'function' ? getPos() : null;

        if (typeof pos === 'number') {
          editor.view.dispatch(
            editor.view.state.tr.setSelection(NodeSelection.create(editor.view.state.doc, pos)),
          );
        }

        options.onEdit?.({
          code: currentCode,
          type: 'chemfig',
          pos: typeof pos === 'number' ? pos : null,
        });
      };

      // `mousedown`, а не `click`: при выделении атома ProseMirror
      // перерисовывает node view, и `click` до него не доходит.
      dom.addEventListener('mousedown', openEditor);

      return {
        dom,
        update: (updated) => {
          if (updated.type.name !== CHEMISTRY_NODE_NAME) return false;

          const code = String(updated.attrs.code ?? '');

          if (code !== currentCode) paint(code);

          return true;
        },
        selectNode: () => dom.classList.add('rte-chemistry--selected'),
        deselectNode: () => dom.classList.remove('rte-chemistry--selected'),
        // SVG внутри узла — не часть документа ProseMirror.
        ignoreMutation: () => true,
        destroy: () => {
          dom.removeEventListener('mousedown', openEditor);
        },
      };
    };
  },

  addKeyboardShortcuts() {
    const { editor, options } = this;

    return {
      // Стрелки выделяют структуру как узел; Enter открывает её диалог —
      // иначе с клавиатуры до правки не добраться.
      Enter: () => {
        const selected = selectedChemistry(editor.state);

        if (!selected || !editor.isEditable || !options.onEdit) return false;

        options.onEdit({
          code: String(selected.node.attrs.code ?? ''),
          type: 'chemfig',
          pos: selected.pos,
        });

        return true;
      },
    };
  },

  addCommands() {
    const { name } = this;

    return {
      insertChemistry:
        ({ code, type }) =>
        ({ commands }) => {
          const trimmed = code.trim();

          // Код сохраняется и тогда, когда наш рендер его не понимает:
          // данные важнее картинки, узел покажет код текстом.
          if (!trimmed) return false;

          return commands.insertContent({
            type: name,
            attrs: { code: trimmed, chemistryType: type ?? 'chemfig' },
          });
        },

      updateChemistry:
        ({ pos, code }) =>
        ({ tr, dispatch, state }) => {
          const trimmed = code.trim();
          const node = state.doc.nodeAt(pos);

          if (!trimmed || !node || node.type.name !== name) return false;

          if (dispatch) tr.setNodeMarkup(pos, undefined, { ...node.attrs, code: trimmed });

          return true;
        },

      deleteChemistryAt:
        (pos) =>
        ({ tr, dispatch, state }) => {
          const node = state.doc.nodeAt(pos);

          if (!node || node.type.name !== name) return false;

          if (dispatch) tr.delete(pos, pos + node.nodeSize);

          return true;
        },
    };
  },
});
