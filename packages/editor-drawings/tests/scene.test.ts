import { describe, expect, it } from 'vitest';
import { latexToPlainText, latexToSvgTspans } from '../src/render/latex-label';
import { parseSceneJson, stringifyScene } from '../src/scene/json';
import {
  detectDrawingKind,
  hasDrawableContent,
  normalizeGeometryScene,
  normalizePhysicsScene,
} from '../src/scene/normalize';
import { splitEdgesThroughVertices } from '../src/scene/split-edges';

describe('терпимый разбор JSON', () => {
  it('читает чистый JSON и ограждение ```json', () => {
    expect(parseSceneJson('{"type":"2d"}')).toEqual({ type: '2d' });
    expect(parseSceneJson('```json\n{"type":"2d"}\n```')).toEqual({ type: '2d' });
    expect(parseSceneJson('Сцена: {"a":1} и хвост')).toEqual({ a: 1 });
  });

  it('чинит LaTeX-слеши, хвостовые запятые, кавычки и ключи без кавычек', () => {
    expect(parseSceneJson('{"label":"\\vec{F}"}')).toEqual({ label: '\\vec{F}' });
    expect(parseSceneJson('{"a":[1,2,],}')).toEqual({ a: [1, 2] });
    expect(parseSceneJson("{'type': 'physics'}")).toEqual({ type: 'physics' });
    expect(parseSceneJson('{type: "2d", scale: 25}')).toEqual({ type: '2d', scale: 25 });
    expect(parseSceneJson('{“type”: “2d”}')).toEqual({ type: '2d' });
    expect(parseSceneJson('{"k": NaN, "v": undefined}')).toEqual({ k: null, v: null });
  });
  it('команды LaTeX, похожие на escape JSON, не превращаются в управляющие символы', () => {
    // Модель пишет LaTeX в JSON без второго слеша: `\frac` иначе стал бы переводом страницы.
    expect(
      parseSceneJson('{"a":"\\frac{1}{2}","b":"\\theta","c":"\\nu_0","d":"\\rho","e":"\\beta","f":"\\underline{x}"}'),
    ).toEqual({ a: '\\frac{1}{2}', b: '\\theta', c: '\\nu_0', d: '\\rho', e: '\\beta', f: '\\underline{x}' });
    // Уже экранированное и обычные escape-последовательности не меняются.
    expect(parseSceneJson('{"a":"\\\\frac{1}{2}","b":"строка\\nдальше","c":"\\u00e9","d":"\\"кавычки\\""}')).toEqual({
      a: '\\frac{1}{2}',
      b: 'строка\nдальше',
      c: 'é',
      d: '"кавычки"',
    });
    // Пробел `\,` и скобки `\{` LaTeX — тоже часть текста.
    expect(parseSceneJson('{"a":"5\\,м","b":"\\{x\\}"}')).toEqual({ a: '5\\,м', b: '\\{x\\}' });
  });

  it('не разбирает мусор и не исполняет код', () => {
    expect(parseSceneJson('')).toBeNull();
    expect(parseSceneJson('совсем не json')).toBeNull();
    expect(parseSceneJson('{"a": alert(1)}')).toBeNull();
    expect(stringifyScene({ a: 1 })).toBe('{"a":1}');
  });
});

