import { describe, expect, it } from 'vitest';
import {
  MIN_HYPERBOLA_K,
  MIN_RADIUS,
  MIN_STRETCH,
  applyFunctionParam,
  describeFunction,
  functionLabel,
  functionParams,
  functionText,
  isFunctionLabel,
  type FunctionParamId,
  type ParabolaForm,
} from '../src/builders/plot-functions';
import { normalizeGeometryScene } from '../src/scene/normalize';
import type { CirclePlot, HyperbolaPlot, LinePlot, ParabolaPlot, Plot, SqrtPlot } from '../src/scene/types';
import { mathLabel } from '../src/tikz/common';
import { geometryToTikz } from '../src/tikz/geometry-tikz';

const parabola = (fields: Partial<ParabolaPlot> = {}): ParabolaPlot => ({ type: 'parabola', vertex: [0, 0], direction: 'up', stretchX: 1, stretchY: 1, ...fields });
const sqrt = (fields: Partial<SqrtPlot> = {}): SqrtPlot => ({ type: 'sqrt', vertex: [0, 0], directionX: 'right', directionY: 'up', stretch: 1, ...fields });
const hyperbola = (fields: Partial<HyperbolaPlot> = {}): HyperbolaPlot => ({ type: 'hyperbola', center: [0, 0], k: 1, ...fields });

const values = (plot: Plot, form: ParabolaForm = 'vertex'): Record<string, number> =>
  Object.fromEntries(functionParams(plot, form).map((param) => [param.id, param.value]));

/** y(x) по полям сцены — так, как кривую строит полотно (`curveRuns`), без модуля формул. */
const yFromFields = (plot: Plot, x: number): number => {
  switch (plot.type) {
    case 'parabola': {
      const t = (x - plot.vertex[0]) / plot.stretchX;

      return plot.vertex[1] + (plot.direction === 'down' ? -1 : 1) * t * t * plot.stretchY;
    }
    case 'sqrt': {
      const s = (x - plot.vertex[0]) * (plot.directionX === 'left' ? -1 : 1);

      return plot.vertex[1] + (plot.directionY === 'down' ? -1 : 1) * plot.stretch * Math.sqrt(s);
    }
    case 'hyperbola':
      return plot.center[1] + plot.k / (x - plot.center[0]);
    case 'line':
      if (plot.p1 && plot.p2) {
        const k = (plot.p2[1] - plot.p1[1]) / (plot.p2[0] - plot.p1[0]);

        return plot.p1[1] + k * (x - plot.p1[0]);
      }

      return (plot.k ?? 0) * x + (plot.b ?? 0);
    default:
      return NaN;
  }
};

/** y(x) по параметрам школьной записи. */
const yFromParams = (plot: Plot, form: ParabolaForm, x: number): number => {
  const p = values(plot, form);
  const get = (id: string): number => p[id] ?? NaN;

  switch (plot.type) {
    case 'parabola':
      return form === 'standard' ? get('a') * x * x + get('b') * x + get('c') : get('a') * (x - get('m')) ** 2 + get('n');
    case 'sqrt':
      return get('a') * Math.sqrt(plot.directionX === 'left' ? get('m') - x : x - get('m')) + get('n');
    case 'hyperbola':
      return get('k') / (x - get('m')) + get('n');
    case 'line':
      return get('k') * x + get('b');
    default:
      return NaN;
  }
};

const expectSameCurve = (plot: Plot, form: ParabolaForm, xs: number[]): void => {
  xs.forEach((x) => expect(yFromParams(plot, form, x)).toBeCloseTo(yFromFields(plot, x), 2));
};

