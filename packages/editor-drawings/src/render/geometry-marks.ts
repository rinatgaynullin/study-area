import type { AngleStyle } from '../scene/types';
import type { SvgPoint } from './coords';
import { HIGHLIGHT_COLOR, INK, fmt, type SvgBuilder, type StrokeOptions } from './svg-builder';

/**
 * Отметки на чертеже: засечки равенства на рёбрах, дуги и уголки углов,
 * подписи с корнями. Всё в координатах SVG — проекцию делает вызывающий.
 */

/** Половина длины засечки поперёк ребра и шаг между соседними засечками. */
const TICK_HALF_LENGTH = 6;
const TICK_SPACING = 6;
const TICK_WIDTH = 1.2;
const MAX_TICKS = 4;

/** Радиусы дуг отметки угла по стилю: одна, две, три дуги. */
const ARC_RADII: Record<Exclude<AngleStyle, 'right'>, number[]> = {
  single: [14],
  double: [14, 18],
  triple: [14, 18, 22],
};
/** Сторона уголка прямого угла и зазор между последней дугой и подписью. */
const RIGHT_ANGLE_SIZE = 10;
const LABEL_GAP = 12;
const MARK_WIDTH = 1.2;

/** Подложка подсветки: тот же контур шире и полупрозрачно. */
const HIGHLIGHT_STROKE: StrokeOptions = {
  color: HIGHLIGHT_COLOR,
  width: 5,
  opacity: 0.45,
  linecap: 'round',
  linejoin: 'round',
};

/** Юникод для команд LaTeX, которые встречаются в подписях углов и отрезков. */
const MATH_SYMBOLS: Record<string, string> = {
  pi: 'π',
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  theta: 'θ',
  phi: 'φ',
  varphi: 'φ',
  omega: 'ω',
  cdot: '·',
  times: '×',
  pm: '±',
  le: '≤',
  leq: '≤',
  ge: '≥',
  geq: '≥',
  ne: '≠',
  neq: '≠',
  approx: '≈',
  infty: '∞',
  circ: '°',
  degree: '°',
};

/** Допустимый цвет для атрибута: hex, имя или функциональная запись — без кавычек и скобок разметки. */
const SAFE_COLOR = /^(#[0-9a-f]{3,8}|[a-z]+|(rgba?|hsla?)\([\d.%\s,/-]+\))$/i;

/**
 * Цвет из данных сцены, который безопасно класть в атрибут. Строки сцены
 * приходят от нейросети, а `SvgBuilder` подставляет цвет как есть, поэтому
 * всё, что не похоже на цвет, заменяется запасным.
 */
export const safeColor = (value: string | undefined, fallback: string): string =>
  value !== undefined && SAFE_COLOR.test(value) ? value : fallback;

/** Полупрозрачная заливка того же цвета: hex получает альфу `33`, остальное остаётся как есть. */
export const translucent = (color: string): string => (/^#[0-9a-f]{6}$/i.test(color) ? `${color}33` : color);

/** Вектор длиной `distance`, перпендикулярный отрезку `a→b`; нулевой для вырожденного отрезка. */
export const perpendicularOffset = (a: SvgPoint, b: SvgPoint, distance = 8): SvgPoint => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);

  if (length === 0) return { x: 0, y: 0 };

  return { x: (-dy / length) * distance, y: (dx / length) * distance };
};

const unitVector = (from: SvgPoint, to: SvgPoint): SvgPoint | null => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);

  return length === 0 ? null : { x: dx / length, y: dy / length };
};

const shifted = (origin: SvgPoint, direction: SvgPoint, distance: number): SvgPoint => ({
  x: origin.x + direction.x * distance,
  y: origin.y + direction.y * distance,
});

const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));

/**
 * Подпись с математикой в читаемый текст: `\sqrt{3}` → `√3`, `\frac{1}{2}` → `1/2`,
 * `\pi` → `π`, `^\circ` → `°`. Сложный подкоренной аргумент остаётся в скобках,
 * чтобы `√(a+b)` не читалось как `√a + b`.
 */
