import { describe, expect, it } from 'vitest';
import { SvgBuilder } from '../src/render/svg-builder';
import {
  arcPath,
  drawArc,
  drawCircuitComponent,
  drawHatchedSurface,
  drawSpring,
  segmentDirection,
} from '../src/render/physics-primitives';
import { collectPhysicsPoints, renderPhysicsSvg, resolvePhysicsViewport } from '../src/render/physics-svg';
import type { PhysicsElement, PhysicsElementType, PhysicsScene } from '../src/scene/types';

const GRAPHIC_TAGS = ['line', 'path', 'circle', 'polygon', 'polyline', 'rect', 'ellipse', 'text'];

const count = (svg: string, tag: string): number => (svg.match(new RegExp(`<${tag}\\b`, 'g')) ?? []).length;

/** Графические элементы без линий сетки. */
const graphicCount = (svg: string): number => {
  const withoutGrid = svg.replace(/<line[^>]*class="rte-drawing__grid"[^>]*\/>/g, '');

  return GRAPHIC_TAGS.reduce((total, tag) => total + count(withoutGrid, tag), 0);
};

const scene = (elements: Array<Partial<PhysicsElement> & { type: PhysicsElementType }>, extra: Partial<PhysicsScene> = {}): PhysicsScene => ({
  type: 'physics',
  offsetX: 0,
  offsetY: 0,
  showGrid: false,
  ...extra,
  elements: elements.map((element, index) => ({ id: element.id ?? `e${index}`, ...element })),
});

const render = (elements: Array<Partial<PhysicsElement> & { type: PhysicsElementType }>, extra: Partial<PhysicsScene> = {}): string =>
  renderPhysicsSvg(scene(elements, extra));

/** Содержимое всех `<text>` без разметки `<tspan>`. */
const plainTexts = (svg: string): string[] =>
  [...svg.matchAll(/<text[^>]*>(.*?)<\/text>/g)].map((match) => match[1].replace(/<[^>]+>/g, ''));

/** Атрибуты `points` всех `<polygon>`. */
const polygonPoints = (svg: string): string[] => [...svg.matchAll(/<polygon points="([^"]+)"/g)].map((match) => match[1]);

describe('рендер физики: каждый тип элемента что-то рисует', () => {
  const samples: Record<PhysicsElementType, Partial<PhysicsElement>> = {
    surface: { points: [[-3, 0], [3, 0]], hatching: 'bottom' },
    arc_surface: { center: [0, 2], points: [[-2, 2], [2, 2]] },
    block: { subtype: 'rectangle', center: [0, 0.5], width: 1.6, height: 1 },
    rope: { points: [[0, 0], [1, 1], [2, 0]] },
    spring: { points: [[0, 0], [3, 0]] },
    vector: { points: [[0, 0], [2, 0]], vectorType: 'force', label: 'F' },
    angle: { center: [0, 0], points: [[2, 0], [1, 1]], label: '\\alpha' },
    stickman: { center: [0, 0], height: 1.6 },
    balloon: { center: [0, 2], radius: 0.6, points: [[0, 0]] },
    ellipse_platform: { center: [0, 0], rx: 2, ry: 0.5, angle: 15 },
    dimension_line: { points: [[0, 0], [3, 0]], label: 'L' },
    thermo_axes: { offset: [-2, -2], xLabel: 'V', yLabel: 'p' },
    thermo_point: { coords: [1, 1], label: '1' },
    thermo_process: { points: [[1, 1], [3, 3]], subtype: 'line' },
    piston_vessel: { center: [0, 0], width: 2, height: 3.5, weight: true, label: 'm' },
    circuit_component: { points: [[0, 0], [3, 0]], subtype: 'resistor' },
    wire: { points: [[0, 0], [3, 0]] },
    charge: { coords: [0, 0], charge: '+' },
    field_line: { points: [[0, 0], [2, 1]], subtype: 'electric' },
    capacitor_plate: { points: [[0, 0], [3, 0]], plateType: 'positive' },
    current_conductor: { coords: [0, 0], subtype: 'cross' },
    circle_shape: { center: [0, 0], radius: 0.8 },
    lens: { center: [0, 0], height: 3, subtype: 'converging', focalLength: 2 },
    mirror: { points: [[-2, 0], [2, 0]] },
    ray: { points: [[-3, 1], [0, 0], [3, -1]] },
    optics_arrow: { center: [-2, 0], height: 1, label: 'AB' },
    prism: { points: [[0, 0], [2, 0], [1, 2]] },
    glass_slab: { center: [0, 0], width: 2, height: 1 },
    text_label: { coords: [0, 0], text: 'm' },
  };

  (Object.keys(samples) as PhysicsElementType[]).forEach((type) => {
    it(`${type} даёт графический элемент помимо сетки`, () => {
      const svg = render([{ type, ...samples[type] }]);

      expect(svg.startsWith('<svg class="rte-drawing__svg"')).toBe(true);
      expect(graphicCount(svg)).toBeGreaterThan(0);
    });
  });

  it('элемент без нужных полей пропускается, а рендер не бросает', () => {
    const svg = render([
      { type: 'block' },
      { type: 'vector', points: [[0, 0]] },
      { type: 'charge' },
      { type: 'prism', points: [[0, 0], [1, 1]] },
      { type: 'lens', center: [0, 0], height: Number.NaN },
      { type: 'unknown' as PhysicsElementType, points: [[0, 0], [1, 1]] },
    ]);

    expect(svg).toContain('</svg>');
    expect(() => renderPhysicsSvg({ type: 'physics', offsetX: 0, offsetY: 0, showGrid: true, elements: [null as unknown as PhysicsElement] })).not.toThrow();
  });
});

