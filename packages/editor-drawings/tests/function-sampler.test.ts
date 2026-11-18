import { describe, expect, it } from 'vitest';
import { parseFunction, type FunctionNode } from '../src/builders/function-expr';
import { MAX_EVALUATIONS, MAX_POINTS, sampleCurve, sampleFunction, sampleNearest, type SampleOptions } from '../src/builders/function-sampler';
import type { Vec2 } from '../src/scene/types';

const astOf = (text: string): FunctionNode => {
  const parsed = parseFunction(text);

  if (!parsed.ok) throw new Error(`«${text}» не разобрано`);

  return parsed.ast;
};

/** Окно полотна по умолчанию: ±9⅓ по x, ±7 по y. */
const VIEW: SampleOptions = { from: -28 / 3, to: 28 / 3, yFrom: -7, yTo: 7 };

const sample = (text: string, options: Partial<SampleOptions> = {}, params: Record<string, number> = {}): Vec2[][] =>
  sampleFunction(astOf(text), params, { ...VIEW, ...options });

const xsOf = (branch: Vec2[] | undefined): number[] => (branch ?? []).map(([x]) => x);

describe('точки графика', () => {
  it('прямая упрощается до двух концов с запасом 5% по x', () => {
    const branches = sample('x/2 + 1');

    expect(branches).toHaveLength(1);
    expect(branches[0]).toHaveLength(2);

    const [start, end] = branches[0] ?? [];
    const margin = (28 / 3) * 2 * 0.05;

    expect(start?.[0]).toBeCloseTo(-28 / 3 - margin, 3);
    expect(end?.[0]).toBeCloseTo(28 / 3 + margin, 3);
    expect(start?.[1]).toBeCloseTo((start?.[0] ?? 0) / 2 + 1, 3);
  });

  it('1/x — две ветви, не соединённые через ноль', () => {
    const branches = sample('1/x');

    expect(branches).toHaveLength(2);

    const [left, right] = branches;

    expect(Math.max(...xsOf(left))).toBeLessThan(0);
    expect(Math.min(...xsOf(right))).toBeGreaterThan(0);
    // Ветви доходят до края окна по y (с запасом): верхняя — до 7,7, нижняя — до −7,7.
    expect(Math.min(...(left ?? []).map(([, y]) => y))).toBeCloseTo(-7.7, 3);
    expect(Math.max(...(right ?? []).map(([, y]) => y))).toBeCloseTo(7.7, 3);
  });

  it('1/x с узлом сетки в нуле — те же две ветви', () => {
    const branches = sample('1/x', { from: -10, to: 10, step: 0.5 });

    expect(branches).toHaveLength(2);
    expect(Math.max(...xsOf(branches[0]))).toBeLessThan(0);
    expect(Math.min(...xsOf(branches[1]))).toBeGreaterThan(0);
  });

  it('tg x — ветви между асимптотами, каждая растёт слева направо', () => {
    const branches = sample('tg x');
    const asymptotes = [-2.5, -1.5, -0.5, 0.5, 1.5, 2.5].map((k) => k * Math.PI);

    expect(branches).toHaveLength(7);
    branches.forEach((branch) => {
      const xs = xsOf(branch);
      const ys = branch.map(([, y]) => y);

      // Ни одна ветвь не перескакивает через асимптоту.
      asymptotes.forEach((asymptote) => {
        expect(xs.every((x) => x < asymptote) || xs.every((x) => x > asymptote)).toBe(true);
      });
      ys.slice(1).forEach((y, index) => expect(y).toBeGreaterThan(ys[index] ?? Infinity));
    });
  });

  it('sqrt(x) начинается в нуле', () => {
    const branches = sample('sqrt(x)');

    expect(branches).toHaveLength(1);
    expect(branches[0]?.[0]).toEqual([0, 0]);
  });

  it('ln x уходит вниз до края окна', () => {
    const [branch] = sample('ln x');

    expect(branch?.[0]?.[1]).toBeCloseTo(-7.7, 3);
    expect(branch?.[0]?.[0]).toBeGreaterThanOrEqual(0);
    expect(branch?.[0]?.[0]).toBeLessThan(0.01);
  });

  it('domain обрезает', () => {
    const branches = sample('x^2', { domain: [-1, 2] });

    expect(branches).toHaveLength(1);
    expect(xsOf(branches[0])[0]).toBe(-1);
    expect(xsOf(branches[0]).at(-1)).toBe(2);
    expect(sample('x', { domain: [-Infinity, 0] })[0]?.at(-1)).toEqual([0, 0]);
    expect(sample('x', { domain: [20, 30] })).toEqual([]);
  });

  it('ветвь обрывается на границе по y: точка пересечения — на краю окна с запасом', () => {
    const branches = sample('x^2 - 4');

    expect(branches).toHaveLength(1);

    const branch = branches[0] ?? [];
    const first = branch[0];
    const last = branch[branch.length - 1];

    expect(first?.[1]).toBeCloseTo(7.7, 3);
    expect(last?.[1]).toBeCloseTo(7.7, 3);
    expect(first?.[0]).toBeCloseTo(-Math.sqrt(11.7), 2);
    expect(last?.[0]).toBeCloseTo(Math.sqrt(11.7), 2);
    expect(branch.every(([, y]) => y >= -4 && y <= 7.7)).toBe(true);
  });

  it('крутой график, проскакивающий окно между двумя шагами, — отрезок от края до края', () => {
    const branches = sample('1000x');

    expect(branches).toHaveLength(1);
    expect(branches[0]?.map(([, y]) => y)).toEqual([-7.7, 7.7]);
  });

  it('модуль: излом на месте с точностью до шага, вне области — ничего', () => {
    const [branch] = sample('|x - 2|');
    const lowest = (branch ?? []).reduce((best, point) => (point[1] < best[1] ? point : best), [0, Infinity]);

    expect(branch).toHaveLength(3);
    expect(lowest[0]).toBeCloseTo(2, 1);
    expect(lowest[1]).toBeLessThan(0.07);
    expect(sample('sqrt(-1 - x^2)')).toEqual([]);
  });

  it('координаты — не больше 3 знаков после запятой, параметры подставлены', () => {
    const branches = sample('a sin(b x)', {}, { a: 2, b: 1.5 });

    branches.flat(2).forEach((value) => expect(Math.round(value * 1000) / 1000).toBe(value));
    expect(Math.max(...branches.flat().map(([, y]) => y))).toBeCloseTo(2, 2);
  });

  it('шаг не мельче 1/5000 отрезка', () => {
    const xs: number[] = [];

    // Значений нет нигде: функция вычисляется только в узлах сетки.
    sampleCurve(
      (x) => {
        xs.push(x);

        return NaN;
      },
      { ...VIEW, step: 1e-9 },
    );
    expect(xs.length).toBeLessThanOrEqual(5001);
    expect(xs.length).toBeGreaterThan(4000);
  });
});

