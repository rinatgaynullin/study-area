import type { Vec2 } from '../scene/types';
import { evaluateFunction, type FunctionNode } from './function-expr';
import { distanceToSegment, roundTo } from './geometry-utils';

/**
 * Точки графика набранной функции для видимого окна: ветви-ломаные, которые
 * сцена хранит как `freehand`. Разрывы (`1/x`, `tg x`), края области
 * определения и выход за край рисунка обрывают ветвь. Модуль без DOM.
 */

export interface SampleOptions {
  /** Видимый отрезок по x. */
  from: number;
  to: number;
  /** Видимый отрезок по y. */
  yFrom: number;
  yTo: number;
  /** Ограничение по x; бесконечные концы — без ограничения с той стороны. */
  domain?: [number, number];
  /** Шаг по x; по умолчанию — около 1/300 ширины. */
  step?: number;
  /** Половина пикселя в единицах мира: точность упрощения ломаной. По умолчанию — по шагу. */
  tolerance?: number;
}

/** Запас за краем окна с каждой стороны — доля ширины и высоты. */
const MARGIN = 0.05;
const STEPS = 300;
/** Знаков у координат точек. */
const DIGITS = 3;
/** Шагов деления пополам при поиске края области и пересечения с границей. */
const BISECTIONS = 50;

type Sample = Vec2;

/** Где значение относительно окна по y: внутри, выше или ниже. */
type Place = 'in' | 'above' | 'below';

/** Точки, лежащие на прямой с соседями точнее `tolerance`, выбрасываются: у прямой остаются два конца. */
const simplify = (points: Vec2[], tolerance: number): Vec2[] => {
  const first = points[0];
  const last = points[points.length - 1];

  if (points.length < 3 || !first || !last) return points;

  let farthest = 0;
  let index = 0;

  points.forEach((point, position) => {
    if (position === 0 || position === points.length - 1) return;

    const gap = distanceToSegment(point, first, last);

    if (gap > farthest) {
      farthest = gap;
      index = position;
    }
  });

  if (farthest <= tolerance) return [first, last];

  return [...simplify(points.slice(0, index + 1), tolerance).slice(0, -1), ...simplify(points.slice(index), tolerance)];
};

const rounded = (points: Vec2[]): Vec2[] =>
  points
    .map(([x, y]): Vec2 => [roundTo(x, DIGITS), roundTo(y, DIGITS)])
    .filter((point, index, all) => {
      const previous = all[index - 1];

      return !previous || previous[0] !== point[0] || previous[1] !== point[1];
    });

/**
 * Обход графика слева направо. Текущая ветвь, готовые ветви, окно и
 * функция — общее состояние шагов обхода, поэтому класс.
 */
class Sampler {
  readonly branches: Vec2[][] = [];

  private current: Vec2[] = [];

  private readonly low: number;

  private readonly high: number;

  /** Скачок по y больше этого между соседними точками проверяется на разрыв. */
  private readonly jump: number;

  constructor(
    private readonly f: (x: number) => number,
    yFrom: number,
    yTo: number,
  ) {
    const span = Math.abs(yTo - yFrom) || 1;

    this.low = Math.min(yFrom, yTo) - span * MARGIN;
    this.high = Math.max(yFrom, yTo) + span * MARGIN;
    this.jump = span / 2;
  }

  /** Обход по точкам `xs`: пары соседних точек разбираются по очереди. */
  run(xs: number[]): void {
    const samples = xs.map((x): Sample => [x, this.f(x)]);
    const [first] = samples;

    if (first && Number.isFinite(first[1]) && this.place(first[1]) === 'in') this.push(first);

    samples.forEach((sample, index) => {
      const previous = samples[index - 1];

      if (previous) this.pair(previous, sample);
    });
    this.end();
  }

  private place(y: number): Place {
    if (y > this.high) return 'above';

    return y < this.low ? 'below' : 'in';
  }

  private push(point: Vec2): void {
    this.current.push(point);
  }

  private end(): void {
    if (this.current.length > 1) this.branches.push(this.current);

    this.current = [];
  }

  private pair(a: Sample, b: Sample): void {
    const aFinite = Number.isFinite(a[1]);
    const bFinite = Number.isFinite(b[1]);

    if (aFinite && bFinite) {
      const gap = this.gapBetween(a, b);

      if (!gap) {
        this.continuous(a, b);

        return;
      }

      // Разрыв: ветвь доводится до него слева, новая начинается справа.
      this.continuous(a, gap.left);
      this.end();

      if (this.place(gap.right[1]) === 'in') this.push(gap.right);

      this.continuous(gap.right, b);

      return;
    }

    if (aFinite) {
      this.continuous(a, this.edge(a, b));
      this.end();

      return;
    }

    if (bFinite) {
      const start = this.edge(b, a);

      this.end();

      if (this.place(start[1]) === 'in') this.push(start);

      this.continuous(start, b);

      return;
    }

    this.end();
  }