export const prettifyMathText = (text: string): string =>
  text
    // `(sqrt 3)` — скобки лишние, знак корня сам ограничивает аргумент.
    .replace(/\(\s*(\\?sqrt\s*[0-9a-z]+)\s*\)/gi, '$1')
    .replace(/\\?sqrt\s*(?:\{([^}]*)\}|\(([^)]*)\)|([0-9a-z]+))/gi, (_match, braced?: string, parens?: string, bare?: string) => {
      const inner = (braced ?? parens ?? bare ?? '').trim();

      return /^[0-9a-z]*$/i.test(inner) ? `√${inner}` : `√(${inner})`;
    })
    .replace(/\\frac\s*\{([^}]*)\}\s*\{([^}]*)\}/g, '$1/$2')
    .replace(/\^\s*\\circ/g, '°')
    .replace(/\\([a-zA-Z]+)/g, (match, name: string) => MATH_SYMBOLS[name] ?? match)
    .replace(/\$/g, '');

/**
 * Засечки равенства поперёк ребра `a→b`: от одной до четырёх коротких линий,
 * разложенных вокруг середины с равным шагом.
 */
export const renderEqualityTicks = (builder: SvgBuilder, a: SvgPoint, b: SvgPoint, count: number, color = INK): void => {
  const ticks = clamp(Math.round(count), 0, MAX_TICKS);
  const along = unitVector(a, b);

  if (ticks === 0 || !along) return;

  const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const across = perpendicularOffset(a, b, TICK_HALF_LENGTH);

  for (let index = 0; index < ticks; index += 1) {
    const center = shifted(middle, along, (index - (ticks - 1) / 2) * TICK_SPACING);

    builder.line(
      { x: center.x - across.x, y: center.y - across.y },
      { x: center.x + across.x, y: center.y + across.y },
      { color, width: TICK_WIDTH },
    );
  }
};

export interface AngleMarkOptions {
  /** Вершина угла и точки на его сторонах. */
  vertex: SvgPoint;
  from: SvgPoint;
  to: SvgPoint;
  style: AngleStyle;
  label?: string;
  /** Пикселей на единицу мира — от него зависит кегль подписи. */
  scale?: number;
  highlighted?: boolean;
  color?: string;
}

/**
 * Отметка угла у вершины: уголок для прямого, одна–три дуги для остальных,
 * подпись на биссектрисе за последней дугой. Рисуется всегда меньший из двух
 * углов между сторонами.
 */
export const renderAngleMark = (builder: SvgBuilder, options: AngleMarkOptions): void => {
  const { vertex, style } = options;
  const u = unitVector(vertex, options.from);
  const v = unitVector(vertex, options.to);

  if (!u || !v) return;

  const color = options.color ?? INK;
  const stroke: StrokeOptions = { color, width: MARK_WIDTH };

  if (style === 'right') {
    const corner = [
      shifted(vertex, u, RIGHT_ANGLE_SIZE),
      shifted(vertex, { x: u.x + v.x, y: u.y + v.y }, RIGHT_ANGLE_SIZE),
      shifted(vertex, v, RIGHT_ANGLE_SIZE),
    ];

    if (options.highlighted) builder.polyline(corner, HIGHLIGHT_STROKE);

    builder.polyline(corner, stroke);
  } else {
    // В SVG ось y вниз, поэтому знак векторного произведения выбирает дугу,
    // идущую внутри угла, а не снаружи.
    const sweep = u.x * v.y - u.y * v.x >= 0 ? 1 : 0;

    ARC_RADII[style].forEach((radius) => {
      const start = shifted(vertex, u, radius);
      const end = shifted(vertex, v, radius);
      const arc = `M ${fmt(start.x)} ${fmt(start.y)} A ${fmt(radius)} ${fmt(radius)} 0 0 ${sweep} ${fmt(end.x)} ${fmt(end.y)}`;

      if (options.highlighted) builder.path(arc, HIGHLIGHT_STROKE);

      builder.path(arc, stroke);
    });
  }

  if (!options.label) return;

  // Биссектриса — сумма единичных векторов сторон; у развёрнутого угла она
  // вырождается в ноль, тогда подпись уходит по перпендикуляру к стороне.
  let bisector = { x: u.x + v.x, y: u.y + v.y };
  const bisectorLength = Math.hypot(bisector.x, bisector.y);

  bisector = bisectorLength < 1e-6 ? { x: -u.y, y: u.x } : { x: bisector.x / bisectorLength, y: bisector.y / bisectorLength };

  const radii = style === 'right' ? ARC_RADII.single : ARC_RADII[style];
  const distance = radii[radii.length - 1] + LABEL_GAP;
  const size = clamp(Math.round(10 * ((options.scale ?? 25) / 25)), 9, 18);
  const at = shifted(vertex, bisector, distance);

  builder.text({ x: at.x, y: at.y + size * 0.35 }, prettifyMathText(options.label), { size, color, halo: true });
};
