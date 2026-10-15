import { describe, expect, it } from 'vitest';
import { normalizeGeometryScene } from '../src/scene/normalize';
import type { GeometryScene, Point } from '../src/scene/types';
import { collectGeometryPoints, renderGeometrySvg, resolveGeometryViewport } from '../src/render/geometry-svg';
import { prettifyMathText } from '../src/render/geometry-marks';

const HIGHLIGHT = '#ec4899';

/** Разметка без `<defs>`: линия паттерна штриховки — не элемент чертежа. */
const body = (svg: string): string => svg.replace(/<defs>[\s\S]*?<\/defs>/, '');

const tags = (svg: string, tag: string): string[] => body(svg).match(new RegExp(`<${tag}\\b[^>]*>`, 'g')) ?? [];

/** Линии чертежа без сетки и осей. */
const figureLines = (svg: string): string[] => tags(svg, 'line').filter((line) => !/rte-drawing__(grid|axis)/.test(line));

/** Тексты подписей без белых подложек. */
const labels = (svg: string): string[] =>
  [...svg.matchAll(/<text\b(?:(?!rte-drawing__halo)[^>])*>([^<]*)<\/text>/g)].map((match) => match[1]);

const vertexDots = (svg: string): Array<[number, number]> =>
  [...svg.matchAll(/<circle cx="([^"]+)" cy="([^"]+)" r="3"/g)].map((match) => [Number(match[1]), Number(match[2])]);

const README_TRIANGLE = {
  type: '2d',
  vertices: { A: [0, 0], B: [4, 0], C: [0, 3] },
  edges: [['A', 'B'], ['B', 'C'], ['C', 'A']],
  angles: [{ points: ['B', 'A', 'C'], style: 'right' }],
};

const PYRAMID = {
  type: '3d',
  vertices: { A: [0, 0, 0], B: [4, 0, 0], C: [4, 4, 0], D: [0, 4, 0], S: [2, 2, 4] },
  edges: [
    ['A', 'B'],
    ['B', 'C'],
    ['C', 'D'],
    { from: 'D', to: 'A', style: 'dashed' },
    ['S', 'A'],
    ['S', 'B'],
    ['S', 'C'],
    ['S', 'D'],
  ],
  sections: [{ vertices: ['A', 'C', 'S'] }],
  showGrid: false,
};

