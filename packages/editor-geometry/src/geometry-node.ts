import { Node, mergeAttributes } from '@tiptap/core';
import type { Translate } from '@rich-editor/core';
import { GeometryBoard } from './geometry-board';
import {
  DEFAULT_BBOX,
  DEFAULT_HEIGHT,
  formatBoundingBox,
  parseBoundingBox,
  type BoundingBox,
  type GeometryAttributes,
  type GeometryPayload,
} from './types';

export interface GeometryOptions {
  t: Translate;
  /** Открыть диалог правки. `null` — у хоста нет диалога, кнопка не показывается. */
  onEdit: ((payload: GeometryPayload) => void) | null;
  onError: ((error: unknown) => void) | null;
  HTMLAttributes: Record<string, unknown>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    geometry: {
      insertGeometry: (attributes: Partial<GeometryAttributes>) => ReturnType;
      updateGeometry: (pos: number, attributes: Partial<GeometryAttributes>) => ReturnType;
    };
  }
}

export const GEOMETRY_NODE_NAME = 'geometry';

const readAttributes = (attrs: Record<string, unknown>): GeometryAttributes => ({
  script: (attrs.script as string) ?? '',
  bbox: (attrs.bbox as BoundingBox) ?? [...DEFAULT_BBOX],
  height: (attrs.height as number) ?? DEFAULT_HEIGHT,
});

/**
 * Блочный атом с интерактивной доской JSXGraph.
 *
 * В HTML уезжает `<div data-geometry data-bbox data-height>`: построение хранится
 * текстом JessieCode, так что документ остаётся обычным HTML, а вьюер
 * поднимает доску из тех же атрибутов (`hydrateGeometry`).
 */
export const GeometryNode = Node.create<GeometryOptions>({
  name: GEOMETRY_NODE_NAME,
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addOptions: () => ({
    t: (key: string) => key,
    onEdit: null,
    onError: null,
    HTMLAttributes: {},
  }),

  addAttributes: () => ({
    script: {
      default: '',
      parseHTML: (element) => element.getAttribute('data-geometry') ?? '',
      renderHTML: (attributes) => ({ 'data-geometry': attributes.script as string }),
    },
    bbox: {
      default: [...DEFAULT_BBOX],
      parseHTML: (element) => parseBoundingBox(element.getAttribute('data-bbox')),
      renderHTML: (attributes) => ({
        'data-bbox': formatBoundingBox(attributes.bbox as BoundingBox),
      }),
    },
    height: {
      default: DEFAULT_HEIGHT,
      parseHTML: (element) => {
        const value = Number.parseInt(element.getAttribute('data-height') ?? '', 10);

        return Number.isFinite(value) && value > 0 ? value : DEFAULT_HEIGHT;
      },
      renderHTML: (attributes) => ({ 'data-height': String(attributes.height) }),
    },
  }),

  parseHTML: () => [{ tag: 'div[data-geometry]' }],

  renderHTML({ node, HTMLAttributes }) {
    const { t } = this.options;

    return [
      'div',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        class: 'rte-geometry',
        role: 'img',
        'aria-label': t('geometry_aria_label'),
      }),
      // Текст на случай страницы без JSXGraph: читателю видно, что здесь построение.
      ['span', { class: 'rte-geometry__fallback' }, (node.attrs.script as string).trim()],
    ];
  },

  addNodeView() {
    const { options } = this;

    return ({ node, getPos, editor }) => {
      let attrs = readAttributes(node.attrs);

      const dom = document.createElement('div');

      dom.className = 'rte-geometry';
      dom.contentEditable = 'false';
      dom.setAttribute('data-geometry', attrs.script);
      dom.setAttribute('data-bbox', formatBoundingBox(attrs.bbox));
      dom.setAttribute('data-height', String(attrs.height));

      const host = document.createElement('div');

      host.className = 'rte-geometry__board jxgbox';
      host.style.height = `${attrs.height}px`;
      host.setAttribute('aria-label', options.t('geometry_aria_label'));
      dom.appendChild(host);

      const editButton = document.createElement('button');

      editButton.type = 'button';
      editButton.className = 'rte-geometry__edit';
      editButton.textContent = options.t('geometry_edit');
      editButton.hidden = !options.onEdit || !editor.isEditable;
      editButton.addEventListener('click', () => {
        const pos = getPos();

        if (typeof pos !== 'number') return;

        options.onEdit?.({ pos, ...attrs });
      });
      dom.appendChild(editButton);

      const board = new GeometryBoard({
        element: host,
        script: attrs.script,
        bbox: attrs.bbox,
        interactive: editor.isEditable,
        onError: (error) => options.onError?.(error),
      });

      return {
        dom,
        update: (updated) => {
          if (updated.type.name !== GEOMETRY_NODE_NAME) return false;

          const next = readAttributes(updated.attrs);
          const isSameBoard = next.script === attrs.script && formatBoundingBox(next.bbox) === formatBoundingBox(attrs.bbox);

          attrs = next;
          dom.setAttribute('data-geometry', next.script);
          dom.setAttribute('data-bbox', formatBoundingBox(next.bbox));
          dom.setAttribute('data-height', String(next.height));
          host.style.height = `${next.height}px`;

          if (!isSameBoard) board.update(next.script, next.bbox);

          return true;
        },
        selectNode: () => dom.classList.add('rte-geometry--selected'),
        deselectNode: () => dom.classList.remove('rte-geometry--selected'),
        // Доска сама обрабатывает указатель и клавиатуру; ProseMirror в неё не лезет.
        stopEvent: (event) => host.contains(event.target as globalThis.Node),
        ignoreMutation: () => true,
        destroy: () => board.destroy(),
      };
    };
  },

  addKeyboardShortcuts() {
    const { editor, options } = this;

    return {
      Enter: () => {
        const { selection } = editor.state;
        const selected = 'node' in selection ? (selection as { node: { type: { name: string }; attrs: Record<string, unknown> } }).node : null;

        if (!selected || selected.type.name !== GEOMETRY_NODE_NAME || !editor.isEditable) return false;

        options.onEdit?.({ pos: selection.from, ...readAttributes(selected.attrs) });

        return true;
      },
    };
  },

  addCommands() {
    const { name } = this;

    return {
      insertGeometry:
        (attributes) =>
        ({ commands }) =>
          commands.insertContent({ type: name, attrs: attributes }),

      updateGeometry:
        (pos, attributes) =>
        ({ tr, dispatch, state }) => {
          const target = state.doc.nodeAt(pos);

          if (!target || target.type.name !== name) return false;

          if (dispatch) tr.setNodeMarkup(pos, undefined, { ...target.attrs, ...attributes });

          return true;
        },
    };
  },
});
