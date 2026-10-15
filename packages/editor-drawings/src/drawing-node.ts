import { Node, mergeAttributes, type CommandProps, type RawCommands } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { NodeSelection, type EditorState } from '@tiptap/pm/state';
import type { Translate } from '@rich-editor/core';
import { paintDrawingNode } from './paint-drawing';
import type { DrawingKind } from './scene/types';
import { GEOMETRY_NODE_NAME, PHYSICS_NODE_NAME, nodeNameFor, type DrawingPayload } from './types';

export interface DrawingOptions {
  /** Переводчик редактора — для заголовков карточки и имени узла в экспорте. */
  t: Translate | null;
  /** Открывает диалог чертежа: нового или существующего. */
  onEdit: ((payload: DrawingPayload) => void) | null;
  /** Масштаб превью; совпадает с `formulaScale`. */
  scale: number;
  HTMLAttributes: Record<string, unknown>;
}

interface DrawingContent {
  data: string;
  tikz?: string;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    drawings: {
      insertGeometry: (content: DrawingContent) => ReturnType;
      updateGeometry: (content: DrawingContent & { pos: number }) => ReturnType;
      insertPhysics: (content: DrawingContent) => ReturnType;
      updatePhysics: (content: DrawingContent & { pos: number }) => ReturnType;
      deleteDrawingAt: (pos: number) => ReturnType;
    };
  }
}

const DEFAULT_DATA = '{}';

/** Атрибуты PinQueen по виду: `data-geometry-data` / `data-physics-data` и общий `data-tikz-code`. */
const dataAttribute = (kind: DrawingKind): string => `data-${kind}-data`;

/** Сцена хранится как пришла: обрезать её — значит менять чужие данные. */
const readData = (element: HTMLElement, kind: DrawingKind): string => {
  const value = element.getAttribute(dataAttribute(kind)) ?? '';

  return value.trim() ? value : DEFAULT_DATA;
};

const readTikz = (element: HTMLElement): string => element.getAttribute('data-tikz-code') ?? '';

/** Чертёж под выделением узла — тот, который можно открыть по Enter. */
const selectedDrawing = (state: EditorState, name: string): { node: PMNode; pos: number } | null => {
  const { selection } = state;

  if (!(selection instanceof NodeSelection) || selection.node.type.name !== name) return null;

  return { node: selection.node, pos: selection.from };
};

/**
 * Блочный атомарный узел чертежа одного вида: геометрия или физика.
 *
 * Источник истины — JSON-сцена в `data-*-data` и TikZ в `data-tikz-code`,
 * ровно как в PinQueen (читаются и `span`, и `div`). Картинка рисуется при
 * показе и в HTML не хранится; сцена хранится строкой как пришла — её не
 * пересобирают, чтобы не потерять поля, которых наш рендер не знает.
 */
