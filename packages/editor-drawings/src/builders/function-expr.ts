/**
 * Функция, набранная учеником: разбор школьной записи (`x^2 - 3x + 1`,
 * `2sin x`, `|x - 2|`, `log(2; x)`), вычисление и запись для карточки
 * формулы и для подписи на чертеже.
 *
 * Только свой разбор: никакого `eval` и `new Function` — запись приходит из
 * поля ввода и из сцены. Модуль без DOM.
 */

/** Функции записи; синонимы (`tan`, `asin`…) сводятся к ним при разборе. */
export type FunctionName = 'sin' | 'cos' | 'tg' | 'ctg' | 'arcsin' | 'arccos' | 'arctg' | 'arcctg' | 'ln' | 'lg' | 'log' | 'exp' | 'abs' | 'sqrt' | 'cbrt';

/** Узел разобранной записи. */
export type FunctionNode =
  /** `text` — цифры числа с точкой как разделителем: показ без потери записи. */
  | { kind: 'number'; value: number; text: string }
  | { kind: 'x' }
  | { kind: 'constant'; name: 'pi' | 'e' }
  | { kind: 'param'; name: string }
  | { kind: 'negate'; operand: FunctionNode }
  | { kind: 'binary'; op: '+' | '-' | '*' | '/' | '^'; left: FunctionNode; right: FunctionNode }
  /** `name` — название, как его набрали (`tan`, `tg`): так оно и показывается. */
  | { kind: 'call'; fn: FunctionName; name: string; args: FunctionNode[] };

/** Ключ сообщения об ошибке разбора; `{word}` в тексте — непонятое слово. */
export type FunctionErrorKey =
  | 'drawings_plots_fn_error_empty'
  | 'drawings_plots_fn_error_word'
  | 'drawings_plots_fn_error_paren'
  | 'drawings_plots_fn_error_extra_paren'
  | 'drawings_plots_fn_error_abs'
  | 'drawings_plots_fn_error_operand'
  | 'drawings_plots_fn_error_operator'
  | 'drawings_plots_fn_error_log'
  | 'drawings_plots_fn_error_left';

export interface FunctionError {
  key: FunctionErrorKey;
  /** Непонятое слово или знак — для `drawings_plots_fn_error_word`. */
  word?: string;
}

export type ParsedFunction =
  | { ok: true; ast: FunctionNode; params: string[] }
  | { ok: false; error: FunctionError; position: number };

/** Часть записи для показа: текст, буква, степень, индекс, дробь, корень, модуль. */
export type FormulaPart =
  | { kind: 'text'; text: string }
  | { kind: 'var'; name: string }
  | { kind: 'sup'; body: FormulaPart[] }
  | { kind: 'sub'; body: FormulaPart[] }
  | { kind: 'frac'; num: FormulaPart[]; den: FormulaPart[] }
  | { kind: 'sqrt'; body: FormulaPart[]; index?: string }
  | { kind: 'abs'; body: FormulaPart[] };

// ------------------------------------------------------------------ слова

const FUNCTION_WORDS: Record<string, FunctionName> = {
  sin: 'sin',
  cos: 'cos',
  tg: 'tg',
  tan: 'tg',
  ctg: 'ctg',
  cot: 'ctg',
  arcsin: 'arcsin',
  asin: 'arcsin',
  arccos: 'arccos',
  acos: 'arccos',
  arctg: 'arctg',
  arctan: 'arctg',
  atan: 'arctg',
  arcctg: 'arcctg',
  arccot: 'arcctg',
  acot: 'arcctg',
  ln: 'ln',
  lg: 'lg',
  log: 'log',
  exp: 'exp',
  abs: 'abs',
  sqrt: 'sqrt',
  cbrt: 'cbrt',
};

/** Короткие синонимы показываются полным названием: `asin x` → `arcsin(x)`. */
const SHOWN_NAMES: Record<string, string> = { asin: 'arcsin', acos: 'arccos', atan: 'arctan', acot: 'arccot' };

/**
 * Похожие слова, которых запись не знает: без этого списка `cosh x` тихо
 * разобралось бы как `cos(h·x)`.
 */
const UNKNOWN_WORDS = ['sinh', 'cosh', 'tanh', 'coth', 'sh', 'ch', 'th', 'cth', 'sec', 'csc', 'cosec', 'sign', 'sgn'];