describe('параметры функции из полей сцены', () => {
  it('прямая: k и b; по двум точкам — вычисляются; вертикальная — один параметр c', () => {
    expect(values({ type: 'line', k: 2, b: -1 })).toEqual({ k: 2, b: -1 });
    expect(values({ type: 'line', p1: [0, 1], p2: [2, 5] })).toEqual({ k: 2, b: 1 });
    expect(values({ type: 'line', p1: [2, -1], p2: [2, 3] })).toEqual({ c: 2 });
  });

  it('парабола: a = ±stretchY / stretchX², m и n — вершина; общий вид — a, b, c', () => {
    expect(values(parabola({ vertex: [1, -3], stretchX: 2, stretchY: 2, direction: 'down' }))).toEqual({ a: -0.5, m: 1, n: -3 });
    expect(values(parabola({ vertex: [1, 3], stretchY: 2 }), 'standard')).toEqual({ a: 2, b: -4, c: 5 });
  });

  it('гипербола: k, m, n; корень: знак a — направление по y', () => {
    expect(values(hyperbola({ center: [-1, 2], k: -3 }))).toEqual({ k: -3, m: -1, n: 2 });
    expect(values(sqrt({ vertex: [2, 1], directionX: 'left', directionY: 'down', stretch: 1.5 }))).toEqual({ a: -1.5, m: 2, n: 1 });
  });

  it('окружность: a и b — центр, r — радиус', () => {
    expect(values({ type: 'circle', center: [1, -2], radius: 2.5 })).toEqual({ a: 1, b: -2, r: 2.5 });
  });

  it('диапазоны: a и k — от −5 до 5 шагом 0,1; сдвиги и центр — от −10 до 10 шагом 0,5; радиус — от 0,5 до 10', () => {
    const [a, m] = functionParams(parabola(), 'vertex');

    expect(a).toMatchObject({ id: 'a', min: -5, max: 5, step: 0.1 });
    expect(m).toMatchObject({ id: 'm', min: -10, max: 10, step: 0.5 });
    expect(functionParams({ type: 'line', k: 1, b: 0 }, 'vertex')[0]).toMatchObject({ id: 'k', min: -5, max: 5, step: 0.1 });
    expect(functionParams({ type: 'circle', center: [0, 0], radius: 2 }, 'vertex')).toEqual([
      { id: 'a', value: 0, min: -10, max: 10, step: 0.5 },
      { id: 'b', value: 0, min: -10, max: 10, step: 0.5 },
      { id: 'r', value: 2, min: MIN_RADIUS, max: 10, step: 0.5 },
    ]);
    expect(MIN_RADIUS).toBe(0.5);
    expect(functionParams({ type: 'point', coords: [0, 0], pointStyle: 'solid' }, 'vertex')).toEqual([]);
  });

  it('значения округляются до двух знаков — как их сохраняет сцена', () => {
    expect(values(parabola({ stretchX: 3, stretchY: 1 })).a).toBe(0.11);
    expect(values(hyperbola({ center: [1.234, -0.005], k: 2.346 }))).toEqual({ k: 2.35, m: 1.23, n: -0.01 });
    expect(values({ type: 'circle', center: [0.125, 0], radius: 1.004 })).toEqual({ a: 0.13, b: 0, r: 1 });
  });

  it('параметры и формула считаются от чисел, которые сохранит сцена: после сохранения — те же', () => {
    // Вершину и растяжения параболы сцена пишет с четырьмя знаками: 1,00006 → 1,0001.
    const loaded = parabola({ vertex: [1.00006, -2.99994], stretchX: 1, stretchY: 0.33333 });
    const stored = parabola({ vertex: [1.0001, -2.9999], stretchX: 1, stretchY: 0.3333 });

    expect(values(loaded)).toEqual(values(stored));
    expect(values(loaded, 'standard')).toEqual(values(stored, 'standard'));
    expect(functionText(loaded, 'vertex', ',')).toBe(functionText(stored, 'vertex', ','));
    expect(functionText({ type: 'circle', center: [0, 0], radius: 1.257 }, 'vertex', ',')).toBe('x² + y² = 1,5876');
  });
});

