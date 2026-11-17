import type { CirclePlot, HyperbolaPlot, LinePlot, ParabolaPlot, Plot, SqrtPlot, Vec2 } from '../scene/types';
import { roundTo } from './geometry-utils';

/**
 * Кривые графиков как функции в школьной записи: параметры (`k`, `b`, `a`,
 * `m`, `n`, `c`) из полей сцены и обратно, формула с подставленными числами.
 * Формат сцены не меняется: всё выводится из уже хранимых полей.
 */

export type FunctionPlot = LinePlot | ParabolaPlot | HyperbolaPlot | SqrtPlot | CirclePlot;

/** Запись параболы: «через вершину» `y = a(x − m)² + n` или «общий вид» `y = ax² + bx + c`. */
export type ParabolaForm = 'vertex' | 'standard';

export type FunctionParamId = 'k' | 'b' | 'a' | 'm' | 'n' | 'c';

export interface FunctionParam {
  id: FunctionParamId;
  value: number;
  min: number;
  max: number;
  step: number;
}

/** Часть формулы для показа: текст, буква-переменная, степень, дробь, корень. */
export type FormulaPart =
  | { kind: 'text'; text: string }
  | { kind: 'var'; name: string }
  | { kind: 'sup'; text: string }
  | { kind: 'frac'; num: FormulaPart[]; den: FormulaPart[] }
  | { kind: 'sqrt'; body: FormulaPart[] };

/** Наименьшее растяжение параболы и корня: ноль формат не хранит. */
export const MIN_STRETCH = 0.05;

/** Наименьший по модулю `k` гиперболы. */
export const MIN_HYPERBOLA_K = 0.1;

const DIGITS = 3;

/** Ползунки: множители `a`, `k` — мелким шагом, сдвиги — шагом сетки полотна. */
const SLOPE_RANGE = { min: -5, max: 5, step: 0.1 };
const SHIFT_RANGE = { min: -10, max: 10, step: 0.5 };

/** Две точки прямой с почти равными x — вертикальная прямая `x = c`. */
const VERTICAL_EPSILON = 1e-9;

/** Настоящий минус, а не дефис. */
const MINUS = '−';

const SUPERSCRIPTS: Record<string, string> = { '2': '²', '3': '³' };

/** Кривые, подпись-формула которых верно рисуется и SVG, и TikZ (см. `functionLabel`). */
const LABEL_TYPES: ReadonlySet<Plot['type']> = new Set<Plot['type']>(['line', 'hyperbola', 'sqrt']);

export const isFunctionPlot = (plot: Plot): plot is FunctionPlot =>
  plot.type === 'line' || plot.type === 'parabola' || plot.type === 'hyperbola' || plot.type === 'sqrt' || plot.type === 'circle';

const round = (value: number): number => roundTo(value, DIGITS);

const param = (id: FunctionParamId, value: number, range: { min: number; max: number; step: number }): FunctionParam => ({ id, value: round(value), ...range });

/** Ноль и слишком малые по модулю значения → наименьшее допустимое; у нуля знак прежнего значения. */
const awayFromZero = (value: number, previous: number, least: number): number => {
  if (Math.abs(value) >= least) return value;

  const sign = value === 0 ? Math.sign(previous) : Math.sign(value);

  return sign < 0 ? -least : least;
};

// ------------------------------------------------------------- параметры

type LineCoefficients = { vertical: true; c: number } | { vertical: false; k: number; b: number };

/** Прямая по двум точкам → `y = kx + b` или `x = c`; заданная `k`/`b` — как есть. */
const lineCoefficients = (plot: LinePlot): LineCoefficients => {
  if (plot.p1 && plot.p2) {
    const [x1, y1] = plot.p1;
    const [x2, y2] = plot.p2;

    if (Math.abs(x2 - x1) < VERTICAL_EPSILON) return { vertical: true, c: x1 };

    const k = (y2 - y1) / (x2 - x1);

    return { vertical: false, k, b: y1 - k * x1 };
  }

  return { vertical: false, k: plot.k ?? 0, b: plot.b ?? 0 };
};

/** Вертикальная прямая записывается `x = c`, остальные — `y = kx + b`. */
export const isVerticalLine = (plot: LinePlot): boolean => lineCoefficients(plot).vertical;

const parabolaA = (plot: ParabolaPlot): number => {
  const stretchX = plot.stretchX === 0 ? 1 : plot.stretchX;

  return ((plot.direction === 'down' ? -1 : 1) * plot.stretchY) / (stretchX * stretchX);
};

const sqrtA = (plot: SqrtPlot): number => (plot.directionY === 'down' ? -plot.stretch : plot.stretch);

/** Общий вид параболы из вершины: `b = −2am`, `c = am² + n`. */
const standardCoefficients = (a: number, [m, n]: Vec2): { a: number; b: number; c: number } => ({ a, b: -2 * a * m, c: a * m * m + n });

