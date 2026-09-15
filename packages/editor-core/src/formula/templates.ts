import type { FormulaType } from '../types';

export type TemplateCategoryId =
  | 'basic'
  | 'fractions'
  | 'roots'
  | 'scripts'
  | 'sums'
  | 'integrals'
  | 'limits'
  | 'matrices'
  | 'greek'
  | 'relations'
  | 'functions'
  | 'chemReactions'
  | 'chemStates'
  | 'chemIsotopes'
  | 'chemPatterns';

export interface FormulaTemplate {
  id: string;
  category: TemplateCategoryId;
  /** LaTeX inserted into the mathfield; `\placeholder{}` marks tab stops. */
  latex: string;
  /** Concrete LaTeX rendered in the gallery, where empty boxes read poorly. */
  preview: string;
}

export interface TemplateCategory {
  id: TemplateCategoryId;
  type: FormulaType;
  /** i18n key under `formula.categories`. */
  labelKey: string;
  templates: FormulaTemplate[];
}

function t(
  category: TemplateCategoryId,
  id: string,
  latex: string,
  preview = latex,
): FormulaTemplate {
  return { id: `${category}.${id}`, category, latex, preview };
}

const P = '\\placeholder{}';

const MATH_CATEGORIES: TemplateCategory[] = [
  {
    id: 'basic',
    type: 'math',
    labelKey: 'formula.categories.basic',
    templates: [
      t('basic', 'plus', 'a+b'),
      t('basic', 'minus', 'a-b'),
      t('basic', 'times', 'a\\times b'),
      t('basic', 'cdot', 'a\\cdot b'),
      t('basic', 'div', 'a\\div b'),
      t('basic', 'pm', 'a\\pm b'),
      t('basic', 'mp', 'a\\mp b'),
      t('basic', 'parens', `\\left(${P}\\right)`, '\\left(a\\right)'),
      t('basic', 'brackets', `\\left[${P}\\right]`, '\\left[a\\right]'),
      t('basic', 'braces', `\\left\\{${P}\\right\\}`, '\\left\\{a\\right\\}'),
      t('basic', 'abs', `\\left|${P}\\right|`, '\\left|a\\right|'),
      t('basic', 'norm', `\\left\\|${P}\\right\\|`, '\\left\\|a\\right\\|'),
      t('basic', 'infty', '\\infty'),
      t('basic', 'degree', '90^\\circ'),
      t('basic', 'percent', '100\\%'),
    ],
  },
  {
    id: 'fractions',
    type: 'math',
    labelKey: 'formula.categories.fractions',
    templates: [
      t('fractions', 'frac', `\\frac{${P}}{${P}}`, '\\frac{a}{b}'),
      t('fractions', 'dfrac', `\\dfrac{${P}}{${P}}`, '\\dfrac{a}{b}'),
      t('fractions', 'nested', `\\frac{${P}}{\\frac{${P}}{${P}}}`, '\\frac{a}{\\frac{b}{c}}'),
      t('fractions', 'mixed', `${P}\\frac{${P}}{${P}}`, '2\\frac{1}{3}'),
      t('fractions', 'binom', `\\binom{${P}}{${P}}`, '\\binom{n}{k}'),
      t('fractions', 'continued', '\\cfrac{1}{1+\\cfrac{1}{x}}'),
      t('fractions', 'derivative', '\\frac{dy}{dx}'),
      t('fractions', 'partial', '\\frac{\\partial f}{\\partial x}'),
    ],
  },
  {
    id: 'roots',
    type: 'math',
    labelKey: 'formula.categories.roots',
    templates: [
      t('roots', 'sqrt', `\\sqrt{${P}}`, '\\sqrt{a}'),
      t('roots', 'nthroot', `\\sqrt[${P}]{${P}}`, '\\sqrt[n]{a}'),
      t('roots', 'cbrt', `\\sqrt[3]{${P}}`, '\\sqrt[3]{a}'),
      t('roots', 'sqrtfrac', `\\sqrt{\\frac{${P}}{${P}}}`, '\\sqrt{\\frac{a}{b}}'),
      t('roots', 'quadratic', '\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}'),
    ],
  },
  {
    id: 'scripts',
    type: 'math',
    labelKey: 'formula.categories.scripts',
    templates: [
      t('scripts', 'sup', `${P}^{${P}}`, 'a^{n}'),
      t('scripts', 'sub', `${P}_{${P}}`, 'a_{n}'),
      t('scripts', 'subsup', `${P}_{${P}}^{${P}}`, 'a_{i}^{n}'),
      t('scripts', 'square', `${P}^{2}`, 'a^{2}'),
      t('scripts', 'cube', `${P}^{3}`, 'a^{3}'),
      // \overline, \underline, \overbrace and \underbrace are omitted: MathLive
      // drops their body when exporting MathML (see LIMITATIONS.md).
      t('scripts', 'bar', `\\bar{${P}}`, '\\bar{AB}'),
      t('scripts', 'vec', `\\vec{${P}}`, '\\vec{v}'),
      t('scripts', 'hat', `\\hat{${P}}`, '\\hat{x}'),
      t('scripts', 'tilde', `\\tilde{${P}}`, '\\tilde{x}'),
      t('scripts', 'dot', `\\dot{${P}}`, '\\dot{x}'),
      t('scripts', 'ddot', `\\ddot{${P}}`, '\\ddot{x}'),
    ],
  },
  {
    id: 'sums',
    type: 'math',
    labelKey: 'formula.categories.sums',
    templates: [
      t('sums', 'sum', `\\sum_{${P}}^{${P}}${P}`, '\\sum_{i=1}^{n}a_i'),
      t('sums', 'sumInf', '\\sum_{n=1}^{\\infty}a_n'),
      t('sums', 'prod', `\\prod_{${P}}^{${P}}${P}`, '\\prod_{i=1}^{n}a_i'),
      t('sums', 'coprod', `\\coprod_{${P}}^{${P}}${P}`, '\\coprod_{i=1}^{n}a_i'),
      t('sums', 'bigcup', `\\bigcup_{${P}}^{${P}}${P}`, '\\bigcup_{i=1}^{n}A_i'),
      t('sums', 'bigcap', `\\bigcap_{${P}}^{${P}}${P}`, '\\bigcap_{i=1}^{n}A_i'),
      t('sums', 'sumDouble', '\\sum_{i=1}^{n}\\sum_{j=1}^{m}a_{ij}'),
    ],
  },
  {
    id: 'integrals',
    type: 'math',
    labelKey: 'formula.categories.integrals',
    templates: [
      t('integrals', 'indefinite', `\\int ${P}\\,d${P}`, '\\int f(x)\\,dx'),
      t('integrals', 'definite', `\\int_{${P}}^{${P}}${P}\\,d${P}`, '\\int_{a}^{b}f(x)\\,dx'),
      t('integrals', 'double', `\\iint_{${P}}${P}`, '\\iint_{D}f\\,dA'),
      t('integrals', 'triple', `\\iiint_{${P}}${P}`, '\\iiint_{V}f\\,dV'),
      t('integrals', 'contour', `\\oint_{${P}}${P}`, '\\oint_{C}f\\,ds'),
      t('integrals', 'improper', '\\int_{0}^{\\infty}e^{-x}\\,dx'),
    ],
  },
  {
    id: 'limits',
    type: 'math',
    labelKey: 'formula.categories.limits',
    templates: [
      t('limits', 'lim', `\\lim_{${P}\\to ${P}}${P}`, '\\lim_{x\\to 0}f(x)'),
      t('limits', 'limInf', '\\lim_{n\\to\\infty}a_n'),
      t('limits', 'limSide', '\\lim_{x\\to a^{+}}f(x)'),
      t('limits', 'limsup', '\\limsup_{n\\to\\infty}a_n'),
      t('limits', 'liminf', '\\liminf_{n\\to\\infty}a_n'),
      t('limits', 'max', `\\max_{${P}}${P}`, '\\max_{x\\in S}f(x)'),
      t('limits', 'min', `\\min_{${P}}${P}`, '\\min_{x\\in S}f(x)'),
    ],
  },
  {
    id: 'matrices',
    type: 'math',
    labelKey: 'formula.categories.matrices',
    templates: [
      t(
        'matrices',
        'pmatrix2',
        `\\begin{pmatrix}${P} & ${P}\\\\ ${P} & ${P}\\end{pmatrix}`,
        '\\begin{pmatrix}a & b\\\\ c & d\\end{pmatrix}',
      ),
      t(
        'matrices',
        'bmatrix2',
        `\\begin{bmatrix}${P} & ${P}\\\\ ${P} & ${P}\\end{bmatrix}`,
        '\\begin{bmatrix}a & b\\\\ c & d\\end{bmatrix}',
      ),
      t(
        'matrices',
        'vmatrix2',
        `\\begin{vmatrix}${P} & ${P}\\\\ ${P} & ${P}\\end{vmatrix}`,
        '\\begin{vmatrix}a & b\\\\ c & d\\end{vmatrix}',
      ),
      t(
        'matrices',
        'pmatrix3',
        '\\begin{pmatrix}a & b & c\\\\ d & e & f\\\\ g & h & i\\end{pmatrix}',
      ),
      t('matrices', 'cases', '\\begin{cases}x, & x\\ge 0\\\\ -x, & x<0\\end{cases}'),
      t('matrices', 'column', '\\begin{pmatrix}x_1\\\\ x_2\\\\ x_3\\end{pmatrix}'),
    ],
  },
  {
    id: 'greek',
    type: 'math',
    labelKey: 'formula.categories.greek',
    templates: [
      t('greek', 'alpha', '\\alpha'),
      t('greek', 'beta', '\\beta'),
      t('greek', 'gamma', '\\gamma'),
      t('greek', 'delta', '\\delta'),
      t('greek', 'epsilon', '\\varepsilon'),
      t('greek', 'zeta', '\\zeta'),
      t('greek', 'eta', '\\eta'),
      t('greek', 'theta', '\\theta'),
      t('greek', 'lambda', '\\lambda'),
      t('greek', 'mu', '\\mu'),
      t('greek', 'nu', '\\nu'),
      t('greek', 'xi', '\\xi'),
      t('greek', 'pi', '\\pi'),
      t('greek', 'rho', '\\rho'),
      t('greek', 'sigma', '\\sigma'),
      t('greek', 'tau', '\\tau'),
      t('greek', 'phi', '\\varphi'),
      t('greek', 'chi', '\\chi'),
      t('greek', 'psi', '\\psi'),
      t('greek', 'omega', '\\omega'),
      t('greek', 'Gamma', '\\Gamma'),
      t('greek', 'Delta', '\\Delta'),
      t('greek', 'Theta', '\\Theta'),
      t('greek', 'Lambda', '\\Lambda'),
      t('greek', 'Sigma', '\\Sigma'),
      t('greek', 'Phi', '\\Phi'),
      t('greek', 'Psi', '\\Psi'),
      t('greek', 'Omega', '\\Omega'),
    ],
  },
  {
    id: 'relations',
    type: 'math',
    labelKey: 'formula.categories.relations',
    templates: [
      t('relations', 'ne', 'a\\ne b'),
      t('relations', 'approx', 'a\\approx b'),
      t('relations', 'equiv', 'a\\equiv b'),
      t('relations', 'le', 'a\\le b'),
      t('relations', 'ge', 'a\\ge b'),
      t('relations', 'll', 'a\\ll b'),
      t('relations', 'gg', 'a\\gg b'),
      t('relations', 'propto', 'a\\propto b'),
      t('relations', 'sim', 'a\\sim b'),
      t('relations', 'in', 'x\\in A'),
      t('relations', 'notin', 'x\\notin A'),
      t('relations', 'subset', 'A\\subset B'),
      t('relations', 'subseteq', 'A\\subseteq B'),
      t('relations', 'cup', 'A\\cup B'),
      t('relations', 'cap', 'A\\cap B'),
      t('relations', 'setminus', 'A\\setminus B'),
      t('relations', 'implies', 'a\\implies b'),
      t('relations', 'iff', 'a\\Longleftrightarrow b'),
      t('relations', 'forall', '\\forall x'),
      t('relations', 'exists', '\\exists x'),
      t('relations', 'perp', 'a\\perp b'),
      t('relations', 'parallel', 'a\\parallel b'),
    ],
  },
  {
    id: 'functions',
    type: 'math',
    labelKey: 'formula.categories.functions',
    templates: [
      t('functions', 'sin', `\\sin ${P}`, '\\sin x'),
      t('functions', 'cos', `\\cos ${P}`, '\\cos x'),
      t('functions', 'tan', `\\tan ${P}`, '\\tan x'),
      t('functions', 'cot', `\\cot ${P}`, '\\cot x'),
      t('functions', 'arcsin', `\\arcsin ${P}`, '\\arcsin x'),
      t('functions', 'arccos', `\\arccos ${P}`, '\\arccos x'),
      t('functions', 'arctan', `\\arctan ${P}`, '\\arctan x'),
      t('functions', 'log', `\\log_{${P}}${P}`, '\\log_{a}x'),
      t('functions', 'ln', `\\ln ${P}`, '\\ln x'),
      t('functions', 'lg', `\\lg ${P}`, '\\lg x'),
      t('functions', 'exp', `e^{${P}}`, 'e^{x}'),
      t('functions', 'fx', `f\\left(${P}\\right)`, 'f\\left(x\\right)'),
      t('functions', 'gcd', '\\gcd(a,b)'),
      t('functions', 'det', '\\det A'),
      t('functions', 'factorial', 'n!'),
    ],
  },
];