describe('renderGeometrySvg: плоский чертёж', () => {
  it('прямоугольный треугольник из README: три ребра, уголок прямого угла, подписи A/B/C', () => {
    const svg = renderGeometrySvg(normalizeGeometryScene({ ...README_TRIANGLE, showGrid: false }));

    expect(svg.startsWith('<svg class="rte-drawing__svg"')).toBe(true);
    expect(svg).toContain('viewBox="0 0 300 300"');
    expect(svg).toContain('id="rte-drawing-stripe"');
    expect(figureLines(svg)).toHaveLength(3);
    expect(tags(svg, 'polyline')).toHaveLength(1);
    expect(tags(svg, 'polyline')[0]).toMatch(/points="[^"]+ [^"]+ [^"]+"/);
    expect(labels(svg)).toEqual(expect.arrayContaining(['A', 'B', 'C']));
    expect(vertexDots(svg)).toHaveLength(3);
  });

  it('ось y мира смотрит вверх: C над A на картинке', () => {
    const svg = renderGeometrySvg(normalizeGeometryScene({ ...README_TRIANGLE, showGrid: false }));
    const [a, , c] = vertexDots(svg);

    expect(c[0]).toBe(a[0]);
    expect(c[1]).toBeLessThan(a[1]);
  });

  it('сетка и пунктирные оси рисуются по showGrid и выключаются', () => {
    const withGrid = renderGeometrySvg(normalizeGeometryScene(README_TRIANGLE));
    const withoutGrid = renderGeometrySvg(normalizeGeometryScene({ ...README_TRIANGLE, showGrid: false }));

    expect(withGrid).toContain('rte-drawing__grid');
    expect(withGrid).toContain('rte-drawing__axis');
    expect(withoutGrid).not.toContain('rte-drawing__grid');
    expect(withoutGrid).not.toContain('rte-drawing__axis');
  });

  it('засечки ticks: 2 дают две короткие линии поперёк ребра', () => {
    const scene = normalizeGeometryScene({
      type: '2d',
      vertices: { A: [0, 0], B: [4, 0] },
      edges: [{ from: 'A', to: 'B', ticks: 2 }],
      showGrid: false,
    });
    const lines = figureLines(renderGeometrySvg(scene));

    expect(lines).toHaveLength(3);
    expect(lines.filter((line) => line.includes('stroke-width="1.2"'))).toHaveLength(2);
  });

  it('угол с дугами и подписью: double — две дуги, подпись через prettify', () => {
    const scene = normalizeGeometryScene({
      type: '2d',
      vertices: { A: [0, 0], B: [4, 0], C: [0, 3] },
      edges: [['A', 'B'], ['A', 'C']],
      angles: [{ points: ['B', 'A', 'C'], style: 'double', label: '\\sqrt{2}' }],
      showGrid: false,
    });
    const svg = renderGeometrySvg(scene);

    expect(tags(svg, 'path').filter((path) => path.includes(' A '))).toHaveLength(2);
    expect(labels(svg)).toContain('√2');
  });

  it('текстовая подпись у отрезка: \\sqrt{3} становится √3 курсивом', () => {
    const scene = normalizeGeometryScene({
      ...README_TRIANGLE,
      text_labels: [{ text: '\\sqrt{3}', position: ['A', 'C'], offset: 'left' }],
      showGrid: false,
    });
    const svg = renderGeometrySvg(scene);

    expect(labels(svg)).toContain('√3');
    expect(svg).toMatch(/<text[^>]*font-style="italic"[^>]*>√3<\/text>/);
  });

  it('подпись в точке coords считается координатами мира', () => {
    const scene = normalizeGeometryScene({
      type: '2d',
      vertices: { A: [0, 0] },
      text_labels: [{ text: 'M', coords: [2, 0] }],
      showGrid: false,
    });
    const svg = renderGeometrySvg(scene);

    // Начало координат в (150, 150), масштаб 25: точка мира (2, 0) → x = 200.
    expect(svg).toMatch(/<text x="200" y="150"[^>]*>M<\/text>/);
  });

  it('окружность на плоском чертеже: центр, пунктирный радиус с числом, подсветка circle_plot', () => {
    const raw = {
      type: '2d',
      vertices: { O: [0, 0] },
      plots: [{ type: 'circle', id: 'c1', centerVertex: 'O', radius: 2, label: 'ω' }],
      showGrid: false,
    };
    const svg = renderGeometrySvg(normalizeGeometryScene(raw));

    expect(svg).toContain('r="50"');
    expect(svg).toContain('stroke-dasharray="3 3"');
    expect(labels(svg)).toEqual(expect.arrayContaining(['2', 'ω', 'O']));
    expect(svg).not.toContain(HIGHLIGHT);

    const highlighted = renderGeometrySvg(normalizeGeometryScene(raw), { highlight: { type: 'circle_plot', id: 'c1' } });

    expect(highlighted).toContain(HIGHLIGHT);
  });

  it('подписи вершин экранируются', () => {
    const scene = normalizeGeometryScene({ type: '2d', vertices: { '<b>': [0, 0] }, showGrid: false });
    const svg = renderGeometrySvg(scene);

    expect(svg).toContain('&lt;b&gt;');
    expect(svg).not.toContain('<b>');
  });

  it('положение буквы из labels: left/right/above/below сдвигают подпись', () => {
    const render = (placement: string): [number, number] => {
      const svg = renderGeometrySvg(
        normalizeGeometryScene({ type: '2d', vertices: { A: [0, 0] }, labels: { A: placement }, showGrid: false }),
      );
      const match = /<text x="([^"]+)" y="([^"]+)"[^>]*>A<\/text>/.exec(svg);

      if (!match) throw new Error('Нет подписи A');

      return [Number(match[1]), Number(match[2])];
    };

    const [, aboveY] = render('above');
    const [, belowY] = render('below');
    const [leftX] = render('left');
    const [rightX, rightY] = render('right');
    const [belowLeftX, belowLeftY] = render('below left');

    expect(aboveY).toBeLessThan(150);
    expect(belowY).toBeGreaterThan(150);
    expect(leftX).toBeLessThan(150);
    expect(rightX).toBeGreaterThan(150);
    expect(rightY).toBeGreaterThan(150);
    expect(belowLeftX).toBeLessThan(150);
    expect(belowLeftY).toBe(belowY);
  });
});

