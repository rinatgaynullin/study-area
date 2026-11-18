import { describe, expect, it } from 'vitest';
import { parseFunction, type FunctionNode } from '../src/builders/function-expr';
import { sampleFunction, type SampleOptions } from '../src/builders/function-sampler';
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
});