/** Параметры функции кривой в школьных обозначениях; у окружности и не-функций — пусто. */
export const functionParams = (plot: Plot, form: ParabolaForm): FunctionParam[] => {
  switch (plot.type) {
    case 'line': {
      const line = lineCoefficients(plot);

      return line.vertical ? [param('c', line.c, SHIFT_RANGE)] : [param('k', line.k, SLOPE_RANGE), param('b', line.b, SHIFT_RANGE)];
    }
    case 'parabola': {
      const a = parabolaA(plot);

      if (form === 'standard') {
        const { b, c } = standardCoefficients(a, plot.vertex);

        return [param('a', a, SLOPE_RANGE), param('b', b, SHIFT_RANGE), param('c', c, SHIFT_RANGE)];
      }

      return [param('a', a, SLOPE_RANGE), param('m', plot.vertex[0], SHIFT_RANGE), param('n', plot.vertex[1], SHIFT_RANGE)];
    }
    case 'hyperbola':
      return [param('k', plot.k, SLOPE_RANGE), param('m', plot.center[0], SHIFT_RANGE), param('n', plot.center[1], SHIFT_RANGE)];
    case 'sqrt':
      return [param('a', sqrtA(plot), SLOPE_RANGE), param('m', plot.vertex[0], SHIFT_RANGE), param('n', plot.vertex[1], SHIFT_RANGE)];
    default:
      return [];
  }
};

/** Сдвиг точки по одной оси: `m` — по x, `n` — по y. */
const withShift = ([x, y]: Vec2, id: FunctionParamId, value: number): Vec2 => {
  if (id === 'm') return [value, y];

  if (id === 'n') return [x, value];

  return [x, y];
};

const applyLine = (plot: LinePlot, id: FunctionParamId, value: number): LinePlot => {
  const line = lineCoefficients(plot);

  if (line.vertical) {
    if (id !== 'c' || !plot.p1 || !plot.p2) return plot;

    return { ...plot, p1: [value, plot.p1[1]], p2: [value, plot.p2[1]] };
  }

  if (id !== 'k' && id !== 'b') return plot;

  // Правка `k` или `b` переводит прямую в запись `y = kx + b`: точки больше не нужны.
  const next: LinePlot = { ...plot, k: id === 'k' ? value : round(line.k), b: id === 'b' ? value : round(line.b) };

  delete next.p1;
  delete next.p2;

  return next;
};

/** Множитель `a` параболы → направление и растяжения: `stretchX = 1`, `stretchY = |a|`. */
const parabolaStretch = (a: number): Pick<ParabolaPlot, 'direction' | 'stretchX' | 'stretchY'> => ({
  direction: a < 0 ? 'down' : 'up',
  stretchX: 1,
  stretchY: Math.abs(a),
});

const applyParabola = (plot: ParabolaPlot, form: ParabolaForm, id: FunctionParamId, value: number): ParabolaPlot => {
  const current = parabolaA(plot);

  if (form === 'standard') {
    if (id !== 'a' && id !== 'b' && id !== 'c') return plot;

    const coefficients = standardCoefficients(current, plot.vertex);
    const a = id === 'a' ? awayFromZero(value, current, MIN_STRETCH) : coefficients.a;
    const b = id === 'b' ? value : coefficients.b;
    const c = id === 'c' ? value : coefficients.c;
    // Обратно к вершине: `m = −b / (2a)`, `n = c − b² / (4a)`.
    const vertex: Vec2 = [round(-b / (2 * a)), round(c - (b * b) / (4 * a))];

    return id === 'a' ? { ...plot, ...parabolaStretch(round(a)), vertex } : { ...plot, vertex };
  }

  if (id === 'a') return { ...plot, ...parabolaStretch(round(awayFromZero(value, current, MIN_STRETCH))) };

  if (id === 'm' || id === 'n') return { ...plot, vertex: withShift(plot.vertex, id, value) };

  return plot;
};

const applySqrt = (plot: SqrtPlot, id: FunctionParamId, value: number): SqrtPlot => {
  if (id === 'a') {
    const a = round(awayFromZero(value, sqrtA(plot), MIN_STRETCH));

    return { ...plot, directionY: a < 0 ? 'down' : 'up', stretch: Math.abs(a) };
  }

  if (id === 'm' || id === 'n') return { ...plot, vertex: withShift(plot.vertex, id, value) };

  return plot;
};

const applyHyperbola = (plot: HyperbolaPlot, id: FunctionParamId, value: number): HyperbolaPlot => {
  if (id === 'k') return { ...plot, k: round(awayFromZero(value, plot.k, MIN_HYPERBOLA_K)) };

  if (id === 'm' || id === 'n') return { ...plot, center: withShift(plot.center, id, value) };

  return plot;
};

