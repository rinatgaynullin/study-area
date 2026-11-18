import type { Point, Vec2 } from '../scene/types';

/**
 * Общие мелочи экспорта в TikZ: формат чисел и координат, списки опций,
 * подписи в математическом режиме, цвета.
 *
 * Результат экспорта — LaTeX, который преподаватель вставляет в документ,
 * поэтому компилируемость важнее дословного повторения входа: `°` и
 * кириллица внутри `$…$` у pdflatex не собираются, греческие буквы юникодом
 * — тоже, так что они переводятся в команды.
 */

/** Два знака после запятой без хвостовых нулей; `-0` и не-числа становятся `0`. */
export const num = (value: number): string => (Number.isFinite(value) ? String(Number(value.toFixed(2))) : '0');

export const xy = (point: Vec2): string => `(${num(point[0])},${num(point[1])})`;

export const xyz = (point: Point): string => `(${num(point[0])},${num(point[1])},${num(point[2] ?? 0)})`;

export const polyline = (points: Vec2[]): string => points.map(xy).join(' -- ');

/** `[a, b]` из непустых частей; без частей — пустая строка, чтобы `\draw` остался без скобок. */
export const options = (...parts: Array<string | false | null | undefined>): string => {
  const kept = parts.filter((part): part is string => typeof part === 'string' && part.length > 0);

  return kept.length > 0 ? `[${kept.join(', ')}]` : '';
};

/** Строка-комментарий с преамбулой, которую нужно подключить, чтобы фрагмент собрался. */
export const requiresLine = (libraries: Iterable<string>, packages: Iterable<string> = []): string => {
  const libs = [...new Set(libraries)];
  const pkgs = [...new Set(packages)];
  const parts = [
    ...(libs.length > 0 ? [`\\usetikzlibrary{${libs.join(',')}}`] : []),
    ...pkgs.map((name) => `\\usepackage{${name}}`),
  ];

  return parts.length > 0 ? `% requires: ${parts.join(' ')}` : '';
};

// ------------------------------------------------------------- положение

const PLACEMENTS: ReadonlySet<string> = new Set([
  'above',
  'below',
  'left',
  'right',
  'above left',
  'above right',
  'below left',
  'below right',
  'center',
]);

const PLACEMENT_SYNONYMS: Record<string, string> = {
  top: 'above',
  bottom: 'below',
  'top left': 'above left',
  'top right': 'above right',
  'bottom left': 'below left',
  'bottom right': 'below right',
  'left above': 'above left',
  'right above': 'above right',
  'left below': 'below left',
  'right below': 'below right',
};

/** Положение подписи из данных сцены — только из известных TikZ слов, иначе запасное. */
export const placement = (value: string | undefined, fallback: string): string => {
  if (!value) return fallback;

  const key = value.trim().toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');
  const resolved = PLACEMENT_SYNONYMS[key] ?? key;

  return PLACEMENTS.has(resolved) ? resolved : fallback;
};

const DIRECTIONS = ['right', 'above right', 'above', 'above left', 'left', 'below left', 'below', 'below right'];

/** Якорь узла, чтобы подпись легла в сторону вектора `(dx, dy)` (y мира вверх). */
export const anchorTowards = (dx: number, dy: number): string => {
  if (dx === 0 && dy === 0) return 'above right';

  const sector = Math.round((Math.atan2(dy, dx) * 180) / Math.PI / 45);

  // Индекс всегда в 0..7; запасное значение — только для `NaN` на входе, как у нулевого вектора.
  return DIRECTIONS[((sector % 8) + 8) % 8] ?? 'above right';
};

/** Единичная нормаль слева от направления `a → b`; для совпадающих точек — вверх. */
export const leftNormal = (a: Vec2, b: Vec2): Vec2 => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy);

  return length > 0 ? [-dy / length, dx / length] : [0, 1];
};

export const shifted = (point: Vec2, direction: Vec2, distance: number): Vec2 => [
  point[0] + direction[0] * distance,
  point[1] + direction[1] * distance,
];

/** Середина ломаной по длине — туда ставится подпись верёвки, провода, пружины. */
export const polylineMidpoint = (points: Vec2[]): Vec2 => {
  const [first] = points;

  if (!first) return [0, 0];

  if (points.length === 1) return first;

  const lengths = points.slice(1).map((point, index) => {
    const previous = points[index];

    if (!previous) return 0;

    return Math.hypot(point[0] - previous[0], point[1] - previous[1]);
  });
  const total = lengths.reduce((sum, length) => sum + length, 0);
  let remaining = total / 2;

  for (let index = 0; index < lengths.length; index += 1) {
    const segment = lengths[index];
    const a = points[index];
    const b = points[index + 1];

    if (segment !== undefined && a && b) {
      if (remaining <= segment || index === lengths.length - 1) {
        const t = segment > 0 ? remaining / segment : 0.5;

        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      }

      remaining -= segment;
    }
  }

  return first;
};