/** Слова для поиска самого длинного совпадения в слитном наборе букв (`sinx`, `xsinx`). */
const WORDS = [...Object.keys(FUNCTION_WORDS), ...UNKNOWN_WORDS, 'pi'].sort((a, b) => b.length - a.length);

const SUPERSCRIPT_DIGITS = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const SUBSCRIPT_DIGITS = '₀₁₂₃₄₅₆₇₈₉';
const SUPERSCRIPT_MINUS = '⁻';

/** Буквы кириллицы, похожие на латинские, которыми набирают переменные на русской раскладке. */
const LOOKALIKES: Record<string, string> = { х: 'x', Х: 'x', у: 'y', У: 'y' };

/** Знаки действий и их обычный вид: тире и юникодный минус — минус, точка и крест — умножение. */
const SYMBOLS: Record<string, string> = {
  '+': '+',
  '-': '-',
  '−': '-',
  '–': '-',
  '*': '*',
  '·': '*',
  '×': '*',
  '⋅': '*',
  '/': '/',
  ':': '/',
  '÷': '/',
  '^': '^',
  '(': '(',
  ')': ')',
  '[': '(',
  ']': ')',
  '{': '(',
  '}': ')',
  '|': '|',
  ';': ';',
  π: 'π',
  '√': '√',
  '∛': '∛',
};

// ---------------------------------------------------------------- лексемы

type TokenKind = 'number' | 'function' | 'letter' | 'pi' | 'symbol' | 'super' | 'sub' | 'end';

interface Token {
  kind: TokenKind;
  /** Знак (`+`, `(`…), название функции, буква — или цифры числа. */
  text: string;
  value: number;
  /** Слово как набрано — для сообщения об ошибке. */
  raw: string;
  start: number;
}

class ParseError extends Error {
  constructor(
    readonly error: FunctionError,
    readonly position: number,
  ) {
    super(error.key);
  }
}

const isDigit = (char: string | undefined): boolean => char !== undefined && char >= '0' && char <= '9';

const isLatin = (char: string | undefined): boolean => char !== undefined && /^[A-Za-z]$/.test(char);

const token = (kind: TokenKind, text: string, start: number, raw = text, value = NaN): Token => ({ kind, text, value, raw, start });

/** Слитный набор букв → функции, `pi` и одиночные буквы; две незнакомые буквы подряд — ошибка на весь набор. */
const splitWord = (word: string, start: number): Token[] => {
  const tokens: Token[] = [];
  const lower = word.toLowerCase();
  let index = 0;

  while (index < word.length) {
    const at = index;
    const found = WORDS.find((candidate) => lower.startsWith(candidate, at));

    if (found && UNKNOWN_WORDS.includes(found)) throw new ParseError({ key: 'drawings_plots_fn_error_word', word }, start);

    if (found) {
      tokens.push(token(found === 'pi' ? 'pi' : 'function', found, start + at, word.slice(at, at + found.length)));
      index += found.length;
    } else {
      const char = word.charAt(at);
      const lowerChar = char.toLowerCase();
      // `X`, `Y`, `E` с заглавной (телефон сам делает первую букву большой) — те же `x`, `y`, `e`.
      const name = lowerChar === 'x' || lowerChar === 'y' || lowerChar === 'e' ? lowerChar : char;

      tokens.push(token('letter', name, start + at));
      index += 1;
    }
  }

  // Буквы-параметры подряд (`ab`, `sqr`, `max`): скорее незнакомое слово, чем произведение.
  const unknown = tokens.some((item, position) => {
    const next = tokens[position + 1];

    const plain = (letter: Token): boolean => letter.kind === 'letter' && letter.text !== 'x' && letter.text !== 'e';

    return next !== undefined && plain(item) && plain(next);
  });

  if (unknown) throw new ParseError({ key: 'drawings_plots_fn_error_word', word }, start);

  return tokens;
};

/** Число со строки `text` с позиции `start`: цифры и один разделитель — точка или запятая между цифрами. */
const readNumber = (text: string, start: number): Token => {
  const match = /^(?:\d+(?:[.,]\d+)?|\.\d+)/.exec(text.slice(start));
  const raw = match?.[0] ?? '';
  const digits = raw.replace(',', '.');

  return token('number', digits.startsWith('.') ? `0${digits}` : digits, start, raw, Number(digits));
};

