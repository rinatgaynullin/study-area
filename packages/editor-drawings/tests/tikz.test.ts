import { describe, expect, it } from 'vitest';
import { normalizeGeometryScene, normalizePhysicsScene } from '../src/scene/normalize';
import type { PhysicsElementType } from '../src/scene/types';
import { geometryToTikz, physicsToTikz } from '../src/tikz';

const geometry = (raw: unknown): string => geometryToTikz(normalizeGeometryScene(raw));

const physics = (elements: unknown[]): string => physicsToTikz(normalizePhysicsScene({ type: 'physics', elements }));

describe('geometryToTikz: 3D', () => {
  const pyramid = {
    type: '3d',
    vertices: { A: [0, 0, 0], B: [2, 0, 0], C: [2, 2, 0], D: [0, 2, 0], S: [1, 1, 3] },
    edges: [
      ['A', 'B'],
      ['B', 'C'],
      ['C', 'D'],
      { from: 'D', to: 'A', style: 'dashed' },
      ['S', 'A'],
      ['S', 'B'],
      ['S', 'C'],
      { from: 'S', to: 'D', style: 'hidden' },
    ],
    sections: [{ vertices: ['A', 'C', 'S'] }],
    labels: { S: 'above', A: 'below left' },
  };
  const tikz = geometry(pyramid);

  it('пишет преамбулу с scale=3, векторами осей и стилями hidden/visible', () => {
    expect(tikz).toContain('\\begin{tikzpicture}[scale=3, line join=round, line cap=round, x={(-0.6cm,-0.3cm)}, y={(1cm,0cm)}, z={(0cm,1cm)}, >=Stealth]');
    expect(tikz).toContain('hidden/.style={dashed, thin, color=black!70}');
    expect(tikz).toContain('visible/.style={thick, color=black}');
    expect(tikz).toContain('\\coordinate (S) at (1,1,3);');
    expect(tikz.trim().endsWith('\\end{tikzpicture}')).toBe(true);
  });

  it('скрытые рёбра идут стилем hidden раньше видимых', () => {
    expect(tikz).toContain('\\draw[hidden] (D) -- (A);');
    expect(tikz).toContain('\\draw[hidden] (S) -- (D);');
    expect(tikz).toContain('\\draw[visible] (A) -- (B);');
    expect(tikz.lastIndexOf('\\draw[hidden]')).toBeLessThan(tikz.indexOf('\\draw[visible]'));
  });

  it('рисует сечение заливкой и подписывает вершины', () => {
    expect(tikz).toContain('\\fill[fill=blue!10, opacity=0.5] (A) -- (C) -- (S) -- cycle;');
    expect(tikz).toContain('\\node[above, fill=white, inner sep=1pt] at (S) {$S$};');
    expect(tikz).toContain('\\node[below left, fill=white, inner sep=1pt] at (A) {$A$};');
  });

  it('цилиндр: верхнее основание видимое, нижнее — скрытая дуга и образующие', () => {
    const out = geometry({
      type: '3d',
      vertices: { O1: [0, 0, 0], O2: [0, 0, 2] },
      edges: [['O1', 'O2']],
      cylinders: [{ base: 'O1', top: 'O2', radius: 1 }],
    });

    expect(out).toContain('\\draw[visible] (O2) circle (1);');
    expect(out).toMatch(/\\draw\[hidden\] \(\[shift=\{\([\d.]+:1\)\}\]O1\) arc\[/);
    expect(out.match(/-- \(\[shift=/g)?.length).toBe(2);
  });
});

describe('geometryToTikz: 2D', () => {
  const triangle = {
    type: '2d',
    vertices: { A: [0, 0], B: [4, 0], C: [0, 3] },
    edges: [
      { from: 'A', to: 'B', ticks: 2 },
      ['B', 'C'],
      ['C', 'A'],
    ],
    angles: [
      { points: ['B', 'A', 'C'], style: 'right' },
      { points: ['A', 'B', 'C'], style: 'single', label: '30°' },
    ],
    plots: [{ type: 'circle', centerVertex: 'A', radius: 2, label: 'ω' }],
    text_labels: [{ text: '√3', position: ['B', 'C'], offset: 'right' }],
    labels: { C: 'above' },
  };
  const tikz = geometry(triangle);

  it('объявляет координаты и рёбра', () => {
    expect(tikz).toContain('\\begin{tikzpicture}[scale=1.5, line join=round, >=Stealth]');
    expect(tikz).toContain('\\coordinate (A) at (0,0);');
    expect(tikz).toContain('\\draw[thick] (B) -- (C);');
  });

  it('углы — через pic: прямой и обычный с подписью', () => {
    expect(tikz).toContain('\\pic [draw, angle radius=0.3cm] {right angle = B--A--C};');
    expect(tikz).toMatch(/\\pic \[draw, angle radius=0\.4cm, angle eccentricity=1\.6, pic text=\{\$30\^\{\\circ\}\$\}\] \{angle = (A--B--C|C--B--A)\};/);
    expect(tikz).toContain('\\usetikzlibrary{');
    expect(tikz).toMatch(/\\usetikzlibrary\{[^}]*angles[^}]*quotes/);
  });

  it('засечки — короткие перпендикуляры у середины ребра', () => {
    const ticks = tikz.match(/\\draw\[thick\] \(1\.9[0-9]?,0\.1\) -- \(1\.9[0-9]?,-0\.1\);|\\draw\[thick\] \(2\.0[0-9]?,0\.1\) -- \(2\.0[0-9]?,-0\.1\);/g) ?? [];

    expect(ticks.length).toBe(2);
  });

  it('окружность по вершине-центру и текстовая подпись у середины отрезка через calc', () => {
    expect(tikz).toContain('\\draw[thick] (A) circle (2);');
    expect(tikz).toContain('{$\\omega$}');
    expect(tikz).toMatch(/\\node\[[a-z ]+\] at \(\$\(B\)!0\.5!\(C\)\$\) \{\$\\sqrt\{3\}\$\};/);
    expect(tikz).toMatch(/\\usetikzlibrary\{[^}]*calc/);
  });

  it('подписи вершин: положение из labels или below', () => {
    expect(tikz).toContain('\\node[above, fill=white, inner sep=0.5pt] at (C) {$C$};');
    expect(tikz).toContain('\\node[below, fill=white, inner sep=0.5pt] at (A) {$A$};');
  });

  it('пунктирное ребро получает dashed', () => {
    const out = geometry({ type: '2d', vertices: { A: [0, 0], B: [1, 1] }, edges: [{ from: 'A', to: 'B', style: 'dashed' }] });

    expect(out).toContain('\\draw[thick, dashed] (A) -- (B);');
  });
});

describe('geometryToTikz: plot_2d', () => {
  const tikz = geometry({
    type: 'plot_2d',
    plots: [
      { type: 'parabola', vertex: [1, 2], direction: 'down', stretchX: 1, stretchY: 1, label: 'f' },
      { type: 'line', k: 2, b: -1 },
      { type: 'point', coords: [1, 2], style: 'hollow', label: 'M' },
      { type: 'hyperbola', center: [0, 0], k: 2 },
      { type: 'circle', center: [2, 2], radius: 1 },
      { type: 'shading', bounds: [0, 1, 0, 2] },
    ],
  });

  it('открывает и закрывает окружение axis', () => {
    expect(tikz).toContain('\\begin{tikzpicture}\n\\begin{axis}[axis lines=middle, xlabel=$x$, ylabel=$y$, xmin=-6, xmax=6, ymin=-4, ymax=6, grid=both, axis equal image]');
    expect(tikz).toContain('\\end{axis}\n\\end{tikzpicture}');
  });

  it('парабола вниз с вершиной (1, 2) получает знак минус', () => {
    expect(tikz).toMatch(/\\addplot\[thick, blue, domain=-6:6, samples=100\] \{-\(x - 1\)\^2 \+ 2\};/);
  });

  it('прямая по k и b — addplot с областью', () => {
    expect(tikz).toMatch(/\\addplot\[thick, red, domain=-6:6\] \{2\*x - 1\};/);
  });

  it('пустая точка — белая заливка с подписью', () => {
    expect(tikz).toContain('\\node[circle, draw, fill=white, inner sep=1.5pt] at (axis cs:1,2) {};');
    expect(tikz).toContain('\\node[above right] at (axis cs:1,2) {$M$};');
  });

  it('гипербола — две ветви, окружность и штриховка — командами TikZ', () => {
    expect(tikz.match(/\\addplot\[thick, blue, domain=[^\]]*samples=80\] \{2\/\(x\)\};/g)?.length).toBe(2);
    expect(tikz).toContain('\\draw[thick, orange] (axis cs:2,2) circle [radius=1];');
    expect(tikz).toContain('\\fill[blue!10, opacity=0.4] (axis cs:0,0) rectangle (axis cs:1,2);');
  });

  it('границы осей расширяются по точкам графиков', () => {
    const wide = geometry({ type: 'plot_2d', plots: [{ type: 'point', coords: [9, -7] }] });

    expect(wide).toContain('xmax=10');
    expect(wide).toContain('ymin=-8');
  });
});

describe('physicsToTikz', () => {
  const fixtures: Record<PhysicsElementType, Record<string, unknown>> = {
    surface: { points: [[-3, 0], [3, 0]], hatching: 'bottom' },
    arc_surface: { center: [0, 2], points: [[-2, 2], [0, 0]] },
    block: { subtype: 'rectangle', center: [0, 0.5], width: 1.6, height: 1, label: 'm' },
    rope: { points: [[0, 0], [1, 1], [2, 1]] },
    spring: { points: [[0, 0], [3, 0]], label: 'k' },
    vector: { vectorType: 'force', points: [[0, 0], [2, 0]], label: '\\vec{F}' },
    angle: { center: [0, 0], points: [[2, 0], [1, 1]], label: '\\alpha' },
    stickman: { center: [0, 0], height: 1.6 },
    balloon: { center: [0, 2], radius: 0.6, points: [[0, 0]] },
    ellipse_platform: { center: [0, 0], rx: 2, ry: 0.5 },
    dimension_line: { points: [[0, 0], [0, 3]], label: 'h' },
    thermo_axes: { xLabel: 'V', yLabel: 'p', xTicks: [{ val: 1, label: 'V_1' }], yTicks: [{ val: 2 }] },
    thermo_point: { coords: [2, 3], label: '1' },
    thermo_process: { subtype: 'line', points: [[1, 1], [3, 3]] },
    piston_vessel: { center: [0, 0], width: 2, height: 3, weight: true },
    circuit_component: { subtype: 'resistor', points: [[0, 0], [2, 0]], label: 'R' },
    wire: { points: [[0, 0], [2, 0], [2, 2]], wavy: true },
    charge: { coords: [0, 0], charge: '+' },
    field_line: { subtype: 'electric', points: [[0, 0], [1, 1], [2, 1]] },
    capacitor_plate: { points: [[0, 0], [0, 2]], plateType: 'positive' },
    current_conductor: { coords: [0, 0], subtype: 'cross' },
    circle_shape: { center: [0, 0], radius: 1 },
    lens: { center: [0, 0], height: 3, subtype: 'converging', focalLength: 2 },
    mirror: { points: [[0, 0], [3, 0]] },
    ray: { points: [[-3, 1], [0, 0], [3, -1]] },
    optics_arrow: { center: [-2, 0], height: 1, label: 'AB' },
    prism: { points: [[0, 0], [2, 0], [1, 2]] },
    glass_slab: { center: [0, 0], width: 2, height: 1 },
    text_label: { coords: [0, 1], text: 'v = 0' },
  };

  it.each(Object.entries(fixtures))('элемент %s даёт хотя бы одну команду рисования', (type, fixture) => {
    const out = physics([{ type, ...fixture }]);

    expect(out).toMatch(/\\(draw|node|fill)/);
    expect(out.startsWith('% requires: \\usetikzlibrary{')).toBe(true);
    expect(out).toContain('\\begin{tikzpicture}[scale=0.5]');
  });

  it('пружина — декорация coil, цепи — circuitikz с правильными ключами', () => {
    const out = physics([
      { type: 'spring', points: [[0, 0], [3, 0]] },
      { type: 'circuit_component', subtype: 'resistor', points: [[0, 0], [2, 0]], label: 'R' },
      { type: 'circuit_component', subtype: 'capacitor', points: [[2, 0], [4, 0]], label: 'C' },
      { type: 'circuit_component', subtype: 'inductor', points: [[4, 0], [6, 0]] },
      { type: 'circuit_component', subtype: 'battery', points: [[6, 0], [8, 0]] },
    ]);

    expect(out).toContain('coil');
    expect(out).toContain('to[R, l={$R$}]');
    expect(out).toContain('to[C, l={$C$}]');
    expect(out).toContain('to[L]');
    expect(out).toContain('to[battery1]');
    expect(out).toContain('\\usepackage{circuitikz}');
    expect(out).toMatch(/\\usetikzlibrary\{[^}]*decorations\.pathmorphing/);
  });

  it('изотерма — гладкая кривая по точкам гиперболы, а не отрезок', () => {
    const out = physics([{ type: 'thermo_process', subtype: 'isotherm', points: [[1, 4], [4, 1]] }]);
    const coordinates = /plot\[smooth\] coordinates \{([^}]*)\}/.exec(out);

    expect(coordinates).not.toBeNull();
    expect(coordinates?.[1].match(/\([^)]*\)/g)?.length).toBeGreaterThan(4);
    expect(out).toContain('(2.5,1.6)');
  });

  it('изотерма считается относительно начала своих осей', () => {
    const out = physics([
      { type: 'thermo_axes', offset: [-2, -2], xLength: 4, yLength: 4 },
      { type: 'thermo_process', subtype: 'isotherm', points: [[-1, 2], [2, -1]] },
    ]);

    expect(out).toContain('(0.5,-0.4)');
  });

  it('dashed попадает в опции, а подпись вектора — в математический режим', () => {
    const out = physics([{ type: 'vector', vectorType: 'force', points: [[0, 0], [2, 0]], label: '\\vec{F}', dashed: true }]);

    expect(out).toContain('\\draw[->, thick, color=blue, dashed] (0,0) -- (2,0);');
    expect(out).toContain('{$\\vec{F}$}');
  });

  it('пустая сцена — только окружение tikzpicture', () => {
    expect(physics([])).toBe('\\begin{tikzpicture}[scale=0.5]\n\\end{tikzpicture}');
  });

  it('элементы, которые терял оригинал, рисуются: блок-пулли, линза, призма, пластина', () => {
    const out = physics([
      { type: 'block', subtype: 'pulley', center: [0, 0], radius: 0.6 },
      { type: 'lens', center: [0, 0], height: 3, subtype: 'diverging' },
      { type: 'prism', points: [[0, 0], [2, 0], [1, 2]] },
      { type: 'glass_slab', center: [4, 0], width: 2, height: 1 },
      { type: 'optics_arrow', center: [-2, 0], height: 1, label: 'AB' },
      { type: 'field_line', subtype: 'magnetic', points: [[0, 0], [1, 1]] },
    ]);

    expect(out).toContain('\\fill (0,0) circle (1.5pt);');
    expect(out).toContain('{Stealth[reversed]}-{Stealth[reversed]}');
    expect(out).toContain('\\draw[thick, fill=blue!10] (0,0) -- (2,0) -- (1,2) -- cycle;');
    expect(out).toContain('\\draw[thick, fill=blue!10] (3,-0.5) rectangle (5,0.5);');
    expect(out).toContain('\\node[below] at (-2,0) {$A$};');
    expect(out).toContain('\\node[above] at (-2,1) {$B$};');
    expect(out).toContain('color=green!60!black, midarrow]');
  });

  it('кириллица в подписи уходит в \\text, а градусы — в \\circ', () => {
    const out = physics([{ type: 'text_label', coords: [0, 0], text: 'Сосуд 1' }, { type: 'angle', center: [0, 0], points: [[1, 0], [0, 1]], label: '90°' }]);

    expect(out).toContain('{$\\text{Сосуд }1$}');
    expect(out).toContain('{$90^{\\circ}$}');
  });
});
