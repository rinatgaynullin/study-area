import { afterEach, describe, expect, it } from 'vitest';
import { RichEditorCore, mathmlToLatex, normalizeMathML, renderMathML } from '../src';

/**
 * A real exam problem: a system of equations written with `<mfenced>` (a brace
 * fence), an `<mtable>` of rows and a nested `<msqrt>`. This is the shape MathML
 * arrives in from other editors, and every part of it has to survive import.
 */
const SYSTEM_OF_EQUATIONS =
  '<p>При каких значениях параметра а система уравнений</p>' +
  '<p><math xmlns="http://www.w3.org/1998/Math/MathML"><mfenced close="" open="{">' +
  '<mtable columnalign="left"><mtr><mtd><mo>(</mo><mi>x</mi><msup><mi>y</mi><mn>2</mn></msup>' +
  '<mo>-</mo><mn>3</mn><mi>x</mi><mi>y</mi><mo>-</mo><mn>3</mn><mi>y</mi><mo>+</mo><mn>9</mn>' +
  '<mo>)</mo><msqrt><mn>3</mn><mo>-</mo><mi>x</mi></msqrt><mo>=</mo><mn>0</mn></mtd></mtr>' +
  '<mtr><mtd><mi>y</mi><mo>=</mo><mi>a</mi><mi>x</mi></mtd></mtr></mtable></mfenced></math></p>' +
  '<p>имеет ровно три различных решения?</p>';

let core: RichEditorCore | undefined;
let element: HTMLElement | undefined;

afterEach(() => {
  core?.destroy();
  element?.remove();
  core = undefined;
  element = undefined;
});

function mount(content: string) {
  element = document.createElement('div');
  document.body.appendChild(element);
  core = new RichEditorCore({ element, content });
  return core;
}

interface JsonNode {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: JsonNode[];
}

function findFormula(doc: unknown): JsonNode | undefined {
  const node = doc as JsonNode;
  if (node?.type === 'formula') return node;
  for (const child of node?.content ?? []) {
    const found = findFormula(child);
    if (found) return found;
  }
  return undefined;
}

describe('importing a system of equations from foreign MathML', () => {
  it('turns it into a formula node instead of leaking markup as text', () => {
    const editor = mount(SYSTEM_OF_EQUATIONS);
    const formula = findFormula(editor.getJSON());

    expect(formula, 'the <math> element should become a formula node').toBeDefined();

    const text = editor.getText();
    expect(text).toContain('При каких значениях параметра');
    expect(text).toContain('имеет ровно три различных решения?');
    // None of the markup may end up as visible text.
    expect(text).not.toContain('mfenced');
    expect(text).not.toContain('mtable');
    expect(text).not.toContain('msqrt');
  });

  it('keeps the structure of the system intact', () => {
    const mathml = findFormula(mount(SYSTEM_OF_EQUATIONS).getJSON())?.attrs?.mathml as string;

    // The brace fence and its two rows are what make this a system.
    expect(mathml).toContain('<mfenced');
    expect(mathml).toContain('open="{"');
    expect(mathml).toContain('<mtable');
    expect((mathml.match(/<mtr>/g) ?? []).length).toBe(2);
    expect(mathml).toContain('<msqrt>');
    expect(mathml).toContain('<msup>');
  });

  it('renders through MathJax', async () => {
    const editor = mount(SYSTEM_OF_EQUATIONS);
    await editor.whenFormulasReady();

    const mathml = findFormula(editor.getJSON())?.attrs?.mathml as string;
    const svg = await renderMathML(mathml);

    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('</svg>');
  });

  it('survives an export/import round trip', async () => {
    const editor = mount(SYSTEM_OF_EQUATIONS);
    await editor.whenFormulasReady();

    const exported = editor.getHTML();
    expect(exported).toContain('data-formula="true"');

    editor.setHTML(exported);
    await editor.whenFormulasReady();

    const mathml = findFormula(editor.getJSON())?.attrs?.mathml as string;
    expect(mathml).toContain('<mfenced');
    expect((mathml.match(/<mtr>/g) ?? []).length).toBe(2);
    expect(editor.getText()).toContain('имеет ровно три различных решения?');
  });

  it('can be reopened in the visual editor', async () => {
    const mathml = findFormula(mount(SYSTEM_OF_EQUATIONS).getJSON())?.attrs?.mathml as string;

    // No TeX annotation here — this MathML came from elsewhere — so this
    // exercises the structural fallback conversion.
    const latex = await mathmlToLatex(mathml);
    expect(latex.length).toBeGreaterThan(0);
    expect(latex).toContain('\\sqrt');
  });

  it('keeps the attributes the sanitizer is asked to preserve', () => {
    const safe = normalizeMathML(
      '<math xmlns="http://www.w3.org/1998/Math/MathML"><mfenced close="" open="{">' +
        '<mtable columnalign="left"><mtr><mtd><mi>x</mi></mtd></mtr></mtable></mfenced></math>',
    );

    expect(safe).toContain('open="{"');
    expect(safe).toContain('columnalign="left"');
  });
});