/** Надстрочные цифры (`²`, `⁻¹`) — показатель степени. */
const readSuperscript = (text: string, start: number): Token => {
  let index = start;
  let digits = '';

  if (text.charAt(index) === SUPERSCRIPT_MINUS) {
    digits = '-';
    index += 1;
  }

  while (index < text.length && SUPERSCRIPT_DIGITS.includes(text.charAt(index))) {
    digits += String(SUPERSCRIPT_DIGITS.indexOf(text.charAt(index)));
    index += 1;
  }

  if (digits === '' || digits === '-') throw new ParseError({ key: 'drawings_plots_fn_error_word', word: text.slice(start, index + 1) }, start);

  return token('super', digits, start, text.slice(start, index), Number(digits));
};

const tokenize = (text: string, offset: number): Token[] => {
  const tokens: Token[] = [];
  let index = 0;

  while (index < text.length) {
    const char = text.charAt(index);
    const at = offset + index;

    if (/\s/.test(char)) {
      index += 1;
    } else if (isDigit(char) || (char === '.' && isDigit(text.charAt(index + 1)))) {
      const number = readNumber(text, index);

      tokens.push({ ...number, start: at });
      index += number.raw.length;
    } else if (isLatin(char)) {
      const word = /^[A-Za-z]+/.exec(text.slice(index))?.[0] ?? char;

      tokens.push(...splitWord(word, at));
      index += word.length;
    } else if (SUPERSCRIPT_DIGITS.includes(char) || char === SUPERSCRIPT_MINUS) {
      const power = readSuperscript(text, index);

      tokens.push({ ...power, start: at });
      index += power.raw.length;
    } else if (SUBSCRIPT_DIGITS.includes(char)) {
      // Подстрочные цифры — основание логарифма: `log₂ x`.
      const digits = /^[₀-₉]+/.exec(text.slice(index))?.[0] ?? char;

      const base = [...digits].map((digit) => String(SUBSCRIPT_DIGITS.indexOf(digit))).join('');

      tokens.push(token('sub', base, at, digits, Number(base)));
      index += digits.length;
    } else if (char === ',') {
      // Запятая не между цифрами — разделитель, как точка с запятой: `log(2, x)`.
      tokens.push(token('symbol', ';', at, char));
      index += 1;
    } else if (SYMBOLS[char]) {
      tokens.push(token('symbol', SYMBOLS[char] ?? char, at, char));
      index += 1;
    } else {
      // Незнакомое: кириллица словом целиком, прочее — по знаку.
      const word = /^[Ѐ-ӿ]+/.exec(text.slice(index))?.[0] ?? char;

      throw new ParseError({ key: 'drawings_plots_fn_error_word', word }, at);
    }
  }

  tokens.push(token('end', '', offset + text.length));

  return tokens;
};

// ------------------------------------------------------------------ разбор

const binary = (op: '+' | '-' | '*' | '/' | '^', left: FunctionNode, right: FunctionNode): FunctionNode => ({ kind: 'binary', op, left, right });

const numberNode = (value: number, text = String(value)): FunctionNode => ({ kind: 'number', value, text });

/**
 * Разбор по уровням: сумма → произведение (в том числе без знака) → унарный
 * минус → степень (правоассоциативна, сильнее минуса: `-x^2` = `−(x²)`) →
 * число, буква, скобки, модуль, корень, функция.
 *
 * Позиция в списке лексем, глубина модуля и найденные параметры — общее
 * состояние уровней, поэтому класс.
 */
class Parser {
  private index = 0;

  /** Открытых модулей: `|` после операнда внутри модуля его закрывает, снаружи — открывает новый. */
  private absDepth = 0;

  readonly params: string[] = [];

  constructor(private readonly tokens: Token[]) {}

  parse(): FunctionNode {
    const node = this.sum();
    const rest = this.peek();

    if (rest.kind === 'end') return node;

    if (this.is(')')) throw new ParseError({ key: 'drawings_plots_fn_error_extra_paren' }, rest.start);

    throw new ParseError({ key: 'drawings_plots_fn_error_word', word: rest.raw }, rest.start);
  }

  private peek(ahead = 0): Token {
    return this.tokens[Math.min(this.index + ahead, this.tokens.length - 1)] ?? token('end', '', 0);
  }

  private is(symbol: string, ahead = 0): boolean {
    const next = this.peek(ahead);

    return next.kind === 'symbol' && next.text === symbol;
  }

  private take(): Token {
    const current = this.peek();

    this.index = Math.min(this.index + 1, this.tokens.length - 1);

    return current;
  }

