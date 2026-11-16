import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it } from 'vitest';
import { ATTACHMENT_NODE_NAME, AUDIO_NODE_NAME, RichEditorCore } from '../src';

let core: RichEditorCore | undefined;
let element: HTMLElement | undefined;

afterEach(() => {
  core?.destroy();
  element?.remove();
  core = undefined;
  element = undefined;
});

const mount = (content: string): RichEditorCore => {
  element = document.createElement('div');
  document.body.appendChild(element);
  core = new RichEditorCore({ element, content });

  return core;
};

/** Имена блоков верхнего уровня по порядку. */
const order = (editor: RichEditorCore): string[] => {
  const names: string[] = [];

  editor.editor.state.doc.forEach((node) => {
    names.push(node.type.name === 'paragraph' ? `p:${node.textContent}` : node.type.name);
  });

  return names;
};

/** Ставит `NodeSelection` на первый узел с этим именем. */
const selectNode = (editor: RichEditorCore, name: string): void => {
  let found = -1;

  editor.editor.state.doc.descendants((node, pos) => {
    if (found < 0 && node.type.name === name) found = pos;

    return found < 0;
  });

  expect(found, `в документе нет узла ${name}`).toBeGreaterThanOrEqual(0);

  const { view } = editor.editor;

  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, found)));
};

const selectedName = (editor: RichEditorCore): string | null => {
  const { selection } = editor.editor.state;

  return selection instanceof NodeSelection ? selection.node.type.name : null;
};

const press = (editor: RichEditorCore, key: string): void => {
  editor.editor.view.dom.dispatchEvent(
    new KeyboardEvent('keydown', { key, altKey: true, bubbles: true, cancelable: true }),
  );
};

const IMAGE_DOC = '<p>один</p><img src="https://example.com/a.png"><p>два</p>';

const ATTACHMENT_DOC =
  '<p>один</p><div data-attachment="true" data-href="https://example.com/a.txt" data-name="a.txt">'
  + '<a href="https://example.com/a.txt" download="a.txt">a.txt</a></div><p>два</p>';

// Под атомом в конце документа редактор сам дописывает пустой абзац («p:»).
describe('перестановка блочных атомов', () => {
  it('moveBlockDown и moveBlockUp меняют картинку местами с соседом, выделение остаётся на ней', () => {
    const editor = mount(IMAGE_DOC);

    expect(order(editor)).toEqual(['p:один', 'image', 'p:два']);

    selectNode(editor, 'image');
    expect(editor.editor.commands.moveBlockDown()).toBe(true);
    expect(order(editor)).toEqual(['p:один', 'p:два', 'image', 'p:']);
    expect(selectedName(editor)).toBe('image');

    expect(editor.editor.commands.moveBlockUp()).toBe(true);
    expect(order(editor)).toEqual(['p:один', 'image', 'p:два', 'p:']);
    expect(selectedName(editor)).toBe('image');
  });

  it('на краю документа команда отказывает и документ не меняется; под дописанный пустой абзац не уходит', () => {
    const editor = mount('<img src="https://example.com/a.png"><p>два</p>');

    selectNode(editor, 'image');

    const before = editor.getHTML();

    expect(editor.editor.commands.moveBlockUp()).toBe(false);
    expect(editor.getHTML()).toBe(before);

    expect(editor.editor.commands.moveBlockDown()).toBe(true);
    expect(order(editor)).toEqual(['p:два', 'image', 'p:']);

    const atEnd = editor.getHTML();

    expect(editor.editor.commands.moveBlockDown()).toBe(false);
    expect(editor.getHTML()).toBe(atEnd);
    expect(selectedName(editor)).toBe('image');
  });

  it('без выделенного атома команды ничего не делают', () => {
    const editor = mount(IMAGE_DOC);
    const { view } = editor.editor;

    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)));

    const before = editor.getHTML();

    expect(editor.editor.commands.moveBlockDown()).toBe(false);
    expect(editor.editor.commands.moveBlockUp()).toBe(false);
    expect(editor.getHTML()).toBe(before);
  });

  it('Alt+↓ и Alt+↑ переставляют выделенное вложение', () => {
    const editor = mount(ATTACHMENT_DOC);

    expect(order(editor)).toEqual(['p:один', 'attachment', 'p:два']);

    selectNode(editor, 'attachment');
    press(editor, 'ArrowDown');
    expect(order(editor)).toEqual(['p:один', 'p:два', 'attachment', 'p:']);
    expect(selectedName(editor)).toBe('attachment');

    press(editor, 'ArrowUp');
    press(editor, 'ArrowUp');
    expect(order(editor)).toEqual(['attachment', 'p:один', 'p:два', 'p:']);
    expect(selectedName(editor)).toBe('attachment');
  });

  it('в обычном абзаце Alt+↓ документ не меняет и событие не глотает', () => {
    const editor = mount(IMAGE_DOC);
    const { view } = editor.editor;

    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)));

    const before = editor.getHTML();
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      altKey: true,
      bubbles: true,
      cancelable: true,
    });

    view.dom.dispatchEvent(event);

    expect(editor.getHTML()).toBe(before);
    expect(event.defaultPrevented).toBe(false);
  });

  it('внутри цитаты Alt+↓ ставит картинку ниже последнего пустого абзаца', () => {
    const editor = mount('<blockquote><p>a</p><img src="https://example.com/a.png"><p></p></blockquote>');

    /** Дети цитаты по порядку. */
    const quoteOrder = (): string[] => {
      const names: string[] = [];
      const quote = editor.editor.state.doc.firstChild;

      expect(quote?.type.name).toBe('blockquote');
      quote?.forEach((node) => {
        names.push(node.type.name === 'paragraph' ? `p:${node.textContent}` : node.type.name);
      });

      return names;
    };

    expect(quoteOrder()).toEqual(['p:a', 'image', 'p:']);

    selectNode(editor, 'image');
    press(editor, 'ArrowDown');

    expect(quoteOrder()).toEqual(['p:a', 'p:', 'image']);
    expect(selectedName(editor)).toBe('image');
  });

  it('у ядра без интерфейса линия места вставки окрашена переменной темы с запасным цветом', () => {
    const editor = mount('<p></p>');
    const dropCursor = editor.editor.extensionManager.extensions.find(
      (extension) => extension.name === 'dropCursor',
    );

    expect(dropCursor?.options).toMatchObject({
      class: 'rte-dropcursor',
      width: 2,
      color: 'var(--rte-color-primary, currentColor)',
    });
  });

  it('узлы картинки, аудио и вложения перетаскиваются', () => {
    const editor = mount('<p></p>');
    const { nodes } = editor.editor.schema;

    expect(nodes.image?.spec.draggable).toBe(true);
    expect(nodes[AUDIO_NODE_NAME]?.spec.draggable).toBe(true);
    expect(nodes[ATTACHMENT_NODE_NAME]?.spec.draggable).toBe(true);
  });
});
