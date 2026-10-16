import { describe, expect, it } from 'vitest';
import { normalizeGeometryScene } from '../src/scene/normalize';
import { renderGeometrySvg } from '../src/render/geometry-svg';
import { renderPlot2dContent } from '../src/render/plot2d-svg';
import { SvgBuilder } from '../src/render/svg-builder';

const HIGHLIGHT = '#ec4899';

/** Разметка без `<defs>`: линия паттерна штриховки — не элемент чертежа. */
const body = (svg: string): string => svg.replace(/<defs>[\s\S]*?<\/defs>/, '');

const tags = (svg: string, tag: string): string[] => body(svg).match(new RegExp(`<${tag}\\b[^>]*>`, 'g')) ?? [];

/** Элементы графиков без сетки и осей. */
const plotTags = (svg: string, tag: string): string[] => tags(svg, tag).filter((item) => !/rte-drawing__(grid|axis)/.test(item));

const labels = (svg: string): string[] =>
  [...svg.matchAll(/<text\b(?:(?!rte-drawing__halo)[^>])*>([^<]*)<\/text>/g)].map((match) => match[1]);

/** Сцена графика без сетки и тиков: в тестах кривых они только мешают считать. */
const plotSvg = (plots: unknown[], extra: Record<string, unknown> = {}): string =>
  renderGeometrySvg(normalizeGeometryScene({ type: 'plot_2d', plots, showGrid: false, showAxesTicks: false, ...extra }));

describe('renderPlot2dContent: оси и сетка', () => {
  it('оси со стрелками и подписями из axes', () => {
    const svg = plotSvg([], { axes: { x_label: 't', y_label: 's' } });

    expect(tags(svg, 'line').filter((line) => line.includes('rte-drawing__axis'))).toHaveLength(2);
    expect(tags(svg, 'polygon').filter((polygon) => polygon.includes('rte-drawing__axis'))).toHaveLength(2);
    expect(labels(svg)).toEqual(expect.arrayContaining(['t', 's']));
  });

  it('сетка включена по умолчанию и выключается showGrid: false', () => {
    const withGrid = renderGeometrySvg(normalizeGeometryScene({ type: 'plot_2d', plots: [] }));

    expect(withGrid).toContain('rte-drawing__grid');
    expect(plotSvg([])).not.toContain('rte-drawing__grid');
  });

  it('тики с числами по showAxesTicks', () => {
    const withTicks = renderGeometrySvg(normalizeGeometryScene({ type: 'plot_2d', plots: [], showGrid: false }));

    expect(labels(withTicks)).toEqual(expect.arrayContaining(['0', '1', '-1', '2', '-2']));
    expect(labels(plotSvg([]))).not.toContain('1');
  });

  it('при мелком масштабе тики редеют, чтобы числа не слипались', () => {
    const svg = renderGeometrySvg(normalizeGeometryScene({ type: 'plot_2d', plots: [], scale: 5, showGrid: false }));
    const numbers = labels(svg).map(Number).filter((value) => Number.isFinite(value));

    expect(numbers).toContain(5);
    expect(numbers).not.toContain(1);
  });

  it('содержимое можно отрисовать напрямую в SvgBuilder без обёртки', () => {
    const builder = new SvgBuilder();

    renderPlot2dContent(
      normalizeGeometryScene({ type: 'plot_2d', plots: [{ type: 'point', coords: [1, 1] }] }),
      { scale: 20, cx: 150, cy: 150 },
      { width: 300, height: 300 },
      null,
      builder,
    );

    const content = builder.toString();

    expect(content).not.toContain('<svg');
    expect(content).toContain('<circle cx="170" cy="130" r="5"');
  });
});