  private sum(): FunctionNode {
    let node = this.product();

    while (this.is('+') || this.is('-')) {
      const op = this.take().text === '+' ? '+' : '-';

      node = binary(op, node, this.product());
    }

    return node;
  }

  /** Может ли со следующей лексемы начаться множитель без знака: `2x`, `2(x+1)`, `x sin x`, `2|x|`. */
  private startsFactor(withFunctions: boolean, withGroups: boolean): boolean {
    const next = this.peek();

    if (next.kind === 'number' || next.kind === 'letter' || next.kind === 'pi') return true;

    if (next.kind === 'function') return withFunctions;

    return this.is('√') || this.is('∛') || this.is('π') || (withGroups && (this.is('(') || (this.is('|') && this.absDepth === 0)));
  }

  /** Два числа подряд (`2 3`, `x²3`) — пропущен знак действия. */
  private checkNumbers(): void {
    const previous = this.tokens[this.index - 1];
    const next = this.peek();

    if (next.kind === 'number' && (previous?.kind === 'number' || previous?.kind === 'super')) {
      throw new ParseError({ key: 'drawings_plots_fn_error_operator' }, next.start);
    }
  }

  private product(): FunctionNode {
    let node = this.unary();
    let more = true;

    while (more) {
      if (this.is('*') || this.is('/')) {
        const op = this.take().text === '*' ? '*' : '/';

        node = binary(op, node, this.unary());
      } else if (this.startsFactor(true, true)) {
        this.checkNumbers();
        node = binary('*', node, this.power());
      } else {
        more = false;
      }
    }

    return node;
  }

  private unary(): FunctionNode {
    if (this.is('-')) {
      this.take();

      return { kind: 'negate', operand: this.unary() };
    }

    if (this.is('+')) {
      this.take();

      return this.unary();
    }

    return this.power();
  }

  private power(): FunctionNode {
    const base = this.postfix();

    if (!this.is('^')) return base;

    this.take();

    return binary('^', base, this.exponent());
  }

  /** Показатель после `^`: свой знак (`2^-x`) и снова степень — справа налево. */
  private exponent(): FunctionNode {
    if (this.is('-')) {
      this.take();

      return { kind: 'negate', operand: this.exponent() };
    }

    if (this.is('+')) {
      this.take();

      return this.exponent();
    }

    return this.power();
  }

  /** Операнд и надстрочные показатели за ним: `x²`, `(x+1)³`. */
  private postfix(): FunctionNode {
    let node = this.primary();

    while (this.peek().kind === 'super') {
      const power = this.take();

      node = binary('^', node, power.value < 0 ? { kind: 'negate', operand: numberNode(-power.value) } : numberNode(power.value));
    }

    return node;
  }

  private primary(): FunctionNode {
    const next = this.peek();

    switch (next.kind) {
      case 'number':
        this.take();

        return numberNode(next.value, next.text);
      case 'pi':
        this.take();

        return { kind: 'constant', name: 'pi' };
      case 'letter':
        this.take();

        return this.letter(next);
      case 'function':
        this.take();

        return this.call(next);
      default:
        break;
    }

    if (this.is('π')) {
      this.take();

      return { kind: 'constant', name: 'pi' };
    }

    if (this.is('(')) return this.group();

    if (this.is('|')) return this.modulus();

    if (this.is('√') || this.is('∛')) {
      const root = this.take();

      return { kind: 'call', fn: root.text === '∛' ? 'cbrt' : 'sqrt', name: root.text, args: [this.postfix()] };
    }

    throw new ParseError({ key: 'drawings_plots_fn_error_operand' }, next.start);
  }

  private letter(item: Token): FunctionNode {
    if (item.text === 'x') return { kind: 'x' };

    if (item.text === 'e') return { kind: 'constant', name: 'e' };

    if (item.text === 'y') throw new ParseError({ key: 'drawings_plots_fn_error_word', word: item.raw }, item.start);

    if (!this.params.includes(item.text)) this.params.push(item.text);

    return { kind: 'param', name: item.text };
  }

  /** Скобки: внутри них `|` после операнда открывает новый модуль, а не закрывает внешний. */
  private group(): FunctionNode {
    const open = this.take();
    const depth = this.absDepth;

    this.absDepth = 0;

    const inner = this.sum();

    this.absDepth = depth;
    this.close(open);

    return inner;
  }

  private close(open: Token): void {
    if (this.is(')')) {
      this.take();

      return;
    }

    const next = this.peek();

    if (next.kind === 'end' || this.is('|')) throw new ParseError({ key: 'drawings_plots_fn_error_paren' }, open.start);

    throw new ParseError({ key: 'drawings_plots_fn_error_word', word: next.raw }, next.start);
  }

