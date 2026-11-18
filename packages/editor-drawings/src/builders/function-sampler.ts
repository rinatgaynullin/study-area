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
  /** Шаг по x; по умолчанию — около 1/300 ширины, не мельче 1/5000 отрезка. */
  step?: number;
  /** Половина пикселя в единицах мира: точность упрощения ломаной. По умолчанию — по шагу. */
  tolerance?: number;
}

/** Запас за краем окна с каждой стороны — доля ширины и высоты. */
const MARGIN = 0.05;
const STEPS = 300;
/** Шаг по x не мельче этой доли отрезка: не больше 5000 шагов на вызов. */
const MIN_STEP_SHARE = 1 / 5000;
/** Знаков у координат точек. */
const DIGITS = 3;
/** Шагов деления пополам при поиске края области и пересечения с границей. */
const BISECTIONS = 50;
/** Уровней уточнения пары соседних точек при поиске разрыва. */
const DEPTH = 12;
/** Допуск проверки «значение между соседями» — доля высоты окна. */
const TOLERANCE = 1e-3;
/** Предел вычислений функции на вызов: дальше пары не уточняются, пересечения — грубее. */
export const MAX_EVALUATIONS = 60_000;
/** Предел точек во всех ветвях одного вызова (до упрощения). */
export const MAX_POINTS = 12_000;
/** Расширений отрезка по x при поиске запасных ветвей, каждое — в 10 раз. */
const WIDENINGS = 4;
/** Высота полосы запасных ветвей вместе с запасом — в высотах окна. */
const BAND = 3;

type Sample = Vec2;

/** Где значение относительно окна по y: внутри, выше или ниже. */
type Place = 'in' | 'above' | 'below';

/** Разрыв между соседними точками: ветвь доводится до `left`, новая начинается с `right`. */
interface Gap {
  left: Sample;
  right: Sample;
}

/** Значения идут в одну сторону (с допуском `tolerance`): вверх или вниз. */
const monotone = (values: number[], tolerance: number): boolean => {
  const steps = values.slice(1).map((value, index) => value - (values[index] ?? value));

  return steps.every((step) => step >= -tolerance) || steps.every((step) => step <= tolerance);
};

/** Сетка по x: видимый отрезок с запасом 5%, пересечённый с `domain`, и шаг. */
const gridOf = (options: Pick<SampleOptions, 'from' | 'to' | 'domain' | 'step'>): { xs: number[]; step: number } => {
  const width = Math.abs(options.to - options.from) || 1;
  const low = Math.min(options.from, options.to) - width * MARGIN;
  const high = Math.max(options.from, options.to) + width * MARGIN;
  const from = options.domain ? Math.max(low, options.domain[0]) : low;
  const to = options.domain ? Math.min(high, options.domain[1]) : high;
  const wanted = options.step && options.step > 0 ? options.step : width / STEPS;

  if (!(to > from)) return { xs: [], step: wanted };

  const step = Math.max(wanted, (to - from) * MIN_STEP_SHARE);
  const count = Math.max(1, Math.ceil((to - from) / step));

  return { xs: Array.from({ length: count + 1 }, (_, index) => (index === count ? to : from + index * step)), step };
};

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
 * Обход графика слева направо. Текущая ветвь, готовые ветви, окно, функция и
 * счётчики вычислений и точек — общее состояние шагов обхода, поэтому класс.
 */
class Sampler {
  readonly branches: Vec2[][] = [];

  private current: Vec2[] = [];

  private readonly low: number;

  private readonly high: number;

  /** Высота окна вместе с запасом. */
  private readonly span: number;

  /** Сколько раз функция уже вычислена. */
  private spent = 0;

  /** Сколько точек уже в ветвях. */
  private points = 0;

  constructor(
    private readonly f: (x: number) => number,
    yFrom: number,
    yTo: number,
  ) {
    const span = Math.abs(yTo - yFrom) || 1;

    this.low = Math.min(yFrom, yTo) - span * MARGIN;
    this.high = Math.max(yFrom, yTo) + span * MARGIN;
    this.span = this.high - this.low;
  }

  /** Обход по точкам `xs`: пары соседних точек разбираются по очереди, пока не набран предел точек. */
  run(xs: number[]): void {
    const samples = xs.map((x): Sample => [x, this.evaluate(x)]);
    const [first] = samples;

    if (first && Number.isFinite(first[1]) && this.place(first[1]) === 'in') this.push(first);

    samples.some((sample, index) => {
      const previous = samples[index - 1];

      if (previous) this.pair(previous, sample);

      return this.points >= MAX_POINTS;
    });
    this.end();
  }