/** Окно полотна 560×420 пикселей шириной `width` единиц со сдвигом `shift` по x. */
const windowOf = (width: number, shift: number): SampleOptions => ({
  from: shift - width / 2,
  to: shift + width / 2,
  yFrom: -0.375 * width,
  yTo: 0.375 * width,
  tolerance: (0.5 * width) / 560,
});

/** Асимптоты в окне шириной до 200: `at(k)` для целых k от −100 до 100. */
const asymptotesOf = (at: (k: number) => number): number[] =>
  Array.from({ length: 201 }, (_, index) => at(index - 100)).filter((x, index, all) => all.indexOf(x) === index);

/** Отрезки ветвей, концы которых по разные стороны асимптоты. */
const crossings = (branches: Vec2[][], asymptotes: number[]): number =>
  branches
    .flatMap((branch) => branch.slice(1).map((point, index): [Vec2 | undefined, Vec2] => [branch[index], point]))
    .filter(([start, end]) => asymptotes.some((x) => start !== undefined && start[0] < x - 1e-3 && end[0] > x + 1e-3)).length;

describe('асимптоты при любом окне', () => {
  const POLES: Array<[string, (k: number) => number]> = [
    ['tg(x)', (k) => Math.PI / 2 + k * Math.PI],
    ['1/x', () => 0],
    ['1/sin(x)', (k) => k * Math.PI],
    ['1/x^2', () => 0],
    ['1/(x-0.37)', () => 0.37],
    ['ctg(x)', (k) => k * Math.PI],
  ];
  const rows = POLES.flatMap(([text, at]) => [20, 60, 100, 200].flatMap((width) => [0, 0.37, 1.234].map((shift) => ({ text, at, width, shift }))));

  it.each(rows)('$text, ширина $width, сдвиг $shift — ни один отрезок не пересекает асимптоту', ({ text, at, width, shift }) => {
    const branches = sample(text, windowOf(width, shift));

    expect(branches.length).toBeGreaterThan(1);
    expect(crossings(branches, asymptotesOf(at))).toBe(0);
  });

  it('1/x^2 и 1/x — две ветви при любом сдвиге полюса относительно сетки', () => {
    [20, 100, 200].forEach((width) => {
      Array.from({ length: 40 }, (_, index) => index / 40).forEach((shift) => {
        expect(sample('1/x^2', windowOf(width, shift))).toHaveLength(2);
        expect(sample('1/x', windowOf(width, shift))).toHaveLength(2);
      });
    });
  });

  it.each([
    ['x^5', {}],
    ['1000x', {}],
    ['100sin(1000x)', { yFrom: -200, yTo: 200 }],
    ['sin(x)', {}],
    ['|x - 2|', {}],
    ['e^x', {}],
  ])('непрерывная %s — одна ветвь при любой ширине окна', (text, tall) => {
    [20, 60, 100, 200].forEach((width) => {
      expect(sample(text, { ...windowOf(width, 0.37), ...tall })).toHaveLength(1);
    });
  });

  it('предел вычислений и точек на вызов соблюдается', () => {
    let calls = 0;
    const branches = sampleCurve(
      (x) => {
        calls += 1;

        return 3 * Math.sin(2000 * x) + 1 / Math.sin(997 * x);
      },
      { ...VIEW, step: 1e-9 },
    );

    // Полюс почти в каждой паре: предел достигнут, но не превышен.
    expect(calls).toBeGreaterThan(MAX_EVALUATIONS - 10);
    expect(calls).toBeLessThanOrEqual(MAX_EVALUATIONS);
    expect(branches.flat().length).toBeLessThanOrEqual(MAX_POINTS);
  });
});