describe('правка параметра', () => {
  const XS = [-3, -1.5, 0.5, 2, 4.25];

  const cases: Array<{ name: string; plot: Plot; form: ParabolaForm; id: FunctionParamId; value: number; xs?: number[] }> = [
    { name: 'прямая k', plot: { type: 'line', k: 1, b: 2 }, form: 'vertex', id: 'k', value: -1.5 },
    { name: 'прямая b', plot: { type: 'line', k: 1, b: 2 }, form: 'vertex', id: 'b', value: -3 },
    { name: 'прямая по точкам k', plot: { type: 'line', p1: [0, 1], p2: [2, 5] }, form: 'vertex', id: 'k', value: 0.5 },
    { name: 'парабола a', plot: parabola({ vertex: [1, -3], stretchX: 2, stretchY: 1 }), form: 'vertex', id: 'a', value: -2 },
    { name: 'парабола m', plot: parabola({ vertex: [1, -3], stretchX: 2, stretchY: 1 }), form: 'vertex', id: 'm', value: -2.5 },
    { name: 'парабола n', plot: parabola({ vertex: [1, -3], direction: 'down' }), form: 'vertex', id: 'n', value: 4 },
    { name: 'парабола общий a', plot: parabola({ vertex: [1, 3], stretchY: 2 }), form: 'standard', id: 'a', value: -1 },
    { name: 'парабола общий b', plot: parabola({ vertex: [1, 3], stretchY: 2 }), form: 'standard', id: 'b', value: 2 },
    { name: 'парабола общий c', plot: parabola({ vertex: [1, 3], stretchY: 2 }), form: 'standard', id: 'c', value: -1 },
    { name: 'гипербола k', plot: hyperbola({ center: [1, 1] }), form: 'vertex', id: 'k', value: -2 },
    { name: 'гипербола m', plot: hyperbola({ center: [1, 1] }), form: 'vertex', id: 'm', value: -0.5, xs: [-3, 0.5, 2, 4.25] },
    { name: 'гипербола n', plot: hyperbola({ center: [1, 1] }), form: 'vertex', id: 'n', value: -2 },
    { name: 'корень a', plot: sqrt({ vertex: [-4, 1] }), form: 'vertex', id: 'a', value: -2 },
    { name: 'корень m', plot: sqrt({ vertex: [-4, 1] }), form: 'vertex', id: 'm', value: -5 },
    { name: 'корень влево n', plot: sqrt({ vertex: [5, 1], directionX: 'left' }), form: 'vertex', id: 'n', value: -1 },
  ];

  cases.forEach(({ name, plot, form, id, value, xs }) => {
    it(`${name}: новая кривая проходит через точки формулы, вход не меняется`, () => {
      const before = JSON.stringify(plot);
      const next = applyFunctionParam(plot, form, id, value);

      expect(JSON.stringify(plot)).toBe(before);
      expect(values(next, form)[id]).toBeCloseTo(value, 2);
      expectSameCurve(next, form, xs ?? XS);
    });
  });

  it('правка a параболы: направление по знаку, stretchX = 1, stretchY = |a|; m и n растяжений не трогают', () => {
    const plot = parabola({ vertex: [1, -3], stretchX: 2, stretchY: 1 });

    expect(applyFunctionParam(plot, 'vertex', 'a', -2)).toMatchObject({ direction: 'down', stretchX: 1, stretchY: 2 });
    expect(applyFunctionParam(plot, 'vertex', 'm', 4)).toMatchObject({ vertex: [4, -3], stretchX: 2, stretchY: 1 });
  });

  it('отрезок по двум точкам остаётся отрезком: k и b пересчитывают y точек при прежних x; вертикальная двигается через c', () => {
    const segment: LinePlot = { type: 'line', p1: [0, 0], p2: [2, 2], color: '#2563eb' };

    expect(applyFunctionParam(segment, 'vertex', 'b', 1)).toEqual({ type: 'line', p1: [0, 1], p2: [2, 3], color: '#2563eb' });
    expect(applyFunctionParam(segment, 'vertex', 'k', -0.5)).toEqual({ type: 'line', p1: [0, 0], p2: [2, -1], color: '#2563eb' });
    expect(applyFunctionParam({ type: 'line', p1: [0, 1], p2: [2, 5] }, 'vertex', 'b', 3)).toEqual({ type: 'line', p1: [0, 3], p2: [2, 7] });
    expect(applyFunctionParam({ type: 'line', p1: [2, -1], p2: [2, 3] }, 'vertex', 'c', -1.5)).toEqual({ type: 'line', p1: [-1.5, -1], p2: [-1.5, 3] });
  });

  it('отрезок: k, которое не укладывается в шаг точек, после правки показывается тем же', () => {
    // y = 0,33 · 0,5 = 0,165: с двумя знаками у точки k стало бы 0,34.
    const next = applyFunctionParam({ type: 'line', p1: [0, 0], p2: [0.5, 0.5] }, 'vertex', 'k', 0.33);

    expect(next).toEqual({ type: 'line', p1: [0, 0], p2: [0.5, 0.165] });
    expect(values(next)).toEqual({ k: 0.33, b: 0 });
    // Нетронутый коэффициент — такой, как в блоке: повторный ввод не меняет кривую.
    expect(applyFunctionParam(next, 'vertex', 'b', 0)).toEqual(next);
  });

  it('отрезок: при правке b нетронутый k — точный, из точек, а не округлённый до двух знаков', () => {
    const segment: LinePlot = { type: 'line', p1: [0, 0], p2: [3, 1] };

    // k = 1/3: с округлённым 0,33 дальняя точка встала бы в (3; 1,99).
    expect(applyFunctionParam(segment, 'vertex', 'b', 1)).toEqual({ type: 'line', p1: [0, 1], p2: [3, 2] });
    // И наоборот: правка k оставляет b точным (2/3), а не 0,67.
    expect(applyFunctionParam({ type: 'line', p1: [1, 1], p2: [4, 2] }, 'vertex', 'k', 1)).toEqual({ type: 'line', p1: [1, 1.6667], p2: [4, 4.6667] });
  });

  it('общий вид ↔ вершина: туда и обратно, когда вершина не укладывается в два знака', () => {
    // c = am² + n = 0,875 — в блоке два знака.
    expect(values(parabola({ vertex: [-1.5, 2], stretchY: 0.5, direction: 'down' }), 'standard')).toEqual({ a: -0.5, b: -1.5, c: 0.88 });

    // y = 3x² + x + 2: m = −1/6, n = 23/12 — в два знака не укладываются.
    const plot = applyFunctionParam(applyFunctionParam(parabola({ stretchY: 3 }), 'standard', 'b', 1), 'standard', 'c', 2);
    const standard = values(plot, 'standard');

    expect(standard).toEqual({ a: 3, b: 1, c: 2 });
    expect(values(plot)).toEqual({ a: 3, m: -0.17, n: 1.92 });

    const back = applyFunctionParam(applyFunctionParam(plot, 'standard', 'b', standard.b ?? 0), 'standard', 'c', standard.c ?? 0);

    expect(back).toEqual(plot);
    expect(values(back, 'standard')).toEqual({ a: 3, b: 1, c: 2 });
  });

  it('общий вид при a = 3: ввод b = 1 даёт b = 1 и c = 0; повторный ввод того же значения ничего не меняет', () => {
    const plot = applyFunctionParam(parabola({ stretchY: 3 }), 'standard', 'b', 1);

    expect(values(plot, 'standard')).toEqual({ a: 3, b: 1, c: 0 });
    expect(functionText(plot, 'standard', ',')).toBe('y = 3x² + x');
    expect(applyFunctionParam(plot, 'standard', 'b', 1)).toEqual(plot);
    expect(applyFunctionParam(plot, 'standard', 'c', 0)).toEqual(plot);
    expect(applyFunctionParam(plot, 'standard', 'a', 3)).toEqual(plot);
  });

  it('множитель a, который при двух знаках стал бы нулём, показывается двумя значащими цифрами', () => {
    const flat = parabola({ stretchX: 5, stretchY: 0.05 });

    expect(values(flat).a).toBe(0.002);
    expect(values(flat, 'standard').a).toBe(0.002);
    expect(functionText(flat, 'vertex', ',')).toBe('y = 0,002x²');
    expect(values(parabola({ stretchX: 5, stretchY: 0.05, direction: 'down' })).a).toBe(-0.002);
    expect(functionText(parabola({ stretchX: 4, stretchY: 0.05, direction: 'down' }), 'vertex', ',')).toBe('y = −0,0031x²');
    // То, что округляется не в ноль, — по-прежнему два знака.
    expect(values(parabola({ stretchX: 4, stretchY: 0.1 })).a).toBe(0.01);
  });

  it('очень малый множитель не печатается в экспоненциальной записи: наименьшее видимое число со своим знаком', () => {
    // a = 0,000012: две значащие цифры видны в шести знаках — пишутся как есть.
    expect(functionText(parabola({ stretchX: 100, stretchY: 0.12 }), 'vertex', ',')).toBe('y = 0,000012x²');
    // a = 1e-8 и −1,5e-9: в шести знаках не видно — 0,000001 со знаком.
    expect(functionText(parabola({ stretchX: 100, stretchY: 0.0001 }), 'vertex', ',')).toBe('y = 0,000001x²');
    expect(functionText(parabola({ stretchX: 1000, stretchY: 0.0015, direction: 'down' }), 'standard', '.')).toBe('y = −0.000001x²');
    expect(functionLabel(parabola({ stretchX: 100, stretchY: 0.0001, direction: 'down' }), 'vertex', ',')).toBe('y = -0,000001x^2');
    expect(values(parabola({ stretchX: 100, stretchY: 0.0001 })).a).toBe(0.000001);
    [parabola({ stretchX: 100, stretchY: 0.0001 }), parabola({ stretchX: 1000, stretchY: 0.0015 })].forEach((plot) => {
      expect(functionText(plot, 'vertex', ',')).not.toMatch(/e/);
      expect(functionText(plot, 'standard', ',')).not.toMatch(/e/);
    });
  });

  it('ноль для a и k гиперболы заменяется наименьшим допустимым со знаком прежнего значения', () => {
    expect(values(applyFunctionParam(parabola({ direction: 'down' }), 'vertex', 'a', 0)).a).toBe(-MIN_STRETCH);
    expect(values(applyFunctionParam(parabola(), 'standard', 'a', 0), 'standard').a).toBe(MIN_STRETCH);
    expect(values(applyFunctionParam(sqrt({ directionY: 'down' }), 'vertex', 'a', 0)).a).toBe(-MIN_STRETCH);
    expect(applyFunctionParam(hyperbola({ k: -2 }), 'vertex', 'k', 0)).toMatchObject({ k: -MIN_HYPERBOLA_K });
    expect(applyFunctionParam(hyperbola({ k: 2 }), 'vertex', 'k', 0.04)).toMatchObject({ k: MIN_HYPERBOLA_K });
    // У прямой k = 0 разрешён.
    expect(applyFunctionParam({ type: 'line', k: 2, b: 1 }, 'vertex', 'k', 0)).toMatchObject({ k: 0, b: 1 });
  });

  it('окружность: a и b двигают центр, r меняет радиус; r меньше 0,5 заменяется на 0,5', () => {
    const circle: CirclePlot = { type: 'circle', center: [1, -2], radius: 2, fill: true, color: '#10b981' };
    const before = JSON.stringify(circle);

    expect(applyFunctionParam(circle, 'vertex', 'a', -3.5)).toEqual({ ...circle, center: [-3.5, -2] });
    expect(applyFunctionParam(circle, 'vertex', 'b', 4)).toEqual({ ...circle, center: [1, 4] });
    expect(applyFunctionParam(circle, 'vertex', 'r', 3.25)).toEqual({ ...circle, radius: 3.25 });
    expect(applyFunctionParam(circle, 'vertex', 'r', 0.2)).toMatchObject({ radius: MIN_RADIUS });
    expect(applyFunctionParam(circle, 'vertex', 'r', 0)).toMatchObject({ radius: 0.5 });
    expect(applyFunctionParam(circle, 'vertex', 'r', -4)).toMatchObject({ radius: 0.5 });
    // Чужой параметр — та же кривая; вход не меняется.
    expect(applyFunctionParam(circle, 'vertex', 'm', 3)).toBe(circle);
    expect(JSON.stringify(circle)).toBe(before);
    // Туда и обратно: параметры новой окружности — те, что ввели.
    expect(values(applyFunctionParam(applyFunctionParam(circle, 'vertex', 'a', 0.5), 'vertex', 'r', 1.5))).toEqual({ a: 0.5, b: -2, r: 1.5 });
  });

  it('кривая без правок не меняется: растяжения и точки остаются как загружены', () => {
    const curve = parabola({ stretchX: 2, stretchY: 3 });
    const line: LinePlot = { type: 'line', p1: [0, 1], p2: [2, 5] };

    functionParams(curve, 'vertex');
    functionParams(line, 'vertex');
    expect(curve).toEqual(parabola({ stretchX: 2, stretchY: 3 }));
    expect(line).toEqual({ type: 'line', p1: [0, 1], p2: [2, 5] });
    // Сдвиг вершины растяжения не переписывает.
    expect(applyFunctionParam(curve, 'vertex', 'n', 1)).toMatchObject({ stretchX: 2, stretchY: 3 });
    // Чужой параметр — та же кривая.
    expect(applyFunctionParam(line, 'vertex', 'm', 3)).toBe(line);
  });
});