  private evaluate(x: number): number {
    this.spent += 1;

    return this.f(x);
  }

  /** В пределе вычислений есть место ещё для `count`. */
  private room(count: number): boolean {
    return this.spent + count <= MAX_EVALUATIONS;
  }

  private place(y: number): Place {
    if (y > this.high) return 'above';

    return y < this.low ? 'below' : 'in';
  }

  private push(point: Vec2): void {
    if (this.points >= MAX_POINTS) return;

    this.current.push(point);
    this.points += 1;
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
    let iteration = 0;

    while (iteration < BISECTIONS && this.room(1)) {
      const middle = (left + right) / 2;
      const y = this.evaluate(middle);

      if (Number.isFinite(y) && y > level === aboveA) left = middle;
      else right = middle;

      iteration += 1;
    }

    return [(left + right) / 2, level];
  }

  /** Последняя точка с конечным значением между `finite` и `missing` — край области определения. */
  private edge(finite: Sample, missing: Sample): Sample {
    let inside = finite;
    let outside = missing[0];
    let iteration = 0;

    while (iteration < BISECTIONS && this.room(1)) {
      const middle = (inside[0] + outside) / 2;
      const y = this.evaluate(middle);

      if (Number.isFinite(y)) inside = [middle, y];
      else outside = middle;

      iteration += 1;
    }

    return inside;
  }

  /** Между `left` и `right` есть точка `missing` вне области определения: края области с обеих сторон. */
  private hole(left: Sample, right: Sample, missing: Sample): Gap {
    return { left: this.edge(left, missing), right: this.edge(right, missing) };
  }

  /** Насколько значение за окном по высоте; в окне — ноль. */
  private beyond(y: number): number {
    return Math.max(y - this.high, this.low - y, 0);
  }

  /**
   * Разрыв между соседними точками; `null` — разрыва нет, точки соединяются.
   * Значение в середине между значениями на концах (а затем и в четвертях —
   * все пять по порядку в одну сторону) — кусок без разрыва. Иначе пара
   * уточняется делением. Порог от высоты окна не нужен: при широком окне
   * соседние точки по разные стороны асимптоты отличаются мало, но середина
   * между ними выдаёт полюс.
   */
  private gapBetween(a: Sample, b: Sample): Gap | null {
    // Без вычислений в запасе — прежнее грубое правило: скачок больше половины окна.
    if (!this.room(3)) return Math.abs(b[1] - a[1]) > this.span / 2 ? { left: a, right: b } : null;

    const tolerance = this.span * TOLERANCE;
    const middle = this.halfway(a, b);

    if (!Number.isFinite(middle[1])) return this.hole(a, b, middle);

    if (!monotone([a[1], middle[1], b[1]], tolerance)) return this.refine(a, b, middle, [middle]);

    // Полюс без смены знака у самого конца пары (`1/x^2`) середину не выдаёт — его выдают четверти.
    const quarters = [a[0] + (b[0] - a[0]) / 4, a[0] + ((b[0] - a[0]) * 3) / 4].map((x): Sample => [x, this.evaluate(x)]);
    const missing = quarters.find(([, y]) => !Number.isFinite(y));

    if (missing) return this.hole(a, b, missing);

    const [first, third] = quarters;

    if (first && third && monotone([a[1], first[1], middle[1], third[1], b[1]], tolerance)) return null;

    return this.refine(a, b, middle, [middle, ...quarters]);
  }

  /** Середина отрезка между двумя точками с вычисленным значением. */
  private halfway(from: Sample, to: Sample): Sample {
    const x = (from[0] + to[0]) / 2;

    return [x, this.evaluate(x)];
  }