describe('нормализация геометрии', () => {
  it('принимает рёбра массивами и объектами с разными ключами, отбрасывает битые', () => {
    const scene = normalizeGeometryScene({
      vertices: { A: [0, 0], B: [4, 0], C: [0, 3] },
      edges: [['A', 'B'], { from: 'B', to: 'C', style: 'hidden', ticks: 7 }, { source: 'C', target: 'A' }, { from: 'A', to: 'Z' }, null, 'x'],
    });

    expect(scene.type).toBe('2d');
    expect(scene.edges).toEqual([
      { from: 'A', to: 'B', style: 'solid', color: undefined },
      { from: 'B', to: 'C', style: 'dashed', color: undefined, ticks: 4 },
      { from: 'C', to: 'A', style: 'solid', color: undefined },
    ]);
  });

  it('понижает 3D с нулевой глубиной до 2D и распознаёт графики', () => {
    expect(normalizeGeometryScene({ type: '3d', vertices: { A: [0, 0, 0], B: [1, 0, 0] } }).type).toBe('2d');
    expect(normalizeGeometryScene({ type: '3d', vertices: { A: [0, 0, 0], S: [1, 1, 3] } }).type).toBe('3d');
    expect(normalizeGeometryScene({ plots: [{ type: 'parabola', vertex: [0, 0] }] }).type).toBe('plot_2d');
    expect(normalizeGeometryScene({ type: '2d', vertices: { A: [0, 0, 2] } }).type).toBe('2d');
  });

  it('собирает окружности из circle/circles и разметки углов из markings, пропуская разметку без точек', () => {
    const scene = normalizeGeometryScene({
      vertices: { A: [0, 0], B: [4, 0], C: [0, 3] },
      circle: { center: [1, 1], radius: 2, stroke: '#f00' },
      circles: [{ coords: [2, 2] }],
      markings: [{ type: 'right_angle', vertex: 'A', from: 'B', to: 'C' }, { type: 'right_angle' }, { points: ['A', 'B', 'C'], style: 'double', label: '30°' }],
    });

    expect(scene.plots.map((plot) => plot.type)).toEqual(['circle', 'circle']);
    expect(scene.plots[0]).toMatchObject({ center: [1, 1], radius: 2, color: '#f00' });
    expect(scene.angles).toEqual([
      { points: ['B', 'A', 'C'], style: 'right', label: undefined },
      { points: ['A', 'B', 'C'], style: 'double', label: '30°' },
    ]);
  });

  it('парабола читает и stretch, и stretchY', () => {
    const [legacy, modern] = normalizeGeometryScene({
      plots: [
        { type: 'parabola', vertex: [1, 2], stretch: 2 },
        { type: 'parabola', vertex: [1, 2], stretchY: 3, stretchX: 0.5, direction: 'down' },
      ],
    }).plots;

    expect(legacy).toMatchObject({ stretchY: 2, stretchX: 1, direction: 'up' });
    expect(modern).toMatchObject({ stretchY: 3, stretchX: 0.5, direction: 'down' });
  });

  it('разрезает ребро, на котором лежит вершина', () => {
    const scene = normalizeGeometryScene({
      vertices: { A: [0, 0], C: [4, 0], B: [2, 0.02] },
      edges: [['A', 'C']],
    });

    expect(scene.edges.map((edge) => `${edge.from}${edge.to}`)).toEqual(['AB', 'BC']);
    // Повторный вызов ничего не меняет.
    expect(splitEdgesThroughVertices(scene)).toBe(false);
  });

  it('что угодно на входе даёт пустую сцену, а не исключение', () => {
    [null, 'text', 42, [], { vertices: 'x', edges: 5 }].forEach((raw) => {
      const scene = normalizeGeometryScene(raw);

      expect(scene.vertices).toEqual({});
      expect(hasDrawableContent(scene)).toBe(false);
    });
  });
});