describe('renderPlot2dContent: кривые', () => {
  it('парабола даёт путь из многих точек, вершина на месте', () => {
    const svg = plotSvg([{ type: 'parabola', vertex: [0, 0], direction: 'up', stretchY: 1 }]);
    const [path] = plotTags(svg, 'path');

    expect(path).toMatch(/d="M [\d.-]+ [\d.-]+ L /);
    expect((path.match(/ L /g) ?? []).length).toBeGreaterThan(50);
    // Вершина (0, 0) → (150, 150) — самая нижняя точка пути.
    expect(path).toContain('L 150 150');
  });

  it('парабола учитывает direction, stretchX/stretchY и domain', () => {
    const down = plotSvg([{ type: 'parabola', vertex: [0, 0], direction: 'down', stretchY: 2, domain: [-1, 1] }]);
    const [path] = plotTags(down, 'path');
    const ys = [...path.matchAll(/[ML] ([\d.-]+) ([\d.-]+)/g)].map((match) => Number(match[2]));
    const xs = [...path.matchAll(/[ML] ([\d.-]+) ([\d.-]+)/g)].map((match) => Number(match[1]));

    expect(Math.min(...ys)).toBe(150);
    expect(Math.max(...ys)).toBeCloseTo(190, 0);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(130);
    expect(Math.max(...xs)).toBeLessThanOrEqual(170);
  });

  it('корень — одна ветвь от вершины', () => {
    const svg = plotSvg([{ type: 'sqrt', vertex: [1, 0], stretch: 1 }]);
    const paths = plotTags(svg, 'path');

    expect(paths).toHaveLength(1);
    expect(paths[0]).toContain('d="M 170 150 L');
  });

  it('гипербола — два пути, по одному на ветвь', () => {
    const svg = plotSvg([{ type: 'hyperbola', center: [0, 0], k: 1 }]);

    expect(plotTags(svg, 'path')).toHaveLength(2);
  });

  it('прямая по k/b и по двум точкам', () => {
    const byCoefficients = plotSvg([{ type: 'line', k: 1, b: 0 }]);
    const lines = plotTags(byCoefficients, 'line');

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('stroke-width="2"');

    const byPoints = plotSvg([{ type: 'line', p1: [0, 0], p2: [2, 1], style: 'dashed' }]);
    const [segment] = plotTags(byPoints, 'line');

    expect(segment).toContain('x1="150" y1="150" x2="190" y2="130"');
    expect(segment).toContain('stroke-dasharray');
  });

  it('прямая по k/b на domain обрезается по нему', () => {
    const [line] = plotTags(plotSvg([{ type: 'line', k: 2, b: 1, domain: [0, 1] }]), 'line');

    expect(line).toContain('x1="150" y1="130" x2="170" y2="90"');
  });

  it('окружность: радиус в пикселях, центр, пунктирный радиус с числом', () => {
    const svg = plotSvg([{ type: 'circle', center: [0, 0], radius: 1.5 }]);
    const circles = plotTags(svg, 'circle');

    expect(circles.some((circle) => circle.includes('r="30"'))).toBe(true);
    expect(circles.some((circle) => circle.includes('r="2.5"'))).toBe(true);
    expect(plotTags(svg, 'line').some((line) => line.includes('stroke-dasharray="3 3"'))).toBe(true);
    expect(labels(svg)).toContain('1.5');
  });

  it('закрашенная окружность берёт штриховку', () => {
    expect(plotSvg([{ type: 'circle', center: [0, 0], radius: 1, fill: true }])).toContain('url(#rte-drawing-stripe)');
  });

  it('штриховка многоугольником и прямоугольником bounds', () => {
    const polygon = plotSvg([{ type: 'shading', points: [[0, 0], [2, 0], [2, 2]], color: '#16a34a' }]);

    expect(polygon).toContain('url(#rte-drawing-stripe)');
    expect(polygon).toContain('<g color="#16a34a">');
    expect(plotTags(polygon, 'polygon').length).toBeGreaterThanOrEqual(2);

    const rect = plotSvg([{ type: 'shading', bounds: [2, -1, 0, 1] }]);
    const rects = tags(rect, 'rect');

    expect(rects.length).toBeGreaterThanOrEqual(2);
    expect(rects[0]).toContain('x="130" y="130" width="60" height="20"');
    expect(rect).toContain('url(#rte-drawing-stripe)');
  });

  it('freehand — ломаная по точкам', () => {
    const svg = plotSvg([{ type: 'freehand', points: [[0, 0], [1, 1], [2, 0]] }]);
    const [polyline] = tags(svg, 'polyline');

    expect(polyline).toContain('points="150,150 170,130 190,150"');
  });

  it('пунктирный стиль графика', () => {
    const [path] = plotTags(plotSvg([{ type: 'parabola', vertex: [0, 0], style: 'dashed' }]), 'path');

    expect(path).toContain('stroke-dasharray="4"');
  });
});

describe('renderPlot2dContent: точки и подписи', () => {
  it('точка solid залита цветом, hollow — белая с обводкой', () => {
    const solid = plotSvg([{ type: 'point', coords: [1, 1], style: 'solid' }]);
    const hollow = plotSvg([{ type: 'point', coords: [1, 1], style: 'hollow', color: '#dc2626' }]);

    expect(solid).toContain('<circle cx="170" cy="130" r="5" fill="#3b82f6"');
    expect(hollow).toContain('<circle cx="170" cy="130" r="5" fill="#fff" stroke="#dc2626"');
  });

  it('подпись точки: \\frac{1}{2} → 1/2, \\pi → π', () => {
    const svg = plotSvg([
      { type: 'point', coords: [1, 1], label: '\\frac{1}{2}' },
      { type: 'point', coords: [2, 2], label: '\\pi' },
    ]);

    expect(labels(svg)).toEqual(expect.arrayContaining(['1/2', 'π']));
  });

  it('подписи кривых рисуются цветом графика', () => {
    const svg = plotSvg([
      { type: 'parabola', vertex: [0, 0], label: 'y = x^2', color: '#dc2626' },
      { type: 'line', k: 1, b: 0, label: 'y = x' },
      { type: 'hyperbola', center: [0, 0], k: 1, label: 'y = 1/x' },
      { type: 'circle', center: [0, 0], radius: 1, label: 'ω' },
    ]);

    expect(labels(svg)).toEqual(expect.arrayContaining(['y = x^2', 'y = x', 'y = 1/x', 'ω']));
    expect(svg).toMatch(/<text[^>]*fill="#dc2626">y = x\^2<\/text>/);
  });

  it('подписи экранируются', () => {
    const svg = plotSvg([{ type: 'point', coords: [0, 0], label: '<b>' }]);

    expect(svg).toContain('&lt;b&gt;');
    expect(svg).not.toContain('<b>');
  });

  it('точки рисуются поверх кривых', () => {
    const svg = plotSvg([
      { type: 'point', coords: [0, 0] },
      { type: 'parabola', vertex: [0, 0] },
    ]);

    expect(svg.indexOf('<path')).toBeLessThan(svg.indexOf('r="5"'));
  });
});

describe('renderPlot2dContent: подсветка', () => {
  const plots = [
    { type: 'parabola', id: 'p1', vertex: [0, 0] },
    { type: 'point', id: 'pt', coords: [1, 1] },
    { type: 'circle', id: 'c1', center: [0, 0], radius: 1 },
  ];

  it('график подсвечивается по id через plot и circle_plot', () => {
    const scene = normalizeGeometryScene({ type: 'plot_2d', plots, showGrid: false });

    expect(renderGeometrySvg(scene)).not.toContain(HIGHLIGHT);
    expect(renderGeometrySvg(scene, { highlight: { type: 'plot', id: 'p1' } })).toContain(HIGHLIGHT);
    expect(renderGeometrySvg(scene, { highlight: { type: 'plot', id: 'pt' } })).toContain(HIGHLIGHT);
    expect(renderGeometrySvg(scene, { highlight: { type: 'circle_plot', id: 'c1' } })).toContain(HIGHLIGHT);
    expect(renderGeometrySvg(scene, { highlight: { type: 'plot', id: 'nope' } })).not.toContain(HIGHLIGHT);
  });

  it('график без id не подсвечивается чужим id', () => {
    const scene = normalizeGeometryScene({ type: 'plot_2d', plots: [{ type: 'parabola', vertex: [0, 0] }], showGrid: false });

    expect(renderGeometrySvg(scene, { highlight: { type: 'plot', id: 'undefined' } })).not.toContain(HIGHLIGHT);
  });
});
