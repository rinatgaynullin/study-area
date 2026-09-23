import { afterEach, describe, expect, it, vi } from 'vitest';
import { RichEditorCore, latexToMathML, type FormulaPayload } from '../src';

let core: RichEditorCore | undefined;
let element: HTMLElement | undefined;

afterEach(() => {
  core?.destroy();
  element?.remove();
  core = undefined;
  element = undefined;
});

const mount = (onFormulaEdit: (payload: FormulaPayload) => void) => {
  element = document.createElement('div');
  document.body.appendChild(element);
  core = new RichEditorCore({ element, onFormulaEdit });

  return core;
};

describe('formula node interaction', () => {
  it('opens the editor with the current MathML when a formula is clicked', async () => {
    const onFormulaEdit = vi.fn();
    const editor = mount(onFormulaEdit);

    const mathml = await latexToMathML('x^2', 'math');

    editor.insertFormula(mathml, 'math');
    await editor.whenFormulasReady();

    const node = element!.querySelector<HTMLElement>('.rte-formula');

    expect(node, 'formula node view should be in the DOM').not.toBeNull();

    node!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));

    expect(onFormulaEdit).toHaveBeenCalledTimes(1);

    const payload = onFormulaEdit.mock.calls[0][0] as FormulaPayload;

    expect(payload.type).toBe('math');
    expect(payload.mathml).toContain('<msup>');
    expect(typeof payload.pos).toBe('number');
  });

  it('reports the chemistry type when a chemistry formula is clicked', async () => {
    const onFormulaEdit = vi.fn();
    const editor = mount(onFormulaEdit);

    editor.insertFormula(await latexToMathML('\\mathrm{H}_2\\mathrm{O}', 'chem'), 'chem');
    await editor.whenFormulasReady();

    element!
      .querySelector<HTMLElement>('.rte-formula')!
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));

    expect((onFormulaEdit.mock.calls[0][0] as FormulaPayload).type).toBe('chem');
  });

  it('does not open the editor while read-only', async () => {
    const onFormulaEdit = vi.fn();
    const editor = mount(onFormulaEdit);

    editor.insertFormula(await latexToMathML('y', 'math'), 'math');
    await editor.whenFormulasReady();
    editor.setEditable(false);

    element!
      .querySelector<HTMLElement>('.rte-formula')!
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));

    expect(onFormulaEdit).not.toHaveBeenCalled();
  });
});

describe('formula node accessibility', () => {
  it('is an image named by its LaTeX, in the editor and in the exported HTML', async () => {
    const editor = mount(() => {});

    editor.insertFormula(await latexToMathML('\\frac{a}{b}', 'math'), 'math');
    await editor.whenFormulasReady();

    const node = element!.querySelector<HTMLElement>('.rte-formula')!;

    expect(node.getAttribute('role')).toBe('img');
    expect(node.getAttribute('aria-label')).toBe('\\frac{a}{b}');

    const html = editor.getHTML();

    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="\\frac{a}{b}"');

    // Имя переживает и обратный путь через санитайзер.
    editor.setHTML(html);
    expect(editor.getHTML()).toContain('aria-label="\\frac{a}{b}"');
  });

  it('Enter on a selected formula opens the editor; elsewhere Enter is a line break', async () => {
    const onFormulaEdit = vi.fn();
    const editor = mount(onFormulaEdit);

    editor.insertFormula(await latexToMathML('x^2', 'math'), 'math');
    await editor.whenFormulasReady();

    // Формула — единственный узел в первом абзаце: позиция 1.
    editor.editor.commands.setNodeSelection(1);

    editor.editor.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );

    expect(onFormulaEdit).toHaveBeenCalledTimes(1);

    const payload = onFormulaEdit.mock.calls[0][0] as FormulaPayload;

    expect(payload.pos).toBe(1);
    expect(payload.mathml).toContain('<msup>');

    editor.editor.commands.setTextSelection(2);

    const paragraphs = editor.editor.state.doc.childCount;

    editor.editor.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );

    expect(onFormulaEdit).toHaveBeenCalledTimes(1);
    expect(editor.editor.state.doc.childCount).toBe(paragraphs + 1);
  });

  it('does not open the editor by Enter while read-only', async () => {
    const onFormulaEdit = vi.fn();
    const editor = mount(onFormulaEdit);

    editor.insertFormula(await latexToMathML('y', 'math'), 'math');
    await editor.whenFormulasReady();
    editor.setEditable(false);

    editor.editor.commands.setNodeSelection(1);

    editor.editor.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );

    expect(onFormulaEdit).not.toHaveBeenCalled();
  });
});