describe('запись формулы', () => {
  const ru = (plot: Plot, form: ParabolaForm = 'vertex'): string => functionText(plot, form, ',');

  it.each<[string, Plot, string]>([
    ['шаблон параболы', parabola(), 'y = x²'],
    ['множитель 1 не пишется', parabola({ vertex: [1, 3] }), 'y = (x − 1)² + 3'],
    ['−1 — минусом', parabola({ direction: 'down' }), 'y = −x²'],
    ['нулевые слагаемые', parabola({ stretchY: 2 }), 'y = 2x²'],
    ['x − (−2) → x + 2, + (−3) → − 3', parabola({ vertex: [-2, -3], stretchY: 2 }), 'y = 2(x + 2)² − 3'],
    ['десятичная запятая', parabola({ vertex: [0.5, 0], stretchY: 0.5 }), 'y = 0,5(x − 0,5)²'],
    ['прямая y = x + 2', { type: 'line', k: 1, b: 2 }, 'y = x + 2'],
    ['прямая y = 2x', { type: 'line', k: 2, b: 0 }, 'y = 2x'],
    ['k = 0', { type: 'line', k: 0, b: 3 }, 'y = 3'],
    ['прямая с минусами', { type: 'line', k: -1, b: -2.5 }, 'y = −x − 2,5'],
    ['вертикальная прямая', { type: 'line', p1: [2, 0], p2: [2, 4] }, 'x = 2'],
    ['гипербола', hyperbola({ center: [1, 2], k: 3 }), 'y = 3/(x − 1) + 2'],
    ['гипербола y = −1/x', hyperbola({ k: -1 }), 'y = −1/x'],
    ['корень', sqrt({ vertex: [1, -2], stretch: 2 }), 'y = 2√(x − 1) − 2'],
    ['корень влево вниз', sqrt({ vertex: [3, 0], directionX: 'left', directionY: 'down' }), 'y = −√(3 − x)'],
    ['корень влево из нуля', sqrt({ directionX: 'left' }), 'y = √(−x)'],
    ['окружность', { type: 'circle', center: [1, -2], radius: 2.5 }, '(x − 1)² + (y + 2)² = 6,25'],
    ['окружность в начале', { type: 'circle', center: [0, 0], radius: 2 }, 'x² + y² = 4'],
  ])('%s: %s', (_name, plot, expected) => {
    expect(ru(plot)).toBe(expected);
  });

  it('общий вид параболы', () => {
    expect(ru(parabola({ vertex: [1, 3], stretchY: 2 }), 'standard')).toBe('y = 2x² − 4x + 5');
    expect(ru(parabola({ vertex: [0.5, 0] }), 'standard')).toBe('y = x² − x + 0,25');
    expect(ru(parabola(), 'standard')).toBe('y = x²');
  });

  it('английская локаль — с десятичной точкой', () => {
    expect(functionText(parabola({ vertex: [0.5, -1.25], stretchY: 1.5 }), 'vertex', '.')).toBe('y = 1.5(x − 0.5)² − 1.25');
  });

  it('части формулы: степень, дробь, корень — отдельными узлами', () => {
    expect(describeFunction(parabola({ vertex: [1, 0] }), 'vertex', ',')).toEqual([
      { kind: 'var', name: 'y' },
      { kind: 'text', text: ' = ' },
      { kind: 'text', text: '(' },
      { kind: 'var', name: 'x' },
      { kind: 'text', text: ' − 1' },
      { kind: 'text', text: ')' },
      { kind: 'sup', text: '2' },
    ]);
    expect(describeFunction(hyperbola(), 'vertex', ',')?.[2]).toEqual({ kind: 'frac', num: [{ kind: 'text', text: '1' }], den: [{ kind: 'var', name: 'x' }] });
    expect(describeFunction(sqrt(), 'vertex', ',')?.[2]).toEqual({ kind: 'sqrt', body: [{ kind: 'var', name: 'x' }] });
    expect(describeFunction({ type: 'point', coords: [0, 0], pointStyle: 'solid' }, 'vertex', ',')).toBeNull();
  });
});