  private modulus(): FunctionNode {
    const open = this.take();

    this.absDepth += 1;

    const inner = this.sum();

    this.absDepth -= 1;

    if (!this.is('|')) {
      if (this.is(')')) throw new ParseError({ key: 'drawings_plots_fn_error_extra_paren' }, this.peek().start);

      if (this.peek().kind !== 'end') throw new ParseError({ key: 'drawings_plots_fn_error_word', word: this.peek().raw }, this.peek().start);

      throw new ParseError({ key: 'drawings_plots_fn_error_abs' }, open.start);
    }

    this.take();

    return { kind: 'call', fn: 'abs', name: 'abs', args: [inner] };
  }

  /**
   * Функция: аргумент в скобках или простой без них (`sin x`, `sin 2x`,
   * `ln x^2`); степень сразу за названием (`sin²x`, `sin^2 x`) — степень значения.
   */
  private call(name: Token): FunctionNode {
    const fn = FUNCTION_WORDS[name.text] ?? 'sin';
    const base = fn === 'log' && this.peek().kind === 'sub' ? this.take() : null;
    const power = this.callPower();
    const written = this.is('(') ? this.callArgs() : [this.simpleArgument()];
    // Основание подстрочными цифрами: `log₂(x)` — то же, что `log(2; x)`.
    const args = base ? [numberNode(base.value, base.text), ...written] : written;

    if (fn === 'log' && args.length !== 2) throw new ParseError({ key: 'drawings_plots_fn_error_log' }, name.start);

    if (fn !== 'log' && args.length !== 1) throw new ParseError({ key: 'drawings_plots_fn_error_word', word: ';' }, name.start);

    const node: FunctionNode = { kind: 'call', fn, name: SHOWN_NAMES[name.text] ?? name.text, args };

    return power ? binary('^', node, power) : node;
  }

  private callPower(): FunctionNode | null {
    const next = this.peek();

    if (next.kind === 'super') {
      this.take();

      return numberNode(next.value);
    }

    if (this.is('^') && this.peek(1).kind === 'number') {
      this.take();

      const power = this.take();

      return numberNode(power.value, power.text);
    }

    return null;
  }

  /** Аргументы в скобках через `;`: у `log` два — основание и само число. */
  private callArgs(): FunctionNode[] {
    const open = this.take();
    const depth = this.absDepth;
    const args: FunctionNode[] = [];

    this.absDepth = 0;
    args.push(this.sum());

    while (this.is(';')) {
      this.take();
      args.push(this.sum());
    }

    this.absDepth = depth;
    this.close(open);

    return args;
  }

  /** Аргумент без скобок: знак и множители без знака умножения, но без других функций — `sin x cos x`. */
  private simpleArgument(): FunctionNode {
    if (this.is('-')) {
      this.take();

      return { kind: 'negate', operand: this.simpleArgument() };
    }

    let node = this.power();

    while (this.startsFactor(false, false)) {
      this.checkNumbers();
      node = binary('*', node, this.power());
    }

    return node;
  }
}

/** Левая часть `y =`, `f(x) =`; остальное слева от `=` — ошибка. */
const LEFT_SIDE = /^\s*(?:y|[a-z]\s*\(\s*x\s*\))\s*$/i;

/** Запись → дерево и буквы-параметры в порядке появления; ошибка — ключом сообщения и позицией в строке. */
export const parseFunction = (text: string): ParsedFunction => {
  // Кириллические х и у — те же буквы: позиции в строке не сдвигаются.
  const chars = [...text];
  const cyrillic = (char: string | undefined): boolean => char !== undefined && /[Ѐ-ӿ]/.test(char);
  // Только отдельная буква: в слове «синус» `у` остаётся кириллицей и даёт понятную ошибку.
  const source = chars.map((char, index) => (cyrillic(chars[index - 1]) || cyrillic(chars[index + 1]) ? char : (LOOKALIKES[char] ?? char))).join('');
  const equals = source.indexOf('=');

  if (equals >= 0 && !LEFT_SIDE.test(source.slice(0, equals))) {
    return { ok: false, error: { key: 'drawings_plots_fn_error_left' }, position: 0 };
  }

  const offset = equals + 1;
  const right = source.slice(offset);

  if (right.trim() === '') return { ok: false, error: { key: 'drawings_plots_fn_error_empty' }, position: text.length };

  try {
    const parser = new Parser(tokenize(right, offset));
    const ast = parser.parse();

    return { ok: true, ast, params: [...parser.params] };
  } catch (error) {
    if (error instanceof ParseError) return { ok: false, error: error.error, position: error.position };

    throw error;
  }
}

