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
    [')x', 'drawings_plots_fn_error_extra_paren', 0],
    ['x + )', 'drawings_plots_fn_error_extra_paren', 4],
    ['(x + )', 'drawings_plots_fn_error_operand', 5],
    ['log(2,1,5)', 'drawings_plots_fn_error_log', 0],
    [`x${' + x'.repeat(80)}`, 'drawings_plots_fn_error_long', 300],
    [`${'('.repeat(51)}x${')'.repeat(51)}`, 'drawings_plots_fn_error_nesting', 50],
    [`${'-'.repeat(51)}x`, 'drawings_plots_fn_error_nesting', 50],
    [`${'sin'.repeat(51)}x`, 'drawings_plots_fn_error_nesting', 150],
    [`${'√'.repeat(51)}x`, 'drawings_plots_fn_error_nesting', 50],
    [`${'|'.repeat(51)}x${'|'.repeat(51)}`, 'drawings_plots_fn_error_nesting', 50],
    [`x${'^x'.repeat(51)}`, 'drawings_plots_fn_error_nesting', 101],
  ];

  it.each(ERRORS)('ошибка в «%s»: %s @%i', (text, key, position, word) => {
    const parsed = parseFunction(text);

    expect(parsed).toMatchObject({ ok: false, error: { key, ...(word ? { word } : {}) }, position });
    // Каждому ключу — перевод на обоих языках.
    expect(PLOTS_MESSAGES.ru?.[key]).toBeTruthy();
    expect(PLOTS_MESSAGES.en?.[key]).toBeTruthy();
  });

  it('log(…) с запятой: запятая разделяет аргументы, десятичные — через точку; вне log запятая десятичная', () => {
    expect(valuesOf('log(2,8)', [0])).toEqual([3]);
    expect(valuesOf('log(2, 8)', [0])).toEqual([3]);
    expect(valuesOf('log(2,x)', [16])).toEqual([4]);
    expect(valuesOf('log(0.5,x)', [4])).toEqual([-2]);
    expect(valuesOf('log(2,(1.5+0.5)x)', [2])).toEqual([2]);
    expect(valuesOf('2,5x + log(2,8)', [2])).toEqual([8]);
    expect(valuesOf('0,5x', [4])).toEqual([2]);
    expect(valuesOf('sin(1,5)', [0])[0]).toBeCloseTo(Math.sin(1.5));
    // Основание подстрочными цифрами: скобка не сразу за log, запятая в ней десятичная.
    expect(valuesOf('log₂(0,5)', [0])).toEqual([-1]);
  });

  it('log(…): с точкой с запятой запятые десятичные, без неё запятая верхнего уровня разделяет аргументы', () => {
    expect(valuesOf('log(2; 0,5)', [0])).toEqual([-1]);
    expect(valuesOf('log(0,5; x)', [4])).toEqual([-2]);
    expect(valuesOf('log(2; sin(0,5x))', [Math.PI])).toEqual([0]);
    expect(valuesOf('log(2,8)', [0])).toEqual([3]);
    expect(valuesOf('log(2, x)', [8])).toEqual([3]);
    // Вложенная скобка без `;` — запятая в ней десятичная.
    expect(valuesOf('log(2, sin(0,5x))', [Math.PI])).toEqual([0]);
  });

  it('длинные и глубокие записи: разбор отклоняет без исключения, принятые считаются и записываются', () => {
    const huge = [
      `${'('.repeat(2000)}x${')'.repeat(2000)}`,
      `${'sin'.repeat(3000)}x`,
      '√'.repeat(30000),
      `${'-'.repeat(5000)}x`,
      `x${'+x'.repeat(20000)}`,
      `x${'^x'.repeat(5000)}`,
    ];

    huge.forEach((text) => expect(parseFunction(text)).toMatchObject({ ok: false, error: { key: 'drawings_plots_fn_error_long' } }));

    // Ровно 300 символов — принимается, 301 — уже нет.
    expect(parseFunction('x'.repeat(300)).ok).toBe(true);
    expect(parseFunction('x'.repeat(301)).ok).toBe(false);
    // Вложенность 50 — принимается, 51 — нет.
    expect(parseFunction(`${'('.repeat(50)}x${')'.repeat(50)}`).ok).toBe(true);
    expect(parseFunction(`${'-'.repeat(50)}x`).ok).toBe(true);

    // Предельные принятые записи: длинная сумма, цепочка умножений без знака, глубокая вложенность.
    const limits: Array<[string, number]> = [
      [`x${'+x'.repeat(149)}`, 300],
      ['x'.repeat(300), 2 ** 300],
      ['2x'.repeat(150), 4 ** 150],
      [`${'-'.repeat(50)}x`, 2],
      [`${'√('.repeat(25)}x${')'.repeat(25)}`, 2 ** (1 / 2 ** 25)],
      [`${'|'.repeat(50)}x${'|'.repeat(50)}`, 2],
      ['x²'.repeat(150), 2 ** 300],
    ];

    limits.forEach(([text, value]) => {
      const ast = astOf(text);

      expect(evaluateFunction(ast, 2)).toBeCloseTo(value);
      expect(() => functionParts(ast, ',')).not.toThrow();
      expect(functionLabelText(ast).startsWith('y = ')).toBe(true);
      expect(functionText(ast).startsWith('y = ')).toBe(true);
    });
  });

  it('разбор никогда не бросает: не строка и мусор — ошибка записи', () => {
    const junk: unknown[] = [undefined, null, 42, {}, ['x']];

    junk.forEach((value) => expect(parseFunction(value as string).ok).toBe(false));
    ['((((', '||||', '^^^', '√√√', 'log(', 'log₂', ')))(((', '-+-+-', '²', '⁻', ',,,', ';;'].forEach((text) => {
      expect(() => parseFunction(text)).not.toThrow();
      expect(parseFunction(text).ok).toBe(false);
    });
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

/** Запись `text` разбирается в функцию с теми же значениями, что у `ast`, в нескольких точках. */
const expectSame = (ast: FunctionNode, text: string): void => {
  const back = astOf(text);
  const params = { a: 2, b: 3, k: -1, p: 5, i: 7, l: 3, n: 2, s: 2, c: 3 };

  [-1.5, 0.5, 2, 4].forEach((x) => {
    const want = evaluateFunction(ast, x, params);
    const got = evaluateFunction(back, x, params);

    if (Number.isNaN(want)) expect(got).toBeNaN();
    else expect(got).toBeCloseTo(want, 9);
  });
};

describe('запись для карточки и для подписи', () => {
  /** Запись → части карточки, строка для чтения, подпись на чертеже. */
  const TABLE: Array<[string, string, string, string]> = [
    ['x^2 - 3x + 1', '<x>^[2] − 3<x> + 1', 'y = x² − 3x + 1', 'y = x^2 - 3x + 1'],
    ['sin(x)', 'sin(<x>)', 'y = sin(x)', 'y = sin(x)'],
    ['|x - 2|', '|[<x> − 2]|', 'y = |x − 2|', 'y = |x - 2|'],
    ['1/x', '[1 / <x>]', 'y = 1/x', 'y = 1/x'],
    ['2/(x-1)+1', '[2 / <x> − 1] + 1', 'y = 2/(x − 1) + 1', 'y = 2/(x - 1) + 1'],
    ['1/2x', '[1 / 2]<x>', 'y = (1/2)x', 'y = (1/2)x'],
    ['1/(2x)', '[1 / 2<x>]', 'y = 1/(2x)', 'y = 1/(2x)'],
    ['sqrt(x+1)', '√[<x> + 1]', 'y = √(x + 1)', 'y = √(x + 1)'],
    ['√x', '√[<x>]', 'y = √x', 'y = √x'],
    ['cbrt(x)', '√3[<x>]', 'y = ∛x', 'y = ∛x'],
    ['2^x', '2^[<x>]', 'y = 2^x', 'y = 2^x'],
    ['2^(-x)', '2^[−<x>]', 'y = 2^(−x)', 'y = 2^{-x}'],
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
    // Подпись и запись для aria-label разбираются обратно в ту же функцию.
    expectSame(ast, functionLabelText(ast, '.'));
    expectSame(ast, functionText(ast, ','));
  });

  /** Произведения и вложенные записи: подпись и aria-label разбираются обратно в ту же функцию. */
  const ROUND_TRIP: Array<[string, string, string]> = [
    ['p*i*x', 'y = p·ix', 'y = p·ix'],
    ['l*n*x', 'y = l·nx', 'y = l·nx'],
    ['a*b*x', 'y = a·bx', 'y = a·bx'],
    ['a*sin(x)', 'y = a·sin(x)', 'y = a·sin(x)'],
    ['x*|x|', 'y = x·|x|', 'y = x·|x|'],
    ['|x*|x||', 'y = |x·|x||', 'y = |x·|x||'],
    ['2*a*x', 'y = 2ax', 'y = 2ax'],
    ['a*e*x', 'y = a·ex', 'y = a·ex'],
    ['s*e*c', 'y = s·e·c', 'y = s·e·c'],
    ['e*x*p', 'y = ex·p', 'y = ex·p'],
    ['x^a*b', 'y = x^a·b', 'y = x^a·b'],
    ['sqrt(a)*b', 'y = √a·b', 'y = √a·b'],
    ['2|x|+|x-1|', 'y = 2·|x| + |x - 1|', 'y = 2·|x| + |x − 1|'],
    ['(1/2)x', 'y = (1/2)x', 'y = (1/2)x'],
    ['sqrt(x)^2', 'y = √x^2', 'y = √x^2'],
    ['sqrt(x+1)^2', 'y = √(x + 1)^2', 'y = √(x + 1)^2'],
    ['2^(x^(x+1))', 'y = 2^{x^{x + 1}}', 'y = 2^(x^(x + 1))'],
    ['log(a; x)', 'y = log(a; x)', 'y = log(a; x)'],
    ['log(0.5; x) + log(2; a)', 'y = log(0,5; x) + log₂(a)', 'y = log(0,5; x) + log₂(a)'],
  ];

  it.each(ROUND_TRIP)('%s: подпись %s, aria-label %s', (text, label, plain) => {
    const ast = astOf(text);

    expect(functionLabelText(ast, ',')).toBe(label);
    expect(functionText(ast, ',')).toBe(plain);
    expectSame(ast, label);
    expectSame(ast, plain);
    expectSame(ast, functionLabelText(ast, '.'));
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
    ['log(a; x)', 'y = \\log(a; x)'],
    ['log(0,5; x)', 'y = \\log(0{,}5; x)'],
    ['2^(x^(x+1))', 'y = 2^{x^{x + 1}}'],
    ['a*sin(x)', 'y = a\\cdot\\sin(x)'],
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