describe('рендер физики: механика', () => {
  it('брусок и сила: прямоугольник и синяя стрелка с подписью F со стрелкой', () => {
    const svg = render([
      { id: 'm', type: 'block', subtype: 'rectangle', center: [0, 0.5], width: 1.6, height: 1 },
      { id: 'F', type: 'vector', vectorType: 'force', points: [[0.8, 0.5], [3, 0.5]], label: '\\vec{F}' },
    ]);

    expect(count(svg, 'rect')).toBe(1);
    expect(svg).toMatch(/<line[^>]*stroke="#2563eb"/);
    expect(svg).toMatch(/<polygon[^>]*fill="#2563eb"/);
    expect(svg).toContain('→');
    expect(plainTexts(svg).some((text) => text.includes('F'))).toBe(true);
  });

  it('ускорение красное, явный цвет вектора сохраняется', () => {
    expect(render([{ type: 'vector', vectorType: 'acc', points: [[0, 0], [1, 0]] }])).toContain('stroke="#dc2626"');
    expect(render([{ type: 'vector', vectorType: 'force', color: '#16a34a', points: [[0, 0], [1, 0]] }])).toContain('stroke="#16a34a"');
  });

  it('брусок с углом поворачивается группой, круг и блок — окружности', () => {
    const rotated = render([{ type: 'block', subtype: 'rectangle', center: [0, 0], width: 1, height: 1, angle: 30 }]);

    expect(rotated).toMatch(/<g transform="translate\([^)]+\) rotate\(-30\)">/);
    expect(count(render([{ type: 'block', subtype: 'circle', center: [0, 0], radius: 0.5 }]), 'circle')).toBe(1);
    expect(count(render([{ type: 'block', subtype: 'pulley', center: [0, 0], radius: 0.6 }]), 'circle')).toBe(3);
  });

  it('пружина — один зигзаг-путь, человечек — голова и пять отрезков', () => {
    const spring = render([{ type: 'spring', points: [[0, 0], [3, 0]] }]);

    expect(count(spring, 'path')).toBe(1);
    expect((spring.match(/ L /g) ?? []).length).toBeGreaterThan(5);

    const stickman = render([{ type: 'stickman', center: [0, 0] }]);

    expect(count(stickman, 'circle')).toBe(1);
    expect(count(stickman, 'line')).toBe(5);
  });

  it('угол подписывается греческой буквой, размерная линия — двумя наконечниками', () => {
    const angle = render([{ type: 'angle', center: [0, 0], points: [[2, 0], [1, 1]], label: '\\alpha' }]);

    expect(plainTexts(angle)).toContain('α');
    expect(count(angle, 'path')).toBe(1);

    const dimension = render([{ type: 'dimension_line', points: [[0, 0], [3, 0]], label: 'h' }]);

    expect(count(dimension, 'polygon')).toBe(2);
    expect(plainTexts(dimension)).toContain('h');
  });
});