describe('renderGeometrySvg: стереометрия', () => {
  it('пирамида: скрытое ребро пунктиром, сечение полигоном, все вершины подписаны', () => {
    const svg = renderGeometrySvg(normalizeGeometryScene(PYRAMID));
    const lines = figureLines(svg);

    expect(lines).toHaveLength(8);
    expect(lines.filter((line) => line.includes('stroke-dasharray'))).toHaveLength(1);
    expect(tags(svg, 'polygon')).toHaveLength(1);
    expect(tags(svg, 'polygon')[0]).toContain('#10b981');
    expect(labels(svg)).toEqual(expect.arrayContaining(['A', 'B', 'C', 'D', 'S']));
  });

  it('3D с ненулевой z — кабинетная проекция: ребро вдоль x уходит наискось', () => {
    const svg = renderGeometrySvg(normalizeGeometryScene(PYRAMID));
    const [a, b] = vertexDots(svg);

    expect(a[0]).not.toBe(b[0]);
    expect(a[1]).not.toBe(b[1]);
  });

  it('цилиндр: эллипсы оснований путями, образующие линиями, скрытая дуга пунктиром', () => {
    const scene = normalizeGeometryScene({
      type: '3d',
      vertices: { O1: [0, 0, 0], O2: [0, 0, 3] },
      cylinders: [{ base: 'O1', top: 'O2', radius: 1.5 }],
      showGrid: false,
    });
    const svg = renderGeometrySvg(scene);
    const paths = tags(svg, 'path');

    expect(paths).toHaveLength(3);
    expect(paths.filter((path) => path.includes('stroke-dasharray'))).toHaveLength(1);
    expect(paths.filter((path) => / Z"/.test(path))).toHaveLength(1);
    expect(figureLines(svg)).toHaveLength(2);
    // 32 точки на эллипсе: `M` и 31 `L`.
    expect((paths.find((path) => / Z"/.test(path)) ?? '').match(/ L /g)).toHaveLength(31);
  });

  it('showAxes даёт оси X/Y/Z со стрелками, showGrid — сетку плоскости', () => {
    const svg = renderGeometrySvg(normalizeGeometryScene({ ...PYRAMID, showAxes: true, showGrid: true }));

    expect(labels(svg)).toEqual(expect.arrayContaining(['X', 'Y', 'Z']));
    expect(tags(svg, 'line').filter((line) => line.includes('rte-drawing__axis'))).toHaveLength(3);
    expect(tags(svg, 'polygon').filter((polygon) => polygon.includes('rte-drawing__axis'))).toHaveLength(3);
    expect(tags(svg, 'line').filter((line) => line.includes('rte-drawing__grid'))).toHaveLength(22);
  });
});

describe('renderGeometrySvg: подсветка', () => {
  const scene = normalizeGeometryScene({ ...README_TRIANGLE, showGrid: false });

  it('без подсветки розового нет', () => {
    expect(renderGeometrySvg(scene)).not.toContain(HIGHLIGHT);
  });

  it('ребро подсвечивается в любом порядке концов', () => {
    const svg = renderGeometrySvg(scene, { highlight: { type: 'edge', from: 'B', to: 'A' } });
    const glow = figureLines(svg).filter((line) => line.includes(HIGHLIGHT));

    expect(glow).toHaveLength(1);
    expect(glow[0]).toContain('stroke-width="6.8"');
  });

  it('вершина, угол и сечение подсвечиваются', () => {
    expect(renderGeometrySvg(scene, { highlight: { type: 'vertex', id: 'C' } })).toContain(HIGHLIGHT);
    expect(renderGeometrySvg(scene, { highlight: { type: 'vertex_draft', id: 'C' } })).toContain(HIGHLIGHT);
    expect(renderGeometrySvg(scene, { highlight: { type: 'angle', id: 'angle_BAC' } })).toContain(HIGHLIGHT);
    expect(renderGeometrySvg(scene, { highlight: { type: 'angle', id: 'angle_ABC' } })).not.toContain(HIGHLIGHT);

    const pyramid = renderGeometrySvg(normalizeGeometryScene(PYRAMID), {
      highlight: { type: 'section', vertices: ['A', 'C', 'S'] },
    });

    expect(tags(pyramid, 'polygon')[0]).toContain(HIGHLIGHT);
  });

  it('черновик угла: кружки у точек и пунктир между первыми двумя', () => {
    const svg = renderGeometrySvg(scene, { highlight: { type: 'angle_draft', points: ['B', 'A'] } });

    expect(svg).toContain('#8b5cf6');
    expect(figureLines(svg).filter((line) => line.includes('#8b5cf6'))).toHaveLength(1);
  });
});

describe('autoFit и viewport', () => {
  const far = normalizeGeometryScene({
    type: '2d',
    vertices: { A: [100, 100], B: [112, 100], C: [100, 109] },
    edges: [['A', 'B'], ['B', 'C'], ['C', 'A']],
  });

  it('без autoFit масштаб и центр берутся из сцены', () => {
    expect(resolveGeometryViewport(far)).toEqual({ scale: 25, cx: 150, cy: 150 });
    expect(resolveGeometryViewport({ ...far, scale: 40, offsetX: 10, offsetY: -5 }, { width: 400 })).toEqual({
      scale: 40,
      cx: 210,
      cy: 145,
    });
    expect(resolveGeometryViewport({ ...far, type: 'plot_2d' }).scale).toBe(20);
  });

  it('далёкие вершины вписываются в картинку, масштаб в пределах 12–120', () => {
    const viewport = resolveGeometryViewport(far, { autoFit: true });

    expect(viewport.scale).toBeGreaterThanOrEqual(12);
    expect(viewport.scale).toBeLessThanOrEqual(120);

    const dots = vertexDots(renderGeometrySvg(far, { autoFit: true }));

    expect(dots).toHaveLength(3);
    dots.forEach(([x, y]) => {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(300);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(300);
    });
  });

  it('точки для вписывания: вершины 3D проецируются, у графиков — опорные точки', () => {
    const points3d = collectGeometryPoints(normalizeGeometryScene(PYRAMID));

    expect(points3d).toHaveLength(5);
    points3d.forEach((point) => expect(point).toHaveLength(2));

    const plot = normalizeGeometryScene({
      type: 'plot_2d',
      plots: [
        { type: 'circle', center: [1, 1], radius: 2 },
        { type: 'line', p1: [0, 0], p2: [3, 3] },
        { type: 'point', coords: [5, 5] },
        { type: 'parabola', vertex: [-1, -1] },
      ],
    });

    expect(collectGeometryPoints(plot)).toEqual(
      expect.arrayContaining([[-1, 1], [3, 1], [1, -1], [1, 3], [0, 0], [3, 3], [5, 5], [-1, -1]]),
    );
  });

  it('у кривых в вписывание попадает кусок ветвей, а не только вершина', () => {
    const parabola = normalizeGeometryScene({ type: 'plot_2d', plots: [{ type: 'parabola', vertex: [1, -1], stretchY: 0.5 }] });

    expect(collectGeometryPoints(parabola)).toEqual(expect.arrayContaining([[1, -1], [-1, 1], [3, 1]]));
    expect(resolveGeometryViewport(parabola, { autoFit: true }).scale).toBeLessThan(120);

    const sqrt = normalizeGeometryScene({ type: 'plot_2d', plots: [{ type: 'sqrt', vertex: [0, 0], directionX: 'left', stretch: 1 }] });

    expect(collectGeometryPoints(sqrt)).toEqual(expect.arrayContaining([[0, 0], [-4, 2]]));

    const hyperbola = normalizeGeometryScene({ type: 'plot_2d', plots: [{ type: 'hyperbola', center: [0, 0], k: 2 }] });

    expect(collectGeometryPoints(hyperbola)).toEqual(expect.arrayContaining([[0, 0], [1, 2], [-1, -2], [2, 1], [-2, -1]]));
  });

  it('пустая сцена с autoFit получает запасной масштаб', () => {
    expect(resolveGeometryViewport(normalizeGeometryScene({}), { autoFit: true })).toEqual({ scale: 25, cx: 150, cy: 150 });
    expect(resolveGeometryViewport(normalizeGeometryScene({ type: 'plot_2d' }), { autoFit: true }).scale).toBe(15);
  });
});

describe('устойчивость рендера', () => {
  it('рёбра и углы с несуществующими вершинами пропускаются', () => {
    const scene: GeometryScene = {
      ...normalizeGeometryScene({ type: '2d', vertices: { A: [0, 0] }, showGrid: false }),
      edges: [{ from: 'A', to: 'Z', style: 'solid' }],
      angles: [{ points: ['A', 'Z', 'Q'], style: 'single' }],
      textLabels: [{ text: 'x', position: ['A', 'Z'] }],
    };
    const svg = renderGeometrySvg(scene);

    expect(figureLines(svg)).toHaveLength(0);
    expect(labels(svg)).toEqual(['A']);
  });

  it('сломанная вершина не роняет рендер', () => {
    const scene: GeometryScene = {
      ...normalizeGeometryScene({ type: '2d', vertices: { A: [0, 0], B: [1, 1] }, edges: [['A', 'B']], showGrid: false }),
      vertices: { A: [0, 0], B: null as unknown as Point },
    };

    expect(() => renderGeometrySvg(scene)).not.toThrow();
    expect(renderGeometrySvg(scene)).toContain('<svg');
  });

  it('цвет из сцены, не похожий на цвет, не попадает в разметку', () => {
    const scene = normalizeGeometryScene({
      type: '2d',
      vertices: { A: [0, 0], B: [1, 0] },
      edges: [{ from: 'A', to: 'B', color: '"><script>' }],
      showGrid: false,
    });

    expect(renderGeometrySvg(scene)).not.toContain('<script>');
  });
});

describe('prettifyMathText', () => {
  it('корни, дроби и команды LaTeX становятся юникодом', () => {
    expect(prettifyMathText('\\sqrt{3}')).toBe('√3');
    expect(prettifyMathText('2\\sqrt{2}')).toBe('2√2');
    expect(prettifyMathText('sqrt(5)')).toBe('√5');
    expect(prettifyMathText('\\sqrt{a+b}')).toBe('√(a+b)');
    expect(prettifyMathText('(sqrt 3)')).toBe('√3');
    expect(prettifyMathText('\\frac{\\sqrt{3}}{2}')).toBe('√3/2');
    expect(prettifyMathText('$\\pi/2$')).toBe('π/2');
    expect(prettifyMathText('60^\\circ')).toBe('60°');
    expect(prettifyMathText('AB')).toBe('AB');
  });
});
