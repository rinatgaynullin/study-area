import { createRichEditor, type RichEditorUi } from '@rich-editor/core';
import { NodeSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it } from 'vitest';
import { createDrawingsFeature } from '../src';

let ui: RichEditorUi | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  ui?.destroy();
  ui = undefined;
  host?.remove();
  host = undefined;
});

const TRIANGLE = '{"type":"2d","vertices":{"A":[0,0],"B":[4,0],"C":[0,3]},"edges":[["A","B"],["B","C"],["C","A"]]}';

const DOC = `<p>один</p><div data-geometry-data='${TRIANGLE}'></div><p>два</p>`;

const mountEditor = (options: Record<string, unknown> = {}): RichEditorUi => {
  host = document.createElement('div');
  document.body.appendChild(host);
  ui = createRichEditor({
    element: host,
    content: DOC,
    features: [createDrawingsFeature()],
    ...options,
  });

  return ui;
};

const drawing = (editor: RichEditorUi): HTMLElement => {
  const found = editor.element.querySelector<HTMLElement>('.rte-content .rte-drawing');

  if (!found) throw new Error('В документе нет чертежа');

  return found;
};

const isDialogOpen = (): boolean => document.querySelector('.rte-modal:not([hidden])') !== null;

const fire = (target: HTMLElement, type: string): MouseEvent => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true });

  target.dispatchEvent(event);

  return event;
};

describe('чертёж в документе: клик и перенос', () => {
  it('нажатие мыши диалог не открывает, клик — открывает и выделяет узел', () => {
    const editor = mountEditor();
    const card = drawing(editor);

    const down = fire(card, 'mousedown');

    // Нажатие отдаётся ProseMirror: он сам решает, начинать ли перенос.
    expect(down.defaultPrevented).toBe(false);
    expect(isDialogOpen()).toBe(false);

    fire(card, 'click');

    expect(isDialogOpen()).toBe(true);
    expect(document.querySelector('.rte-modal:not([hidden]) .rte-modal__title')?.textContent).toBe('Изменить чертёж');
    expect(editor.core.editor.state.selection).toBeInstanceOf(NodeSelection);
  });

  it('в нередактируемом документе клик диалог не открывает, перенос не начинается', () => {
    const editor = mountEditor({ editable: false });
    const card = drawing(editor);

    fire(card, 'click');
    expect(isDialogOpen()).toBe(false);

    const drag = fire(card, 'dragstart');

    expect(drag.defaultPrevented).toBe(true);
  });

  it('в редактируемом документе перенос не запрещён', () => {
    const editor = mountEditor();
    const drag = fire(drawing(editor), 'dragstart');

    expect(drag.defaultPrevented).toBe(false);
  });

  it('узлы геометрии и физики перетаскиваются', () => {
    const { nodes } = mountEditor().core.editor.schema;

    expect(nodes.geometry?.spec.draggable).toBe(true);
    expect(nodes.physics?.spec.draggable).toBe(true);
  });

  it('Alt+↓ переставляет выделенный чертёж ниже абзаца', () => {
    const editor = mountEditor();
    const { view } = editor.core.editor;

    let pos = -1;

    view.state.doc.forEach((node, offset) => {
      if (node.type.name === 'geometry') pos = offset;
    });
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
    view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true, cancelable: true }));

    const names: string[] = [];

    view.state.doc.forEach((node) => names.push(node.type.name));
    // Под атомом в конце документа редактор сам дописывает пустой абзац.
    expect(names).toEqual(['paragraph', 'paragraph', 'geometry', 'paragraph']);
    expect(isDialogOpen()).toBe(false);
  });
});