describe('нормализация физики', () => {
  it('переименовывает синонимы и даёт размеры по умолчанию', () => {
    const scene = normalizePhysicsScene({
      elements: [
        { type: 'wall', points: [[0, 0], [5, 0]] },
        { type: 'weight', center: [1, 1] },
        { type: 'box', rect: [0, 0, 2, 1] },
        { type: 'piston', center: [0, 0] },
        { type: 'point', center: [1, 2], charge: '+' },
        { type: 'axis', orientation: 'vertical', name: 'y' },
        { type: 'unknown_thing' },
        'мусор',
      ],
    });

    expect(scene.elements.map((element) => element.type)).toEqual([
      'surface',
      'block',
      'block',
      'piston_vessel',
      'charge',
      'vector',
    ]);
    expect(scene.elements[1]).toMatchObject({ subtype: 'rectangle', width: 0.8, height: 0.6 });
    expect(scene.elements[2]).toMatchObject({ center: [1, 0.5], width: 2, height: 1 });
    expect(scene.elements[3]).toMatchObject({ width: 2, height: 3.5 });
    expect(scene.elements[4]).toMatchObject({ coords: [1, 2], charge: '+' });
    expect(scene.elements[5]).toMatchObject({ points: [[0, -2], [0, 4]], label: 'y' });
    expect(new Set(scene.elements.map((element) => element.id)).size).toBe(6);
  });

  it('разворачивает старые термографики в оси, точки и процессы с нормировкой координат', () => {
    const scene = normalizePhysicsScene({
      type: 'graph_pV',
      points: [{ label: '1', v: 100, p: 300 }, { label: '2', v: 300, p: 300 }, { label: '3', v: 300, p: 100 }],
      path: [{ from: '1', to: '2' }, { from: '2', to: '3', type: 'curve' }],
    });

    const types = scene.elements.map((element) => element.type);

    expect(types).toEqual(['thermo_axes', 'thermo_point', 'thermo_point', 'thermo_point', 'thermo_process', 'thermo_process']);
    // Координаты уложены в окно 2..6 × 1.5..5.5.
    scene.elements
      .filter((element) => element.type === 'thermo_point')
      .forEach((element) => {
        expect(element.coords![0]).toBeGreaterThanOrEqual(2);
        expect(element.coords![0]).toBeLessThanOrEqual(6);
        expect(element.coords![1]).toBeGreaterThanOrEqual(1.5);
        expect(element.coords![1]).toBeLessThanOrEqual(5.5);
      });
    expect(scene.elements[5].subtype).toBe('isotherm');
  });

  it('верхнеуровневые thermo_* и ссылки по индексу', () => {
    const scene = normalizePhysicsScene({
      thermo_axes: { x_label: 'V', y_label: 'p' },
      thermo_point: [{ label: 'a', x: 2, y: 3 }, { label: 'b', x: 4, y: 5 }],
      thermo_process: [{ start: 0, end: 1, type: 'isochor' }],
    });

    expect(scene.elements.map((element) => element.type)).toEqual(['thermo_axes', 'thermo_point', 'thermo_point', 'thermo_process']);
    expect(scene.elements[3]).toMatchObject({ subtype: 'isochor', points: [[2, 3], [4, 5]] });
  });

  it('группы vessels, charges и vectors разворачиваются в элементы', () => {
    const scene = normalizePhysicsScene({
      elements: [
        { vessels: [{ id: 'A', size: [2, 3], labels: ['p_1'] }, { id: 'B' }] },
        { charges: [{ coords: [0, 0], charge: '-' }], vectors: [{ points: [[0, 0], [1, 1]] }] },
      ],
    });

    expect(scene.elements.map((element) => element.type)).toEqual([
      'piston_vessel',
      'text_label',
      'piston_vessel',
      'charge',
      'vector',
    ]);
    expect(scene.elements[0].label).toBe('Сосуд A');
  });

  it('сцена incline не подменяется шаблоном: элементы остаются своими', () => {
    const scene = normalizePhysicsScene({
      type: 'mechanics_scene',
      elements: [{ type: 'incline', label: 'h' }, { type: 'block', subtype: 'circle', center: [0, 0], radius: 1 }],
    });

    expect(scene.elements).toHaveLength(1);
    expect(scene.elements[0]).toMatchObject({ type: 'block', subtype: 'circle' });
  });

  it('резистор с L в подписи — катушка', () => {
    const scene = normalizePhysicsScene({
      elements: [{ type: 'circuit_component', subtype: 'resistor', label: 'L_1', points: [[0, 0], [2, 0]] }],
    });

    expect(scene.elements[0].subtype).toBe('inductor');
  });
});

describe('вид чертежа', () => {
  it('определяется по типу, термо-полям, элементам и подсказке предмета', () => {
    expect(detectDrawingKind({ type: 'physics' })).toBe('physics');
    expect(detectDrawingKind({ type: 'mechanics_scene' })).toBe('physics');
    expect(detectDrawingKind({ thermo_point: [] })).toBe('physics');
    expect(detectDrawingKind({ elements: [{ type: 'spring' }] })).toBe('physics');
    expect(detectDrawingKind({ type: '3d', vertices: {} })).toBe('geometry');
    expect(detectDrawingKind({ vertices: { A: [0, 0] } })).toBe('geometry');
    expect(detectDrawingKind({}, 'physics')).toBe('physics');
    expect(detectDrawingKind({})).toBe('geometry');
  });
});

describe('подписи LaTeX', () => {
  it('греческие буквы, индексы, векторы и текст', () => {
    const markup = latexToSvgTspans('\\vec{F}_{тр} = \\mu N \\cdot \\text{кг}');

    expect(markup).toContain('→');
    expect(markup).toContain('тр');
    expect(markup).toContain('μ');
    expect(markup).toContain('·');
    expect(markup).toContain('font-weight="normal">кг</tspan>');
    expect(latexToPlainText('\\alpha_1 + \\beta')).toBe('α_1 + β');
  });

  it('экранирует разметку из данных', () => {
    const markup = latexToSvgTspans('<script>alert(1)</script>');

    expect(markup).not.toContain('<script');
    expect(markup).not.toContain('</script');
    expect(markup).toContain('&lt;');
  });

  it('табуляция из JSON читается как \\text', () => {
    expect(latexToSvgTspans('\text{abc}')).toContain('>abc</tspan>');
  });
});
