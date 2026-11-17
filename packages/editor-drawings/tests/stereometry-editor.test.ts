import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Translate } from '@rich-editor/core';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { supportPlanes } from '../src/builders/hidden-lines';
import {
  STEREOMETRY_CANVAS,
  parseAngleVertices,
  projectVertex,
  stereometryEditorFactory,
  unprojectToGround,
  unprojectToHeight,
} from '../src/builders/stereometry-editor';
import { formatAngleMeasure } from '../src/builders/geometry-utils';
import { STEREOMETRY_MESSAGES } from '../src/builders/stereometry-messages';
import type { SceneEditor } from '../src/builders/types';
import { DRAWINGS_MESSAGES } from '../src/messages';
import { project3dToPlane, type Viewport } from '../src/render/coords';
import { resolveGeometryViewport } from '../src/render/geometry-svg';
import { normalizeGeometryScene } from '../src/scene/normalize';
import type { Point } from '../src/scene/types';

/** Настоящая оболочка, но со счётчиком вызовов: при вращении её не пересчитывают. */
vi.mock('../src/builders/hidden-lines', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/builders/hidden-lines')>();

  return { ...actual, supportPlanes: vi.fn(actual.supportPlanes) };
});

/** jsdom не знает PointerEvent — полотно слушает именно его. */
beforeAll(() => {
  if (typeof globalThis.PointerEvent === 'undefined') {
    class PointerEventPolyfill extends MouseEvent {
      readonly pointerId: number;

      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
      }
    }

    globalThis.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent;
  }
});

const t: Translate = (key) => STEREOMETRY_MESSAGES.ru[key] ?? DRAWINGS_MESSAGES.ru[key] ?? key;

/**
 * Окно просмотра без `load`: исходный масштаб полотна и центр в середине.
 * В jsdom `getBoundingClientRect` даёт нули, поэтому координаты viewBox равны клиентским.
 */
const VIEWPORT = { scale: STEREOMETRY_CANVAS.scale, cx: STEREOMETRY_CANVAS.width / 2, cy: STEREOMETRY_CANVAS.height / 2 };

/**
 * Окно, от которого считаются клики: исходное у нового конструктора, после
 * шаблона — вписанное, как его подбирает `fitView`.
 */
let view: Viewport = VIEWPORT;

const fittedViewport = (editor: SceneEditor): Viewport =>
  resolveGeometryViewport(
    { ...normalizeGeometryScene(editor.getScene()), type: '3d' },
    { width: STEREOMETRY_CANVAS.width, height: STEREOMETRY_CANVAS.height, autoFit: true },
  );

/** Вид шаблонов и пустой сцены. */
const TEMPLATE_VIEW = { angleY: 15, angleZ: -30 };

interface At {
  x: number;
  y: number;
}

const svgOf = (point: Point, angles = TEMPLATE_VIEW): At => projectVertex(point, angles.angleY, angles.angleZ, view);

type PointerType = 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel';

const pointerAt = (target: HTMLElement, type: PointerType, at: At, init: Partial<PointerEventInit> = {}): void => {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: at.x, clientY: at.y, pointerId: 1, ...init }));
};

const clickAt = (target: HTMLElement, at: At, init: Partial<PointerEventInit> = {}): void => {
  pointerAt(target, 'pointerdown', at, init);
  pointerAt(target, 'pointerup', at, init);
};

const clickVertex = (target: HTMLElement, point: Point, angles = TEMPLATE_VIEW): void => clickAt(target, svgOf(point, angles));