describe('подпись формулой', () => {
  it('запись для обоих рендеров: дефис, дробь в скобках, корень знаком', () => {
    expect(functionLabel({ type: 'line', k: -2, b: 1 }, 'vertex', ',')).toBe('y = -2x + 1');
    expect(functionLabel(hyperbola({ center: [1, -2], k: 3 }), 'vertex', ',')).toBe('y = 3/(x - 1) - 2');
    expect(functionLabel(sqrt({ vertex: [1, 0], stretch: 0.5 }), 'vertex', ',')).toBe('y = 0,5√(x - 1)');
    // Степень — `^2`: SVG рисует её верхним индексом, TikZ — в математическом режиме.
    expect(functionLabel(parabola({ vertex: [1, -3], stretchY: 2 }), 'vertex', ',')).toBe('y = 2(x - 1)^2 - 3');
    expect(functionLabel(parabola({ vertex: [1, 3], stretchY: 2 }), 'standard', ',')).toBe('y = 2x^2 - 4x + 5');
    expect(functionLabel({ type: 'circle', center: [1, -2], radius: 2.5 }, 'vertex', ',')).toBe('(x - 1)^2 + (y + 2)^2 = 6,25');
    expect(functionLabel({ type: 'circle', center: [0, 0], radius: 2 }, 'vertex', ',')).toBe('x^2 + y^2 = 4');
    expect(functionLabel({ type: 'point', coords: [0, 0], pointStyle: 'solid' }, 'vertex', ',')).toBeNull();
  });

  it('TikZ получает корректную математическую запись: степень, дробь, корень', () => {
    const tikz = (plot: Plot, form: ParabolaForm = 'vertex'): string => mathLabel(functionLabel(plot, form, ',') ?? '');

    expect(tikz(parabola({ vertex: [1, -3], stretchY: 2 }))).toBe('$y = 2(x - 1)^2 - 3$');
    expect(tikz(parabola({ vertex: [1, 3], stretchY: 2 }), 'standard')).toBe('$y = 2x^2 - 4x + 5$');
    expect(tikz(hyperbola({ center: [1, -2], k: 3 }))).toBe('$y = 3/(x - 1) - 2$');
    expect(tikz(hyperbola({ k: -1 }))).toBe('$y = -1/x$');
    expect(tikz(sqrt({ vertex: [1, 0], stretch: 0.5 }))).toBe('$y = 0{,}5\\sqrt{x - 1}$');
    expect(tikz(sqrt({ vertex: [3, 0], directionX: 'left', directionY: 'down' }))).toBe('$y = -\\sqrt{3 - x}$');
    expect(tikz({ type: 'circle', center: [1, -2], radius: 2.5 })).toBe('$(x - 1)^2 + (y + 2)^2 = 6{,}25$');
    expect(tikz({ type: 'line', k: -2, b: 1 })).toBe('$y = -2x + 1$');
  });

  it('подпись-формула параболы и окружности попадает в TikZ сцены', () => {
    const label = functionLabel(parabola({ vertex: [1, -3], stretchY: 2 }), 'vertex', ',') ?? '';
    const ring = functionLabel({ type: 'circle', center: [1, -2], radius: 2.5 }, 'vertex', ',') ?? '';
    const tikz = geometryToTikz(
      normalizeGeometryScene({
        type: 'plot_2d',
        plots: [
          { type: 'parabola', vertex: [1, -3], direction: 'up', stretchX: 1, stretchY: 2, label },
          { type: 'circle', center: [1, -2], radius: 2.5, label: ring },
        ],
      }),
    );

    expect(tikz).toContain('{$y = 2(x - 1)^2 - 3$}');
    expect(tikz).toContain('{$(x - 1)^2 + (y + 2)^2 = 6{,}25$}');
  });

  it('десятичная запятая между цифрами уходит в TikZ как {,}; запятая-разделитель с пробелом — как есть', () => {
    expect(mathLabel('y = 0,5x^2')).toBe('$y = 0{,}5x^2$');
    expect(mathLabel('(x - 1)^2 + (y + 2)^2 = 6,25')).toBe('$(x - 1)^2 + (y + 2)^2 = 6{,}25$');
    expect(mathLabel('37,5°')).toBe('$37{,}5^{\\circ}$');
    expect(mathLabel('A, B')).toBe('$A, B$');
    expect(mathLabel('1,2,3')).toBe('$1{,}2{,}3$');
    // В самой подписи и в SVG запятая остаётся запятой.
    expect(functionLabel({ type: 'circle', center: [1, -2], radius: 2.5 }, 'vertex', ',')).toBe('(x - 1)^2 + (y + 2)^2 = 6,25');
  });

  it('подпись, равная формуле, узнаётся без учёта пробелов, минуса и разделителя', () => {
    const line: LinePlot = { type: 'line', k: 0.5, b: -1 };

    expect(isFunctionLabel('y=0.5x-1', line, 'vertex', ',')).toBe(true);
    expect(isFunctionLabel('y = 0,5x − 1', line, 'vertex', ',')).toBe(true);
    expect(isFunctionLabel('y = x', line, 'vertex', ',')).toBe(false);
    expect(isFunctionLabel(undefined, line, 'vertex', ',')).toBe(false);
  });
});
