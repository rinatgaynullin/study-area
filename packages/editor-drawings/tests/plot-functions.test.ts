import { describe, expect, it } from 'vitest';
import { evaluateFunction, functionLabelText, parseFunction } from '../src/builders/function-expr';
import { isReadyFunction, plotExpression } from '../src/builders/plot-functions';
import { normalizeGeometryScene } from '../src/scene/normalize';
import type { HyperbolaPlot, ParabolaPlot, Plot, SqrtPlot } from '../src/scene/types';
import { mathLabel } from '../src/tikz/common';
import { geometryToTikz } from '../src/tikz/geometry-tikz';

const parabola = (fields: Partial<ParabolaPlot> = {}): ParabolaPlot => ({ type: 'parabola', vertex: [0, 0], direction: 'up', stretchX: 1, stretchY: 1, ...fields });

const sqrt = (fields: Partial<SqrtPlot> = {}): SqrtPlot => ({ type: 'sqrt', vertex: [0, 0], directionX: 'right', directionY: 'up', stretch: 1, ...fields });

const hyperbola = (fields: Partial<HyperbolaPlot> = {}): HyperbolaPlot => ({ type: 'hyperbola', center: [0, 0], k: 1, ...fields });

/** Значение готовой кривой в точке — так, как её рисует рендер. */
const curveValue = (plot: Plot, x: number): number => {
  switch (plot.type) {
    case 'line':
      return (plot.k ?? 0) * x + (plot.b ?? 0);
    case 'parabola': {
      const t = (x - plot.vertex[0]) / plot.stretchX;

      return plot.vertex[1] + t * t * plot.stretchY * (plot.direction === 'down' ? -1 : 1);
    }
    case 'hyperbola':
      return x === plot.center[0] ? NaN : plot.center[1] + plot.k / (x - plot.center[0]);
    case 'sqrt': {
      const s = plot.directionX === 'left' ? plot.vertex[0] - x : x - plot.vertex[0];

      return s < 0 ? NaN : plot.vertex[1] + Math.sqrt(s) * plot.stretch * (plot.directionY === 'down' ? -1 : 1);
    }
    default:
      return NaN;
  }
};

describe('запись готовой кривой', () => {
  const TABLE: Array<[string, Plot, string]> = [
    ['шаблон параболы', parabola(), 'x^2'],
    ['парабола через вершину', parabola({ vertex: [1, -3], stretchY: 2 }), '2(x-1)^2-3'],
    ['парабола вниз со сдвигом влево', parabola({ vertex: [-2, 1], direction: 'down' }), '-(x+2)^2+1'],
    ['растяжение по x', parabola({ stretchX: 2, stretchY: 1 }), '0,25x^2'],
    ['десятичная запятая', parabola({ vertex: [0.5, 1.5], stretchY: 0.5 }), '0,5(x-0,5)^2+1,5'],
    ['прямая y = x', { type: 'line', k: 1, b: 0 }, 'x'],
    ['прямая с минусами', { type: 'line', k: -1, b: -2.5 }, '-x-2,5'],
    ['прямая k = 0', { type: 'line', k: 0, b: 3 }, '3'],
    ['гипербола', hyperbola(), '1/x'],
    ['гипербола со сдвигом', hyperbola({ center: [1, 1], k: 2 }), '2/(x-1)+1'],
    ['гипербола −1/x', hyperbola({ k: -1 }), '-1/x'],
    ['корень', sqrt(), 'sqrt(x)'],
    ['корень со сдвигом и множителем', sqrt({ vertex: [1, 3], stretch: 2 }), '2sqrt(x-1)+3'],
    ['корень влево вниз', sqrt({ vertex: [2, 0], directionX: 'left', directionY: 'down' }), '-sqrt(2-x)'],
    ['корень влево из нуля', sqrt({ directionX: 'left' }), 'sqrt(-x)'],
  ];

  it.each(TABLE)('%s', (_name, plot, expected) => {
    expect(isReadyFunction(plot)).toBe(true);
    expect(plotExpression(plot, ',')).toBe(expected);

    // Запись разбирается и задаёт ту же кривую.
    const parsed = parseFunction(expected);

    if (!parsed.ok) throw new Error(`«${expected}» не разобрано`);

    [-3.5, -1, 0.25, 2, 4.5].forEach((x) => {
      const want = curveValue(plot, x);
      const got = evaluateFunction(parsed.ast, x);

      if (Number.isNaN(want)) expect(got).toBeNaN();
      else expect(got).toBeCloseTo(want, 6);
    });
  });

  it('английская локаль — с десятичной точкой', () => {
    expect(plotExpression(parabola({ stretchY: 0.5 }), '.')).toBe('0.5x^2');
  });

  it('отрезок по двум точкам, вертикальная прямая, окружность и прочее — не функции', () => {
    expect(isReadyFunction({ type: 'line', p1: [0, 0], p2: [2, 2] })).toBe(false);
    expect(isReadyFunction({ type: 'line', p1: [1, 0], p2: [1, 2] })).toBe(false);
    expect(plotExpression({ type: 'line', p1: [1, 0], p2: [1, 2] }, ',')).toBeNull();
    expect(plotExpression({ type: 'circle', center: [0, 0], radius: 2 }, ',')).toBeNull();
    expect(plotExpression({ type: 'point', coords: [0, 0], pointStyle: 'solid' }, ',')).toBeNull();
    expect(isReadyFunction({ type: 'freehand', points: [[0, 0], [1, 1]] })).toBe(false);
  });

  it('очень малый множитель не печатается в экспоненциальной записи', () => {
    expect(plotExpression(parabola({ stretchY: 0.002 }), '.')).toBe('0.002x^2');
    expect(plotExpression(parabola({ stretchY: 1e-9 }), '.')).toBe('0.000001x^2');
  });
});