export const createDrawingNode = (kind: DrawingKind) => {
  const name = nodeNameFor(kind);
  const attribute = dataAttribute(kind);
  const ariaKey = kind === 'physics' ? 'drawings_aria_physics' : 'drawings_aria_geometry';

  return Node.create<DrawingOptions>({
    name,
    group: 'block',
    atom: true,
    selectable: true,
    draggable: true,

    addOptions: () => ({ t: null, onEdit: null, scale: 1, HTMLAttributes: {} }),

    addAttributes: () => ({
      data: {
        default: DEFAULT_DATA,
        parseHTML: (element) => readData(element, kind),
        renderHTML: (attributes) => ({ [attribute]: attributes.data as string }),
      },
      tikz: {
        default: '',
        parseHTML: readTikz,
        renderHTML: (attributes) =>
          attributes.tikz ? { 'data-tikz-code': attributes.tikz as string } : {},
      },
    }),

    parseHTML: () => [{ tag: `span[${attribute}]` }, { tag: `div[${attribute}]` }],

    renderHTML({ HTMLAttributes }) {
      return [
        'div',
        mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
          [`data-${kind}`]: 'true',
          class: `rte-drawing rte-drawing--${kind}`,
          // Экспортированный документ читают и без редактора — имя едет с ним.
          role: 'img',
          'aria-label': this.options.t ? this.options.t(ariaKey) : kind,
        }),
      ];
    },

    addNodeView() {
      const { options } = this;

      return ({ node, getPos, editor }) => {
        const dom = document.createElement('div');

        dom.setAttribute(`data-${kind}`, 'true');
        dom.setAttribute('contenteditable', 'false');

        let currentData = '';
        let currentTikz = '';

        const paint = (data: string, tikz: string): void => {
          currentData = data;
          currentTikz = tikz;
          dom.setAttribute(attribute, data);

          if (tikz) dom.setAttribute('data-tikz-code', tikz);
          else dom.removeAttribute('data-tikz-code');

          paintDrawingNode(dom, kind, data, {
            scale: options.scale,
            t: options.t ?? undefined,
            accessibleName: options.t ? options.t(ariaKey) : undefined,
          });
        };

        paint(String(node.attrs.data ?? DEFAULT_DATA), String(node.attrs.tikz ?? ''));

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

          options.onEdit?.({ kind, data: currentData, tikz: currentTikz, pos: typeof pos === 'number' ? pos : null });
        };

        // `mousedown`, а не `click`: при выделении атома ProseMirror
        // перерисовывает node view, и `click` до него не доходит.
        dom.addEventListener('mousedown', openEditor);

        return {
          dom,
          update: (updated) => {
            if (updated.type.name !== name) return false;

            const data = String(updated.attrs.data ?? DEFAULT_DATA);
            const tikz = String(updated.attrs.tikz ?? '');

            if (data !== currentData || tikz !== currentTikz) paint(data, tikz);

            return true;
          },
          selectNode: () => dom.classList.add('rte-drawing--selected'),
          deselectNode: () => dom.classList.remove('rte-drawing--selected'),
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
        Enter: () => {
          const selected = selectedDrawing(editor.state, name);

          if (!selected || !editor.isEditable || !options.onEdit) return false;

          options.onEdit({
            kind,
            data: String(selected.node.attrs.data ?? DEFAULT_DATA),
            tikz: String(selected.node.attrs.tikz ?? ''),
            pos: selected.pos,
          });

          return true;
        },
      };
    },

    addCommands() {
      const insert =
        (content: DrawingContent) =>
        ({ commands }: CommandProps): boolean => {
          const { data } = content;

          if (!data.trim()) return false;

          return commands.insertContent({ type: name, attrs: { data, tikz: content.tikz ?? '' } });
        };

      const update =
        (content: DrawingContent & { pos: number }) =>
        ({ tr, dispatch, state }: CommandProps): boolean => {
          const { data } = content;
          const node = state.doc.nodeAt(content.pos);

          if (!data.trim() || !node || node.type.name !== name) return false;

          if (dispatch) tr.setNodeMarkup(content.pos, undefined, { ...node.attrs, data, tikz: content.tikz ?? '' });

          return true;
        };

      const remove =
        (pos: number) =>
        ({ tr, dispatch, state }: CommandProps): boolean => {
          const node = state.doc.nodeAt(pos);

          if (!node || (node.type.name !== GEOMETRY_NODE_NAME && node.type.name !== PHYSICS_NODE_NAME)) return false;

          if (dispatch) tr.delete(pos, pos + node.nodeSize);

          return true;
        };

      // Команды одного вида — у своего узла; удаление общее и срабатывает
      // на любом чертеже, поэтому объявлено у обоих.
      const own =
        kind === 'geometry'
          ? { insertGeometry: insert, updateGeometry: update }
          : { insertPhysics: insert, updatePhysics: update };

      return { ...own, deleteDrawingAt: remove } as Partial<RawCommands>;
    },
  });
};

export const GeometryNode = createDrawingNode('geometry');
export const PhysicsNode = createDrawingNode('physics');
