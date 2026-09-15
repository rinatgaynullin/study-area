import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RichEditorCore, latexToMathML, resetMathJax } from '../src';

let element: HTMLElement;
let core: RichEditorCore;

function mount(options: Partial<ConstructorParameters<typeof RichEditorCore>[0]> = {}) {
  element = document.createElement('div');
  document.body.appendChild(element);
  core = new RichEditorCore({ element, ...options });
  return core;
}

beforeEach(() => {
  resetMathJax();
});

afterEach(() => {
  core?.destroy();
  element?.remove();
});

describe('document serialization', () => {
  it('round-trips basic formatting through getHTML/setHTML', () => {
    const editor = mount();
    const html =
      '<h2>Заголовок</h2><p><strong>жирный</strong> и <em>курсив</em></p><ul><li><p>пункт</p></li></ul>';

    editor.setHTML(html);
    const output = editor.getHTML();

    expect(output).toContain('<h2>Заголовок</h2>');
    expect(output).toContain('<strong>жирный</strong>');
    expect(output).toContain('<em>курсив</em>');
    expect(output).toContain('<ul>');
  });

  it('keeps tables, alignment, colors and sub/superscripts', () => {
    const editor = mount();
    editor.setHTML(
      '<table><tbody><tr><th><p>A</p></th><td><p>B</p></td></tr></tbody></table>' +
        '<p style="text-align: center">центр</p>' +
        '<p><span style="color: #ff0000">красный</span></p>' +
        '<p>H<sub>2</sub>O и x<sup>2</sup></p>',
    );
    const output = editor.getHTML();

    expect(output).toContain('<table');
    expect(output).toContain('text-align: center');
    // The DOM normalizes hex colors to their rgb() form on serialization.
    expect(output).toContain('color: rgb(255, 0, 0)');
    expect(output).toContain('<sub>2</sub>');
    expect(output).toContain('<sup>2</sup>');
  });
});

describe('formula round-trip', () => {
  it('preserves MathML through an export/import cycle', async () => {
    const editor = mount();
    const mathml = await latexToMathML('\\frac{a}{b}', 'math');

    expect(editor.insertFormula(mathml, 'math')).toBe(true);
    await editor.whenFormulasReady();

    const exported = editor.getHTML();
    expect(exported).toContain('data-formula="true"');
    expect(exported).toContain('data-formula-type="math"');
    expect(exported).toContain('data-mathml=');
    // The cached MathJax projection travels with the document.
    expect(exported).toContain('<svg');

    // Re-importing must yield a formula node, not broken text.
    editor.setHTML(exported);
    const json = editor.getJSON();
    const formula = findNode(json, 'formula');

    expect(formula).toBeDefined();
    expect(formula?.attrs?.mathml).toContain('<mfrac>');
    expect(formula?.attrs?.formulaType).toBe('math');
    expect(editor.getText()).not.toContain('mfrac');
  });

  it('re-renders after the MathML is updated in place', async () => {
    const editor = mount();
    editor.insertFormula(await latexToMathML('x', 'math'), 'math');

    const pos = findFormulaPos(editor);
    expect(pos).not.toBeNull();

    const updated = await latexToMathML('y^2', 'math');
    expect(editor.updateFormulaAt(pos!, updated, 'math')).toBe(true);
    await editor.whenFormulasReady();

    const formula = findNode(editor.getJSON(), 'formula');
    expect(formula?.attrs?.mathml).toContain('<msup>');
  });

  it('deletes a formula as a whole node', async () => {
    const editor = mount();
    editor.insertFormula(await latexToMathML('\\alpha', 'math'), 'math');

    const pos = findFormulaPos(editor);
    expect(editor.deleteFormulaAt(pos!)).toBe(true);
    expect(findNode(editor.getJSON(), 'formula')).toBeUndefined();
  });

  it('rejects invalid MathML instead of inserting broken content', () => {
    const editor = mount();
    expect(editor.insertFormula('<p>not a formula</p>')).toBe(false);
    expect(findNode(editor.getJSON(), 'formula')).toBeUndefined();
  });

  it('upgrades raw MathML in imported HTML into formula nodes', () => {
    const editor = mount();
    editor.setHTML(
      '<p>Формула: <math xmlns="http://www.w3.org/1998/Math/MathML"><msup><mi>x</mi><mn>2</mn></msup></math></p>',
    );

    const formula = findNode(editor.getJSON(), 'formula');
    expect(formula).toBeDefined();
    expect(formula?.attrs?.mathml).toContain('<msup>');
  });

  it('chemistry formulas keep their type across a round-trip', async () => {
    const editor = mount();
    editor.insertFormula(await latexToMathML('\\mathrm{H}_2\\mathrm{O}', 'chem'), 'chem');
    await editor.whenFormulasReady();

    editor.setHTML(editor.getHTML());
    expect(findNode(editor.getJSON(), 'formula')?.attrs?.formulaType).toBe('chem');
  });
});

interface JsonNode {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: JsonNode[];
}

function findNode(doc: unknown, type: string): JsonNode | undefined {
  const node = doc as JsonNode;
  if (node?.type === type) return node;
  for (const child of node?.content ?? []) {
    const found = findNode(child, type);
    if (found) return found;
  }
  return undefined;
}

function findFormulaPos(core: RichEditorCore): number | null {
  let result: number | null = null;
  core.editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'formula' && result === null) result = pos;
    return result === null;
  });
  return result;
}
