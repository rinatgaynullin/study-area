import { describe, expect, it } from 'vitest';
import {
  evaluateFunction,
  functionLabelText,
  functionParts,
  functionText,
  parseFunction,
  sameLabel,
  type FormulaPart,
  type FunctionNode,
} from '../src/builders/function-expr';
import { PLOTS_MESSAGES } from '../src/builders/plots-messages';
import { toLatexMath } from '../src/tikz/common';

const astOf = (text: string): FunctionNode => {
  const parsed = parseFunction(text);

  if (!parsed.ok) throw new Error(`«${text}» не разобрано: ${parsed.error.key} @${parsed.position}`);

  return parsed.ast;
};

const valuesOf = (text: string, xs: number[], params: Record<string, number> = {}): number[] => {
  const ast = astOf(text);

  return xs.map((x) => evaluateFunction(ast, x, params));
};

describe('разбор и вычисление записи', () => {
  const XS = [-2, -0.5, 0, 1, 3];

  /** Запись → функция, с которой сверяются значения в точках `XS`. */
  const TABLE: Array<[string, (x: number) => number]> = [
    ['2', () => 2],
    ['0.5x', (x) => 0.5 * x],
    ['0,5x', (x) => 0.5 * x],
    ['x^2 - 3x + 1', (x) => x * x - 3 * x + 1],
    ['x^2 − 3x + 1', (x) => x * x - 3 * x + 1],
    ['2x', (x) => 2 * x],
    ['2(x+1)', (x) => 2 * (x + 1)],
    ['(x+1)(x-1)', (x) => (x + 1) * (x - 1)],
    ['-x^2', (x) => -(x * x)],
    ['-x²', (x) => -(x * x)],
    ['x²', (x) => x * x],
    ['x³ + x', (x) => x ** 3 + x],
    ['2^x', (x) => 2 ** x],
    ['2^-x', (x) => 2 ** -x],
    ['2^3^x', (x) => 2 ** (3 ** x)],
    ['x^(1/3)', (x) => Math.cbrt(x)],
    ['3 * x · 2 × x', (x) => 6 * x * x],
    ['x / 2 : 2', (x) => x / 4],
    ['|x - 2|', (x) => Math.abs(x - 2)],
    ['abs(x)', (x) => Math.abs(x)],
    ['2|x|+|x-1|', (x) => 2 * Math.abs(x) + Math.abs(x - 1)],
    ['||x| - 1|', (x) => Math.abs(Math.abs(x) - 1)],
    ['cbrt(x)', (x) => Math.cbrt(x)],
    ['sin(x)', (x) => Math.sin(x)],
    ['sin x', (x) => Math.sin(x)],
    ['sin 2x', (x) => Math.sin(2 * x)],
    ['2sin(x)', (x) => 2 * Math.sin(x)],
    ['x sin(x)', (x) => x * Math.sin(x)],
    ['xsinx', (x) => x * Math.sin(x)],
    ['sin x cos x', (x) => Math.sin(x) * Math.cos(x)],
    ['sin x + 1', (x) => Math.sin(x) + 1],
    ['sin²x', (x) => Math.sin(x) ** 2],
    ['SIN(X)', (x) => Math.sin(x)],
    ['cos(πx)', (x) => Math.cos(Math.PI * x)],
    ['tan x + tg x', (x) => 2 * Math.tan(x)],
    ['atan(x) - arctg x', () => 0],
    ['arcctg(x)', (x) => Math.PI / 2 - Math.atan(x)],
    ['exp(x) - e^x', () => 0],
    ['pi', () => Math.PI],
    ['2pix', (x) => 2 * Math.PI * x],
    ['y = x + 1', (x) => x + 1],
    ['f(x) = x^2', (x) => x * x],
    ['у = х', (x) => x],
  ];

  it.each(TABLE)('%s', (text, expected) => {
    valuesOf(text, XS).forEach((value, index) => {
      const x = XS[index] ?? 0;
      const want = expected(x);

      if (Number.isNaN(want)) expect(value).toBeNaN();
      else expect(value).toBeCloseTo(want, 9);
    });
  });

  it('корень, логарифмы: вне области определения — NaN, без исключений', () => {
    expect(valuesOf('sqrt(x)', [-1, 0, 4])).toEqual([NaN, 0, 2]);
    expect(valuesOf('√x', [-1, 9])).toEqual([NaN, 3]);
    expect(valuesOf('√(x+1)', [-2, 3])).toEqual([NaN, 2]);
    expect(valuesOf('ln x', [-1, 0, Math.E])).toEqual([NaN, NaN, 1]);
    expect(valuesOf('lg(x)', [0, 100])).toEqual([NaN, 2]);
    expect(valuesOf('log(2; x)', [0, 8])).toEqual([NaN, 3]);
    expect(valuesOf('log(2, x)', [4])).toEqual([2]);
    expect(valuesOf('1/x', [0, 2])).toEqual([NaN, 0.5]);
    expect(valuesOf('1/(x - 1)', [1])).toEqual([NaN]);
    expect(valuesOf('arcsin(x)', [2])).toEqual([NaN]);
    expect(valuesOf('x^0.5', [-4])).toEqual([NaN]);
    expect(valuesOf('ctg x', [0])).toEqual([NaN]);
  });

  it('буквы-параметры: в порядке появления, без x, y и e; без значения — 1', () => {
    const parsed = parseFunction('kx + b + a*x^2 + k');

    expect(parsed.ok && parsed.params).toEqual(['k', 'b', 'a']);
    expect(valuesOf('a*x^2 + b', [2], { a: 3, b: -1 })).toEqual([11]);
    expect(valuesOf('kx + b', [2])).toEqual([3]);
    expect(valuesOf('a sin(b x)', [Math.PI / 2], { a: 2, b: 1 })).toEqual([2]);
    expect(parseFunction('e^x').ok && parseFunction('e^x')).toMatchObject({ params: [] });
  });

  /** Запись → ключ сообщения, позиция и непонятое слово. */
  const ERRORS: Array<[string, string, number, string?]> = [
    ['', 'drawings_plots_fn_error_empty', 0],
    ['   ', 'drawings_plots_fn_error_empty', 3],
    ['y = ', 'drawings_plots_fn_error_empty', 4],
    ['x^', 'drawings_plots_fn_error_operand', 2],
    ['2 +', 'drawings_plots_fn_error_operand', 3],
    ['*x', 'drawings_plots_fn_error_operand', 0],
    ['(x + 1', 'drawings_plots_fn_error_paren', 0],
    ['2(x(x + 1)', 'drawings_plots_fn_error_paren', 1],
    ['x + 1)', 'drawings_plots_fn_error_extra_paren', 5],
    ['|x - 2', 'drawings_plots_fn_error_abs', 0],
    ['foo(x)', 'drawings_plots_fn_error_word', 0, 'foo'],
    ['sqr(x)', 'drawings_plots_fn_error_word', 0, 'sqr'],
    ['cosh x', 'drawings_plots_fn_error_word', 0, 'cosh'],
    ['x + y', 'drawings_plots_fn_error_word', 4, 'y'],
    ['2 # x', 'drawings_plots_fn_error_word', 2, '#'],
    ['синус(x)', 'drawings_plots_fn_error_word', 0, 'синус'],
    ['2 3', 'drawings_plots_fn_error_operator', 2],
    ['log(x)', 'drawings_plots_fn_error_log', 0],
    ['x = 2', 'drawings_plots_fn_error_left', 0],
  ];

  it.each(ERRORS)('ошибка в «%s»: %s @%i', (text, key, position, word) => {
    const parsed = parseFunction(text);

    expect(parsed).toMatchObject({ ok: false, error: { key, ...(word ? { word } : {}) }, position });
    // Каждому ключу — перевод на обоих языках.
    expect(PLOTS_MESSAGES.ru?.[key]).toBeTruthy();
    expect(PLOTS_MESSAGES.en?.[key]).toBeTruthy();
  });

  it('в записи нет вызова eval и new Function', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(process.cwd(), 'packages/editor-drawings/src/builders/function-expr.ts'), 'utf8');

    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    expect(code).not.toMatch(/\beval\b|\bFunction\s*\(|new\s+Function/);
  });
});