/**
 * Chemistry is expressed with the same MathML pipeline: upright element symbols,
 * sub/superscripts for counts and charges, and standard reaction arrows. This
 * covers equations and notation — structural molecule drawing is out of scope
 * for v1 (see LIMITATIONS.md).
 */
const CHEM_CATEGORIES: TemplateCategory[] = [
  {
    id: 'chemReactions',
    type: 'chem',
    labelKey: 'formula.categories.chemReactions',
    templates: [
      t('chemReactions', 'yields', `${P}\\rightarrow ${P}`, '\\mathrm{A}\\rightarrow\\mathrm{B}'),
      t(
        'chemReactions',
        'equilibrium',
        `${P}\\rightleftharpoons ${P}`,
        '\\mathrm{A}\\rightleftharpoons\\mathrm{B}',
      ),
      t('chemReactions', 'reversible', `${P}\\rightleftarrows ${P}`, '\\mathrm{A}\\rightleftarrows\\mathrm{B}'),
      t(
        'chemReactions',
        'catalyst',
        // \xrightarrow exports as invalid MathML from MathLive; \overset does not.
        `${P}\\overset{${P}}{\\rightarrow}${P}`,
        '\\mathrm{A}\\overset{\\Delta}{\\rightarrow}\\mathrm{B}',
      ),
      t('chemReactions', 'water', '2\\mathrm{H}_2+\\mathrm{O}_2\\rightarrow 2\\mathrm{H}_2\\mathrm{O}'),
      t(
        'chemReactions',
        'neutralization',
        '\\mathrm{HCl}+\\mathrm{NaOH}\\rightarrow\\mathrm{NaCl}+\\mathrm{H}_2\\mathrm{O}',
      ),
      t(
        'chemReactions',
        'photosynthesis',
        '6\\mathrm{CO}_2+6\\mathrm{H}_2\\mathrm{O}\\rightarrow\\mathrm{C}_6\\mathrm{H}_{12}\\mathrm{O}_6+6\\mathrm{O}_2',
      ),
      t('chemReactions', 'precipitate', `${P}\\downarrow`, '\\mathrm{AgCl}\\downarrow'),
      t('chemReactions', 'gas', `${P}\\uparrow`, '\\mathrm{CO}_2\\uparrow'),
    ],
  },
  {
    id: 'chemStates',
    type: 'chem',
    labelKey: 'formula.categories.chemStates',
    templates: [
      t('chemStates', 'solid', `${P}(\\mathrm{s})`, '\\mathrm{NaCl}(\\mathrm{s})'),
      t('chemStates', 'liquid', `${P}(\\mathrm{l})`, '\\mathrm{H}_2\\mathrm{O}(\\mathrm{l})'),
      t('chemStates', 'gas', `${P}(\\mathrm{g})`, '\\mathrm{O}_2(\\mathrm{g})'),
      t('chemStates', 'aqueous', `${P}(\\mathrm{aq})`, '\\mathrm{NaCl}(\\mathrm{aq})'),
      t('chemStates', 'cation', `\\mathrm{${P}}^{+}`, '\\mathrm{Na}^{+}'),
      t('chemStates', 'anion', `\\mathrm{${P}}^{-}`, '\\mathrm{Cl}^{-}'),
      t('chemStates', 'charge2plus', '\\mathrm{Ca}^{2+}'),
      t('chemStates', 'charge2minus', '\\mathrm{SO}_4^{2-}'),
    ],
  },
  {
    id: 'chemIsotopes',
    type: 'chem',
    labelKey: 'formula.categories.chemIsotopes',
    templates: [
      t('chemIsotopes', 'isotope', `{\\,}^{${P}}_{${P}}\\mathrm{${P}}`, '{\\,}^{14}_{6}\\mathrm{C}'),
      t('chemIsotopes', 'massNumber', `{\\,}^{${P}}\\mathrm{${P}}`, '{\\,}^{14}\\mathrm{C}'),
      t('chemIsotopes', 'uranium', '{\\,}^{235}_{92}\\mathrm{U}'),
      t('chemIsotopes', 'alpha', '{\\,}^{4}_{2}\\mathrm{He}'),
      t('chemIsotopes', 'beta', '{\\,}^{0}_{-1}\\mathrm{e}'),
      t('chemIsotopes', 'neutron', '{\\,}^{1}_{0}\\mathrm{n}'),
      t(
        'chemIsotopes',
        'decay',
        '{\\,}^{238}_{92}\\mathrm{U}\\rightarrow{\\,}^{234}_{90}\\mathrm{Th}+{\\,}^{4}_{2}\\mathrm{He}',
      ),
    ],
  },
  {
    id: 'chemPatterns',
    type: 'chem',
    labelKey: 'formula.categories.chemPatterns',
    templates: [
      t('chemPatterns', 'water', '\\mathrm{H}_2\\mathrm{O}'),
      t('chemPatterns', 'co2', '\\mathrm{CO}_2'),
      t('chemPatterns', 'sulfuric', '\\mathrm{H}_2\\mathrm{SO}_4'),
      t('chemPatterns', 'glucose', '\\mathrm{C}_6\\mathrm{H}_{12}\\mathrm{O}_6'),
      t('chemPatterns', 'ammonia', '\\mathrm{NH}_3'),
      t('chemPatterns', 'methane', '\\mathrm{CH}_4'),
      t('chemPatterns', 'ethanol', '\\mathrm{C}_2\\mathrm{H}_5\\mathrm{OH}'),
      t('chemPatterns', 'carbonate', '\\mathrm{CaCO}_3'),
      t('chemPatterns', 'hydroxide', '\\mathrm{NaOH}'),
      t('chemPatterns', 'benzene', '\\mathrm{C}_6\\mathrm{H}_6'),
      t('chemPatterns', 'subscript', `\\mathrm{${P}}_{${P}}`, '\\mathrm{X}_{n}'),
      t('chemPatterns', 'upright', `\\mathrm{${P}}`, '\\mathrm{Fe}'),
    ],
  },
];

export const TEMPLATE_CATEGORIES: TemplateCategory[] = [...MATH_CATEGORIES, ...CHEM_CATEGORIES];

export function getTemplateCategories(type: FormulaType): TemplateCategory[] {
  return TEMPLATE_CATEGORIES.filter((category) => category.type === type);
}

export function findTemplate(id: string): FormulaTemplate | undefined {
  for (const category of TEMPLATE_CATEGORIES) {
    const found = category.templates.find((template) => template.id === id);
    if (found) return found;
  }
  return undefined;
}
