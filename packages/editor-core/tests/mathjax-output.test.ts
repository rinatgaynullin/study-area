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

  /**
   * Размер запекается в пикселях. Браузерный `ex` считается по x-height
   * унаследованного шрифта, поэтому в ex одна и та же формула визуально
   * скачет: в абзаце она была 16.6px, а в заголовке 29.5px.
   */
  it('фиксирует размер в пикселях, а не в ex', async () => {
    const svg = await renderMathML(await latexToMathML('x', 'math'));

    expect(svg).toMatch(/width="[\d.]+px"/);
    expect(svg).toMatch(/height="[\d.]+px"/);
    expect(svg).not.toMatch(/(width|height)="[\d.]+ex"/);
    // Смещение базовой линии страдало ровно так же.
    expect(svg).not.toMatch(/vertical-align:\s*[-\d.]+ex/);
  });

  it('масштабирует формулу пропорционально запрошенному кеглю', async () => {
    const mathml = await latexToMathML('x', 'math');
    const normal = await renderMathML(mathml);
    const doubled = await renderMathML(mathml, { fontSizePx: 30 });

    const widthOf = (svg: string) => Number.parseFloat(/width="([\d.]+)px"/.exec(svg)?.[1] ?? '0');

    expect(widthOf(normal)).toBeGreaterThan(0);
    // Кегль по умолчанию — 15px, значит 30px даёт ровно вдвое больше.
    expect(widthOf(doubled) / widthOf(normal)).toBeCloseTo(2, 1);
  });

  it('не выдаёт один и тот же SVG для разных кеглей', async () => {
    const mathml = await latexToMathML('y', 'math');

    expect(await renderMathML(mathml, { fontSizePx: 15 })).not.toBe(
      await renderMathML(mathml, { fontSizePx: 24 }),
    );
  });
});
