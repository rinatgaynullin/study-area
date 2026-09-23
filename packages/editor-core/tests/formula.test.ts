import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildMathML,
  extractFormulaType,
  extractTexAnnotation,
  isMathMLEmpty,
  latexToMathML,
  mathmlToLatex,
  normalizeMathML,
  renderMathML,
  resetMathJax,
  sanitizeMathML,
} from '../src';

const FRACTION_MATHML =
  '<math xmlns="http://www.w3.org/1998/Math/MathML"><mfrac><mrow><mi>a</mi><mo>+</mo><mn>1</mn></mrow><msqrt><mi>b</mi></msqrt></mfrac></math>';

describe('MathML utilities', () => {
  it('wraps LaTeX into annotated MathML', async () => {
    const mathml = await latexToMathML('\\frac{a}{b}', 'math');

    expect(mathml).toContain('<math');
    expect(mathml).toContain('<semantics>');
    expect(mathml).toContain('<mfrac>');
    expect(extractTexAnnotation(mathml)).toBe('\\frac{a}{b}');
    expect(extractFormulaType(mathml)).toBe('math');
  });

  it('marks chemistry formulas so re-editing opens the right mode', async () => {
    const mathml = await latexToMathML('\\mathrm{H}_2\\mathrm{O}', 'chem');

    expect(extractFormulaType(mathml)).toBe('chem');
  });

  it('escapes LaTeX inside the annotation so the MathML stays well-formed', () => {
    const mathml = buildMathML('<mi>a</mi>', 'a < b & c > d', 'math');

    expect(mathml).toContain('a &lt; b &amp; c &gt; d');
    expect(extractTexAnnotation(mathml)).toBe('a < b & c > d');
  });

  it('prefers the embedded TeX annotation when converting back to LaTeX', async () => {
    const mathml = await latexToMathML('\\sqrt[3]{x}', 'math');

    expect(await mathmlToLatex(mathml)).toBe('\\sqrt[3]{x}');
  });

  it('falls back to structural conversion for foreign MathML', async () => {
    const latex = await mathmlToLatex(FRACTION_MATHML);

    expect(latex.replace(/\s+/g, '')).toBe('\\frac{a+1}{\\sqrt{b}}');
  });

  it('detects empty formulas', async () => {
    expect(isMathMLEmpty('')).toBe(true);
    expect(isMathMLEmpty('<math><semantics><mrow></mrow></semantics></math>')).toBe(true);
    expect(isMathMLEmpty(FRACTION_MATHML)).toBe(false);
  });

  it('rejects markup that is not a MathML document', () => {
    expect(normalizeMathML('<p>hello</p>')).toBe('');
    expect(normalizeMathML('not markup at all')).toBe('');
  });

  it('adds the MathML namespace when it is missing', () => {
    const normalized = normalizeMathML('<math><mi>x</mi></math>');

    expect(normalized).toContain('xmlns="http://www.w3.org/1998/Math/MathML"');
  });
});

describe('MathML sanitization', () => {
  it('strips script tags smuggled into MathML', () => {
    const hostile = '<math><mi>x</mi><script>alert(1)</script></math>';
    const safe = sanitizeMathML(hostile);

    expect(safe).not.toContain('script');
    expect(safe).toContain('<mi>x</mi>');
  });

  it('drops annotation-xml, the classic MathML mXSS vector', () => {
    const hostile =
      '<math><semantics><mi>x</mi><annotation-xml encoding="text/html"><img src=x onerror=alert(1)></annotation-xml></semantics></math>';

    const safe = sanitizeMathML(hostile);

    expect(safe).not.toContain('annotation-xml');
    expect(safe).not.toContain('onerror');
  });

  it('removes event handlers and links from MathML elements', () => {
    const hostile = '<math><mi onclick="alert(1)" href="javascript:alert(1)">x</mi></math>';

    const safe = sanitizeMathML(hostile);

    expect(safe).not.toContain('onclick');
    // eslint-disable-next-line no-script-url -- проверяем опасную схему намеренно
    expect(safe).not.toContain('javascript:');
  });

  it('keeps the TeX annotation that makes re-editing lossless', () => {
    const safe = sanitizeMathML(buildMathML('<mi>x</mi>', '\\alpha', 'math'));

    expect(safe).toContain('<annotation');
    expect(extractTexAnnotation(safe)).toBe('\\alpha');
  });
});

describe('MathJax rendering', () => {
  beforeEach(() => {
    resetMathJax();
  });

  it('renders MathML to a self-contained SVG', async () => {
    const svg = await renderMathML(FRACTION_MATHML);

    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('</svg>');
    // `fontCache: 'local'` inlines glyph outlines so exported HTML stands alone.
    expect(svg).toContain('<defs>');
    expect(svg).not.toContain('mjx-container');
  });

  it('returns an empty string for MathML it cannot accept', async () => {
    expect(await renderMathML('<p>nope</p>')).toBe('');
    expect(await renderMathML('')).toBe('');
  });

  it('renders chemistry notation', async () => {
    const mathml = await latexToMathML('2\\mathrm{H}_2+\\mathrm{O}_2', 'chem');
    const svg = await renderMathML(mathml);

    expect(svg.startsWith('<svg')).toBe(true);
  });
});
