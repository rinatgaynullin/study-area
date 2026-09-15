import { beforeEach, describe, expect, it } from 'vitest';
import { latexToMathML, renderMathML, resetMathJax } from '../src';

beforeEach(() => {
  resetMathJax();
});

function countRoots(svg: string): number {
  return (svg.match(/<svg\b/g) ?? []).length;
}

describe('MathJax SVG output', () => {
  // MathJax 4 breaks lines on its own guessed width, which would split one
  // formula into several sibling <svg> roots inside an inline atom.
  it('emits exactly one SVG root per formula', async () => {
    for (const latex of [
      'a^2+b^2=c^2',
      '\\int_{0}^{\\infty}e^{-x^2}\\,dx=\\frac{\\sqrt{\\pi}}{2}',
      '2\\mathrm{H}_2+\\mathrm{O}_2\\rightarrow 2\\mathrm{H}_2\\mathrm{O}',
      '\\sum_{i=1}^{n}\\sum_{j=1}^{m}a_{ij}+\\prod_{k=1}^{p}b_k-\\frac{1}{2}\\int f(x)\\,dx',
    ]) {
      const svg = await renderMathML(await latexToMathML(latex, 'math'));
      expect(countRoots(svg), `"${latex}" should render as a single SVG`).toBe(1);
    }
  });

  it('inlines glyph outlines so exported HTML needs no MathJax runtime', async () => {
    const svg = await renderMathML(await latexToMathML('\\frac{a}{b}', 'math'));

    expect(svg).toContain('<defs>');
    expect(svg).toContain('<path');
    expect(svg).toContain('<use');
  });

  it('carries the baseline offset that keeps formulas aligned with the text', async () => {
    const svg = await renderMathML(await latexToMathML('x_1', 'math'));
    expect(svg).toContain('vertical-align');
  });

  it('serves repeated renders from cache', async () => {
    const mathml = await latexToMathML('\\alpha', 'math');

    const first = await renderMathML(mathml);
    const second = await renderMathML(mathml);

    expect(second).toBe(first);
  });

  // Sizes are in `ex`, so scaling is a font-size concern on the host element,
  // not a second render. One cached SVG therefore serves every scale.
  it('sizes the SVG in ex units so a host can scale it with CSS', async () => {
    const svg = await renderMathML(await latexToMathML('x', 'math'));

    expect(svg).toMatch(/width="[\d.]+ex"/);
    expect(svg).toMatch(/height="[\d.]+ex"/);
  });
});