describe('подпись формулой готовой кривой', () => {
  const labelOf = (plot: Plot): string => {
    const parsed = parseFunction(plotExpression(plot, ',') ?? '');

    return parsed.ok ? functionLabelText(parsed.ast, ',') : '';
  };

  it('запись для обоих рендеров: дефис, дробь в скобках, корень знаком', () => {
    expect(labelOf(parabola({ vertex: [1, -3], stretchY: 2 }))).toBe('y = 2(x - 1)^2 - 3');
    expect(labelOf(hyperbola({ center: [1, 0], k: 2 }))).toBe('y = 2/(x - 1)');
    expect(labelOf(sqrt({ vertex: [1, 0] }))).toBe('y = √(x - 1)');
  });

  it('подпись-формула параболы попадает в TikZ сцены', () => {
    const label = labelOf(parabola({ vertex: [1, -3], stretchY: 2 }));
    const tikz = geometryToTikz(
      normalizeGeometryScene({
        type: 'plot_2d',
        plots: [{ type: 'parabola', vertex: [1, -3], direction: 'up', stretchX: 1, stretchY: 2, label }],
      }),
    );

    expect(tikz).toContain('{$y = 2(x - 1)^2 - 3$}');
  });

  it('десятичная запятая между цифрами уходит в TikZ как {,}; запятая-разделитель с пробелом — как есть', () => {
    expect(mathLabel('y = 0,5x^2')).toBe('$y = 0{,}5x^2$');
    expect(mathLabel('37,5°')).toBe('$37{,}5^{\\circ}$');
    expect(mathLabel('A, B')).toBe('$A, B$');
  });

  it('подпись ветви набранной функции попадает в TikZ: функции — командами, модуль — \\left|…\\right|', () => {
    const tikz = geometryToTikz(
      normalizeGeometryScene({
        type: 'plot_2d',
        plots: [{ type: 'freehand', points: [[0, 2], [2, 0], [4, 2]], label: 'y = |x - 2| + sin(x)', expr: '|x - 2| + sin(x)', fn: 'f' }],
      }),
    );

    expect(tikz).toContain('$y = \\left|x - 2\\right| + \\sin(x)$');
  });
});
