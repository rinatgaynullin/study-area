import { Node, mergeAttributes } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { NodeSelection, type EditorState } from '@tiptap/pm/state';
import type { FormulaPayload, FormulaType } from '../types';
import {
  DEFAULT_FORMULA_FONT_SIZE_PX,
  getCachedFormulaSvg,
  renderMathML,
} from '../formula/mathjax';
import { extractFormulaType, formulaAccessibleName, normalizeMathML } from '../formula/mathml';

/** Настройки узла: колбэк открытия редактора формул, масштаб, атрибуты обёртки. */
export interface FormulaOptions {
  /** Opens the host's visual editor for a new or existing formula. */
  onEdit: ((payload: FormulaPayload) => void) | null;
  scale: number;
  HTMLAttributes: Record<string, unknown>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    formula: {
      insertFormula: (options: { mathml: string; type?: FormulaType }) => ReturnType;
      updateFormula: (options: { pos: number; mathml: string; type?: FormulaType }) => ReturnType;
      deleteFormulaAt: (pos: number) => ReturnType;
    };
  }
}

/** Имя узла формулы в схеме. */
export const FORMULA_NODE_NAME = 'formula';

/**
 * Кегль, под который рендерится формула.
 *
 * Раньше масштаб задавался `font-size` на элементе-хосте: SVG был размечен в
 * ex и тянулся за кеглем. Теперь размер запечён в пикселях — ровно затем,
 * чтобы формула не зависела от окружения, — и на `font-size` уже не реагирует.
 * Поэтому масштаб входит в сам рендер.
 */
const formulaFontSize = (scale: number): number => DEFAULT_FORMULA_FONT_SIZE_PX * scale;

/** Формула под выделением узла — та, которую можно открыть по Enter. */
const selectedFormula = (state: EditorState): { node: PMNode; pos: number } | null => {
  const { selection } = state;

  if (!(selection instanceof NodeSelection) || selection.node.type.name !== FORMULA_NODE_NAME) {
    return null;
  }

  return { node: selection.node, pos: selection.from };
};

/**
 * Atomic inline node holding a formula. The MathML in `data-mathml` is the
 * source of truth; the SVG inside the render host is a cached MathJax
 * projection so exported HTML displays without the editor. Because the node is
 * an atom, the document can never contain "half" a formula.
 */