  /**
   * Уточнение пары с серединой `middle`: у каждой половины считается своя
   * середина, дальше — в половину, где значения не идут в одну сторону (там
   * полюс или излом), а если таких две или ни одной — где скачок больше; не
   * глубже `DEPTH` уровней. На последнем отрезке значения разошлись больше
   * высоты окна или оба ушли за окно с одной стороны — разрыв там. Сошлись,
   * но по дороге (`seen` — точки, уже вычисленные внутри пары) значение
   * уходило за окно — разрыв в самой дальней такой точке: ветвь обрывается у
   * границы окна с обеих сторон от неё (так и полюс без смены знака, который
   * деление обошло стороной, не соединяется через асимптоту). Иначе — кусок
   * без разрыва.
   */
  private refine(a: Sample, b: Sample, middle: Sample, seen: Sample[]): Gap | null {
    const tolerance = this.span * TOLERANCE;
    const visited = [...seen];
    let left = a;
    let right = b;
    let centre = middle;
    let depth = 0;

    while (depth < DEPTH && this.room(2)) {
      const leftQuarter = this.halfway(left, centre);
      const rightQuarter = this.halfway(centre, right);

      if (!Number.isFinite(leftQuarter[1])) return this.hole(left, centre, leftQuarter);

      if (!Number.isFinite(rightQuarter[1])) return this.hole(centre, right, rightQuarter);

      visited.push(leftQuarter, rightQuarter);

      const leftBent = !monotone([left[1], leftQuarter[1], centre[1]], tolerance);
      const rightBent = !monotone([centre[1], rightQuarter[1], right[1]], tolerance);
      const toLeft = leftBent === rightBent ? Math.abs(centre[1] - left[1]) >= Math.abs(right[1] - centre[1]) : leftBent;

      if (toLeft) {
        right = centre;
        centre = leftQuarter;
      } else {
        left = centre;
        centre = rightQuarter;
      }

      depth += 1;
    }

    const side = this.place(left[1]);
    const apart = Math.abs(right[1] - left[1]) > this.span;
    const away = side !== 'in' && side === this.place(right[1]);

    if (apart || away) return { left, right };

    const farthest = visited.reduce<Sample | null>((best, sample) => {
      if (this.beyond(sample[1]) === 0) return best;

      return !best || this.beyond(sample[1]) > this.beyond(best[1]) ? sample : best;
    }, null);

    return farthest ? { left: farthest, right: farthest } : null;
  }
}

/**
 * Ветви кривой `f` для окна `[from; to] × [yFrom; yTo]` (с запасом 5% с
 * каждой стороны), обрезанные областью `domain`: ломаные с координатами до
 * 3 знаков, без лишних точек на прямых участках; ветви из одной точки
 * отброшены. Шаг — не мельче 1/5000 отрезка, вычислений и точек — не больше
 * `MAX_EVALUATIONS` и `MAX_POINTS`.
 */
export const sampleCurve = (f: (x: number) => number, options: SampleOptions): Vec2[][] => {
  const { xs, step } = gridOf(options);

  if (xs.length === 0) return [];

  const sampler = new Sampler(f, options.yFrom, options.yTo);
  const tolerance = options.tolerance ?? step / 4;

  sampler.run(xs);

  return sampler.branches.map((branch) => rounded(simplify(branch, tolerance))).filter((branch) => branch.length > 1);
};

/** Ветви набранной функции с параметрами `params` для окна (см. `sampleCurve`). */
export const sampleFunction = (ast: FunctionNode, params: Record<string, number>, options: SampleOptions): Vec2[][] =>
  sampleCurve((x) => evaluateFunction(ast, x, params), options);

/**
 * Запасные ветви, когда в окне графика нет: ближайший к окну кусок графика.
 * Функция пробуется на отрезке x окна (той же сеткой, что у выборки); нет
 * конечных значений — отрезок расширяется в 10 раз вокруг середины окна, до
 * четырёх раз. Среди конечных значений берётся ближайшее к окну по высоте,
 * ветви считаются на найденном отрезке в полосе высотой в три высоты окна
 * вокруг него. Конечных значений нет нигде — ветвей нет.
 */
export const sampleNearest = (ast: FunctionNode, params: Record<string, number>, options: SampleOptions): Vec2[][] => {
  const f = (x: number): number => evaluateFunction(ast, x, params);
  const center = (options.from + options.to) / 2;
  const half = Math.abs(options.to - options.from) / 2 || 0.5;
  const low = Math.min(options.yFrom, options.yTo);
  const high = Math.max(options.yFrom, options.yTo);
  const height = high - low || 1;
  const distance = (y: number): number => Math.max(low - y, y - high, 0);
  const found = Array.from({ length: WIDENINGS + 1 }, (_, index) => 10 ** index).reduce<{ from: number; to: number; y: number } | null>(
    (result, factor) => {
      if (result) return result;

      const from = center - half * factor;
      const to = center + half * factor;
      const values = gridOf({ from, to, domain: options.domain })
        .xs.map(f)
        .filter((y) => Number.isFinite(y));
      const [first] = values;

      if (first === undefined) return null;

      return { from, to, y: values.reduce((best, y) => (distance(y) < distance(best) ? y : best), first) };
    },
    null,
  );

  if (!found) return [];

  // Полоса с запасом выборки (5% с каждой стороны) — ровно `BAND` высот окна.
  const reach = (BAND * height) / 2 / (1 + 2 * MARGIN);

  return sampleCurve(f, { from: found.from, to: found.to, yFrom: found.y - reach, yTo: found.y + reach, domain: options.domain, tolerance: options.tolerance });
};