// ----------------------------------------------------------------- подписи

const SYMBOL_COMMANDS: Record<string, string> = {
  α: 'alpha',
  β: 'beta',
  γ: 'gamma',
  δ: 'delta',
  ε: 'varepsilon',
  η: 'eta',
  θ: 'theta',
  λ: 'lambda',
  μ: 'mu',
  ν: 'nu',
  π: 'pi',
  ρ: 'rho',
  σ: 'sigma',
  τ: 'tau',
  φ: 'varphi',
  χ: 'chi',
  ψ: 'psi',
  ω: 'omega',
  Δ: 'Delta',
  Ω: 'Omega',
  Φ: 'Phi',
  Ψ: 'Psi',
  '·': 'cdot',
  '×': 'times',
  '±': 'pm',
  '≤': 'le',
  '≥': 'ge',
  '≠': 'neq',
  '≈': 'approx',
  '∞': 'infty',
  '∝': 'propto',
  '→': 'to',
  '⊙': 'odot',
  '⊗': 'otimes',
  '≅': 'cong',
};

const SYMBOL_PATTERN = new RegExp(`[${Object.keys(SYMBOL_COMMANDS).join('')}]`, 'g');

/** Кириллица со своими пробелами и знаками — одним куском в `\text{…}`. */
const CYRILLIC_RUN = /\s*[Ѐ-ӿ][Ѐ-ӿ\s.,:;!?()-]*/g;

/**
 * Названия функций школьной записи → команды LaTeX. `\tg`, `\ctg`, `\arctg`
 * есть только в русской раскладке babel, `\operatorname` — только с amsmath,
 * поэтому такие названия — оператором из прямых букв: собирается без пакетов.
 */
const FUNCTION_COMMANDS: Record<string, string> = {
  sin: '\\sin',
  cos: '\\cos',
  tan: '\\tan',
  cot: '\\cot',
  arcsin: '\\arcsin',
  arccos: '\\arccos',
  arctan: '\\arctan',
  ln: '\\ln',
  lg: '\\lg',
  log: '\\log',
  exp: '\\exp',
  tg: '\\mathop{\\mathrm{tg}}\\nolimits',
  ctg: '\\mathop{\\mathrm{ctg}}\\nolimits',
  arctg: '\\mathop{\\mathrm{arctg}}\\nolimits',
  arcctg: '\\mathop{\\mathrm{arcctg}}\\nolimits',
  arccot: '\\mathop{\\mathrm{arccot}}\\nolimits',
};

/** Название функции отдельным словом: не часть другого слова и не команда после `\`. */
const FUNCTION_PATTERN = new RegExp(
  `(?<![A-Za-z\\\\])(${Object.keys(FUNCTION_COMMANDS)
    .sort((a, b) => b.length - a.length)
    .join('|')})(?![A-Za-z])`,
  'g',
);

const SUBSCRIPT_DIGITS = '₀₁₂₃₄₅₆₇₈₉';

/** Индекс закрывающей скобки к открывающей в `from`; нет пары — `-1`. */
const matchingParen = (text: string, from: number): number => {
  let depth = 0;
  let index = from;

  while (index < text.length) {
    const char = text.charAt(index);

    if (char === '(') depth += 1;

    if (char === ')') {
      depth -= 1;

      if (depth === 0) return index;
    }

    index += 1;
  }

  return -1;
};

