import { Node, mergeAttributes } from '@tiptap/core';
import type { AttachmentAttributes, Translate } from '../types';
import { formatBytes } from '../utils/format';

export interface AttachmentOptions {
  t: Translate;
  HTMLAttributes: Record<string, unknown>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    attachment: {
      insertAttachment: (attributes: AttachmentAttributes) => ReturnType;
    };
  }
}

export const ATTACHMENT_NODE_NAME = 'attachment';

/**
 * Attachment chip for text files. Exported markup is a real `<a download>`, so
 * the file stays reachable from the plain HTML without the editor.
 */
export const AttachmentNode = Node.create<AttachmentOptions>({
  name: ATTACHMENT_NODE_NAME,
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addOptions() {
    return { t: (key: string) => key, HTMLAttributes: {} };
  },

  addAttributes() {
    return {
      href: {
        default: '',
        parseHTML: (element) =>
          element.getAttribute('data-href') ??
          element.querySelector('a')?.getAttribute('href') ??
          '',
        renderHTML: () => ({}),
      },
      name: {
        default: '',
        parseHTML: (element) =>
          element.getAttribute('data-name') ??
          element.querySelector('a')?.textContent?.trim() ??
          '',
        renderHTML: (attributes) => ({ 'data-name': attributes.name as string }),
      },
      size: {
        default: null,
        parseHTML: (element) => {
          const raw = element.getAttribute('data-size');
          const value = raw === null ? Number.NaN : Number.parseInt(raw, 10);
          return Number.isFinite(value) ? value : null;
        },
        renderHTML: (attributes) =>
          attributes.size === null || attributes.size === undefined
            ? {}
            : { 'data-size': String(attributes.size) },
      },
      mime: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-mime'),
        renderHTML: (attributes) =>
          attributes.mime ? { 'data-mime': attributes.mime as string } : {},
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-attachment]',
        getAttrs: (element) => {
          const el = element as HTMLElement;
          const href = el.getAttribute('data-href') ?? el.querySelector('a')?.getAttribute('href');
          return href ? null : false;
        },
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const href = (node.attrs.href as string) ?? '';
    const name = (node.attrs.name as string) || href;
    const size = node.attrs.size as number | null;

    return [
      'div',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-attachment': 'true',
        'data-href': href,
        class: 'rte-attachment',
      }),
      [
        'a',
        { href, download: name, rel: 'noopener noreferrer', class: 'rte-attachment__link' },
        size ? `${name} (${formatBytes(size)})` : name,
      ],
    ];
  },

  addNodeView() {
    return ({ node }) => {
      const attrs = node.attrs as unknown as AttachmentAttributes;

      const dom = document.createElement('div');
      dom.className = 'rte-attachment';
      dom.setAttribute('data-attachment', 'true');
      dom.setAttribute('data-href', attrs.href);
      dom.contentEditable = 'false';

      const icon = document.createElement('span');
      icon.className = 'rte-attachment__icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = '📄';

      const link = document.createElement('a');
      link.className = 'rte-attachment__link';
      link.href = attrs.href;
      link.download = attrs.name;
      link.rel = 'noopener noreferrer';
      link.textContent = attrs.name;
      link.title = this.options.t('file_download');

      const meta = document.createElement('span');
      meta.className = 'rte-attachment__meta';
      if (attrs.size) meta.textContent = formatBytes(attrs.size);

      dom.append(icon, link, meta);
      return { dom, ignoreMutation: () => true };
    };
  },

  addCommands() {
    return {
      insertAttachment:
        (attributes) =>
        ({ commands }) => {
          if (!attributes.href) return false;
          return commands.insertContent({ type: this.name, attrs: attributes });
        },
    };
  },
});
