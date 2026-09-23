import { Node, mergeAttributes } from '@tiptap/core';
import { sanitizeHtml } from '../security/sanitize';

interface LegacyEmbedOptions {
  HTMLAttributes: Record<string, unknown>;
}

const LEGACY_EMBED_NODE_NAME = 'legacyEmbed';

/**
 * Атомарный узел для фрагментов старого редактора, которые нечем смоделировать:
 * готовый SVG от MathJax и структурные формулы химии из JSME.
 *
 * Исходных данных (MathML, SMILES) в такой разметке нет — восстанавливать
 * нечего, поэтому узел хранит саму разметку и отдаёт её обратно без изменений.
 * Смысл узла не в редактировании, а в том, чтобы контент пережил открытие
 * документа: без него схема выбрасывает `<svg>` целиком, и ученик, открыв своё
 * старое решение, теряет формулы молча.
 *
 * Узел инлайновый: оба источника встречаются внутри строки текста, и блочный
 * вариант разорвал бы абзац.
 */
export const LegacyEmbedNode = Node.create<LegacyEmbedOptions>({
  name: LEGACY_EMBED_NODE_NAME,
  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,
  draggable: false,

  addOptions: () => ({ HTMLAttributes: {} }),

  addAttributes: () => ({
    html: {
      default: '',
      // Разметка уже прошла санитайзер на входе, но узел могут наполнить и
      // программно, поэтому чистим ещё раз перед тем, как положить в модель.
      parseHTML: (element) => sanitizeHtml(element.innerHTML),
      renderHTML: () => ({}),
    },
  }),

  parseHTML: () => [
    {
      tag: 'span[data-legacy-embed]',
      getAttrs: (element) => (sanitizeHtml((element as HTMLElement).innerHTML) ? null : false),
    },
  ],

  renderHTML({ node, HTMLAttributes }) {
    const dom = document.createElement('span');

    const attrs = mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
      'data-legacy-embed': 'true',
      class: 'rte-legacy-embed',
      contenteditable: 'false',
    });

    Object.entries(attrs).forEach(([key, value]) => {
      if (value !== null && value !== undefined) dom.setAttribute(key, String(value));
    });

    dom.innerHTML = (node.attrs.html as string) ?? '';

    return dom;
  },

  addNodeView:
    () =>
    ({ node }) => {
      const dom = document.createElement('span');

      dom.className = 'rte-legacy-embed';
      dom.setAttribute('data-legacy-embed', 'true');
      dom.contentEditable = 'false';
      dom.innerHTML = (node.attrs.html as string) ?? '';

      return {
        dom,
        // Содержимое — не часть документа ProseMirror; читать его обратно как
        // правку нельзя.
        ignoreMutation: () => true,
      };
    },
});