/** `√(…)` и `∛(…)` со скобками любой вложенности → `\sqrt{…}` и `\sqrt[3]{…}`. */
const rootsToLatex = (text: string): string => {
  const at = text.search(/[√∛]\(/);
  const close = at < 0 ? -1 : matchingParen(text, at + 1);

  if (close < 0) return text;

  const command = text.charAt(at) === '∛' ? '\\sqrt[3]' : '\\sqrt';

  return `${text.slice(0, at)}${command}{${rootsToLatex(text.slice(at + 2, close))}}${rootsToLatex(text.slice(close + 1))}`;
};

/** После этих знаков черта `|` открывает модуль, а не закрывает его. */
const OPENS_MODULUS = new Set(['', '(', '[', '{', '+', '-', '−', '*', '·', '/', '^', '=', ',', ';', ':']);

/**
 * Модуль `|…|` → `\left|…\right|`. Черта открывает модуль в начале, после
 * знака действия, скобки или открывающей черты, иначе закрывает. Если черты
 * не сходятся в пары, строка остаётся как была.
 */
const modulusToLatex = (text: string): string => {
  const kinds: Array<'open' | 'close'> = [];
  let depth = 0;
  let previous = '';
  let previousOpened = false;
  let broken = false;

  [...text].forEach((char) => {
    if (char === '|') {
      const opens = depth === 0 || OPENS_MODULUS.has(previous) || (previous === '|' && previousOpened);

      depth += opens ? 1 : -1;
      kinds.push(opens ? 'open' : 'close');
      previousOpened = opens;
    }

    if (!/\s/.test(char)) previous = char;

    broken = broken || depth < 0;
  });

  if (broken || depth !== 0 || kinds.length === 0) return text;

  let bar = 0;

  return text.replace(/\|/g, () => {
    const kind = kinds[bar];

    bar += 1;

    return kind === 'open' ? '\\left|' : '\\right|';
  });
};

/**
 * Подпись из данных → содержимое математического режима. Команды LaTeX,
 * `\text{…}` и слеши остаются как есть; переводится только то, что в `$…$`
 * у pdflatex не компилируется.
 */
export const toLatexMath = (text: string): string => {
  // `\t` из JSON без второго слеша читается как табуляция — это был `\text`.
  let out = rootsToLatex(text.replace(/\t/g, '\\text').trim());
  const hasText = /\\text\s*\{/.test(out);

  // Внутри `\text{…}` названия функций и черты — обычные буквы: их не трогают.
  if (!hasText) out = modulusToLatex(out).replace(FUNCTION_PATTERN, (name: string) => FUNCTION_COMMANDS[name] ?? name);

  out = out
    .replace(/[₀-₉]+/g, (digits) => `_{${[...digits].map((digit) => SUBSCRIPT_DIGITS.indexOf(digit)).join('')}}`)
    .replace(/√(\d+(?:[.,]\d+)?|[A-Za-z])/g, '\\sqrt{$1}')
    .replace(/∛(\d+(?:[.,]\d+)?|[A-Za-z])/g, '\\sqrt[3]{$1}')
    .replace(/√/g, '\\sqrt')
    .replace(/∛/g, '\\sqrt[3]')
    .replace(/°/g, '^{\\circ}')
    // Десятичная запятая между цифрами — в фигурных скобках: иначе LaTeX ставит после неё пробел.
    .replace(/(\d),(?=\d)/g, '$1{,}')
    // После команды нужен пробел только перед буквой: `\alpha x`, но `\alpha_1`.
    .replace(SYMBOL_PATTERN, (char, offset: number, source: string) =>
      `\\${SYMBOL_COMMANDS[char]}${/[A-Za-z]/.test(source[offset + 1] ?? '') ? ' ' : ''}`,
    );

  if (!hasText) out = out.replace(CYRILLIC_RUN, (run) => `\\text{${run}}`);

  return out;
};

/** `$…$` вокруг подписи; если автор уже расставил доллары — строка идёт как есть. */
export const mathLabel = (text: string): string => {
  const trimmed = text.trim();

  if (trimmed.includes('$')) return trimmed;

  return `$${toLatexMath(trimmed)}$`;
};

// ------------------------------------------------------------------- цвета

const XCOLOR_NAMES: ReadonlySet<string> = new Set([
  'red',
  'green',
  'blue',
  'cyan',
  'magenta',
  'yellow',
  'black',
  'gray',
  'white',
  'darkgray',
  'lightgray',
  'brown',
  'lime',
  'olive',
  'orange',
  'pink',
  'purple',
  'teal',
  'violet',
]);

/** Фирменные цвета приложения — именами, чтобы код читался; остальные hex — выражением xcolor. */
const KNOWN_HEX: Record<string, string> = {
  '#2563eb': 'blue',
  '#3b82f6': 'blue',
  '#dc2626': 'red',
  '#ef4444': 'red',
  '#f59e0b': 'orange',
  '#10b981': 'green!60!black',
  '#16a34a': 'green!60!black',
  '#1e293b': 'black',
  '#000000': 'black',
  '#64748b': 'gray',
  '#ec4899': 'magenta',
};

export const tikzColor = (color: string | undefined): string | undefined => {
  if (!color) return undefined;

  const key = color.trim().toLowerCase();

  if (XCOLOR_NAMES.has(key)) return key;

  if (KNOWN_HEX[key]) return KNOWN_HEX[key];

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(key)?.[1];

  if (!hex) return undefined;

  const full = hex.length === 3 ? [...hex].map((digit) => digit + digit).join('') : hex;
  const [r, g, b] = [0, 2, 4].map((offset) => parseInt(full.slice(offset, offset + 2), 16));

  return `{rgb,255:red,${r};green,${g};blue,${b}}`;
};