// -------------------------------------------------------------- вычисление

/** Знаменатели дробного показателя, при которых степень отрицательного числа определена: `x^(1/3)`. */
const ODD_DENOMINATORS = [3, 5, 7, 9];

const power = (base: number, exponent: number): number => {
  if (base >= 0 || Number.isInteger(exponent)) return base ** exponent;

  const denominator = ODD_DENOMINATORS.find((value) => Math.abs(exponent * value - Math.round(exponent * value)) < 1e-9);

  if (denominator === undefined) return NaN;

  const sign = Math.round(exponent * denominator) % 2 === 0 ? 1 : -1;

  return sign * Math.abs(base) ** exponent;
};

const logarithm = (value: number): number => (value > 0 ? Math.log(value) : NaN);

const applyFunction = (fn: FunctionName, args: number[]): number => {
  const [a = NaN, b = NaN] = args;

  switch (fn) {
    case 'sin':
      return Math.sin(a);
    case 'cos':
      return Math.cos(a);
    case 'tg':
      return Math.tan(a);
    case 'ctg':
      return Math.sin(a) === 0 ? NaN : Math.cos(a) / Math.sin(a);
    case 'arcsin':
      return Math.asin(a);
    case 'arccos':
      return Math.acos(a);
    case 'arctg':
      return Math.atan(a);
    case 'arcctg':
      return Math.PI / 2 - Math.atan(a);
    case 'ln':
      return logarithm(a);
    case 'lg':
      return a > 0 ? Math.log10(a) : NaN;
    case 'log':
      // `log(a; x)`: основание положительно и не 1.
      return a > 0 && a !== 1 ? logarithm(b) / Math.log(a) : NaN;
    case 'exp':
      return Math.exp(a);
    case 'abs':
      return Math.abs(a);
    case 'sqrt':
      return a >= 0 ? Math.sqrt(a) : NaN;
    case 'cbrt':
      return Math.cbrt(a);
    default:
      return NaN;
  }
};

const evaluate = (node: FunctionNode, x: number, params: Record<string, number>): number => {
  switch (node.kind) {
    case 'number':
      return node.value;
    case 'x':
      return x;
    case 'constant':
      return node.name === 'pi' ? Math.PI : Math.E;
    case 'param':
      return params[node.name] ?? 1;
    case 'negate':
      return -evaluate(node.operand, x, params);
    case 'call':
      return applyFunction(
        node.fn,
        node.args.map((arg) => evaluate(arg, x, params)),
      );
    case 'binary': {
      const left = evaluate(node.left, x, params);
      const right = evaluate(node.right, x, params);

      switch (node.op) {
        case '+':
          return left + right;
        case '-':
          return left - right;
        case '*':
          return left * right;
        case '/':
          return right === 0 ? NaN : left / right;
        default:
          return power(left, right);
      }
    }
    default:
      return NaN;
  }
};

/**
 * Значение функции в точке; вне области определения (корень из
 * отрицательного, деление на ноль, логарифм неположительного) — `NaN`, без
 * исключений. Параметр без значения равен 1.
 */
export const evaluateFunction = (ast: FunctionNode, x: number, params: Record<string, number> = {}): number => {
  const value = evaluate(ast, x, params);

  return Number.isFinite(value) ? value : NaN;
};

// ------------------------------------------------------------------- запись

/** Настоящий минус, а не дефис. */
const MINUS = '−';

/** Как записать: для карточки (дробь — дробью) или для подписи на чертеже (одной строкой). */
type Mode = 'card' | 'label';

const text = (value: string): FormulaPart => ({ kind: 'text', text: value });

/** Сила связи узла: сумма слабее произведения и минуса, степень сильнее, числа и функции — неделимы. */
const precedence = (node: FunctionNode): number => {
  switch (node.kind) {
    case 'binary':
      if (node.op === '+' || node.op === '-') return 1;

      return node.op === '^' ? 3 : 2;
    case 'negate':
      return 2;
    default:
      return 4;
  }
};

/** Крайний левый лист записи: по нему видно, начинается ли множитель с цифры или с названия функции. */
const leftmost = (node: FunctionNode): FunctionNode => {
  if (node.kind === 'binary') return leftmost(node.left);

  return node;
};