/** Перетаскивание: нажатие, движение через середину пути и отпускание. */
const dragFrom = (target: HTMLElement, from: At, to: At, init: Partial<PointerEventInit> = {}): void => {
  pointerAt(target, 'pointerdown', from, init);
  pointerAt(target, 'pointermove', { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, init);
  pointerAt(target, 'pointermove', to, init);
  pointerAt(target, 'pointerup', to, init);
};

const press = (target: HTMLElement, key: string, init: Partial<KeyboardEventInit> = {}): void => {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
};

const pickTool = (editor: SceneEditor, tool: string): void => {
  editor.element.querySelector<HTMLButtonElement>(`button[data-tool="${tool}"]`)?.click();
};

/** Шаблон вписывается в полотно: дальше клики считаются от нового окна. */
const pickTemplate = (editor: SceneEditor, template: string): void => {
  editor.element.querySelector<HTMLButtonElement>(`button[data-template="${template}"]`)?.click();
  view = fittedViewport(editor);
};

const canvasOf = (editor: SceneEditor): HTMLElement => {
  const canvas = editor.element.querySelector<HTMLElement>('.rte-sketch');

  if (!canvas) throw new Error('Нет полотна');

  return canvas;
};

const propsOf = (editor: SceneEditor): HTMLElement => {
  const props = editor.element.querySelector<HTMLElement>('.rte-builder__props');

  if (!props) throw new Error('Нет панели свойств');

  return props;
};

const setValue = (control: HTMLInputElement | HTMLSelectElement, value: string): void => {
  control.value = value;
  control.dispatchEvent(new Event('change', { bubbles: true }));
};

type Edge = { from: string; to: string; style: string };

const edgesOf = (editor: SceneEditor): Edge[] => editor.getScene().edges as Edge[];

const hasEdge = (edges: Edge[], a: string, b: string): boolean =>
  edges.some((edge) => (edge.from === a && edge.to === b) || (edge.from === b && edge.to === a));

/** Пирамида из шаблонов диалога с видом из README, сечением и углом. */
const PYRAMID = {
  type: '3d',
  vertices: { A: [0, 0, 0], B: [3, 0, 0], C: [3, 3, 0], D: [0, 3, 0], S: [1.5, 1.5, 3.5] },
  edges: [
    ['A', 'B'],
    ['B', 'C'],
    ['C', 'D'],
    { from: 'D', to: 'A', style: 'dashed' },
    ['S', 'A'],
    ['S', 'B'],
    ['S', 'C'],
    { from: 'S', to: 'D', style: 'dashed' },
  ],
  labels: { S: 'above', A: 'below left' },
  sections: [{ vertices: ['A', 'C', 'S'], fill: 'rgba(37, 99, 235, 0.25)' }],
  angles: [{ points: ['B', 'A', 'D'], style: 'right' }],
  angleY: 15,
  angleZ: -30,
};

describe('конструктор стереометрии', () => {
  let editor: SceneEditor | undefined;

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
  });

  const create = (): SceneEditor => {
    editor = stereometryEditorFactory.create({ t });
    document.body.appendChild(editor.element);
    view = VIEWPORT;

    return editor;
  };

  it('загружает пирамиду и отдаёт её обратно в формате PinQueen с поворотами', () => {
    const stereo = create();

    stereo.load(PYRAMID);

    const scene = stereo.getScene();

    expect(scene.type).toBe('3d');
    expect(scene.vertices).toEqual(PYRAMID.vertices);
    expect(scene.edges).toEqual([
      { from: 'A', to: 'B', style: 'solid' },
      { from: 'B', to: 'C', style: 'solid' },
      { from: 'C', to: 'D', style: 'solid' },
      { from: 'D', to: 'A', style: 'dashed' },
      { from: 'S', to: 'A', style: 'solid' },
      { from: 'S', to: 'B', style: 'solid' },
      { from: 'S', to: 'C', style: 'solid' },
      { from: 'S', to: 'D', style: 'dashed' },
    ]);
    expect(scene.labels).toEqual({ S: 'above', A: 'below left' });
    expect(scene.sections).toEqual([{ vertices: ['A', 'C', 'S'], fill: 'rgba(37, 99, 235, 0.25)' }]);
    expect(scene.angles).toEqual([{ points: ['B', 'A', 'D'], style: 'right' }]);
    expect(scene.angleY).toBe(15);
    expect(scene.angleZ).toBe(-30);
    // Сетка включена и оси выключены по умолчанию — в JSON их нет.
    expect(scene.showGrid).toBeUndefined();
    expect(scene.showAxes).toBeUndefined();
    expect(canvasOf(stereo).querySelector('svg')).not.toBeNull();
    expect(stereo.element.querySelector('.rte-builder__hint')?.textContent).toContain('Левая кнопка мыши двигает чертёж, правая поворачивает фигуру');
  });

  it('шаблоны дают ожидаемые вершины, рёбра и тела вращения', () => {
    const stereo = create();
    const expectations: Array<[string, string[], number]> = [
      ['cube', ['A', 'B', 'C', 'D', 'A1', 'B1', 'C1', 'D1'], 12],
      ['parallelepiped', ['A', 'B', 'C', 'D', 'A1', 'B1', 'C1', 'D1'], 12],
      ['prism', ['A', 'B', 'C', 'A1', 'B1', 'C1'], 9],
      ['pyramid', ['A', 'B', 'C', 'D', 'S'], 8],
      ['frustum', ['A', 'B', 'C', 'D', 'A1', 'B1', 'C1', 'D1'], 12],
    ];

    expect([...stereo.element.querySelectorAll<HTMLButtonElement>('button[data-template]')].map((button) => button.dataset.template)).toEqual([
      'cube',
      'parallelepiped',
      'prism',
      'pyramid',
      'frustum',
      'cylinder',
      'cone',
      'sphere',
    ]);

    expectations.forEach(([template, names, edgeCount]) => {
      pickTemplate(stereo, template);

      const scene = stereo.getScene();

      expect(Object.keys(scene.vertices as object)).toEqual(names);
      expect(scene.edges).toHaveLength(edgeCount);
      expect(scene.angleY).toBe(15);
      expect(scene.angleZ).toBe(-30);
      expect(scene.cylinders).toBeUndefined();
      expect(scene.cones).toBeUndefined();
      expect(scene.spheres).toBeUndefined();
    });

    pickTemplate(stereo, 'cylinder');

    const cylinder = stereo.getScene();

    expect(cylinder.cylinders).toEqual([{ base: 'O1', top: 'O2', radius: 3 }]);
    expect(cylinder.vertices).toMatchObject({ O1: [0, 0, 0], O2: [0, 0, 5.5] });
    expect(hasEdge(cylinder.edges as Edge[], 'O1', 'O2')).toBe(true);
  });

  it('точка на ребре делит его по 3D-координатам', () => {
    const stereo = create();
    const canvas = canvasOf(stereo);

    pickTemplate(stereo, 'pyramid');
    pickTool(stereo, 'point');
    // Клик по середине проекции ребра S–B: доля t = 0.5 переносится в пространство.
    clickVertex(canvas, [1.5, -1.5, 2.75]);

    const scene = stereo.getScene();
    const edges = scene.edges as Edge[];

    expect(scene.vertices).toMatchObject({ E: [1.5, -1.5, 2.75] });
    expect(scene.labels).toMatchObject({ E: 'above' });
    expect(hasEdge(edges, 'S', 'B')).toBe(false);
    expect(hasEdge(edges, 'S', 'E')).toBe(true);
    expect(hasEdge(edges, 'E', 'B')).toBe(true);
    expect(edges).toHaveLength(9);
  });

  it('точка в пустоте ложится на плоскость z = 0 обратной проекцией', () => {
    const stereo = create();
    const canvas = canvasOf(stereo);

    pickTool(stereo, 'point');
    clickVertex(canvas, [1, 2, 0]);
    expect(stereo.getScene().vertices).toEqual({ A: [1, 2, 0] });

    // С Shift точка не прилипает к полуклеткам.
    clickAt(canvas, svgOf([0.3, 0.7, 0]), { shiftKey: true });

    const free = (stereo.getScene().vertices as Record<string, number[]>).B;

    expect(free[0]).toBeCloseTo(0.3, 1);
    expect(free[1]).toBeCloseTo(0.7, 1);
    expect(free[2]).toBe(0);

    // И на повёрнутой сцене с фигурой: клик мимо рёбер — новая точка на земле.
    pickTemplate(stereo, 'pyramid');
    pickTool(stereo, 'point');
    clickVertex(canvas, [-1, 1, 0]);
    expect(stereo.getScene().vertices).toMatchObject({ E: [-1, 1, 0] });
    expect(stereo.getScene().labels).toMatchObject({ E: 'below right' });
  });

  it('отрезок строится двумя кликами по вершинам', () => {
    const stereo = create();
    const canvas = canvasOf(stereo);

    pickTemplate(stereo, 'pyramid');
    pickTool(stereo, 'segment');
    clickVertex(canvas, [-3, -3, 0]);
    clickVertex(canvas, [3, 3, 0]);

    const edges = edgesOf(stereo);

    expect(edges).toHaveLength(9);
    // Диагональ лежит в основании, а его в виде по умолчанию не видно.
    expect(edges).toContainEqual({ from: 'A', to: 'C', style: 'dashed' });

    // Повтор того же отрезка и клик дважды по одной точке ничего не добавляют.
    clickVertex(canvas, [3, 3, 0]);
    clickVertex(canvas, [-3, -3, 0]);
    clickVertex(canvas, [0, 0, 5.5]);
    clickVertex(canvas, [0, 0, 5.5]);
    expect(edgesOf(stereo)).toHaveLength(9);
  });

  it('сечение собирается кликами по трём вершинам и замыкается Enter или повторным кликом', () => {
    const stereo = create();
    const canvas = canvasOf(stereo);

    pickTemplate(stereo, 'pyramid');
    pickTool(stereo, 'section');
    clickVertex(canvas, [-3, -3, 0]);
    clickVertex(canvas, [3, -3, 0]);
    expect(stereo.getScene().sections).toBeUndefined();
    // С двумя вершинами Enter ничего не замыкает — черновик остаётся.
    press(canvas, 'Enter');
    clickVertex(canvas, [0, 0, 5.5]);
    expect(stereo.getScene().sections).toBeUndefined();
    press(canvas, 'Enter');

    expect(stereo.getScene().sections).toEqual([{ vertices: ['A', 'B', 'S'], fill: 'rgba(16, 185, 129, 0.25)', stroke: '#10b981' }]);

    clickVertex(canvas, [3, -3, 0]);
    clickVertex(canvas, [3, 3, 0]);
    clickVertex(canvas, [0, 0, 5.5]);
    clickVertex(canvas, [3, -3, 0]);
    expect(stereo.getScene().sections).toHaveLength(2);
    expect((stereo.getScene().sections as Array<{ vertices: string[] }>)[1].vertices).toEqual(['B', 'C', 'S']);

    // Выбранное сечение меняет заливку из списка.
    const fill = propsOf(stereo).querySelector<HTMLSelectElement>('select');

    expect(fill?.value).toBe('rgba(16, 185, 129, 0.25)');
    setValue(fill!, 'rgba(37, 99, 235, 0.25)');
    expect((stereo.getScene().sections as Array<{ fill: string }>)[1].fill).toBe('rgba(37, 99, 235, 0.25)');
  });

  it('угол ставится тремя кликами или вводом вершин текстом «SOH»; прямой угол распознаётся', () => {
    const stereo = create();
    const canvas = canvasOf(stereo);

    pickTemplate(stereo, 'parallelepiped');
    pickTool(stereo, 'angle');
    clickVertex(canvas, [-3, -3, 5]);
    clickVertex(canvas, [-3, -3, 0]);
    clickVertex(canvas, [3, -3, 0]);
    expect(stereo.getScene().angles).toEqual([{ points: ['A1', 'A', 'B'], style: 'right' }]);

    // Поле ввода показывается, когда ничего не выбрано.
    press(canvas, 'Escape');

    const input = propsOf(stereo).querySelector<HTMLInputElement>('input[placeholder="SOH"]');

    expect(input).not.toBeNull();
    setValue(input!, 'xyz');
    expect(input!.getAttribute('aria-invalid')).toBe('true');
    expect(stereo.getScene().angles).toHaveLength(1);

    press(canvas, 'Escape');
    setValue(propsOf(stereo).querySelector<HTMLInputElement>('input[placeholder="SOH"]')!, 'b1bc');
    expect(stereo.getScene().angles).toEqual([
      { points: ['A1', 'A', 'B'], style: 'right' },
      { points: ['B1', 'B', 'C'], style: 'right' },
    ]);

    // Наклонный угол — одной дугой; метка и вид дуги правятся в свойствах.
    press(canvas, 'Escape');
    setValue(propsOf(stereo).querySelector<HTMLInputElement>('input[placeholder="SOH"]')!, 'C1 A C');

    const angles = stereo.getScene().angles as Array<Record<string, unknown>>;

    // Наклонный угол сразу подписан величиной в пространстве: arctg(5 / 6√2) ≈ 30,5°.
    expect(angles[2]).toEqual({ points: ['C1', 'A', 'C'], style: 'single', label: '30,5°' });

    const [style] = propsOf(stereo).querySelectorAll('select');

    setValue(style, 'double');
    // Своя подпись — только с выключенной величиной.
    viewField(stereo, 'angleMeasure').click();
    setValue(firstControl(stereo, 'input[placeholder="30°"]'), '60°');
    expect((stereo.getScene().angles as unknown[])[2]).toEqual({ points: ['C1', 'A', 'C'], style: 'double', label: '60°' });
  });

  it('вращение правой кнопкой меняет angleZ и angleY с ограничением ±85 и одной записью в истории', () => {
    const stereo = create();
    const canvas = canvasOf(stereo);
    let changes = 0;

    pickTemplate(stereo, 'pyramid');
    stereo.onChange(() => {
      changes += 1;
    });

    pointerAt(canvas, 'pointerdown', { x: 100, y: 100 }, { button: 2 });
    pointerAt(canvas, 'pointermove', { x: 110, y: 105 }, { button: 2 });
    expect(stereo.getScene().angleZ).toBeCloseTo(-22);
    expect(stereo.getScene().angleY).toBeCloseTo(19);

    pointerAt(canvas, 'pointermove', { x: 110, y: 405 }, { button: 2 });
    expect(stereo.getScene().angleY).toBe(85);
    pointerAt(canvas, 'pointerup', { x: 110, y: 405 }, { button: 2 });
    expect(changes).toBe(1);

    // Вращение не ставит точек и не меняет фигуру.
    expect(Object.keys(stereo.getScene().vertices as object)).toHaveLength(5);

    press(canvas, 'z', { ctrlKey: true });
    expect(stereo.getScene().angleY).toBe(15);
    expect(stereo.getScene().angleZ).toBe(-30);

    press(canvas, 'y', { ctrlKey: true });
    expect(stereo.getScene().angleY).toBe(85);
    expect(stereo.getScene().angleZ).toBe(-22);

    // Средняя кнопка двигает полотно и вид не вращает.
    pointerAt(canvas, 'pointerdown', { x: 20, y: 20 }, { button: 1 });
    pointerAt(canvas, 'pointermove', { x: 60, y: 60 }, { button: 1 });
    pointerAt(canvas, 'pointerup', { x: 60, y: 60 }, { button: 1 });
    expect(stereo.getScene().angleZ).toBe(-22);
    expect(stereo.getScene().angleY).toBe(85);
  });

  it('отмена возвращает прошлое состояние, повтор — следующее', () => {
    const stereo = create();
    const canvas = canvasOf(stereo);

    pickTemplate(stereo, 'pyramid');
    pickTool(stereo, 'point');
    clickVertex(canvas, [-1, 1, 0]);
    expect(Object.keys(stereo.getScene().vertices as object)).toHaveLength(6);

    press(canvas, 'z', { ctrlKey: true });
    expect(Object.keys(stereo.getScene().vertices as object)).toHaveLength(5);

    press(canvas, 'z', { ctrlKey: true });
    expect(stereo.getScene().vertices).toEqual({});

    press(canvas, 'y', { ctrlKey: true });
    press(canvas, 'z', { ctrlKey: true, shiftKey: true });
    expect(Object.keys(stereo.getScene().vertices as object)).toHaveLength(6);
  });

  it('свойства: ребро становится пунктирным, у вершины правятся имя и координаты, вид — числами', () => {
    const stereo = create();
    const canvas = canvasOf(stereo);

    pickTemplate(stereo, 'pyramid');
    pickTool(stereo, 'select');
    // Середина проекции ребра B–C.
    clickVertex(canvas, [3, 0, 0]);

    const style = propsOf(stereo).querySelector<HTMLSelectElement>('select');

    expect(style?.value).toBe('solid');
    setValue(style!, 'dashed');
    expect(edgesOf(stereo)).toContainEqual({ from: 'B', to: 'C', style: 'dashed' });

    clickVertex(canvas, [0, 0, 5.5]);

    const name = propsOf(stereo).querySelector<HTMLInputElement>('input[type="text"]');
    const z = propsOf(stereo).querySelector<HTMLInputElement>('input[data-axis="z"]');

    expect(name?.value).toBe('S');
    expect(z?.value).toBe('5.5');
    setValue(z!, '4');
    expect(stereo.getScene().vertices).toMatchObject({ S: [0, 0, 4] });

    setValue(propsOf(stereo).querySelector<HTMLInputElement>('input[type="text"]')!, 'P');

    const renamed = stereo.getScene();

    expect(Object.keys(renamed.vertices as object)).toEqual(['A', 'B', 'C', 'D', 'P']);
    expect(hasEdge(renamed.edges as Edge[], 'P', 'A')).toBe(true);
    expect(renamed.labels).toMatchObject({ P: 'above' });

    // Ничего не выбрано — повороты, сетка и оси.
    press(canvas, 'Escape');

    setValue(propsOf(stereo).querySelector<HTMLInputElement>('input[data-prop="angleY"]')!, '120');
    expect(stereo.getScene().angleY).toBe(85);
    setValue(propsOf(stereo).querySelector<HTMLInputElement>('input[data-prop="angleZ"]')!, '200');
    expect(stereo.getScene().angleZ).toBe(-160);

    // Панель перерисовывается после каждого изменения, поэтому чекбоксы берём заново.
    const checkboxes = (): NodeListOf<HTMLInputElement> => propsOf(stereo).querySelectorAll<HTMLInputElement>('input[type="checkbox"]');

    // Третий — автоматический пунктир: ручной стиль ребра B–C его выключил.
    expect([...checkboxes()].map((box) => box.checked)).toEqual([true, false, false]);
    checkboxes()[0].click();
    expect(stereo.getScene().showGrid).toBe(false);
    checkboxes()[1].click();
    expect(stereo.getScene().showAxes).toBe(true);
    expect([...checkboxes()].map((box) => box.checked)).toEqual([false, true, false]);
  });

  it('удаление вершины чистит рёбра, сечения, углы и подпись', () => {
    const stereo = create();
    const canvas = canvasOf(stereo);

    pickTemplate(stereo, 'pyramid');
    pickTool(stereo, 'section');
    clickVertex(canvas, [-3, -3, 0]);
    clickVertex(canvas, [3, -3, 0]);
    clickVertex(canvas, [0, 0, 5.5]);
    press(canvas, 'Enter');
    clickVertex(canvas, [-3, -3, 0]);
    clickVertex(canvas, [3, -3, 0]);
    clickVertex(canvas, [3, 3, 0]);
    clickVertex(canvas, [-3, 3, 0]);
    press(canvas, 'Enter');
    pickTool(stereo, 'angle');
    clickVertex(canvas, [0, 0, 5.5]);
    clickVertex(canvas, [-3, -3, 0]);
    clickVertex(canvas, [3, -3, 0]);
    expect(stereo.getScene().sections).toHaveLength(2);
    expect(stereo.getScene().angles).toHaveLength(1);

    pickTool(stereo, 'delete');
    clickVertex(canvas, [0, 0, 5.5]);

    const scene = stereo.getScene();

    expect(Object.keys(scene.vertices as object)).toEqual(['A', 'B', 'C', 'D']);
    expect(scene.edges).toHaveLength(4);
    expect(scene.angles).toBeUndefined();
    // Треугольное сечение без вершины исчезает, четырёхугольное без S не менялось.
    expect(scene.sections).toEqual([{ vertices: ['A', 'B', 'C', 'D'], fill: 'rgba(16, 185, 129, 0.25)', stroke: '#10b981' }]);
    expect((scene.labels as Record<string, string>).S).toBeUndefined();

    // Delete с клавиатуры убирает выбранное ребро.
    pickTool(stereo, 'select');
    clickVertex(canvas, [3, 0, 0]);
    press(canvas, 'Delete');
    expect(stereo.getScene().edges).toHaveLength(3);
  });

  it('принимает только объёмные сцены', () => {
    expect(stereometryEditorFactory.accepts(PYRAMID)).toBe(true);
    expect(stereometryEditorFactory.accepts({ type: '3d', vertices: { S: [0, 0, 2], A: [0, 0, 0] }, edges: [['S', 'A']] })).toBe(true);
    expect(stereometryEditorFactory.accepts({ type: '2d', vertices: { A: [0, 0], B: [4, 0] } })).toBe(false);
    // «3D» без глубины нормализация считает плоской сценой.
    expect(stereometryEditorFactory.accepts({ type: '3d', vertices: { A: [0, 0, 0], B: [1, 0, 0] } })).toBe(false);
    expect(stereometryEditorFactory.accepts({ plots: [{ type: 'parabola', vertex: [0, 0] }] })).toBe(false);
    expect(stereometryEditorFactory.id).toBe('stereometry');
    expect(stereometryEditorFactory.kind).toBe('geometry');
    expect(stereometryEditorFactory.labelKey).toBe('drawings_tab_stereometry');
  });

  it('чужие поля сцены и элементов возвращаются нетронутыми', () => {
    const stereo = create();
    const canvas = canvasOf(stereo);

    stereo.load({
      ...PYRAMID,
      custom: { keep: true },
      text_labels: [{ text: '√3', position: ['A', 'B'] }],
      plots: [{ type: 'parabola', vertex: [0, 0] }],
      edges: [...PYRAMID.edges.slice(0, 7), { from: 'S', to: 'D', style: 'dashed', color: '#2563eb', ticks: 2 }],
    });

    const scene = stereo.getScene();

    expect(scene.custom).toEqual({ keep: true });
    expect(scene.text_labels).toEqual([{ text: '√3', position: ['A', 'B'] }]);
    expect(scene.plots).toEqual([{ type: 'parabola', vertex: [0, 0] }]);
    expect(scene.edges).toContainEqual({ from: 'S', to: 'D', style: 'dashed', color: '#2563eb', ticks: 2 });

    // И после правки тоже: клики считаются от подогнанного окна, поэтому точка — через шаблон не нужна.
    pickTool(stereo, 'select');
    press(canvas, 'Escape');
    propsOf(stereo).querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1].click();
    expect(stereo.getScene().custom).toEqual({ keep: true });
    expect(stereo.getScene().showAxes).toBe(true);
  });

  /** Угол полотна: после вписывания шаблона там пусто. */
  const EMPTY_CORNER: At = { x: 6, y: 6 };

  const nameField = (stereo: SceneEditor): string | undefined => propsOf(stereo).querySelector<HTMLInputElement>('input[type="text"]')?.value;

  const viewField = (stereo: SceneEditor, prop: string): HTMLInputElement => {
    const input = propsOf(stereo).querySelector<HTMLInputElement>(`input[data-prop="${prop}"]`);

    if (!input) throw new Error(`Нет поля ${prop}`);

    return input;
  };

  const vertexOf = (stereo: SceneEditor, name: string): number[] | undefined => (stereo.getScene().vertices as Record<string, number[]>)[name];

  it('перетаскивание пустого места основной кнопкой двигает полотно: углы прежние, история не пополняется', () => {
    const stereo = create();
    const canvas = canvasOf(stereo);
    let changes = 0;

    // Сцена из load: история пуста, так что любая отмена после панорамы была бы её шагом.
    stereo.load(PYRAMID);
    view = fittedViewport(stereo);
    stereo.onChange(() => {
      changes += 1;
    });

    const before = stereo.getScene();

    pointerAt(canvas, 'pointerdown', EMPTY_CORNER);
    // В пределах порога это ещё клик: полотно на месте.
    pointerAt(canvas, 'pointermove', { x: 8, y: 7 });
    expect(stereo.element.classList.contains('rte-stereo--rotating')).toBe(false);
    // Порог пройден: сдвиг считается отсюда, поэтому рывка нет.
    pointerAt(canvas, 'pointermove', { x: 16, y: 6 });
    expect(stereo.element.classList.contains('rte-stereo--rotating')).toBe(true);
    pointerAt(canvas, 'pointermove', { x: 26, y: 18 });
    pointerAt(canvas, 'pointerup', { x: 26, y: 18 });
    expect(stereo.element.classList.contains('rte-stereo--rotating')).toBe(false);
    expect(stereo.getScene()).toEqual(before);
    expect(viewField(stereo, 'angleZ').value).toBe('-30');
    expect(changes).toBe(0);

    // Фигура уехала на (10, 12): клик по сдвинутой проекции вершины попадает в неё.
    view = { ...view, cx: view.cx + 10, cy: view.cy + 12 };
    pickTool(stereo, 'select');
    clickVertex(canvas, [1.5, 1.5, 3.5]);
    expect(nameField(stereo)).toBe('S');

    press(canvas, 'z', { ctrlKey: true });
    expect(stereo.getScene()).toEqual(before);
    clickAt(canvas, EMPTY_CORNER);
    clickVertex(canvas, [3, 0, 0]);
    expect(propsOf(stereo).querySelector('select')).not.toBeNull();
  });

  it('в «Точке» клик без движения ставит точку, а перетаскивание двигает полотно и точку не ставит', () => {
    const stereo = create();
    const canvas = canvasOf(stereo);

    pickTool(stereo, 'point');
    clickVertex(canvas, [1, 2, 0]);
    expect(stereo.getScene().vertices).toEqual({ A: [1, 2, 0] });

    const from = svgOf([-3, -3, 0]);

    // Порог пройден на середине пути (+20 px), дальше ещё 20 px — полотно сдвинулось на 20.
    dragFrom(canvas, from, { x: from.x + 40, y: from.y });
    expect(stereo.getScene().vertices).toEqual({ A: [1, 2, 0] });
    expect(stereo.getScene().angleZ).toBe(-30);

    view = { ...view, cx: view.cx + 20 };
    clickVertex(canvas, [1, -1, 0]);
    expect(stereo.getScene().vertices).toEqual({ A: [1, 2, 0], B: [1, -1, 0] });
  });

  it('pointercancel посреди панорамы точку не ставит', () => {
    const stereo = create();
    const canvas = canvasOf(stereo);

    pickTool(stereo, 'point');
    pointerAt(canvas, 'pointerdown', svgOf([1, 2, 0]));
    pointerAt(canvas, 'pointermove', { x: svgOf([1, 2, 0]).x + 30, y: svgOf([1, 2, 0]).y });
    pointerAt(canvas, 'pointercancel', { x: svgOf([1, 2, 0]).x + 30, y: svgOf([1, 2, 0]).y });
    expect(stereo.getScene().vertices).toEqual({});
    expect(stereo.element.classList.contains('rte-stereo--rotating')).toBe(false);
  });

  it('клик по пустому месту в «Выборе» снимает выделение', () => {
    const stereo = create();
    const canvas = canvasOf(stereo);

    pickTemplate(stereo, 'pyramid');
    pickTool(stereo, 'select');
    clickVertex(canvas, [3, 0, 0]);
    expect(propsOf(stereo).querySelector('select')).not.toBeNull();

    clickAt(canvas, EMPTY_CORNER);
    expect([...propsOf(stereo).querySelectorAll('.rte-builder__props-title')].map((title) => title.textContent)).toEqual(['Размеры фигуры', 'Вид']);
    expect(propsOf(stereo).querySelector('input[data-prop="angleY"]')).not.toBeNull();
  });

  it('pointercancel после нажатия по пустому месту точку не ставит', () => {
    const stereo = create();
    const canvas = canvasOf(stereo);

    pickTool(stereo, 'point');
    pointerAt(canvas, 'pointerdown', svgOf([1, 2, 0]));
    pointerAt(canvas, 'pointercancel', svgOf([1, 2, 0]));
    expect(stereo.getScene().vertices).toEqual({});

    // Следующий обычный клик работает как раньше.
    clickVertex(canvas, [1, 2, 0]);
    expect(stereo.getScene().vertices).toEqual({ A: [1, 2, 0] });
  });

  it('вершина в «Выборе» тащится в плоскости своей высоты без рывка; отмена — один шаг', () => {
    const stereo = create();
    const canvas = canvasOf(stereo);
    let changes = 0;

    pickTemplate(stereo, 'pyramid');
    pickTool(stereo, 'select');
    stereo.onChange(() => {
      changes += 1;
    });

    // Взяли не точно за центр: смещение захвата сохраняется, вершина не прыгает к курсору.
    const grab = { x: 3, y: 2 };
    const at = svgOf([0, 0, 5.5]);
    const target = svgOf([1.5, -1, 5.5]);

    pointerAt(canvas, 'pointerdown', { x: at.x + grab.x, y: at.y + grab.y });
    pointerAt(canvas, 'pointermove', { x: at.x + grab.x + 1, y: at.y + grab.y + 1 });
    expect(vertexOf(stereo, 'S')).toEqual([0, 0, 5.5]);
    pointerAt(canvas, 'pointermove', { x: target.x + grab.x, y: target.y + grab.y });
    expect(vertexOf(stereo, 'S')).toEqual([1.5, -1, 5.5]);
    // Во время движения — только перерисовка, координаты в панели не отстают.
    expect(changes).toBe(0);
    expect(propsOf(stereo).querySelector<HTMLInputElement>('input[data-axis="x"]')?.value).toBe('1.5');
    pointerAt(canvas, 'pointerup', { x: target.x + grab.x, y: target.y + grab.y });

    expect(changes).toBe(1);
    expect(nameField(stereo)).toBe('S');
    expect(edgesOf(stereo)).toHaveLength(8);

    press(canvas, 'z', { ctrlKey: true });
    expect(vertexOf(stereo, 'S')).toEqual([0, 0, 5.5]);
    press(canvas, 'z', { ctrlKey: true });
    expect(stereo.getScene().vertices).toEqual({});
  });

  it('с Alt вершина тащится по вертикали: меняется только z', () => {
    const stereo = create();
    const canvas = canvasOf(stereo);

    pickTemplate(stereo, 'pyramid');
    pickTool(stereo, 'select');
    dragFrom(canvas, svgOf([0, 0, 5.5]), svgOf([0, 0, 7]), { altKey: true });
    expect(vertexOf(stereo, 'S')).toEqual([0, 0, 7]);

    // Сдвиг вбок при Alt высоту почти не меняет и (x, y) не трогает.
    dragFrom(canvas, svgOf([0, 0, 7]), svgOf([2, 2, 7]), { altKey: true });

    const lifted = vertexOf(stereo, 'S');

    expect(lifted?.[0]).toBe(0);
    expect(lifted?.[1]).toBe(0);

    // В других инструментах вершины не тащатся.
    pickTool(stereo, 'point');
    dragFrom(canvas, svgOf([3, 3, 0]), svgOf([4, 4, 0]));
    expect(vertexOf(stereo, 'C')).toEqual([3, 3, 0]);
  });

  it('высота новой точки: точка встаёт на z = pointHeight, над полотном — подсказка', () => {
    const stereo = create();
    const canvas = canvasOf(stereo);

    pickTool(stereo, 'select');
    expect(propsOf(stereo).querySelector('input[data-prop="pointHeight"]')).toBeNull();

    pickTool(stereo, 'point');
    expect(viewField(stereo, 'pointHeight').value).toBe('0');
    setValue(viewField(stereo, 'pointHeight'), '2');

    pointerAt(canvas, 'pointermove', svgOf([1, 2, 2]));
    expect(canvas.querySelector('.rte-sketch__overlay line')).not.toBeNull();

    clickVertex(canvas, [1, 2, 2]);
    expect(stereo.getScene().vertices).toEqual({ A: [1, 2, 2] });

    // Поставленная точка выделена, но поле высоты остаётся первым блоком панели,
    // и вторая точка подряд встаёт на ту же высоту без Esc.
    expect(propsOf(stereo).firstElementChild?.querySelector('input[data-prop="pointHeight"]')).not.toBeNull();
    expect(viewField(stereo, 'pointHeight').value).toBe('2');
    expect(nameField(stereo)).toBe('A');
    pointerAt(canvas, 'pointermove', svgOf([-2, 1, 2]));
    expect(canvas.querySelector('.rte-sketch__overlay line')).not.toBeNull();
    clickVertex(canvas, [-2, 1, 2]);
    expect(stereo.getScene().vertices).toEqual({ A: [1, 2, 2], B: [-2, 1, 2] });

    // Высота живёт в инструменте: после снятия выделения поле помнит её.
    press(canvas, 'Escape');
    expect(viewField(stereo, 'pointHeight').value).toBe('2');

    // «Сечение» в пустоте точек не ставит — поля у него нет; у «Отрезка» есть.
    pickTool(stereo, 'section');
    expect(propsOf(stereo).querySelector('input[data-prop="pointHeight"]')).toBeNull();
    pickTool(stereo, 'segment');
    expect(viewField(stereo, 'pointHeight').value).toBe('2');

    // Шаблон сбрасывает высоту в 0, и подсказки больше нет.
    pickTemplate(stereo, 'pyramid');
    pointerAt(canvas, 'pointermove', EMPTY_CORNER);
    expect(canvas.querySelector('.rte-sketch__overlay line')).toBeNull();
    expect(viewField(stereo, 'pointHeight').value).toBe('0');
  });

  it('после шаблона все вершины лежат внутри полотна', () => {
    const stereo = create();
    const canvas = canvasOf(stereo);

    ['cube', 'parallelepiped', 'prism', 'pyramid', 'frustum', 'cylinder', 'cone', 'sphere'].forEach((template) => {
      pickTemplate(stereo, template);
      pickTool(stereo, 'select');

      Object.entries(stereo.getScene().vertices as Record<string, Point>).forEach(([name, point]) => {
        const at = svgOf(point);

        expect(at.x).toBeGreaterThan(0);
        expect(at.x).toBeLessThan(STEREOMETRY_CANVAS.width);
        expect(at.y).toBeGreaterThan(0);
        expect(at.y).toBeLessThan(STEREOMETRY_CANVAS.height);
        // Конструктор рисует в том же вписанном окне: клик по расчётной точке попадает в вершину.
        clickAt(canvas, at);
        expect(nameField(stereo)).toBe(name);
      });
    });
  });

  it('ползунок «Поворот» вращает вид одним шагом истории, «Сбросить вид» возвращает 15° и −30°', () => {
    const stereo = create();
    const canvas = canvasOf(stereo);
    let changes = 0;

    pickTemplate(stereo, 'pyramid');
    stereo.onChange(() => {
      changes += 1;
    });

    const slider = viewField(stereo, 'angleZRange');

    expect(slider.type).toBe('range');
    expect(slider.value).toBe('-30');

    slider.value = '40';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    expect(stereo.getScene().angleZ).toBe(40);
    expect(viewField(stereo, 'angleZ').value).toBe('40');
    slider.value = '60';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    expect(changes).toBe(0);
    slider.dispatchEvent(new Event('change', { bubbles: true }));
    expect(stereo.getScene().angleZ).toBe(60);
    expect(changes).toBe(1);

    press(canvas, 'z', { ctrlKey: true });
    expect(stereo.getScene().angleZ).toBe(-30);

    const tilt = viewField(stereo, 'angleYRange');

    tilt.value = '-40';
    tilt.dispatchEvent(new Event('input', { bubbles: true }));
    tilt.dispatchEvent(new Event('change', { bubbles: true }));
    setValue(viewField(stereo, 'angleZ'), '100');
    expect(stereo.getScene().angleY).toBe(-40);
    expect(stereo.getScene().angleZ).toBe(100);

    const reset = [...propsOf(stereo).querySelectorAll('button')].find((button) => button.textContent === 'Сбросить вид');

    reset?.click();
    expect(stereo.getScene().angleY).toBe(15);
    expect(stereo.getScene().angleZ).toBe(-30);
    expect(viewField(stereo, 'angleZRange').value).toBe('-30');

    // Сброс — один шаг истории.
    press(canvas, 'z', { ctrlKey: true });
    expect(stereo.getScene().angleZ).toBe(100);
  });

  it('стрелки крутят вид, пока ничего не выбрано: по 5°, с Shift — по 15°', () => {
    const stereo = create();
    const canvas = canvasOf(stereo);
    const arrow = (key: string, shiftKey = false): boolean =>
      canvas.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }));

    pickTemplate(stereo, 'pyramid');

    expect(arrow('ArrowRight')).toBe(false);
    expect(stereo.getScene().angleZ).toBe(-25);
    arrow('ArrowRight', true);
    expect(stereo.getScene().angleZ).toBe(-10);
    arrow('ArrowLeft');
    expect(stereo.getScene().angleZ).toBe(-15);
    arrow('ArrowUp');
    expect(stereo.getScene().angleY).toBe(20);
    arrow('ArrowDown', true);
    expect(stereo.getScene().angleY).toBe(5);

    press(canvas, 'z', { ctrlKey: true });
    expect(stereo.getScene().angleY).toBe(20);

    // С выделением стрелки не обрабатываются.
    // Окно вписано под шаблон и при повороте стрелками не меняется.
    pickTool(stereo, 'select');
    clickVertex(canvas, [3, 0, 0], { angleY: 20, angleZ: -15 });
    expect(propsOf(stereo).querySelector('select')).not.toBeNull();
    expect(arrow('ArrowRight')).toBe(true);
    expect(stereo.getScene().angleZ).toBe(-15);
  });

  it('ползунок увели и вернули без change: жест закрыт, отмена правок идёт по шагам', () => {
    const stereo = create();
    const canvas = canvasOf(stereo);
    const slide = (value: string, ...events: string[]): void => {
      const slider = viewField(stereo, 'angleZRange');

      slider.value = value;
      events.forEach((type) => slider.dispatchEvent(new Event(type, { bubbles: true })));
    };

    pickTemplate(stereo, 'pyramid');
    slide('40', 'input');
    slide('-30', 'input');
    pickTool(stereo, 'point');
    clickAt(canvas, EMPTY_CORNER);
    expect(Object.keys(stereo.getScene().vertices as object)).toHaveLength(6);

    // Снова тянем ползунок: это новый жест со своим шагом истории.
    pickTool(stereo, 'select');
    press(canvas, 'Escape');
    slide('50', 'input', 'change');
    expect(stereo.getScene().angleZ).toBe(50);

    press(canvas, 'z', { ctrlKey: true });
    expect(stereo.getScene().angleZ).toBe(-30);
    expect(Object.keys(stereo.getScene().vertices as object)).toHaveLength(6);
    // Увели и вернули — не правка: следующая отмена убирает только точку, затем шаблон.
    press(canvas, 'z', { ctrlKey: true });
    expect(Object.keys(stereo.getScene().vertices as object)).toHaveLength(5);
    press(canvas, 'z', { ctrlKey: true });
    expect(stereo.getScene().vertices).toEqual({});
  });

  it('ползунок закрывает жест по отпусканию и потере фокуса', () => {
    const stereo = create();
    const canvas = canvasOf(stereo);
    let changes = 0;

    pickTemplate(stereo, 'pyramid');
    stereo.onChange(() => {
      changes += 1;
    });

    ['pointerup', 'keyup', 'blur'].forEach((type, index) => {
      const slider = viewField(stereo, 'angleZRange');

      slider.value = String(10 * (index + 1));
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      slider.dispatchEvent(new Event(type));
      expect(changes).toBe(index + 1);
    });

    press(canvas, 'z', { ctrlKey: true });
    expect(stereo.getScene().angleZ).toBe(20);
    press(canvas, 'z', { ctrlKey: true });
    expect(stereo.getScene().angleZ).toBe(10);
    press(canvas, 'z', { ctrlKey: true });
    expect(stereo.getScene().angleZ).toBe(-30);
  });

  it('Alt посреди перетаскивания: (x, y) остаются сдвинутыми, меняется только z', () => {
    const stereo = create();
    const canvas = canvasOf(stereo);

    pickTemplate(stereo, 'pyramid');
    pickTool(stereo, 'select');

    const grab = { x: 3, y: 2 };
    const at = svgOf([0, 0, 5.5]);
    const moved = svgOf([1.5, -1, 5.5]);
    const lifted = svgOf([1.5, -1, 7]);

    pointerAt(canvas, 'pointerdown', { x: at.x + grab.x, y: at.y + grab.y });
    pointerAt(canvas, 'pointermove', { x: moved.x + grab.x, y: moved.y + grab.y });
    expect(vertexOf(stereo, 'S')).toEqual([1.5, -1, 5.5]);
    // Зажали Alt на месте: вершина не прыгает к началу жеста.
    pointerAt(canvas, 'pointermove', { x: moved.x + grab.x, y: moved.y + grab.y }, { altKey: true });
    expect(vertexOf(stereo, 'S')).toEqual([1.5, -1, 5.5]);
    pointerAt(canvas, 'pointermove', { x: lifted.x + grab.x, y: lifted.y + grab.y }, { altKey: true });
    expect(vertexOf(stereo, 'S')).toEqual([1.5, -1, 7]);
    // Отпустили Alt: высота остаётся новой, дальше сдвиг по горизонтали на z = 7.
    pointerAt(canvas, 'pointermove', { x: lifted.x + grab.x, y: lifted.y + grab.y });
    expect(vertexOf(stereo, 'S')).toEqual([1.5, -1, 7]);

    const further = svgOf([2.5, 0, 7]);

    pointerAt(canvas, 'pointermove', { x: further.x + grab.x, y: further.y + grab.y });
    expect(vertexOf(stereo, 'S')).toEqual([2.5, 0, 7]);
    pointerAt(canvas, 'pointerup', { x: further.x + grab.x, y: further.y + grab.y });

    // Весь жест — один шаг истории.
    press(canvas, 'z', { ctrlKey: true });
    expect(vertexOf(stereo, 'S')).toEqual([0, 0, 5.5]);
  });

  it('плоскость почти с ребра: вершина по горизонтали не едет, точка в пустоте не ставится', () => {
    const stereo = create();
    const canvas = canvasOf(stereo);
    // Наклон −18°: определитель обратной проекции около 0,027 (< 0,05), но не ноль.
    const shallow = { angleY: -18, angleZ: -30 };
    const [a, c] = project3dToPlane([1, 0, 0], shallow.angleY, shallow.angleZ);
    const [b, d] = project3dToPlane([0, 1, 0], shallow.angleY, shallow.angleZ);

    expect(Math.abs(a * d - b * c)).toBeLessThan(0.05);
    expect(Math.abs(a * d - b * c)).toBeGreaterThan(0.01);

    stereo.load({ type: '3d', vertices: { A: [0, 0, 0], B: [3, 0, 0], C: [0, 3, 2] }, edges: [['A', 'B']], ...shallow });
    view = fittedViewport(stereo);
    pickTool(stereo, 'select');

    const from = svgOf([0, 3, 2], shallow);

    dragFrom(canvas, from, { x: from.x + 30, y: from.y + 12 });
    expect(vertexOf(stereo, 'C')).toEqual([0, 3, 2]);

    // Вертикальный сдвиг с Alt при этом работает.
    dragFrom(canvas, from, svgOf([0, 3, 3], shallow), { altKey: true });
    expect(vertexOf(stereo, 'C')).toEqual([0, 3, 3]);

    // Клик в пустоту в «Точке» и «Отрезке» новой вершины не даёт.
    pickTool(stereo, 'point');
    clickAt(canvas, EMPTY_CORNER);
    pickTool(stereo, 'segment');
    clickAt(canvas, EMPTY_CORNER);
    expect(Object.keys(stereo.getScene().vertices as object)).toEqual(['A', 'B', 'C']);
  });

  it('отмена и повтор посреди жеста игнорируются', () => {
    const stereo = create();
    const canvas = canvasOf(stereo);

    pickTemplate(stereo, 'pyramid');

    // Вращение правой кнопкой.
    pointerAt(canvas, 'pointerdown', EMPTY_CORNER, { button: 2 });
    pointerAt(canvas, 'pointermove', { x: 16, y: 6 }, { button: 2 });
    expect(stereo.getScene().angleZ).toBeCloseTo(-22);
    press(canvas, 'z', { ctrlKey: true });
    press(canvas, 'y', { ctrlKey: true });
    expect(stereo.getScene().angleZ).toBeCloseTo(-22);
    pointerAt(canvas, 'pointerup', { x: 16, y: 6 }, { button: 2 });
    press(canvas, 'z', { ctrlKey: true });
    expect(stereo.getScene().angleZ).toBe(-30);

    // Панорама основной кнопкой: отмена посреди неё не откатывает шаблон.
    pointerAt(canvas, 'pointerdown', EMPTY_CORNER);
    pointerAt(canvas, 'pointermove', { x: 20, y: 6 });
    pointerAt(canvas, 'pointermove', { x: 30, y: 6 });
    press(canvas, 'z', { ctrlKey: true });
    expect(Object.keys(stereo.getScene().vertices as object)).toHaveLength(5);
    pointerAt(canvas, 'pointerup', { x: 30, y: 6 });
    view = { ...view, cx: view.cx + 10 };

    // Перетаскивание вершины: отмена не возвращает её и не воскрешает удалённое.
    pickTool(stereo, 'select');

    const at = svgOf([0, 0, 5.5]);
    const target = svgOf([1, 1, 5.5]);

    pointerAt(canvas, 'pointerdown', at);
    pointerAt(canvas, 'pointermove', target);
    press(canvas, 'z', { ctrlKey: true });
    expect(vertexOf(stereo, 'S')).toEqual([1, 1, 5.5]);
    pointerAt(canvas, 'pointerup', target);
    press(canvas, 'z', { ctrlKey: true });
    expect(vertexOf(stereo, 'S')).toEqual([0, 0, 5.5]);

    // Ползунок.
    press(canvas, 'Escape');

    const slider = viewField(stereo, 'angleZRange');

    slider.value = '40';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    press(canvas, 'z', { ctrlKey: true });
    press(canvas, 'z', { ctrlKey: true, shiftKey: true });
    expect(stereo.getScene().angleZ).toBe(40);
    slider.dispatchEvent(new Event('change', { bubbles: true }));
    expect(stereo.getScene().angleZ).toBe(40);
    press(canvas, 'z', { ctrlKey: true });
    expect(stereo.getScene().angleZ).toBe(-30);
  });

  it('отложенный клик не ломает построения: отрезок в пустоту, сечение с двойным кликом', () => {
    const stereo = create();
    const canvas = canvasOf(stereo);

    pickTool(stereo, 'segment');
    clickVertex(canvas, [1, 1, 0]);
    clickVertex(canvas, [3, -2, 0]);
    expect(stereo.getScene().vertices).toEqual({ A: [1, 1, 0], B: [3, -2, 0] });
    expect(edgesOf(stereo)).toEqual([{ from: 'A', to: 'B', style: 'solid' }]);

    pickTemplate(stereo, 'pyramid');
    pickTool(stereo, 'section');
    clickVertex(canvas, [-3, -3, 0]);
    clickVertex(canvas, [3, -3, 0]);
    clickVertex(canvas, [3, 3, 0]);

    const at = svgOf([3, 3, 0]);

    canvas.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: at.x, clientY: at.y }));
    expect(stereo.getScene().sections).toEqual([{ vertices: ['A', 'B', 'C'], fill: 'rgba(16, 185, 129, 0.25)', stroke: '#10b981' }]);
  });

  // ------------------------------------------- автоматический пунктир и шаблоны

  /** Пунктирные рёбра сцены строками «AB». */
  const dashedOf = (stereo: SceneEditor): string[] =>
    edgesOf(stereo)
      .filter((edge) => edge.style === 'dashed')
      .map((edge) => `${edge.from}${edge.to}`);

  const autoHiddenBox = (stereo: SceneEditor): HTMLInputElement => viewField(stereo, 'autoHidden');

  /** Первый элемент панели свойств по селектору; нет — тест падает. */
  const firstControl = (stereo: SceneEditor, selector: string): HTMLInputElement | HTMLSelectElement => {
    const control = propsOf(stereo).querySelector<HTMLInputElement | HTMLSelectElement>(selector);

    if (!control) throw new Error(`Нет ${selector}`);

    return control;
  };

  const templateField = (stereo: SceneEditor, key: string): HTMLInputElement | null =>
    propsOf(stereo).querySelector<HTMLInputElement>(`input[data-prop="template-${key}"]`);

  it('поворот на 180° вокруг вертикали переносит пунктир с рёбер A на рёбра C — числом и ползунком', () => {
    const stereo = create();
    const canvas = canvasOf(stereo);

    pickTemplate(stereo, 'parallelepiped');
    expect(dashedOf(stereo)).toEqual(['AB', 'DA', 'AA1']);
    expect(autoHiddenBox(stereo).checked).toBe(true);

    setValue(viewField(stereo, 'angleZ'), '150');
    expect(dashedOf(stereo)).toEqual(['BC', 'CD', 'CC1']);

    press(canvas, 'z', { ctrlKey: true });
    expect(dashedOf(stereo)).toEqual(['AB', 'DA', 'AA1']);

    // Ползунок пересчитывает пунктир на каждом кадре, отмена возвращает его вместе с видом.
    const slider = viewField(stereo, 'angleZRange');

    slider.value = '150';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    expect(dashedOf(stereo)).toEqual(['BC', 'CD', 'CC1']);
    slider.dispatchEvent(new Event('change', { bubbles: true }));
    press(canvas, 'z', { ctrlKey: true });
    expect(stereo.getScene().angleZ).toBe(-30);
    expect(dashedOf(stereo)).toEqual(['AB', 'DA', 'AA1']);

    // Вращение правой кнопкой — тоже на каждом кадре: 225 px — это 180°.
    pointerAt(canvas, 'pointerdown', EMPTY_CORNER, { button: 2 });
    pointerAt(canvas, 'pointermove', { x: EMPTY_CORNER.x + 100, y: EMPTY_CORNER.y }, { button: 2 });
    pointerAt(canvas, 'pointermove', { x: EMPTY_CORNER.x + 225, y: EMPTY_CORNER.y }, { button: 2 });
    expect(stereo.getScene().angleZ).toBe(150);
    expect(dashedOf(stereo)).toEqual(['BC', 'CD', 'CC1']);
    pointerAt(canvas, 'pointerup', { x: EMPTY_CORNER.x + 225, y: EMPTY_CORNER.y }, { button: 2 });
  });

  it('высота SO пирамиды, проведённая отрезком, сразу пунктирная', () => {
    const stereo = create();
    const canvas = canvasOf(stereo);

    pickTemplate(stereo, 'pyramid');
    pickTool(stereo, 'segment');
    clickVertex(canvas, [0, 0, 5.5]);
    clickVertex(canvas, [0, 0, 0]);

    expect(stereo.getScene().vertices).toMatchObject({ E: [0, 0, 0] });
    expect(edgesOf(stereo)).toContainEqual({ from: 'S', to: 'E', style: 'dashed' });
    expect(dashedOf(stereo)).toEqual(['AB', 'DA', 'SA', 'SE']);
  });

  it('ручной стиль ребра выключает автоматический пунктир, и поворот стили больше не трогает', () => {
    const stereo = create();
    const canvas = canvasOf(stereo);

    pickTemplate(stereo, 'pyramid');
    pickTool(stereo, 'select');
    clickVertex(canvas, [3, 0, 0]);
    setValue(firstControl(stereo, 'select'), 'dashed');
    press(canvas, 'Escape');
    expect(autoHiddenBox(stereo).checked).toBe(false);

    const before = dashedOf(stereo);

    expect(before).toEqual(['AB', 'BC', 'DA', 'SA']);
    setValue(viewField(stereo, 'angleZ'), '150');
    expect(dashedOf(stereo)).toEqual(before);
    press(canvas, 'ArrowLeft');
    expect(dashedOf(stereo)).toEqual(before);
  });

  it('load сцены со сплошными рёбрами флажок выключает; включение расставляет пунктир одним шагом', () => {
    const source = create();

    pickTemplate(source, 'cube');

    const solid = { ...source.getScene(), edges: edgesOf(source).map((edge) => ({ ...edge, style: 'solid' })) };

    source.destroy();

    const stereo = create();
    const canvas = canvasOf(stereo);

    stereo.load(solid);
    expect(autoHiddenBox(stereo).checked).toBe(false);
    // Пока ничего не трогали, сцена уходит такой, какой пришла.
    expect(stereo.getScene()).toEqual(solid);
    setValue(viewField(stereo, 'angleZ'), '0');
    expect(dashedOf(stereo)).toEqual([]);

    press(canvas, 'z', { ctrlKey: true });
    autoHiddenBox(stereo).click();
    expect(autoHiddenBox(stereo).checked).toBe(true);
    expect(dashedOf(stereo)).toEqual(['AB', 'DA', 'AA1']);

    // Флажок едет с историей: отмена выключает его и возвращает сплошные рёбра, повтор — наоборот.
    press(canvas, 'z', { ctrlKey: true });
    expect(dashedOf(stereo)).toEqual([]);
    expect(autoHiddenBox(stereo).checked).toBe(false);
    press(canvas, 'y', { ctrlKey: true });
    expect(dashedOf(stereo)).toEqual(['AB', 'DA', 'AA1']);
    expect(autoHiddenBox(stereo).checked).toBe(true);

    // Выключение — тоже шаг истории, стили при этом не меняются.
    autoHiddenBox(stereo).click();
    expect(autoHiddenBox(stereo).checked).toBe(false);
    expect(dashedOf(stereo)).toEqual(['AB', 'DA', 'AA1']);
    press(canvas, 'z', { ctrlKey: true });
    expect(autoHiddenBox(stereo).checked).toBe(true);
  });

  it('load сцены, построенной шаблоном, оставляет флажок включённым и сцену прежней', () => {
    ['cube', 'pyramid', 'cone', 'sphere', 'cylinder'].forEach((template) => {
      const source = create();

      pickTemplate(source, template);
      setValue(viewField(source, 'angleZ'), '40');

      const saved = source.getScene();

      source.destroy();

      const stereo = create();

      stereo.load(saved);
      expect(autoHiddenBox(stereo).checked).toBe(true);
      expect(stereo.getScene()).toEqual(saved);
      // Шаблон после load неизвестен: параметров нет.
      expect(templateField(stereo, 'radius') ?? templateField(stereo, 'edge')).toBeNull();
      stereo.destroy();
    });
  });

  it('поле параметра перестраивает фигуру одним шагом: призма 3 → 6 сторон, вид, сетка и оси остаются', () => {
    const stereo = create();
    const canvas = canvasOf(stereo);

    pickTemplate(stereo, 'prism');
    expect([...propsOf(stereo).querySelectorAll<HTMLInputElement>('input[data-prop^="template-"]')].map((input) => input.dataset.prop)).toEqual([
      'template-sides',
      'template-edge',
      'template-height',
    ]);
    setValue(viewField(stereo, 'angleZ'), '20');
    setValue(viewField(stereo, 'angleY'), '30');
    autoHiddenBox(stereo).click();
    propsOf(stereo).querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[0]?.click();
    propsOf(stereo).querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1]?.click();
    expect(autoHiddenBox(stereo).checked).toBe(false);

    setValue(viewField(stereo, 'template-sides'), '6');

    const scene = stereo.getScene();

    expect(Object.keys(scene.vertices as object)).toHaveLength(12);
    expect(scene.edges).toHaveLength(18);
    expect(scene.angleZ).toBe(20);
    expect(scene.angleY).toBe(30);
    expect(scene.showGrid).toBe(false);
    expect(scene.showAxes).toBe(true);
    expect(templateField(stereo, 'sides')?.value).toBe('6');
    // Перестроенная фигура снова размечена автоматически.
    expect(autoHiddenBox(stereo).checked).toBe(true);
    expect(dashedOf(stereo).length).toBeGreaterThan(0);

    // Значение за пределом упирается в него.
    setValue(viewField(stereo, 'template-sides'), '20');
    expect(Object.keys(stereo.getScene().vertices as object)).toHaveLength(16);
    expect(templateField(stereo, 'sides')?.value).toBe('8');

    // Отмена — к шести сторонам, ещё одна — к трём и к прежним параметрам в панели.
    press(canvas, 'z', { ctrlKey: true });
    expect(Object.keys(stereo.getScene().vertices as object)).toHaveLength(12);
    press(canvas, 'z', { ctrlKey: true });
    expect(Object.keys(stereo.getScene().vertices as object)).toEqual(['A', 'B', 'C', 'A1', 'B1', 'C1']);
    expect(templateField(stereo, 'sides')?.value).toBe('3');
  });

  it('вращение и флажки блок параметров не убирают, правка геометрии — убирает', () => {
    const stereo = create();
    const canvas = canvasOf(stereo);

    pickTemplate(stereo, 'pyramid');
    setValue(viewField(stereo, 'angleZ'), '60');
    propsOf(stereo).querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1]?.click();
    expect(templateField(stereo, 'height')?.value).toBe('5.5');

    setValue(viewField(stereo, 'template-height'), '8');
    expect(stereo.getScene().vertices).toMatchObject({ S: [0, 0, 8] });

    pickTool(stereo, 'point');
    clickVertex(canvas, [1, 1, 0], { angleY: 15, angleZ: 60 });
    press(canvas, 'Escape');
    expect(Object.keys(stereo.getScene().vertices as object)).toHaveLength(6);
    expect(templateField(stereo, 'height')).toBeNull();
    expect(propsOf(stereo).querySelector('.rte-builder__props-title')?.textContent).not.toBe('Размеры фигуры');

    // Отмена точки возвращает фигуру шаблона — и блок вместе с ней.
    press(canvas, 'z', { ctrlKey: true });
    expect(templateField(stereo, 'height')?.value).toBe('8');
  });

  it('конус и шар из шаблонов: в getScene, поле «Радиус» у центров, удаление центра удаляет тело', () => {
    const stereo = create();
    const canvas = canvasOf(stereo);

    pickTemplate(stereo, 'cone');
    expect(stereo.getScene().cones).toEqual([{ base: 'O', apex: 'S', radius: 3 }]);
    pickTool(stereo, 'select');
    clickVertex(canvas, [0, 0, 5.5]);
    expect(nameField(stereo)).toBe('S');
    setValue(viewField(stereo, 'radius'), '2');
    expect(stereo.getScene().cones).toEqual([{ base: 'O', apex: 'S', radius: 2 }]);
    clickVertex(canvas, [0, -3, 0]);
    expect(nameField(stereo)).toBe('A');
    expect(propsOf(stereo).querySelector('input[data-prop="radius"]')).toBeNull();

    clickVertex(canvas, [0, 0, 0]);
    expect(nameField(stereo)).toBe('O');
    setValue(firstControl(stereo, 'input[type="text"]'), 'Q');
    expect(stereo.getScene().cones).toEqual([{ base: 'Q', apex: 'S', radius: 2 }]);
    press(canvas, 'Delete');
    expect(stereo.getScene().cones).toBeUndefined();

    pickTemplate(stereo, 'sphere');
    expect(stereo.getScene().spheres).toEqual([{ center: 'O', radius: 3 }]);
    expect(stereo.getScene().cones).toBeUndefined();
    pickTool(stereo, 'select');
    clickVertex(canvas, [0, 0, 0]);
    setValue(viewField(stereo, 'radius'), '4.5');
    expect(stereo.getScene().spheres).toEqual([{ center: 'O', radius: 4.5 }]);
    // Ноль и мусор радиус не меняют.
    setValue(viewField(stereo, 'radius'), '0');
    expect(stereo.getScene().spheres).toEqual([{ center: 'O', radius: 4.5 }]);
    setValue(firstControl(stereo, 'input[type="text"]'), 'P');
    expect(stereo.getScene().spheres).toEqual([{ center: 'P', radius: 4.5 }]);
    pickTool(stereo, 'delete');
    clickVertex(canvas, [0, 0, 0]);
    expect(stereo.getScene().spheres).toBeUndefined();

    // Цилиндр: удаление центра основания удаляет и его.
    pickTemplate(stereo, 'cylinder');
    pickTool(stereo, 'select');
    clickVertex(canvas, [0, 0, 5.5]);
    expect(nameField(stereo)).toBe('O2');
    expect(viewField(stereo, 'radius').value).toBe('3');
    press(canvas, 'Delete');
    expect(stereo.getScene().cylinders).toBeUndefined();
  });

  it('у вершины нескольких тел — поле радиуса на каждое', () => {
    const stereo = create();
    const canvas = canvasOf(stereo);

    stereo.load({
      type: '3d',
      vertices: { O: [0, 0, 0], S: [0, 0, 4], T: [0, 0, -4] },
      edges: [['S', 'T']],
      cones: [
        { base: 'O', apex: 'S', radius: 2 },
        { base: 'O', apex: 'T', radius: 1 },
      ],
      spheres: [{ center: 'O', radius: 1.5 }],
    });
    view = fittedViewport(stereo);
    pickTool(stereo, 'select');
    clickVertex(canvas, [0, 0, 0]);
    expect(nameField(stereo)).toBe('O');

    const radii = (): HTMLInputElement[] => [...propsOf(stereo).querySelectorAll<HTMLInputElement>('input[data-prop="radius"]')];
    const [, second] = radii();

    expect(radii().map((input) => input.value)).toEqual(['2', '1', '1.5']);
    expect(second).toBeDefined();
    if (second) setValue(second, '2.5');
    expect(stereo.getScene().cones).toEqual([
      { base: 'O', apex: 'S', radius: 2 },
      { base: 'O', apex: 'T', radius: 2.5 },
    ]);
  });

  it('оболочка сцены с шаром считается один раз на геометрию, а не на кадр вращения', () => {
    const stereo = create();
    const canvas = canvasOf(stereo);
    const calls = vi.mocked(supportPlanes);

    pickTemplate(stereo, 'sphere');
    calls.mockClear();

    pointerAt(canvas, 'pointerdown', EMPTY_CORNER, { button: 2 });
    Array.from({ length: 30 }, (_, index) => index + 1).forEach((step) => {
      pointerAt(canvas, 'pointermove', { x: EMPTY_CORNER.x + step * 8, y: EMPTY_CORNER.y + step }, { button: 2 });
    });
    pointerAt(canvas, 'pointerup', { x: EMPTY_CORNER.x + 240, y: EMPTY_CORNER.y + 30 }, { button: 2 });
    expect(stereo.getScene().angleZ).not.toBe(-30);
    expect(calls).not.toHaveBeenCalled();
    // Радиус шара OA — внутри тела при любом виде.
    expect(dashedOf(stereo)).toEqual(['OA']);

    // Правка геометрии — один пересчёт.
    pickTool(stereo, 'select');
    const { angleY, angleZ } = stereo.getScene();

    clickVertex(canvas, [0, 0, 0], { angleY: Number(angleY), angleZ: Number(angleZ) });
    setValue(viewField(stereo, 'radius'), '4');
    expect(calls).toHaveBeenCalledTimes(1);
  });

  it('перестроение шаблона очищает черновик: отрезок не тянется к исчезнувшей вершине', () => {
    const stereo = create();
    const canvas = canvasOf(stereo);

    pickTemplate(stereo, 'prism');
    setValue(viewField(stereo, 'template-sides'), '6');
    view = fittedViewport(stereo);
    pickTool(stereo, 'segment');
    clickVertex(canvas, vertexOf(stereo, 'F') ?? []);
    setValue(viewField(stereo, 'template-sides'), '4');
    view = fittedViewport(stereo);
    clickVertex(canvas, vertexOf(stereo, 'A') ?? []);
    // Второй клик — по C: отрезок A–C начат заново, а не от F.
    clickVertex(canvas, vertexOf(stereo, 'C') ?? []);

    const scene = stereo.getScene();
    const names = Object.keys(scene.vertices as object);

    expect(names).not.toContain('F');
    edgesOf(stereo).forEach((edge) => {
      expect(names).toContain(edge.from);
      expect(names).toContain(edge.to);
    });
    expect(scene.sections).toBeUndefined();
    expect(hasEdge(edgesOf(stereo), 'A', 'C')).toBe(true);
    expect(edgesOf(stereo)).toHaveLength(13);
  });

  it('отмена шаблона возвращает и выключенный флажок: поворот ручную разметку не трогает', () => {
    const stereo = create();
    const canvas = canvasOf(stereo);

    stereo.load(PYRAMID);
    expect(autoHiddenBox(stereo).checked).toBe(false);
    pickTemplate(stereo, 'cube');
    expect(autoHiddenBox(stereo).checked).toBe(true);
    press(canvas, 'z', { ctrlKey: true });
    expect(autoHiddenBox(stereo).checked).toBe(false);

    const marked = edgesOf(stereo);

    setValue(viewField(stereo, 'angleZ'), '150');
    expect(edgesOf(stereo)).toEqual(marked);
    expect(dashedOf(stereo)).toEqual(['DA', 'SD']);
  });

  it('тела вращения без правок возвращаются как пришли; правка радиуса и имени не теряет чужих полей', () => {
    const stereo = create();
    const canvas = canvasOf(stereo);
    const bodies = {
      cones: [{ base: 'O', apex: 'S', radius: 2.345, color: '#f00' }],
      spheres: [{ center: 'O' }],
      cylinders: [{ base: 'O', top: 'S', radius: 1.111, note: 'x' }],
    };

    stereo.load({ type: '3d', vertices: { O: [0, 0, 0], S: [0, 0, 4] }, edges: [['O', 'S']], angleY: 15, angleZ: -30, ...bodies });
    expect(stereo.getScene()).toMatchObject(bodies);
    expect(stereo.getScene().cones).toEqual(bodies.cones);
    expect(stereo.getScene().spheres).toEqual(bodies.spheres);
    expect(stereo.getScene().cylinders).toEqual(bodies.cylinders);

    view = fittedViewport(stereo);
    pickTool(stereo, 'select');
    clickVertex(canvas, [0, 0, 4]);
    expect(nameField(stereo)).toBe('S');

    // У S — цилиндр и конус: поле на каждое, по порядку тел.
    const [cylinderRadius, coneRadius] = [...propsOf(stereo).querySelectorAll<HTMLInputElement>('input[data-prop="radius"]')];

    expect([cylinderRadius?.value, coneRadius?.value]).toEqual(['1.11', '2.35']);
    if (coneRadius) setValue(coneRadius, '3.456');
    expect(stereo.getScene().cones).toEqual([{ base: 'O', apex: 'S', radius: 3.46, color: '#f00' }]);
    expect(stereo.getScene().cylinders).toEqual(bodies.cylinders);

    setValue(firstControl(stereo, 'input[type="text"]'), 'T');
    expect(stereo.getScene().cones).toEqual([{ base: 'O', apex: 'T', radius: 3.46, color: '#f00' }]);
    expect(stereo.getScene().cylinders).toEqual([{ base: 'O', top: 'T', radius: 1.111, note: 'x' }]);
    expect(stereo.getScene().spheres).toEqual([{ center: 'O' }]);

    // Тела не массивом конструктор не разбирает и возвращает как есть.
    stereo.load({ ...PYRAMID, cones: 'oops', spheres: { center: 'S' } });
    expect(stereo.getScene().cones).toBe('oops');
    expect(stereo.getScene().spheres).toEqual({ center: 'S' });
  });

  it('прямой угол, переставший быть прямым после перестроения, рисуется одной дугой', () => {
    const stereo = create();
    const canvas = canvasOf(stereo);

    pickTemplate(stereo, 'pyramid');
    pickTool(stereo, 'angle');
    setValue(firstControl(stereo, 'input[placeholder="SOH"]'), 'BAD');
    expect(stereo.getScene().angles).toEqual([{ points: ['B', 'A', 'D'], style: 'right' }]);
    press(canvas, 'Escape');

    // Высота угол при основании не меняет — он остаётся прямым.
    setValue(viewField(stereo, 'template-height'), '7');
    expect(stereo.getScene().angles).toEqual([{ points: ['B', 'A', 'D'], style: 'right' }]);
    setValue(viewField(stereo, 'template-sides'), '5');
    expect(stereo.getScene().angles).toEqual([{ points: ['B', 'A', 'D'], style: 'single' }]);
  });

  it('радиус и длина проверяются после округления: 0,004 и 0,001 сцену не меняют', () => {
    const stereo = create();
    const canvas = canvasOf(stereo);

    pickTemplate(stereo, 'sphere');
    pickTool(stereo, 'select');
    clickVertex(canvas, [0, 0, 0]);
    setValue(viewField(stereo, 'radius'), '0.004');
    expect(stereo.getScene().spheres).toEqual([{ center: 'O', radius: 3 }]);
    expect(viewField(stereo, 'radius').value).toBe('3');

    pickTemplate(stereo, 'parallelepiped');
    pickTool(stereo, 'select');
    clickVertex(canvas, [3, 0, 0]);

    const before = stereo.getScene();

    setValue(lengthField(stereo), '0.001');
    expect(stereo.getScene()).toEqual(before);
    expect(lengthField(stereo).value).toBe('6');
  });

  it('load плоской заготовки с пунктиром флажок выключает: вершина над плоскостью разметку не трогает', () => {
    const stereo = create();
    const canvas = canvasOf(stereo);
    const flat = {
      type: '3d',
      vertices: { A: [0, 0, 0], B: [4, 0, 0], C: [4, 3, 0], D: [0, 3, 0] },
      edges: [['A', 'B'], ['B', 'C'], ['C', 'D'], { from: 'D', to: 'A', style: 'dashed' }],
      angleY: 15,
      angleZ: -30,
    };

    stereo.load(flat);
    view = fittedViewport(stereo);
    expect(autoHiddenBox(stereo).checked).toBe(false);

    const marked = edgesOf(stereo);

    pickTool(stereo, 'point');
    setValue(viewField(stereo, 'pointHeight'), '3');
    clickVertex(canvas, [2, 1.5, 3]);
    expect(vertexOf(stereo, 'E')).toEqual([2, 1.5, 3]);
    pickTool(stereo, 'segment');
    clickVertex(canvas, [0, 0, 0]);
    clickVertex(canvas, [2, 1.5, 3]);
    expect(edgesOf(stereo).slice(0, 4)).toEqual(marked);
    expect(edgesOf(stereo)).toHaveLength(5);

    // Без пунктира плоская заготовка размечается сама, как только появится объём.
    stereo.load({ ...flat, edges: flat.edges.slice(0, 3) });
    expect(autoHiddenBox(stereo).checked).toBe(true);
  });

  // --------------------------------------------------------- величина угла

  /** Величина угла S–A–C пирамиды из шаблона высоты `h`: наклон SA к диагонали основания. */
  const pyramidAngle = (h: number): string => formatAngleMeasure((Math.atan(h / (3 * Math.SQRT2)) * 180) / Math.PI);

  const anglesOf = (stereo: SceneEditor): Array<Record<string, unknown>> => (stereo.getScene().angles ?? []) as Array<Record<string, unknown>>;

  /** Клик внутри сектора угла в 26 px от вершины — дальше радиуса попадания в неё: так угол выбирается на полотне. */
  const clickAngle = (canvas: HTMLElement, a: Point, vertex: Point, b: Point): void => {
    const [from, at, to] = [a, vertex, b].map((point) => svgOf(point));

    if (!from || !at || !to) return;

    const unit = (point: At): At => {
      const length = Math.hypot(point.x - at.x, point.y - at.y);

      return { x: (point.x - at.x) / length, y: (point.y - at.y) / length };
    };
    const [u, w] = [unit(from), unit(to)];
    const sum = { x: (u?.x ?? 0) + (w?.x ?? 0), y: (u?.y ?? 0) + (w?.y ?? 0) };
    const length = Math.hypot(sum.x, sum.y);

    clickAt(canvas, { x: at.x + (sum.x / length) * 26, y: at.y + (sum.y / length) * 26 });
  };

  /** Пирамида из шаблона с углом S–A–C, введённым буквами; угол остаётся выделенным. */
  const pyramidWithAngle = (stereo: SceneEditor): void => {
    pickTemplate(stereo, 'pyramid');
    pickTool(stereo, 'angle');
    setValue(firstControl(stereo, 'input[placeholder="SOH"]'), 'SAC');
  };

  it('новый наклонный угол подписан величиной в пространстве, прямой — уголком без подписи', () => {
    const stereo = create();

    pyramidWithAngle(stereo);
    expect(anglesOf(stereo)).toEqual([{ points: ['S', 'A', 'C'], style: 'single', label: pyramidAngle(5.5) }]);
    expect(pyramidAngle(5.5)).toBe('52,4°');
    // Панель: величина только для чтения, флажок включён, подпись руками не правится.
    expect(viewField(stereo, 'angleValue').value).toBe('52,4°');
    expect(viewField(stereo, 'angleValue').readOnly).toBe(true);
    expect(viewField(stereo, 'angleMeasure').checked).toBe(true);
    expect(firstControl(stereo, 'input[placeholder="30°"]').disabled).toBe(true);

    press(canvasOf(stereo), 'Escape');
    setValue(firstControl(stereo, 'input[placeholder="SOH"]'), 'BAD');
    expect(anglesOf(stereo)[1]).toEqual({ points: ['B', 'A', 'D'], style: 'right' });
    expect(viewField(stereo, 'angleMeasure').checked).toBe(false);
    expect(firstControl(stereo, 'input[placeholder="30°"]').disabled).toBe(false);
  });

  it('подпись-величина следует за вершиной и за параметром шаблона, блок параметров остаётся', () => {
    const stereo = create();
    const canvas = canvasOf(stereo);

    pyramidWithAngle(stereo);
    press(canvas, 'Escape');
    setValue(viewField(stereo, 'template-height'), '8');
    expect(anglesOf(stereo)[0]?.label).toBe(pyramidAngle(8));
    expect(pyramidAngle(8)).toBe('62,1°');
    expect(viewField(stereo, 'template-height').value).toBe('8');

    // Перемещение вершины — координатой в панели и мышью с Alt.
    view = fittedViewport(stereo);
    pickTool(stereo, 'select');
    clickVertex(canvas, [0, 0, 8]);
    setValue(firstControl(stereo, 'input[data-axis="z"]'), '3');
    expect(anglesOf(stereo)[0]?.label).toBe(pyramidAngle(3));

    const top = svgOf([0, 0, 3]);
    const lifted = svgOf([0, 0, 4]);

    dragFrom(canvas, top, lifted, { altKey: true });
    expect(vertexOf(stereo, 'S')).toEqual([0, 0, 4]);
    expect(anglesOf(stereo)[0]?.label).toBe(pyramidAngle(4));

    // Отмена возвращает прежнюю подпись вместе с геометрией.
    press(canvas, 'z', { ctrlKey: true });
    expect(anglesOf(stereo)[0]?.label).toBe(pyramidAngle(3));
  });

  it('выключенный флажок оставляет подпись текстом; ручная «α» правками геометрии не меняется', () => {
    const stereo = create();
    const canvas = canvasOf(stereo);

    pyramidWithAngle(stereo);
    viewField(stereo, 'angleMeasure').click();
    expect(viewField(stereo, 'angleMeasure').checked).toBe(false);
    expect(anglesOf(stereo)[0]?.label).toBe('52,4°');
    press(canvas, 'Escape');
    setValue(viewField(stereo, 'template-height'), '8');
    expect(anglesOf(stereo)[0]?.label).toBe('52,4°');

    // Отмена возвращает и флажок: подпись снова ведётся и следует за высотой.
    press(canvas, 'z', { ctrlKey: true });
    press(canvas, 'z', { ctrlKey: true });
    expect(anglesOf(stereo)[0]?.label).toBe('52,4°');
    setValue(viewField(stereo, 'template-height'), '5');
    expect(anglesOf(stereo)[0]?.label).toBe(pyramidAngle(5));

    view = fittedViewport(stereo);
    pickTool(stereo, 'select');
    clickAngle(canvas, [0, 0, 5], [-3, -3, 0], [3, 3, 0]);
    expect(viewField(stereo, 'angleMeasure').checked).toBe(true);
    viewField(stereo, 'angleMeasure').click();
    setValue(firstControl(stereo, 'input[placeholder="30°"]'), 'α');
    expect(anglesOf(stereo)[0]?.label).toBe('α');
    press(canvas, 'Escape');
    setValue(viewField(stereo, 'template-height'), '8');
    expect(anglesOf(stereo)[0]?.label).toBe('α');

    // Включение флажка снова пишет величину одним шагом.
    view = fittedViewport(stereo);
    clickAngle(canvas, [0, 0, 8], [-3, -3, 0], [3, 3, 0]);
    viewField(stereo, 'angleMeasure').click();
    expect(anglesOf(stereo)[0]?.label).toBe('62,1°');
    press(canvas, 'z', { ctrlKey: true });
    expect(anglesOf(stereo)[0]?.label).toBe('α');
  });

  it('load: подпись, равная величине, ведётся дальше; чужая «45°» у угла в 60° остаётся; сцена без правок прежняя', () => {
    const stereo = create();
    const canvas = canvasOf(stereo);
    // Правильный тетраэдр без одной вершины: угол B–A–C ровно 60°.
    const scene = {
      type: '3d',
      vertices: { A: [0, 0, 0], B: [4, 0, 0], C: [2, 3.46, 0], S: [2, 1.15, 3.27] },
      edges: [['A', 'B'], ['B', 'C'], ['C', 'A'], ['S', 'A'], ['S', 'B'], ['S', 'C']],
      angles: [
        { points: ['B', 'A', 'C'], style: 'single', label: '60 °' },
        { points: ['C', 'B', 'A'], style: 'double', label: '45°' },
      ],
      angleY: 15,
      angleZ: -30,
    };

    stereo.load(scene);
    expect(stereo.getScene().angles).toEqual(scene.angles);
    view = fittedViewport(stereo);
    pickTool(stereo, 'select');
    clickAngle(canvas, [4, 0, 0], [0, 0, 0], [2, 3.46, 0]);
    expect(viewField(stereo, 'angleMeasure').checked).toBe(true);
    clickAngle(canvas, [2, 3.46, 0], [4, 0, 0], [0, 0, 0]);
    expect(viewField(stereo, 'angleMeasure').checked).toBe(false);
    expect(viewField(stereo, 'angleValue').value).toBe('60°');

    // Правка геометрии: первая подпись — новая величина, чужие не трогаются.
    clickVertex(canvas, [2, 3.46, 0]);
    setValue(firstControl(stereo, 'input[data-axis="y"]'), '4');

    const angles = anglesOf(stereo);

    expect(angles[0]?.label).toBe(formatAngleMeasure((Math.atan2(4, 2) * 180) / Math.PI));
    expect(angles[1]?.label).toBe('45°');
    angles.forEach((angle) => expect(angle).not.toHaveProperty('measured'));
  });

  // ------------------------------------------------------------ длина ребра

  const lengthField = (stereo: SceneEditor): HTMLInputElement => viewField(stereo, 'length');

  const lengthEnd = (stereo: SceneEditor): HTMLSelectElement => {
    const select = propsOf(stereo).querySelector<HTMLSelectElement>('select[data-prop="lengthEnd"]');

    if (!select) throw new Error('Нет выбора подвижного конца');

    return select;
  };

  const distanceOf = (stereo: SceneEditor, a: string, b: string): number => {
    const from = vertexOf(stereo, a) ?? [];
    const to = vertexOf(stereo, b) ?? [];

    return Math.hypot((to[0] ?? 0) - (from[0] ?? 0), (to[1] ?? 0) - (from[1] ?? 0), (to[2] ?? 0) - (from[2] ?? 0));
  };

  it('длина выбранного ребра: второй конец едет вдоль отрезка, первый стоит; отмена — одним шагом', () => {
    const stereo = create();
    const canvas = canvasOf(stereo);

    pickTemplate(stereo, 'parallelepiped');
    pickTool(stereo, 'select');
    // Середина ребра B–C.
    clickVertex(canvas, [3, 0, 0]);
    expect(lengthField(stereo).value).toBe('6');
    expect(lengthEnd(stereo).value).toBe('to');
    expect([...lengthEnd(stereo).options].map((option) => option.textContent)).toEqual(['B', 'C']);

    setValue(lengthField(stereo), '10');
    expect(vertexOf(stereo, 'B')).toEqual([3, -3, 0]);
    expect(vertexOf(stereo, 'C')).toEqual([3, 7, 0]);
    expect(Math.abs(distanceOf(stereo, 'B', 'C') - 10)).toBeLessThan(0.02);
    // Выделение осталось на ребре, поле показывает новую длину.
    expect(lengthField(stereo).value).toBe('10');
    // Блок параметров исчез: геометрию правили.
    press(canvas, 'Escape');
    expect(templateField(stereo, 'depth')).toBeNull();

    press(canvas, 'z', { ctrlKey: true });
    expect(vertexOf(stereo, 'C')).toEqual([3, 3, 0]);
    expect(vertexOf(stereo, 'B')).toEqual([3, -3, 0]);
  });

  it('подвижным концом можно выбрать первый; выбор сбрасывается со сменой выделения', () => {
    const stereo = create();
    const canvas = canvasOf(stereo);

    pickTemplate(stereo, 'parallelepiped');
    pickTool(stereo, 'select');
    clickVertex(canvas, [3, 0, 0]);
    setValue(lengthEnd(stereo), 'from');
    setValue(lengthField(stereo), '9');
    expect(vertexOf(stereo, 'C')).toEqual([3, 3, 0]);
    expect(vertexOf(stereo, 'B')).toEqual([3, -6, 0]);
    // Пока выделение то же, выбор конца держится.
    expect(lengthEnd(stereo).value).toBe('from');
    setValue(lengthField(stereo), '8');
    expect(vertexOf(stereo, 'B')).toEqual([3, -5, 0]);

    clickAt(canvas, EMPTY_CORNER);
    clickVertex(canvas, [3, -1, 0]);
    expect(lengthEnd(stereo).value).toBe('to');
  });

  it('ноль, отрицательная и пустая длина сцену не меняют, поле показывает прежнюю', () => {
    const stereo = create();
    const canvas = canvasOf(stereo);

    pickTemplate(stereo, 'parallelepiped');
    pickTool(stereo, 'select');
    clickVertex(canvas, [3, 0, 0]);

    const before = stereo.getScene();
    let changes = 0;

    stereo.onChange(() => {
      changes += 1;
    });
    ['0', '-3', '', 'abc'].forEach((value) => {
      const field = lengthField(stereo);

      setValue(field, value);
      expect(field.value).toBe('6');
    });
    expect(stereo.getScene()).toEqual(before);
    expect(changes).toBe(0);
  });

  it('поле показывает длину в пространстве, а не длину проекции', () => {
    const stereo = create();
    const canvas = canvasOf(stereo);

    pickTemplate(stereo, 'pyramid');
    pickTool(stereo, 'select');
    // Середина бокового ребра S–C.
    clickVertex(canvas, [1.5, 1.5, 2.75]);

    const scene = stereo.getScene();
    const target = (scene.edges as Edge[]).find((edge) => edge.from === 'S' && edge.to === 'C');

    expect(target).toBeDefined();
    expect(lengthField(stereo).value).toBe(String(Math.round(Math.sqrt(9 + 9 + 5.5 * 5.5) * 100) / 100));
    expect(lengthField(stereo).value).toBe('6.95');

    // Новая длина откладывается вдоль наклонного ребра: C едет к S.
    setValue(lengthField(stereo), '3.5');
    expect(Math.abs(distanceOf(stereo, 'S', 'C') - 3.5)).toBeLessThan(0.02);
    expect(vertexOf(stereo, 'S')).toEqual([0, 0, 5.5]);
  });
});

