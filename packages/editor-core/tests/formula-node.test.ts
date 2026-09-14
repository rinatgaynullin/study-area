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

function mount(onFormulaEdit: (payload: FormulaPayload) => void) {
  element = document.createElement('div');
  document.body.appendChild(element);
  core = new RichEditorCore({ element, onFormulaEdit });
  return core;
}

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

    element!.querySelector<HTMLElement>('.rte-formula')!
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));

    expect((onFormulaEdit.mock.calls[0][0] as FormulaPayload).type).toBe('chem');
  });

  it('does not open the editor while read-only', async () => {
    const onFormulaEdit = vi.fn();
    const editor = mount(onFormulaEdit);

    editor.insertFormula(await latexToMathML('y', 'math'), 'math');
    await editor.whenFormulasReady();
    editor.setEditable(false);

    element!.querySelector<HTMLElement>('.rte-formula')!
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));

    expect(onFormulaEdit).not.toHaveBeenCalled();
  });
});