describe('рендер физики: цепь', () => {
  const component = (subtype: string, label?: string): string =>
    render([{ type: 'circuit_component', subtype, points: [[-2, 0], [2, 0]], label }]);

  it('резистор — четырёхугольник, диод — треугольник и черта', () => {
    const resistor = component('resistor');

    expect(polygonPoints(resistor)).toHaveLength(1);
    expect(polygonPoints(resistor)[0].split(' ')).toHaveLength(4);

    const diode = component('diode');

    expect(polygonPoints(diode)[0].split(' ')).toHaveLength(3);
    expect(diode).toContain('stroke-linecap="square"');
  });

  it('конденсатор — две пластины, катушка — дуги', () => {
    expect((component('capacitor').match(/stroke-linecap="square"/g) ?? []).length).toBe(2);
    expect(component('coil')).toMatch(/<path d="M [^"]* Q [^"]* Q [^"]* Q [^"]* Q /);
    expect(component('inductor')).toContain(' Q ');
  });

  it('ключ — два контакта, источник — плюс и минус', () => {
    expect(count(component('switch'), 'circle')).toBe(2);

    const source = plainTexts(component('source'));

    expect(source).toContain('+');
    expect(source).toContain('−');
    expect(plainTexts(component('battery'))).toContain('+');
  });

  it('вольтметр и амперметр — окружность с буквой, лампа — окружность с крестом', () => {
    const voltmeter = component('voltmeter');

    expect(count(voltmeter, 'circle')).toBe(1);
    expect(plainTexts(voltmeter)).toContain('V');
    expect(plainTexts(component('ammeter'))).toContain('A');

    const lamp = component('lamp');

    expect(lamp).toMatch(/<circle[^>]*r="18"/);
    expect(count(lamp, 'line')).toBe(4);
  });

  it('неизвестный подтип — просто линия', () => {
    const svg = component('transistor');

    expect(count(svg, 'line')).toBe(1);
    expect(count(svg, 'polygon')).toBe(0);
  });

  it('волнистый провод — путь с множеством точек, заряд красится по знаку', () => {
    const wire = render([{ type: 'wire', points: [[0, 0], [3, 0]], wavy: true }]);

    expect((wire.match(/ L /g) ?? []).length).toBeGreaterThan(20);
    expect(render([{ type: 'charge', coords: [0, 0], charge: '+' }])).toContain('stroke="#dc2626"');
    expect(render([{ type: 'charge', coords: [0, 0], charge: '-' }])).toContain('stroke="#2563eb"');
  });

  it('пластина конденсатора с знаками, проводник с током — крест или точка', () => {
    const plate = plainTexts(render([{ type: 'capacitor_plate', points: [[0, 0], [4, 0]], plateType: 'negative' }]));

    expect(plate.filter((text) => text === '−').length).toBeGreaterThanOrEqual(1);

    const cross = render([{ type: 'current_conductor', coords: [0, 0], subtype: 'cross' }]);

    expect(count(cross, 'line')).toBe(2);
    expect(count(render([{ type: 'current_conductor', coords: [0, 0] }]), 'circle')).toBe(2);
  });

  it('силовые линии: электрические синие, магнитные зелёные', () => {
    expect(render([{ type: 'field_line', points: [[0, 0], [2, 0]], subtype: 'electric' }])).toContain('stroke="#3b82f6"');
    expect(render([{ type: 'field_line', points: [[0, 0], [2, 0]], subtype: 'magnetic' }])).toContain('stroke="#10b981"');
  });
});

describe('рендер физики: оптика и термодинамика', () => {
  it('линза: главная ось и четыре отметки F и 2F', () => {
    const svg = render([{ type: 'lens', center: [0, 0], height: 3, subtype: 'converging', focalLength: 1.5 }]);
    const texts = plainTexts(svg);

    expect(texts.filter((text) => text === 'F')).toHaveLength(2);
    expect(texts.filter((text) => text === '2F')).toHaveLength(2);
    expect(svg).toContain('class="rte-drawing__axis"');

    const diverging = render([{ type: 'lens', center: [0, 0], height: 3, subtype: 'diverging' }]);

    expect(count(diverging, 'polyline')).toBe(2);
  });

  it('луч: первый отрезок оранжевый, следующие красные, пунктирный — голубой', () => {
    const svg = render([{ type: 'ray', points: [[-3, 1], [0, 0], [3, -1]] }]);

    expect(svg).toContain('stroke="#f59e0b"');
    expect(svg).toContain('stroke="#ef4444"');

    const dashed = render([{ type: 'ray', points: [[-3, 1], [0, 0]], dashed: true }]);

    expect(dashed).toContain('stroke="#38bdf8"');
    expect(dashed).toContain('stroke-dasharray=');
  });

  it('стрелка предмета подписывается по буквам у основания и острия', () => {
    const texts = plainTexts(render([{ type: 'optics_arrow', center: [-2, 0], height: 1, label: 'AB' }]));

    expect(texts).toEqual(['A', 'B']);
  });

  it('термо-оси с тиками и подписями', () => {
    const svg = render([
      {
        type: 'thermo_axes',
        offset: [-2, -2],
        xLabel: 'V',
        yLabel: 'p',
        xTicks: [{ val: 1, label: 'V_1' }, { val: 2 }, { val: 2 }],
        yTicks: [{ val: 1.5 }],
      },
    ]);
    const texts = plainTexts(svg);

    expect(count(svg, 'polygon')).toBe(2);
    expect(texts).toContain('V');
    expect(texts).toContain('p');
    expect(texts).toContain('0');
    expect(texts).toContain('V1');
    expect(texts).toContain('2');
    expect(texts.filter((text) => text === '2')).toHaveLength(1);
    expect(texts).toContain('1.5');
  });

  it('изотерма — путь из многих сегментов с наконечником, прямой процесс — линия со стрелкой', () => {
    const isotherm = render([{ type: 'thermo_process', subtype: 'isotherm', points: [[1, 4], [4, 1]] }]);
    const path = /<path d="([^"]+)"/.exec(isotherm);

    expect(path).not.toBeNull();
    expect((path?.[1].match(/ L /g) ?? []).length).toBe(15);
    expect(count(isotherm, 'polygon')).toBe(1);

    const line = render([{ type: 'thermo_process', subtype: 'isochor', points: [[1, 1], [1, 3]] }]);

    expect(count(line, 'line')).toBe(1);
    expect(count(line, 'polygon')).toBe(1);
  });

  it('сосуд с поршнем: стенки, поршень, шток, груз и подпись', () => {
    const svg = render([{ type: 'piston_vessel', center: [0, 0], width: 2, height: 3.5, weight: true, label: 'p_0' }]);

    expect(count(svg, 'path')).toBe(1);
    expect(count(svg, 'rect')).toBe(2);
    expect(count(svg, 'line')).toBe(1);
    expect(plainTexts(svg)).toContain('p0');
  });
});