describe('запасные ветви', () => {
  const heightOf = (branches: Vec2[][]): number => {
    const ys = branches.flat().map(([, y]) => y);

    return Math.max(...ys) - Math.min(...ys);
  };
  const nearest = (text: string): Vec2[][] => sampleNearest(astOf(text), {}, VIEW);

  it('x^4 + 10 — кусок у y = 10 высотой не больше трёх высот окна', () => {
    const branches = nearest('x^4 + 10');

    expect(branches).toHaveLength(1);
    expect(heightOf(branches)).toBeLessThanOrEqual(3 * 14 + 1e-6);
    expect(Math.min(...branches.flat().map(([, y]) => y))).toBeCloseTo(10, 1);
  });

  it('y = 20000, x^2 + 100000 — у найденного значения; sqrt(x - 1000) — на расширенном отрезке', () => {
    expect(nearest('20000')).toEqual([expect.arrayContaining([[expect.any(Number), 20000]])]);
    expect(Math.min(...nearest('x^2 + 100000').flat().map(([, y]) => y))).toBeCloseTo(100000, 1);

    const [root] = nearest('sqrt(x - 1000)');

    expect(root?.[0]?.[0]).toBeCloseTo(1000, 2);
    expect(heightOf(root ? [root] : [])).toBeLessThanOrEqual(3 * 14);
  });

  it('конечных значений нет нигде — ветвей нет', () => {
    expect(nearest('sqrt(-1 - x^2)')).toEqual([]);
  });
});