const rightmost = (node: FunctionNode): FunctionNode => {
  if (node.kind === 'binary') return node.op === '^' ? node : rightmost(node.right);

  if (node.kind === 'negate') return rightmost(node.operand);

  return node;
};

const isLetter = (node: FunctionNode): boolean => node.kind === 'x' || node.kind === 'param' || node.kind === 'constant';

/** Функция с названием (`sin`, `log`) — не модуль и не корень, которые пишутся знаком. */
const isNamedCall = (node: FunctionNode): boolean => node.kind === 'call' && node.fn !== 'abs' && node.fn !== 'sqrt' && node.fn !== 'cbrt';

/**
 * Знак между множителями: число на букву — без знака (`2x`, `2sin(x)`),
 * буква перед названием функции — пробел (`x sin(x)`), перед числом и
 * между `x` и буквой — точка (`x·2`, `2·3`, `x·a`).
 */
const productSign = (left: FunctionNode, right: FunctionNode, rightGrouped: boolean): string => {
  if (rightGrouped) return '';

  const first = leftmost(right);
  const last = rightmost(left);

  const bothModuli = first.kind === 'call' && first.fn === 'abs' && last.kind === 'call' && last.fn === 'abs';

  if (first.kind === 'number' || (last.kind === 'x' && isLetter(first)) || bothModuli) return '·';

  if (isNamedCall(first) && (isLetter(last) || last.kind === 'number')) return last.kind === 'number' ? '' : ' ';

  return '';
};

/** Число с разделителем `separator`. */
const numberText = (node: { text: string }, separator: string): string => node.text.replace('.', separator === '.' ? '.' : ',');

/**
 * Дерево → части. Скобки ставятся по силе связи, лишние скобки записи
 * пропадают: `((x))` → `x`.
 */
class Writer {
  constructor(
    private readonly mode: Mode,
    private readonly separator: string,
  ) {}

  write(node: FunctionNode): FormulaPart[] {
    switch (node.kind) {
      case 'number':
        return [text(numberText(node, this.separator))];
      case 'x':
        return [{ kind: 'var', name: 'x' }];
      case 'param':
        return [{ kind: 'var', name: node.name }];
      case 'constant':
        return [text(node.name === 'pi' ? 'π' : 'e')];
      case 'negate': {
        const operand = node.operand;
        const grouped = operand.kind === 'negate' || precedence(operand) < 2;

        return [text(MINUS), ...this.maybeGrouped(operand, grouped)];
      }
      case 'call':
        return this.call(node);
      case 'binary':
        return this.binary(node);
      default:
        return [];
    }
  }

  private grouped(node: FunctionNode): FormulaPart[] {
    return [text('('), ...this.write(node), text(')')];
  }

  private maybeGrouped(node: FunctionNode, grouped: boolean): FormulaPart[] {
    return grouped ? this.grouped(node) : this.write(node);
  }

  private binary(node: Extract<FunctionNode, { kind: 'binary' }>): FormulaPart[] {
    const { left, right } = node;

    switch (node.op) {
      case '+':
      case '-': {
        const grouped = precedence(right) < 2 || right.kind === 'negate';

        return [...this.write(left), text(node.op === '+' ? ' + ' : ` ${MINUS} `), ...this.maybeGrouped(right, grouped)];
      }
      case '*': {
        // В подписи частное перед множителем — в скобках: `(1/2)x`, а не `1/2x`.
        const leftGrouped = precedence(left) < 2 || (this.mode === 'label' && left.kind === 'binary' && left.op === '/');
        const rightGrouped = precedence(right) < 2 || right.kind === 'negate';

        return [...this.maybeGrouped(left, leftGrouped), text(productSign(left, right, rightGrouped)), ...this.maybeGrouped(right, rightGrouped)].filter(
          (part) => part.kind !== 'text' || part.text !== '',
        );
      }
      case '/':
        if (this.mode === 'card') return [{ kind: 'frac', num: this.write(left), den: this.write(right) }];

        return [...this.maybeGrouped(left, precedence(left) < 2), text('/'), ...this.maybeGrouped(right, precedence(right) <= 2)];
      default:
        return [...this.maybeGrouped(left, precedence(left) < 4), { kind: 'sup', body: this.write(right) }];
    }
  }

