import { describe, expect, it } from 'vitest';
import { parsePgfplotsTikz } from '../src/render/pgfplots';
import { normalizeGeometryScene } from '../src/scene/normalize';

const plotsOf = (tikz: string): Array<Record<string, unknown>> => {
  const scene = parsePgfplotsTikz(tikz);

  if (!scene) throw new Error(`Графики не разобраны: ${tikz}`);

  return scene.plots as Array<Record<string, unknown>>;
};

describe('parsePgfplotsTikz', () => {
  it('парабола с коэффициентами: вершина и stretchY', () => {
    const [plot] = plotsOf('\\addplot[blue]{x^2 - 2*x + 1};');

    expect(plot).toMatchObject({ type: 'parabola', direction: 'up', stretchY: 1, color: '#2563eb', label: 'y = x^2 - 2x + 1' });
    expect(plot.vertex).toEqual([1, 0]);
    expect(plot).not.toHaveProperty('stretch');
  });

  it('парабола ветвями вниз и с дробным коэффициентом', () => {
    expect(plotsOf('\\addplot{-x^2 + 4};')[0]).toMatchObject({ type: 'parabola', direction: 'down', stretchY: 1, vertex: [0, 4] });
    expect(plotsOf('\\addplot{0.5*x^2};')[0]).toMatchObject({ type: 'parabola', stretchY: 0.5, vertex: [0, 0] });
    expect(plotsOf('\\addplot{2*(x-3)^2 + 1};')[0]).toMatchObject({ type: 'parabola', stretchY: 2, vertex: [3, 1] });
  });

  it('прямая k·x + b с цветом и пунктиром', () => {
    const [plot] = plotsOf('\\addplot[red, dashed]{2*x + 1};');

    expect(plot).toMatchObject({ type: 'line', k: 2, b: 1, color: '#dc2626', style: 'dashed' });
    expect(plotsOf('\\addplot{x};')[0]).toMatchObject({ type: 'line', k: 1, b: 0 });
    expect(plotsOf('\\addplot{-x - 2};')[0]).toMatchObject({ type: 'line', k: -1, b: -2 });
  });

  it('domain из опций переходит в график', () => {
    expect(plotsOf('\\addplot[domain=-2:3]{x^2};')[0].domain).toEqual([-2, 3]);
  });

  it('гипербола и корень', () => {
    expect(plotsOf('\\addplot{1/x};')[0]).toMatchObject({ type: 'hyperbola', k: 1 });
    expect(plotsOf('\\addplot{-2/x};')[0]).toMatchObject({ type: 'hyperbola', k: -2 });
    expect(plotsOf('\\addplot{sqrt(x)};')[0]).toMatchObject({ type: 'sqrt', directionX: 'right', directionY: 'up', vertex: [0, 0] });
    expect(plotsOf('\\addplot{-sqrt(x-2)};')[0]).toMatchObject({ type: 'sqrt', directionY: 'down', vertex: [2, 0] });
  });

  it('coordinates и only marks дают точки: mark=o — пустые, иначе сплошные', () => {
    expect(plotsOf('\\addplot[only marks, mark=o] coordinates {(1,2)};')).toEqual([
      { type: 'point', coords: [1, 2], style: 'void' },
    ]);
    expect(plotsOf('\\addplot[only marks, mark=*] coordinates {(1,2) (-3, 0.5)};')).toEqual([
      { type: 'point', coords: [1, 2], style: 'solid' },
      { type: 'point', coords: [-3, 0.5], style: 'solid' },
    ]);
  });

  it('точки одного графика не захватывают координаты следующего', () => {
    const plots = plotsOf('\\addplot[only marks] coordinates {(1,2)};\n\\addplot[only marks] coordinates {(3,4)};');

    expect(plots).toHaveLength(2);
  });

  it('\\node подписывает точку рядом или добавляет новую', () => {
    const labelled = plotsOf('\\addplot[only marks] coordinates {(1,2)};\n\\node at (axis cs:1,2) {A};');

    expect(labelled).toEqual([{ type: 'point', coords: [1, 2], style: 'solid', label: 'A' }]);

    const added = plotsOf('\\addplot{x};\n\\node[above] at (axis cs: 1, 2) {$B$};');

    expect(added[1]).toEqual({ type: 'point', coords: [1, 2], style: 'solid', label: 'B' });
  });

  it('подписи осей из xlabel/ylabel и легенда графика', () => {
    const scene = parsePgfplotsTikz(
      '\\begin{axis}[xlabel={$t$}, ylabel=$s$]\n\\addplot{x};\n\\addlegendentry{$s = t$}\n\\end{axis}',
    );

    expect(scene?.axes).toEqual({ x_label: 't', y_label: 's' });
    expect((scene?.plots as Array<Record<string, unknown>>)[0].label).toBe('s = t');
  });

  it('без подписей осей подставляются x и y', () => {
    expect(parsePgfplotsTikz('\\addplot{x};')?.axes).toEqual({ x_label: 'x', y_label: 'y' });
  });

  it('текст без графиков и неразбираемые выражения дают null', () => {
    expect(parsePgfplotsTikz('')).toBe(null);
    expect(parsePgfplotsTikz('\\draw (0,0) -- (1,1);')).toBe(null);
    expect(parsePgfplotsTikz('\\addplot{sin(deg(x))};')).toBe(null);
    expect(parsePgfplotsTikz('\\addplot table {data.dat};')).toBe(null);
  });

  it('результат проходит нормализацию как сцена plot_2d', () => {
    const raw = parsePgfplotsTikz('\\addplot[blue]{x^2 - 2*x + 1};\n\\addplot[only marks, mark=o] coordinates {(1,0)};');
    const scene = normalizeGeometryScene(raw);

    expect(scene.type).toBe('plot_2d');
    expect(scene.plots).toHaveLength(2);
    expect(scene.plots[0]).toMatchObject({ type: 'parabola', vertex: [1, 0], stretchX: 1, stretchY: 1 });
    expect(scene.plots[1]).toMatchObject({ type: 'point', pointStyle: 'hollow' });
  });
});