/**
 * Новая кривая с изменённым параметром; вход не меняется. Поля, которых
 * параметр не касается, и чужие поля элемента копируются как были.
 */
export const applyFunctionParam = (plot: Plot, form: ParabolaForm, id: FunctionParamId, value: number): Plot => {
  if (!Number.isFinite(value)) return plot;

  const rounded = round(value);

  switch (plot.type) {
    case 'line':
      return applyLine(plot, id, rounded);
    case 'parabola':
      return applyParabola(plot, form, id, rounded);
    case 'sqrt':
      return applySqrt(plot, id, rounded);
    case 'hyperbola':
      return applyHyperbola(plot, id, rounded);
    default:
      return plot;
  }
};

// ---------------------------------------------------------------- формула

const decimalSeparator = (locale: string): string => (locale.toLowerCase().startsWith('en') ? '.' : ',');

/** Число по локали: настоящий минус, без незначащих нулей, не больше трёх знаков. */
export const formatNumber = (value: number, locale: string): string => {
  const rounded = round(value);
  const digits = String(Math.abs(rounded)).replace('.', decimalSeparator(locale));

  return rounded < 0 ? `${MINUS}${digits}` : digits;
};

const text = (value: string): FormulaPart => ({ kind: 'text', text: value });

const variable = (name: string): FormulaPart => ({ kind: 'var', name });

const SQUARE: FormulaPart = { kind: 'sup', text: '2' };

/** Знак слагаемого после первого — с пробелами вокруг. */
const sign = (value: number): string => (value < 0 ? ` ${MINUS} ` : ' + ');

/** `x − m`: нулевой сдвиг не пишется, `x − (−2)` → `x + 2`. */
const shifted = (name: string, shift: number, locale: string): FormulaPart[] => {
  const value = round(shift);

  return value === 0 ? [variable(name)] : [variable(name), text(`${sign(-value)}${formatNumber(Math.abs(value), locale)}`)];
};

/** Квадрат сдвинутой переменной: `x²` или `(x − 1)²`. */
const shiftedSquare = (name: string, shift: number, locale: string): FormulaPart[] =>
  round(shift) === 0 ? [variable(name), SQUARE] : [text('('), ...shifted(name, shift, locale), text(')'), SQUARE];

/** Множитель перед выражением: 1 не пишется, −1 — одним минусом. */
const leading = (coefficient: number, locale: string): FormulaPart[] => {
  const value = round(coefficient);

  if (value === 1) return [];

  if (value === -1) return [text(MINUS)];

  return [text(formatNumber(value, locale))];
};

/** Свободное слагаемое: ` + 3`, ` − 3`; ноль не пишется. */
const constantTerm = (value: number, locale: string): FormulaPart[] => {
  const rounded = round(value);

  return rounded === 0 ? [] : [text(`${sign(rounded)}${formatNumber(Math.abs(rounded), locale)}`)];
};

/** Слагаемое с переменной: ` + 3x`, ` − x`; ноль не пишется. */
const variableTerm = (coefficient: number, name: string, locale: string): FormulaPart[] => {
  const value = round(coefficient);
  const magnitude = Math.abs(value);

  if (value === 0) return [];

  return [text(`${sign(value)}${magnitude === 1 ? '' : formatNumber(magnitude, locale)}`), variable(name)];
};

/** Подкоренное выражение: `x − m`, а для ветви влево — `m − x`. */
const sqrtBody = (plot: SqrtPlot, locale: string): FormulaPart[] => {
  if (plot.directionX !== 'left') return shifted('x', plot.vertex[0], locale);

  const m = round(plot.vertex[0]);

  return m === 0 ? [text(MINUS), variable('x')] : [text(`${formatNumber(m, locale)} ${MINUS} `), variable('x')];
};

const Y_EQUALS: FormulaPart[] = [variable('y'), text(' = ')];

const lineFormula = (plot: LinePlot, locale: string): FormulaPart[] => {
  const line = lineCoefficients(plot);

  if (line.vertical) return [variable('x'), text(' = '), text(formatNumber(line.c, locale))];

  if (round(line.k) === 0) return [...Y_EQUALS, text(formatNumber(line.b, locale))];

  return [...Y_EQUALS, ...leading(line.k, locale), variable('x'), ...constantTerm(line.b, locale)];
};

const parabolaFormula = (plot: ParabolaPlot, form: ParabolaForm, locale: string): FormulaPart[] => {
  const a = parabolaA(plot);

  if (form === 'standard') {
    const { b, c } = standardCoefficients(a, plot.vertex);

    return [...Y_EQUALS, ...leading(a, locale), variable('x'), SQUARE, ...variableTerm(b, 'x', locale), ...constantTerm(c, locale)];
  }

  return [...Y_EQUALS, ...leading(a, locale), ...shiftedSquare('x', plot.vertex[0], locale), ...constantTerm(plot.vertex[1], locale)];
};