  private call(node: Extract<FunctionNode, { kind: 'call' }>): FormulaPart[] {
    const [first, second] = node.args;

    if (!first) return [];

    switch (node.fn) {
      case 'abs':
        return [{ kind: 'abs', body: this.write(first) }];
      case 'sqrt':
        return [{ kind: 'sqrt', body: this.write(first) }];
      case 'cbrt':
        return [{ kind: 'sqrt', body: this.write(first), index: '3' }];
      case 'log':
        return second ? [text('log'), { kind: 'sub', body: this.write(first) }, ...this.grouped(second)] : [];
      default:
        return [text(node.name), ...this.grouped(first)];
    }
  }
}

/** Части записи для карточки формулы: дробь, степень, корень, модуль; параметры — буквами. */
export const functionParts = (ast: FunctionNode, separator: string): FormulaPart[] => new Writer('card', separator).write(ast);

// ------------------------------------------------------ запись одной строкой

const SUPERSCRIPT_CHARS: Record<string, string> = { '-': '⁻', [MINUS]: '⁻', n: 'ⁿ', x: 'ˣ' };

const superscript = (value: string): string | null => {
  const chars = [...value].map((char) => (isDigit(char) ? SUPERSCRIPT_DIGITS.charAt(Number(char)) : SUPERSCRIPT_CHARS[char]));

  return chars.every((char) => char !== undefined) ? chars.join('') : null;
};

const subscript = (value: string): string | null => (/^\d+$/.test(value) ? [...value].map((char) => SUBSCRIPT_DIGITS.charAt(Number(char))).join('') : null);

/** Часть из одного знака или буквы — без скобок: `√x`, `√2`. */
const isSimple = (parts: FormulaPart[], flat: string): boolean => parts.length === 1 && /^[\p{L}\d.,]+$/u.test(flat);

type Flavor = 'plain' | 'label';

/**
 * Части одной строкой: `plain` — для чтения и `aria-label` (`x²`, `−`),
 * `label` — подпись на чертеже: дефис вместо минуса, степень `^2` и `^{…}` —
 * её поднимает рендер SVG и понимает LaTeX.
 */
const flatten = (parts: FormulaPart[], flavor: Flavor): string => parts.map((part) => flattenPart(part, flavor)).join('');

const flattenPart = (part: FormulaPart, flavor: Flavor): string => {
  switch (part.kind) {
    case 'text':
      return flavor === 'label' ? part.text.split(MINUS).join('-') : part.text;
    case 'var':
      return part.name;
    case 'sup': {
      const body = flatten(part.body, flavor);

      if (flavor === 'plain') return superscript(body) ?? `^(${body})`;

      return body.length === 1 ? `^${body}` : `^{${body}}`;
    }
    case 'sub': {
      const body = flatten(part.body, flavor);

      return subscript(body) ?? (flavor === 'label' ? `_{${body}}` : `_(${body})`);
    }
    case 'frac': {
      const num = flatten(part.num, flavor);
      const den = flatten(part.den, flavor);

      return `${isSimple(part.num, num) ? num : `(${num})`}/${isSimple(part.den, den) ? den : `(${den})`}`;
    }
    case 'sqrt': {
      const body = flatten(part.body, flavor);

      return `${part.index === '3' ? '∛' : '√'}${isSimple(part.body, body) ? body : `(${body})`}`;
    }
    case 'abs':
      return `|${flatten(part.body, flavor)}|`;
    default:
      return '';
  }
};

/** Запись одной строкой для чтения: `y = x² − 3x + 1`, `y = 1/x` — для `aria-label` карточки. */
export const functionText = (ast: FunctionNode, separator = ','): string => `y = ${flatten(functionParts(ast, separator), 'plain')}`;

/**
 * Подпись на чертеже: `y = x^2 - 3x + 1`, `y = sin(x)`, `y = |x - 2|`.
 * Рендер SVG поднимает `^…` верхним индексом, TikZ получает её через
 * `toLatexMath`. Десятичный разделитель — из таблицы переводов.
 */
export const functionLabelText = (ast: FunctionNode, separator = ','): string => `y = ${flatten(new Writer('label', separator).write(ast), 'label')}`;

/** Подписи совпадают без учёта пробелов, вида минуса и десятичного разделителя. */
export const sameLabel = (a: string | undefined, b: string | undefined): boolean => {
  const normalize = (value: string): string => value.replace(/\s+/g, '').split(MINUS).join('-').replace(/\./g, ',');

  return a !== undefined && b !== undefined && normalize(a) === normalize(b);
};