  /**
   * Кусок без разрыва от `a` до `b`; `a`, если он в окне, уже в ветви.
   * Выход за край окна — точка пересечения с краем и конец ветви, вход — начало новой.
   */
  private continuous(a: Sample, b: Sample): void {
    const from = this.place(a[1]);
    const to = this.place(b[1]);

    if (from === 'in' && to === 'in') {
      this.push(b);

      return;
    }

    if (from === 'in') {
      this.push(this.cross(a, b, to));
      this.end();

      return;
    }

    if (to === 'in') {
      this.end();
      this.push(this.cross(a, b, from));
      this.push(b);

      return;
    }

    // Обе точки за окном по разные стороны: график пересекает окно целиком между ними.
    if (from !== to) {
      this.end();
      this.push(this.cross(a, b, from));
      this.push(this.cross(a, b, to));
      this.end();
    }
  }

  /** Точка, где кусок без разрыва пересекает край окна `side`: делением пополам. */
  private cross(a: Sample, b: Sample, side: Place): Vec2 {
    const level = side === 'above' ? this.high : this.low;
    const aboveA = a[1] > level;
    let left = a[0];
    let right = b[0];

    Array.from({ length: BISECTIONS }).forEach(() => {
      const middle = (left + right) / 2;
      const y = this.f(middle);

      if (Number.isFinite(y) && y > level === aboveA) left = middle;
      else right = middle;
    });

    return [(left + right) / 2, level];
  }

  /** Последняя точка с конечным значением между `finite` и `missing` — край области определения. */
  private edge(finite: Sample, missing: Sample): Sample {
    let inside = finite;
    let outside = missing[0];

    Array.from({ length: BISECTIONS }).forEach(() => {
      const middle = (inside[0] + outside) / 2;
      const y = this.f(middle);

      if (Number.isFinite(y)) inside = [middle, y];
      else outside = middle;
    });

    return inside;
  }

  /**
   * Разрыв между соседними точками: большой скачок, который не уменьшается
   * при делении отрезка пополам (у непрерывной функции он тает), или точка
   * вне области определения между ними. `null` — разрыва нет.
   */
  private gapBetween(a: Sample, b: Sample): { left: Sample; right: Sample } | null {
    if (Math.abs(b[1] - a[1]) <= this.jump) return null;

    let left = a;
    let right = b;
    let iteration = 0;

    while (iteration < BISECTIONS && Math.abs(right[1] - left[1]) > this.jump) {
      const x = (left[0] + right[0]) / 2;
      const middle: Sample = [x, this.f(x)];

      if (!Number.isFinite(middle[1])) return { left: this.edge(left, middle), right: this.edge(right, middle) };

      // Дальше — в ту половину, где скачок больше.
      if (Math.abs(middle[1] - left[1]) >= Math.abs(right[1] - middle[1])) right = middle;
      else left = middle;

      iteration += 1;
    }

    return Math.abs(right[1] - left[1]) > this.jump ? { left, right } : null;
  }
}

/**
 * Ветви графика для окна `[from; to] × [yFrom; yTo]` (с запасом 5% с каждой
 * стороны), обрезанные областью `domain`: ломаные с координатами до 3 знаков,
 * без лишних точек на прямых участках; ветви из одной точки отброшены.
 */
export const sampleFunction = (ast: FunctionNode, params: Record<string, number>, options: SampleOptions): Vec2[][] => {
  const width = Math.abs(options.to - options.from) || 1;
  const low = Math.min(options.from, options.to) - width * MARGIN;
  const high = Math.max(options.from, options.to) + width * MARGIN;
  const from = options.domain ? Math.max(low, options.domain[0]) : low;
  const to = options.domain ? Math.min(high, options.domain[1]) : high;

  if (!(to > from)) return [];

  const step = options.step && options.step > 0 ? options.step : width / STEPS;
  const count = Math.max(1, Math.ceil((to - from) / step));
  const xs = Array.from({ length: count + 1 }, (_, index) => (index === count ? to : from + index * step));
  const sampler = new Sampler((x) => evaluateFunction(ast, x, params), options.yFrom, options.yTo);
  const tolerance = options.tolerance ?? step / 4;

  sampler.run(xs);

  return sampler.branches.map((branch) => rounded(simplify(branch, tolerance))).filter((branch) => branch.length > 1);
};
