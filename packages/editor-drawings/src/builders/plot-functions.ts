import type { HyperbolaPlot, LinePlot, ParabolaPlot, Plot, SqrtPlot } from '../scene/types';
import { roundTo } from './geometry-utils';

/**
 * Готовые кривые графиков (прямая `y = kx + b`, парабола, гипербола, корень)
 * как запись функции: из полей сцены получается строка, которую понимает
 * `parseFunction` (`2(x-1)^2-3`). Она показывается в поле ввода блока
 * «Функция»; изменённая запись превращает кривую в набранную функцию.
 */

/** Кривая, которую можно записать функцией `y = …`: отрезок по двум точкам и вертикальная прямая — нет. */
export type ReadyFunctionPlot = LinePlot | ParabolaPlot | HyperbolaPlot | SqrtPlot;

/** Наименьшее растяжение параболы: ноль формат не хранит (так же — у распознанной карандашом). */
export const MIN_STRETCH = 0.05;

/** Наименьший радиус окружности. */
export const MIN_RADIUS = 0.5;

/** Знаков после запятой в записи. */
const DIGITS = 2;

/**
 * Знаков у вершины и растяжений параболы и у точек прямой — в состоянии и в
 * сцене: так их сохраняет конструктор.
 */
export const FINE_DIGITS = 4;

/** Больше знаков после запятой множитель не показывает: иначе `String` даст запись `1e-7`. */
const TINY_DIGITS = 6;

/** Наименьший по модулю множитель для показа. */
const TINY = 10 ** -TINY_DIGITS;

const round = (value: number): number => roundTo(value, DIGITS);

export const isReadyFunction = (plot: Plot): plot is ReadyFunctionPlot =>
  (plot.type === 'line' && !(plot.p1 && plot.p2)) || plot.type === 'parabola' || plot.type === 'hyperbola' || plot.type === 'sqrt';

/**
 * Множитель для показа: два знака, но ненулевой множитель, который при
 * округлении стал бы нулём (`a = 0,002`), — двумя значащими цифрами. Если и
 * их не видно в `TINY_DIGITS` знаках, — `TINY` с его знаком.
 */
const multiplier = (value: number): number => {
  const rounded = round(value);

  if (rounded !== 0 || value === 0) return rounded;

  const significant = Number(value.toPrecision(2));

  if (roundTo(significant, TINY_DIGITS) === significant) return significant;

  return value < 0 ? -TINY : TINY;
};

/** Модуль числа с разделителем `separator` (`,` или `.`). */
const digits = (value: number, separator: string): string => String(Math.abs(value)).replace('.', separator === '.' ? '.' : ',');

/** Число со знаком: `-2`, `0,5`. */
const signed = (value: number, separator: string): string => `${value < 0 ? '-' : ''}${digits(value, separator)}`;

/** Множитель перед выражением: 1 не пишется, −1 — одним минусом. */
const leading = (value: number, separator: string): string => {
  if (value === 1) return '';

  return value === -1 ? '-' : signed(value, separator);
};

/** Слагаемое: `+3`, `-3`; ноль не пишется. */
const term = (value: number, separator: string): string => {
  const rounded = round(value);

  if (rounded === 0) return '';

  return `${rounded < 0 ? '-' : '+'}${digits(rounded, separator)}`;
};

/** `x-m`: нулевой сдвиг не пишется, `x-(-2)` → `x+2`. */
const shifted = (shift: number, separator: string): string => `x${term(-shift, separator)}`;

const parabolaA = (plot: ParabolaPlot): number => {
  const stretchX = plot.stretchX === 0 ? 1 : plot.stretchX;

  return ((plot.direction === 'down' ? -1 : 1) * plot.stretchY) / (stretchX * stretchX);
};

const lineExpression = (plot: LinePlot, separator: string): string => {
  const k = round(plot.k ?? 0);

  if (k === 0) return signed(round(plot.b ?? 0), separator);

  return `${leading(k, separator)}x${term(plot.b ?? 0, separator)}`;
};

const parabolaExpression = (plot: ParabolaPlot, separator: string): string => {
  const [m, n] = plot.vertex;
  const square = round(m) === 0 ? 'x^2' : `(${shifted(m, separator)})^2`;

  return `${leading(multiplier(parabolaA(plot)), separator)}${square}${term(n, separator)}`;
};

const hyperbolaExpression = (plot: HyperbolaPlot, separator: string): string => {
  const k = multiplier(plot.k);
  const [m, n] = plot.center;
  const denominator = round(m) === 0 ? 'x' : `(${shifted(m, separator)})`;

  return `${k < 0 ? '-' : ''}${digits(k, separator)}/${denominator}${term(n, separator)}`;
};

const sqrtExpression = (plot: SqrtPlot, separator: string): string => {
  const [m, n] = plot.vertex;
  const a = multiplier(plot.directionY === 'down' ? -plot.stretch : plot.stretch);
  const shift = round(m);
  // Ветвь влево — `√(m − x)`.
  const left = shift === 0 ? '-x' : `${signed(shift, separator)}-x`;
  const body = plot.directionX === 'left' ? left : shifted(m, separator);

  return `${leading(a, separator)}sqrt(${body})${term(n, separator)}`;
};

/**
 * Запись готовой кривой для поля ввода: `2(x-1)^2-3`, `1/x`, `-sqrt(x)`; у
 * отрезка, вертикальной прямой, окружности и прочего — `null`.
 */
export const plotExpression = (plot: Plot, separator: string): string | null => {
  switch (plot.type) {
    case 'line':
      return isReadyFunction(plot) ? lineExpression(plot, separator) : null;
    case 'parabola':
      return parabolaExpression(plot, separator);
    case 'hyperbola':
      return hyperbolaExpression(plot, separator);
    case 'sqrt':
      return sqrtExpression(plot, separator);
    default:
      return null;
  }
};