export const FormulaNode = Node.create<FormulaOptions>({
  name: FORMULA_NODE_NAME,
  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,
  draggable: false,

  addOptions: () => ({ onEdit: null, scale: 1, HTMLAttributes: {} }),

  addAttributes: () => ({
    mathml: {
      default: '',
      parseHTML: (element) => normalizeMathML(element.getAttribute('data-mathml') ?? ''),
      renderHTML: (attributes) => ({ 'data-mathml': attributes.mathml as string }),
    },
    formulaType: {
      default: 'math' as FormulaType,
      parseHTML: (element) =>
        element.getAttribute('data-formula-type') === 'chem' ? 'chem' : 'math',
      renderHTML: (attributes) => ({ 'data-formula-type': attributes.formulaType as string }),
    },
  }),

  parseHTML: () => [
    {
      tag: 'span[data-formula]',
      getAttrs: (element) => {
        const mathml = normalizeMathML((element as HTMLElement).getAttribute('data-mathml') ?? '');

        // Rejecting here keeps malformed or hostile MathML out of the document.
        if (!mathml) return false;

        return null;
      },
    },
  ],

  renderHTML({ node, HTMLAttributes }) {
    const mathml = (node.attrs.mathml as string) ?? '';
    const dom = document.createElement('span');

    const attrs = mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
      'data-formula': 'true',
      class: 'rte-formula',
      contenteditable: 'false',
      // Экспортированный документ читают и без редактора — имя едет с ним.
      role: 'img',
      'aria-label': formulaAccessibleName(mathml),
    });

    Object.entries(attrs).forEach(([key, value]) => {
      if (value !== null && value !== undefined) dom.setAttribute(key, String(value));
    });

    const host = document.createElement('span');

    host.className = 'rte-formula__render';
    host.setAttribute('data-render-host', 'true');

    const svg = getCachedFormulaSvg(mathml, formulaFontSize(this.options.scale));

    // Already sanitized when it entered the cache.
    if (svg) host.innerHTML = svg;

    dom.appendChild(host);

    return dom;
  },

  addNodeView() {
    const { options } = this;

    return ({ node, getPos, editor }) => {
      const dom = document.createElement('span');

      dom.className = 'rte-formula';
      dom.setAttribute('data-formula', 'true');
      dom.setAttribute('contenteditable', 'false');
      dom.setAttribute('role', 'img');

      const host = document.createElement('span');

      host.className = 'rte-formula__render';
      host.setAttribute('data-render-host', 'true');
      dom.appendChild(host);

      const fontSizePx = formulaFontSize(options.scale);

      let destroyed = false;
      let currentMathml = '';

      const paint = (mathml: string, type: FormulaType) => {
        currentMathml = mathml;
        dom.setAttribute('data-mathml', mathml);
        dom.setAttribute('data-formula-type', type);
        dom.setAttribute('aria-label', formulaAccessibleName(mathml));

        const cached = getCachedFormulaSvg(mathml, fontSizePx);

        if (cached !== undefined) {
          host.innerHTML = cached;

          return;
        }

        host.textContent = '…';

        renderMathML(mathml, { fontSizePx })
          // Не загрузился движок — тот же маркер, что и при неудачном рендере.
          .catch(() => '')
          .then((svg) => {
            // Guard against a stale render landing after the node changed again.
            if (destroyed || currentMathml !== mathml) return;

            if (svg) host.innerHTML = svg;
            else host.textContent = '⚠';
          });
      };

      paint(node.attrs.mathml as string, node.attrs.formulaType as FormulaType);

      const openEditor = (event: MouseEvent) => {
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
          mathml: currentMathml,
          type: dom.getAttribute('data-formula-type') === 'chem' ? 'chem' : 'math',
          pos: typeof pos === 'number' ? pos : null,
        });
      };

      // `mousedown`, not `click`: ProseMirror re-renders the node view when the
      // atom becomes selected, so mouseup can land on a different element and
      // the click event is never dispatched here.
      dom.addEventListener('mousedown', openEditor);

      return {
        dom,
        update: (updated) => {
          if (updated.type.name !== FORMULA_NODE_NAME) return false;

          const mathml = updated.attrs.mathml as string;
          const type = updated.attrs.formulaType as FormulaType;

          if (mathml !== currentMathml) paint(mathml, type);
          else dom.setAttribute('data-formula-type', type);

          return true;
        },
        selectNode: () => dom.classList.add('rte-formula--selected'),
        deselectNode: () => dom.classList.remove('rte-formula--selected'),
        // Our async SVG injection is not part of the ProseMirror document.
        ignoreMutation: () => true,
        destroy: () => {
          destroyed = true;
          dom.removeEventListener('mousedown', openEditor);
        },
      };
    };
  },

  addKeyboardShortcuts() {
    const { editor, options } = this;

    return {
      // Стрелки выделяют формулу как узел; Enter открывает её редактор —
      // иначе с клавиатуры до правки формулы не добраться: клик ей нужен.
      Enter: () => {
        const selected = selectedFormula(editor.state);

        if (!selected || !editor.isEditable || !options.onEdit) return false;

        options.onEdit({
          mathml: selected.node.attrs.mathml as string,
          type: selected.node.attrs.formulaType as FormulaType,
          pos: selected.pos,
        });

        return true;
      },
    };
  },

  addCommands() {
    const { name } = this;

    return {
      insertFormula:
        ({ mathml, type }) =>
        ({ commands }) => {
          const safe = normalizeMathML(mathml);

          if (!safe) return false;

          return commands.insertContent({
            type: name,
            attrs: { mathml: safe, formulaType: type ?? extractFormulaType(safe) },
          });
        },

      updateFormula:
        ({ pos, mathml, type }) =>
        ({ tr, dispatch, state }) => {
          const safe = normalizeMathML(mathml);

          if (!safe) return false;

          const node = state.doc.nodeAt(pos);

          if (!node || node.type.name !== name) return false;

          if (dispatch) {
            tr.setNodeMarkup(pos, undefined, {
              ...node.attrs,
              mathml: safe,
              formulaType: type ?? (node.attrs.formulaType as FormulaType),
            });
          }

          return true;
        },

      deleteFormulaAt:
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