describe('рендер физики: сцена целиком', () => {
  it('подсветка по id красит элемент в розовый', () => {
    const elements: Array<Partial<PhysicsElement> & { type: PhysicsElementType }> = [
      { id: 'floor', type: 'surface', points: [[-3, 0], [3, 0]] },
      { id: 'rope', type: 'rope', points: [[0, 0], [2, 2]] },
    ];

    expect(renderPhysicsSvg(scene(elements))).not.toContain('#ec4899');
    expect(renderPhysicsSvg(scene(elements), { highlight: { id: 'floor' } })).toContain('stroke="#ec4899"');
    expect(renderPhysicsSvg(scene(elements), { highlight: { id: 'rope' } })).toContain('stroke="#ec4899"');
    expect(renderPhysicsSvg(scene(elements), { highlight: { id: 'none' } })).not.toContain('#ec4899');
  });

  it('autoFit держит масштаб в пределах 12–80 и центрирует сцену', () => {
    const huge = scene([{ type: 'wire', points: [[-100, -100], [100, 100]] }]);
    const tiny = scene([{ type: 'wire', points: [[0, 0], [0.5, 0.5]] }]);
    const normal = scene([{ type: 'block', subtype: 'rectangle', center: [10, 10], width: 1, height: 1 }]);

    expect(resolvePhysicsViewport(huge, { autoFit: true }).scale).toBe(12);
    expect(resolvePhysicsViewport(tiny, { autoFit: true }).scale).toBe(80);

    const fitted = resolvePhysicsViewport(normal, { autoFit: true });

    expect(fitted.scale).toBeGreaterThanOrEqual(12);
    expect(fitted.scale).toBeLessThanOrEqual(80);
    // Центр блока (10, 10) ложится в центр картинки 340×300.
    expect(fitted.cx + 10 * fitted.scale).toBeCloseTo(170);
    expect(fitted.cy - 10 * fitted.scale).toBeCloseTo(150);
  });

  it('без autoFit — масштаб и смещение сцены; без точек (подпись без координат) autoFit тоже их сохраняет', () => {
    const plain = scene([{ type: 'wire', points: [[0, 0], [1, 1]] }], { scale: 40, offsetX: 5, offsetY: -5 });

    expect(resolvePhysicsViewport(plain)).toEqual({ scale: 40, cx: 175, cy: 145 });
    expect(resolvePhysicsViewport(scene([{ type: 'text_label', text: 'x' }], { scale: 30 }), { autoFit: true }).scale).toBe(30);
  });

  it('точки для вписывания: points, coords и центр ± радиус', () => {
    const points = collectPhysicsPoints(
      scene([
        { type: 'wire', points: [[1, 2], [3, 4]] },
        { type: 'charge', coords: [5, 6] },
        { type: 'block', center: [0, 0], radius: 2 },
        { type: 'stickman', center: [0, 0] },
      ]),
    );

    expect(points).toEqual([[1, 2], [3, 4], [5, 6], [-2, -2], [2, 2], [-1.5, -1.5], [1.5, 1.5]]);
  });

  it('пунктир даёт stroke-dasharray', () => {
    const svg = render([{ type: 'rope', points: [[0, 0], [2, 2]], dashed: true }]);

    expect(svg).toContain('stroke-dasharray="6,4"');
    expect(render([{ type: 'rope', points: [[0, 0], [2, 2]] }])).not.toContain('stroke-dasharray');
  });

  it('подпись со скриптом экранируется и не попадает в SVG сырой', () => {
    const svg = render([
      { type: 'text_label', coords: [0, 0], text: '<script>alert(1)</script>' },
      { type: 'vector', points: [[0, 0], [1, 0]], label: '\\text{<script>alert(1)</script>}' },
      { type: 'circuit_component', points: [[0, 0], [2, 0]], subtype: '<script>' },
    ]);

    expect(svg).not.toContain('<script');
    expect(svg).toContain('&lt;');
    expect(svg).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('пустая сцена — только сетка, без showGrid сетки нет', () => {
    const withGrid = renderPhysicsSvg({ type: 'physics', offsetX: 0, offsetY: 0, showGrid: true, elements: [] });

    expect(count(withGrid, 'line')).toBeGreaterThan(0);
    expect(count(withGrid, 'line')).toBe((withGrid.match(/class="rte-drawing__grid"/g) ?? []).length);
    expect(graphicCount(withGrid)).toBe(0);
    expect(withGrid).toContain('viewBox="0 0 340 300"');

    const withoutGrid = renderPhysicsSvg({ type: 'physics', offsetX: 0, offsetY: 0, showGrid: false, elements: [] });

    expect(withoutGrid).not.toContain('rte-drawing__grid');
    expect(withoutGrid).toBe('<svg class="rte-drawing__svg" xmlns="http://www.w3.org/2000/svg" width="340" height="300" viewBox="0 0 340 300" role="presentation" aria-hidden="true" focusable="false"></svg>');
  });

  it('размер картинки берётся из опций', () => {
    const svg = renderPhysicsSvg(scene([]), { width: 500, height: 200 });

    expect(svg).toContain('width="500" height="200" viewBox="0 0 500 200"');
  });
});

describe('примитивы физики', () => {
  it('направление отрезка: null для совпавших точек и битых координат', () => {
    expect(segmentDirection({ x: 0, y: 0 }, { x: 0, y: 0 })).toBeNull();
    expect(segmentDirection({ x: 0, y: 0 }, { x: Number.NaN, y: 0 })).toBeNull();
    expect(segmentDirection({ x: 0, y: 0 }, { x: 3, y: 4 })).toEqual({ ux: 0.6, uy: 0.8, length: 5 });
  });

  it('дуга идёт против часовой в мире: четверть от 0° до 90° заканчивается сверху', () => {
    expect(arcPath({ x: 100, y: 100 }, 50, 0, 90)).toBe('M 150 100 A 50 50 0 0 0 100 50');
    expect(arcPath({ x: 100, y: 100 }, 50, 0, 90, 'cw')).toBe('M 150 100 A 50 50 0 1 1 100 50');
    // Нулевой размах — полная окружность двумя полудугами.
    expect(arcPath({ x: 100, y: 100 }, 50, 0, 360)).toContain('A 50 50 0 0 0 50 100 A 50 50 0 0 0 150 100');
  });

  it('дуга с нулевым радиусом и пружина нулевой длины ничего не рисуют', () => {
    const svg = new SvgBuilder();

    drawArc(svg, { x: 0, y: 0 }, 0, 0, 90);
    drawSpring(svg, { x: 1, y: 1 }, { x: 1, y: 1 });
    drawCircuitComponent(svg, { x: 1, y: 1 }, { x: 1, y: 1 }, 'resistor');

    expect(svg.toString()).toBe('');
  });

  it('штриховка: сторона top меняет направление штрихов на противоположное', () => {
    const bottom = new SvgBuilder();
    const top = new SvgBuilder();

    drawHatchedSurface(bottom, { x: 0, y: 0 }, { x: 60, y: 0 }, { hatching: 'bottom' });
    drawHatchedSurface(top, { x: 0, y: 0 }, { x: 60, y: 0 }, { hatching: 'top' });

    const tickY = (svg: string): number => Number(/<line[^>]*stroke-width="0.8"[^>]*\/>/.exec(svg)?.[0].match(/y2="([^"]+)"/)?.[1]);

    expect(tickY(bottom.toString())).toBeGreaterThan(0);
    expect(tickY(top.toString())).toBeLessThan(0);
    expect(count(bottom.toString(), 'line')).toBe(12);
  });

  it('короткий резистор и короткая катушка вырождаются в провод', () => {
    const svg = new SvgBuilder();

    drawCircuitComponent(svg, { x: 0, y: 0 }, { x: 20, y: 0 }, 'resistor');
    drawCircuitComponent(svg, { x: 0, y: 0 }, { x: 20, y: 0 }, 'coil');

    expect(count(svg.toString(), 'line')).toBe(2);
    expect(count(svg.toString(), 'polygon')).toBe(0);
  });
});
