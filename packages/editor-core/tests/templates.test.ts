import { describe, expect, it } from 'vitest';
import {
  TEMPLATE_CATEGORIES,
  findTemplate,
  getTemplateCategories,
  latexToMathML,
  normalizeMathML,
  renderMathML,
  repairMathML,
} from '../src';

const ALL_TEMPLATES = TEMPLATE_CATEGORIES.flatMap((category) =>
  category.templates.map((template) => ({ ...template, type: category.type })),
);

describe('template catalog', () => {
  it('covers the required math and chemistry categories', () => {
    const ids = TEMPLATE_CATEGORIES.map((category) => category.id);

    for (const required of [
      'fractions', 'roots', 'sums', 'integrals', 'limits',
      'matrices', 'greek', 'relations', 'functions',
      'chemReactions', 'chemStates', 'chemIsotopes', 'chemPatterns',
    ]) {
      expect(ids).toContain(required);
    }

    expect(getTemplateCategories('math').length).toBeGreaterThan(0);
    expect(getTemplateCategories('chem').length).toBe(4);
  });

  it('has unique template ids and resolves them by id', () => {
    const ids = ALL_TEMPLATES.map((template) => template.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(findTemplate(ids[0])?.id).toBe(ids[0]);
    expect(findTemplate('does.not.exist')).toBeUndefined();
  });

  // Guards against MathLive emitting structurally invalid MathML for a command
  // (as it does for \longrightarrow and \xrightarrow), which makes MathJax throw.
  it.each(ALL_TEMPLATES.map((template) => [template.id, template] as const))(
    'renders preview for %s',
    async (_id, template) => {
      const mathml = await latexToMathML(template.preview, template.type);
      expect(mathml, 'template produced no MathML').not.toBe('');

      const normalized = normalizeMathML(mathml);
      expect(normalized, 'template MathML was rejected').not.toBe('');

      const svg = await renderMathML(normalized);
      expect(svg.startsWith('<svg'), 'template did not render to SVG').toBe(true);
    },
  );
});

describe('MathML repair', () => {
  it('wraps bare operator text that MathLive leaves inside script elements', () => {
    const broken = '<math><munder>→</munder></math>';
    const repaired = repairMathML(broken);

    expect(repaired).toContain('<mo>→</mo>');
  });

  it('fills in missing children so script elements keep their required arity', () => {
    const repaired = repairMathML('<math><msubsup><mn>6</mn><mn>14</mn></msubsup></math>');
    const children = repaired.match(/<(mn|mrow)\b/g) ?? [];

    expect(children.length).toBeGreaterThanOrEqual(3);
  });

  it('leaves valid MathML untouched apart from serialization', () => {
    const valid = '<math><mfrac><mi>a</mi><mi>b</mi></mfrac></math>';
    expect(repairMathML(valid)).toContain('<mfrac><mi>a</mi><mi>b</mi></mfrac>');
  });

  it('keeps text inside token elements', () => {
    expect(repairMathML('<math><mtext>кат.</mtext></math>')).toContain('<mtext>кат.</mtext>');
  });
});