describe('проекция стереометрии', () => {
  it('обратная проекция на плоскость z = 0 обращает прямую', () => {
    const views = [
      { angleY: 15, angleZ: -30 },
      { angleY: 0, angleZ: 0 },
      { angleY: 60, angleZ: 45 },
      { angleY: -80, angleZ: 170 },
    ];
    const points: Array<[number, number]> = [
      [0, 0],
      [1, 2],
      [-3, 0.5],
      [2.5, -4],
    ];

    views.forEach(({ angleY, angleZ }) => {
      points.forEach(([x, y]) => {
        const at = projectVertex([x, y, 0], angleY, angleZ, VIEWPORT);
        const plane: [number, number] = [(at.x - VIEWPORT.cx) / VIEWPORT.scale, (VIEWPORT.cy - at.y) / VIEWPORT.scale];
        const [bx, by] = unprojectToGround(plane, angleY, angleZ);

        expect(bx).toBeCloseTo(x, 6);
        expect(by).toBeCloseTo(y, 6);
      });
    });
  });

  it('обратная проекция на плоскость z = const обращает прямую', () => {
    const views = [
      { angleY: 15, angleZ: -30 },
      { angleY: 0, angleZ: 0 },
      { angleY: 60, angleZ: 45 },
      { angleY: -80, angleZ: 170 },
    ];
    const points: Array<[number, number, number]> = [
      [0, 0, 2],
      [1, 2, -1.5],
      [-3, 0.5, 5.5],
      [2.5, -4, 0],
    ];

    views.forEach(({ angleY, angleZ }) => {
      points.forEach(([x, y, z]) => {
        const at = projectVertex([x, y, z], angleY, angleZ, VIEWPORT);
        const plane: [number, number] = [(at.x - VIEWPORT.cx) / VIEWPORT.scale, (VIEWPORT.cy - at.y) / VIEWPORT.scale];
        const [bx, by] = unprojectToHeight(plane, z, angleY, angleZ);

        expect(bx).toBeCloseTo(x, 6);
        expect(by).toBeCloseTo(y, 6);
      });
    });
  });

  it('плоскость, видимая с ребра, даёт конечную точку', () => {
    // При tg(angleY) = −cos45°·0,5 проекция плоскости z = 0 вырождается в прямую.
    const degenerate = (-Math.atan(Math.cos(Math.PI / 4) * 0.5) * 180) / Math.PI;
    const [x, y] = unprojectToGround([2, 1], degenerate, 30);

    expect(Number.isFinite(x)).toBe(true);
    expect(Number.isFinite(y)).toBe(true);
    expect(Math.hypot(x, y)).toBeCloseTo(2, 6);
  });

  it('разбирает имена вершин угла из текста', () => {
    const names = ['S', 'O', 'H', 'A1', 'B'];

    expect(parseAngleVertices('SOH', names)).toEqual(['S', 'O', 'H']);
    expect(parseAngleVertices('soh', names)).toEqual(['S', 'O', 'H']);
    expect(parseAngleVertices('SA1B', names)).toEqual(['S', 'A1', 'B']);
    expect(parseAngleVertices('S, O, A1', names)).toEqual(['S', 'O', 'A1']);
    expect(parseAngleVertices('SOS', names)).toBeNull();
    expect(parseAngleVertices('SO', names)).toBeNull();
    expect(parseAngleVertices('XYZ', names)).toBeNull();
  });
});

describe('сообщения конструктора стереометрии', () => {
  // Подписи шаблонов и их полей живут в построителях шаблонов.
  const source = ['stereometry-editor.ts', 'stereo-templates.ts']
    .map((file) => readFileSync(resolve(process.cwd(), 'packages/editor-drawings/src/builders', file), 'utf8'))
    .join('\n');

  it('английская таблица повторяет набор ключей русской', () => {
    expect(Object.keys(STEREOMETRY_MESSAGES.en).sort()).toEqual(Object.keys(STEREOMETRY_MESSAGES.ru).sort());
  });

  it('все ключи с префиксом drawings_stereo_ и читаются кодом конструктора и шаблонов целиком', () => {
    Object.keys(STEREOMETRY_MESSAGES.ru).forEach((key) => {
      expect(key.startsWith('drawings_stereo_')).toBe(true);
      expect(source.includes(`'${key}'`)).toBe(true);
    });
  });

  it('влита в таблицы возможности: диалог переводит её ключи', () => {
    Object.keys(STEREOMETRY_MESSAGES.ru).forEach((key) => {
      expect(DRAWINGS_MESSAGES.ru[key]).toBe(STEREOMETRY_MESSAGES.ru[key]);
    });
  });
});