const hyperbolaFormula = (plot: HyperbolaPlot, locale: string): FormulaPart[] => {
  const k = round(plot.k);
  const fraction: FormulaPart = { kind: 'frac', num: [text(formatNumber(Math.abs(k), locale))], den: shifted('x', plot.center[0], locale) };

  return [...Y_EQUALS, ...(k < 0 ? [text(MINUS)] : []), fraction, ...constantTerm(plot.center[1], locale)];
};

const sqrtFormula = (plot: SqrtPlot, locale: string): FormulaPart[] => [
  ...Y_EQUALS,
  ...leading(sqrtA(plot), locale),
  { kind: 'sqrt', body: sqrtBody(plot, locale) },
  ...constantTerm(plot.vertex[1], locale),
];

const circleFormula = (plot: CirclePlot, locale: string): FormulaPart[] => [
  ...shiftedSquare('x', plot.center[0], locale),
  text(' + '),
  ...shiftedSquare('y', plot.center[1], locale),
  text(' = '),
  text(formatNumber(plot.radius * plot.radius, locale)),
];

/** Формула кривой для показа частями; у не-функций — `null`. */
export const describeFunction = (plot: Plot, form: ParabolaForm, locale: string): FormulaPart[] | null => {
  switch (plot.type) {
    case 'line':
      return lineFormula(plot, locale);
    case 'parabola':
      return parabolaFormula(plot, form, locale);
    case 'hyperbola':
      return hyperbolaFormula(plot, locale);
    case 'sqrt':
      return sqrtFormula(plot, locale);
    case 'circle':
      return circleFormula(plot, locale);
    default:
      return null;
  }
};

/** Как записать части одной строкой: для чтения (`x²`, `−`) или для подписи на чертеже (`x^2`, `-`). */
type Flavor = 'plain' | 'label';

const flatten = (parts: FormulaPart[], flavor: Flavor): string => parts.map((part) => flattenPart(part, flavor)).join('');

/** Выражение из одной части — без скобок: `3/x`, `√x`; длиннее — в скобках. */
const grouped = (parts: FormulaPart[], flavor: Flavor): string => (parts.length > 1 ? `(${flatten(parts, flavor)})` : flatten(parts, flavor));

const flattenPart = (part: FormulaPart, flavor: Flavor): string => {
  switch (part.kind) {
    case 'text':
      return flavor === 'label' ? part.text.split(MINUS).join('-') : part.text;
    case 'var':
      return part.name;
    case 'sup':
      return flavor === 'label' ? `^${part.text}` : (SUPERSCRIPTS[part.text] ?? `^${part.text}`);
    case 'frac':
      return `${grouped(part.num, flavor)}/${grouped(part.den, flavor)}`;
    case 'sqrt':
      return `√${grouped(part.body, flavor)}`;
    default:
      return '';
  }
};

/** Формула одной строкой — для `aria-label` и тестов; у не-функций — пустая строка. */
export const functionText = (plot: Plot, form: ParabolaForm, locale: string): string => {
  const parts = describeFunction(plot, form, locale);

  return parts ? flatten(parts, 'plain') : '';
};

/** Можно ли подписать кривую формулой так, чтобы подпись верно нарисовали оба рендера. */
export const canLabelWithFormula = (plot: Plot): boolean => LABEL_TYPES.has(plot.type);

/**
 * Подпись-формула для поля `label`. Рендер SVG показывает подпись почти как
 * есть, TikZ кладёт её в `$…$` и переводит `√(…)` в `\sqrt{…}`; поэтому
 * минус — дефис, дробь — `3/(x - 1)`, корень — `√(x - 1)`. Степень так не
 * записать: SVG показал бы `^2` буквально, а `²` не компилируется в
 * математическом режиме TikZ, — у параболы и окружности подписи-формулы нет.
 */
export const functionLabel = (plot: Plot, form: ParabolaForm, locale: string): string | null => {
  const parts = canLabelWithFormula(plot) ? describeFunction(plot, form, locale) : null;

  return parts ? flatten(parts, 'label') : null;
};

const normalizeLabel = (label: string): string => label.replace(/\s+/g, '').split(MINUS).join('-').replace(/\./g, ',');

/** Подпись кривой — её формула: такую подпись конструктор ведёт сам. Пробелы и разделитель не мешают. */
export const isFunctionLabel = (label: string | undefined, plot: Plot, form: ParabolaForm, locale: string): boolean => {
  const formula = functionLabel(plot, form, locale);

  return label !== undefined && formula !== null && normalizeLabel(label) === normalizeLabel(formula);
};