/** Части одной строкой: так видно, какие части получились. */
const show = (parts: FormulaPart[]): string =>
  parts
    .map((part) => {
      switch (part.kind) {
        case 'text':
          return part.text;
        case 'var':
          return `<${part.name}>`;
        case 'sup':
          return `^[${show(part.body)}]`;
        case 'sub':
          return `_[${show(part.body)}]`;
        case 'frac':
          return `[${show(part.num)} / ${show(part.den)}]`;
        case 'sqrt':
          return `√${part.index ?? ''}[${show(part.body)}]`;
        case 'abs':
          return `|[${show(part.body)}]|`;
        default:
          return '';
      }
    })
    .join('');

describe('запись для карточки и для подписи', () => {
  /** Запись → части карточки, строка для чтения, подпись на чертеже. */
  const TABLE: Array<[string, string, string, string]> = [
    ['x^2 - 3x + 1', '<x>^[2] − 3<x> + 1', 'y = x² − 3x + 1', 'y = x^2 - 3x + 1'],
    ['sin(x)', 'sin(<x>)', 'y = sin(x)', 'y = sin(x)'],
    ['|x - 2|', '|[<x> − 2]|', 'y = |x − 2|', 'y = |x - 2|'],
    ['1/x', '[1 / <x>]', 'y = 1/x', 'y = 1/x'],
    ['2/(x-1)+1', '[2 / <x> − 1] + 1', 'y = 2/(x − 1) + 1', 'y = 2/(x - 1) + 1'],
    ['1/2x', '[1 / 2]<x>', 'y = 1/2x', 'y = (1/2)x'],
    ['1/(2x)', '[1 / 2<x>]', 'y = 1/(2x)', 'y = 1/(2x)'],
    ['sqrt(x+1)', '√[<x> + 1]', 'y = √(x + 1)', 'y = √(x + 1)'],
    ['√x', '√[<x>]', 'y = √x', 'y = √x'],
    ['cbrt(x)', '√3[<x>]', 'y = ∛x', 'y = ∛x'],
    ['2^x', '2^[<x>]', 'y = 2ˣ', 'y = 2^x'],
    ['2^(-x)', '2^[−<x>]', 'y = 2⁻ˣ', 'y = 2^{-x}'],
    ['x^(1/3)', '<x>^[[1 / 3]]', 'y = x^(1/3)', 'y = x^{1/3}'],
    ['x^10', '<x>^[10]', 'y = x¹⁰', 'y = x^{10}'],
    ['(x+1)^2', '(<x> + 1)^[2]', 'y = (x + 1)²', 'y = (x + 1)^2'],
    ['-x^2', '−<x>^[2]', 'y = −x²', 'y = -x^2'],
    ['-(x+1)', '−(<x> + 1)', 'y = −(x + 1)', 'y = -(x + 1)'],
    ['x - (x - 1)', '<x> − (<x> − 1)', 'y = x − (x − 1)', 'y = x - (x - 1)'],
    ['x + -2', '<x> + (−2)', 'y = x + (−2)', 'y = x + (-2)'],
    ['0.5x', '0,5<x>', 'y = 0,5x', 'y = 0,5x'],
    ['2*3x', '2·3<x>', 'y = 2·3x', 'y = 2·3x'],
    ['x*x', '<x>·<x>', 'y = x·x', 'y = x·x'],
    ['kx + b', '<k><x> + <b>', 'y = kx + b', 'y = kx + b'],
    ['a*x^2', '<a><x>^[2]', 'y = ax²', 'y = ax^2'],
    ['2sin x', '2sin(<x>)', 'y = 2sin(x)', 'y = 2sin(x)'],
    ['x sin x', '<x> sin(<x>)', 'y = x sin(x)', 'y = x sin(x)'],
    ['tan x', 'tan(<x>)', 'y = tan(x)', 'y = tan(x)'],
    ['asin x', 'arcsin(<x>)', 'y = arcsin(x)', 'y = arcsin(x)'],
    ['2πx', '2π<x>', 'y = 2πx', 'y = 2πx'],
    ['pi*x', 'π<x>', 'y = πx', 'y = πx'],
    ['log(2; x)', 'log_[2](<x>)', 'y = log₂(x)', 'y = log₂(x)'],
    ['(x+1)(x-1)', '(<x> + 1)(<x> − 1)', 'y = (x + 1)(x − 1)', 'y = (x + 1)(x - 1)'],
  ];

  it.each(TABLE)('%s', (text, parts, plain, label) => {
    const ast = astOf(text);

    expect(show(functionParts(ast, ','))).toBe(parts);
    expect(functionText(ast, ',')).toBe(plain);
    expect(functionLabelText(ast, ',')).toBe(label);
    // Подпись разбирается обратно в ту же функцию.
    const back = astOf(functionLabelText(ast, '.'));

    [-1.5, 0.5, 2].forEach((x) => {
      const want = evaluateFunction(ast, x, { a: 2, b: 3, k: -1 });
      const got = evaluateFunction(back, x, { a: 2, b: 3, k: -1 });

      if (Number.isNaN(want)) expect(got).toBeNaN();
      else expect(got).toBeCloseTo(want, 9);
    });
  });

  it('десятичный разделитель — по ключу перевода', () => {
    expect(functionText(astOf('0,5x'), '.')).toBe('y = 0.5x');
    expect(functionLabelText(astOf('0.5x'), ',')).toBe('y = 0,5x');
  });

  it('подписи сравниваются без пробелов, вида минуса и разделителя', () => {
    expect(sameLabel('y=x^2-1', 'y = x^2 − 1')).toBe(true);
    expect(sameLabel('y = 0.5x', 'y = 0,5x')).toBe(true);
    expect(sameLabel('y = x', 'y = 2x')).toBe(false);
    expect(sameLabel(undefined, 'y = x')).toBe(false);
  });

  /** Подпись → LaTeX для TikZ. */
  const LATEX: Array<[string, string]> = [
    ['x^2 - 3x + 1', 'y = x^2 - 3x + 1'],
    ['sin(x)', 'y = \\sin(x)'],
    ['|x - 2|', 'y = \\left|x - 2\\right|'],
    ['||x| - 1|', 'y = \\left|\\left|x\\right| - 1\\right|'],
    ['|x|·|x - 1|', 'y = \\left|x\\right|\\cdot\\left|x - 1\\right|'],
    ['tg x', 'y = \\mathop{\\mathrm{tg}}\\nolimits(x)'],
    ['x ctg x', 'y = x \\mathop{\\mathrm{ctg}}\\nolimits(x)'],
    ['arctg x + arcsin x', 'y = \\mathop{\\mathrm{arctg}}\\nolimits(x) + \\arcsin(x)'],
    ['ln x + lg x', 'y = \\ln(x) + \\lg(x)'],
    ['2πx', 'y = 2\\pi x'],
    ['sqrt((x+1)/2)', 'y = \\sqrt{(x + 1)/2}'],
    ['cbrt(x - 1)', 'y = \\sqrt[3]{x - 1}'],
    ['log(2; x)', 'y = \\log_{2}(x)'],
    ['0,5x^(1/3)', 'y = 0{,}5x^{1/3}'],
    ['e^x', 'y = e^x'],
  ];

  it.each(LATEX)('%s → LaTeX', (text, latex) => {
    expect(toLatexMath(functionLabelText(astOf(text), ','))).toBe(latex);
  });

  it('прежние подписи в LaTeX не меняются', () => {
    expect(toLatexMath('y = √(x - 1)')).toBe('y = \\sqrt{x - 1}');
    expect(toLatexMath('√2')).toBe('\\sqrt{2}');
    expect(toLatexMath('\\text{sin}')).toBe('\\text{sin}');
    expect(toLatexMath('|AB| = 5')).toBe('\\left|AB\\right| = 5');
    // Непарная черта остаётся как была.
    expect(toLatexMath('a | b')).toBe('a | b');
    expect(toLatexMath('cosine')).toBe('cosine');
  });
});
