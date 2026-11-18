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

// «Частые» ссылаются на шаблоны других категорий, а не копируют их: каталог —
// это множество объектов, и каждый проверяется один раз.
const ALL_TEMPLATES = [
  ...new Map(
    TEMPLATE_CATEGORIES.flatMap((category) =>
      category.templates.map((template) => [template, { ...template, type: category.type }]),
    ),
  ).values(),
];

describe('template catalog', () => {
  it('covers the required math and chemistry categories', () => {
    const ids = TEMPLATE_CATEGORIES.map((category) => category.id);

    [
      'fractions',
      'roots',
      'sums',
      'integrals',
      'limits',
      'matrices',
      'greek',
      'relations',
      'functions',
      'chemReactions',
      'chemStates',
      'chemIsotopes',
      'chemPatterns',
    ].forEach((required) => {
      expect(ids).toContain(required);
    });

    expect(getTemplateCategories('math').length).toBeGreaterThan(0);
    expect(getTemplateCategories('chem').length).toBe(4);
  });

  it('opens math with «Popular» built from existing templates; chemistry has none', () => {
    const [popular] = getTemplateCategories('math');

    expect(popular?.id).toBe('popular');
    expect(popular?.labelKey).toBe('formula_categories_popular');
    expect(popular?.templates.map((template) => template.id)).toEqual([
      'fractions.frac',
      'scripts.square',
      'scripts.sup',
      'scripts.sub',
      'roots.sqrt',
      'roots.nthroot',
      'basic.parens',
      'basic.abs',
      'basic.times',
      'basic.div',
      'basic.pm',
      'basic.degree',
      'relations.le',
      'relations.ge',
      'relations.ne',
      'relations.approx',
      'greek.pi',
    ]);

    // Те же объекты, что в исходных категориях, — не копии.
    popular?.templates.forEach((template) => {
      expect(findTemplate(template.id)).toBe(template);

      const home = TEMPLATE_CATEGORIES.find((category) => category.id === template.category);

      expect(home?.templates).toContain(template);
    });

    expect(getTemplateCategories('chem')[0]?.id).toBe('chemReactions');
    expect(getTemplateCategories('chem').map((category) => category.id)).not.toContain('popular');
  });

  it('has unique template ids and resolves them by id', () => {
    const ids = ALL_TEMPLATES.map((template) => template.id);

    expect(new Set(ids).size).toBe(ids.length);

    ids.forEach((id) => {
      expect(findTemplate(id)?.id).toBe(id);
    });

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
