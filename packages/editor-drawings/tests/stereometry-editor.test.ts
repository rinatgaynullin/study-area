import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Translate } from '@rich-editor/core';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  STEREOMETRY_CANVAS,
  parseAngleVertices,
  projectVertex,
  stereometryEditorFactory,
  unprojectToGround,
  unprojectToHeight,
} from '../src/builders/stereometry-editor';
import { STEREOMETRY_MESSAGES } from '../src/builders/stereometry-messages';
import type { SceneEditor } from '../src/builders/types';
import { DRAWINGS_MESSAGES } from '../src/messages';
import { project3dToPlane, type Viewport } from '../src/render/coords';
import { resolveGeometryViewport } from '../src/render/geometry-svg';
import { normalizeGeometryScene } from '../src/scene/normalize';
import type { Point } from '../src/scene/types';

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
    expect(stereo.element.querySelector('.rte-builder__hint')?.textContent).toContain('Тяните пустое место');
  });

  it('шаблоны дают ожидаемые вершины, рёбра и цилиндр', () => {
    const stereo = create();
    const expectations: Array<[string, string[], number]> = [
      ['pyramid3', ['A', 'B', 'C', 'S'], 6],
      ['pyramid4', ['A', 'B', 'C', 'D', 'S'], 8],
      ['prism3', ['A', 'B', 'C', 'A1', 'B1', 'C1'], 9],
      ['parallelepiped', ['A', 'B', 'C', 'D', 'A1', 'B1', 'C1', 'D1'], 12],
    ];

    expectations.forEach(([template, names, edgeCount]) => {
      pickTemplate(stereo, template);

      const scene = stereo.getScene();

      expect(Object.keys(scene.vertices as object)).toEqual(names);
      expect(scene.edges).toHaveLength(edgeCount);
      expect(scene.angleY).toBe(15);
      expect(scene.angleZ).toBe(-30);
      expect(scene.cylinders).toBeUndefined();
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

    pickTemplate(stereo, 'pyramid4');
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
    pickTemplate(stereo, 'pyramid4');
    pickTool(stereo, 'point');
    clickVertex(canvas, [-1, 1, 0]);
    expect(stereo.getScene().vertices).toMatchObject({ E: [-1, 1, 0] });
    expect(stereo.getScene().labels).toMatchObject({ E: 'below right' });
  });

  it('отрезок строится двумя кликами по вершинам', () => {
    const stereo = create();
    const canvas = canvasOf(stereo);

    pickTemplate(stereo, 'pyramid4');
    pickTool(stereo, 'segment');
    clickVertex(canvas, [-3, -3, 0]);
    clickVertex(canvas, [3, 3, 0]);

    const edges = edgesOf(stereo);

    expect(edges).toHaveLength(9);
    expect(edges).toContainEqual({ from: 'A', to: 'C', style: 'solid' });

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

    pickTemplate(stereo, 'pyramid4');
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

    expect(angles[2]).toEqual({ points: ['C1', 'A', 'C'], style: 'single' });

    const [style] = propsOf(stereo).querySelectorAll('select');
    const label = propsOf(stereo).querySelector<HTMLInputElement>('input[type="text"]');

    setValue(style, 'double');
    setValue(label!, '60°');
    expect((stereo.getScene().angles as unknown[])[2]).toEqual({ points: ['C1', 'A', 'C'], style: 'double', label: '60°' });
  });

  it('вращение правой кнопкой меняет angleZ и angleY с ограничением ±85 и одной записью в истории', () => {
    const stereo = create();
    const canvas = canvasOf(stereo);
    let changes = 0;

    pickTemplate(stereo, 'pyramid4');
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

    pickTemplate(stereo, 'pyramid4');
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

    pickTemplate(stereo, 'pyramid4');
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

    expect([...checkboxes()].map((box) => box.checked)).toEqual([true, false]);
    checkboxes()[0].click();
    expect(stereo.getScene().showGrid).toBe(false);
    checkboxes()[1].click();
    expect(stereo.getScene().showAxes).toBe(true);
    expect([...checkboxes()].map((box) => box.checked)).toEqual([false, true]);
  });

  it('удаление вершины чистит рёбра, сечения, углы и подпись', () => {
    const stereo = create();
    const canvas = canvasOf(stereo);

    pickTemplate(stereo, 'pyramid4');
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

  it('перетаскивание пустого места основной кнопкой вращает вид; отмена — одним шагом', () => {
    const stereo = create();
    const canvas = canvasOf(stereo);
    let changes = 0;

    pickTemplate(stereo, 'pyramid4');
    stereo.onChange(() => {
      changes += 1;
    });

    pointerAt(canvas, 'pointerdown', EMPTY_CORNER);
    // В пределах порога это ещё клик: вид прежний.
    pointerAt(canvas, 'pointermove', { x: 8, y: 7 });
    expect(stereo.getScene().angleZ).toBe(-30);
    expect(stereo.element.classList.contains('rte-stereo--rotating')).toBe(false);
    // Порог пройден: дельты считаются отсюда, поэтому рывка нет.
    pointerAt(canvas, 'pointermove', { x: 16, y: 6 });
    expect(stereo.getScene().angleZ).toBe(-30);
    expect(stereo.element.classList.contains('rte-stereo--rotating')).toBe(true);
    pointerAt(canvas, 'pointermove', { x: 26, y: 16 });
    expect(stereo.getScene().angleZ).toBeCloseTo(-22);
    expect(stereo.getScene().angleY).toBeCloseTo(23);
    // Числа и ползунки «Вида» идут за вращением, панель не пересобирается.
    expect(viewField(stereo, 'angleZ').value).toBe('-22');
    expect(viewField(stereo, 'angleZRange').value).toBe('-22');
    expect(viewField(stereo, 'angleY').value).toBe('23');
    expect(changes).toBe(0);

    pointerAt(canvas, 'pointerup', { x: 26, y: 16 });
    expect(stereo.element.classList.contains('rte-stereo--rotating')).toBe(false);
    expect(changes).toBe(1);
    expect(Object.keys(stereo.getScene().vertices as object)).toHaveLength(5);

    press(canvas, 'z', { ctrlKey: true });
    expect(stereo.getScene().angleY).toBe(15);
    expect(stereo.getScene().angleZ).toBe(-30);
  });

  it('в «Точке» клик без движения ставит точку, а перетаскивание вращает и точку не ставит', () => {
    const stereo = create();
    const canvas = canvasOf(stereo);

    pickTool(stereo, 'point');
    clickVertex(canvas, [1, 2, 0]);
    expect(stereo.getScene().vertices).toEqual({ A: [1, 2, 0] });

    const from = svgOf([-3, -3, 0]);

    // Порог пройден на середине пути (+20 px), дальше ещё 20 px — это 16°.
    dragFrom(canvas, from, { x: from.x + 40, y: from.y });
    expect(stereo.getScene().vertices).toEqual({ A: [1, 2, 0] });
    expect(stereo.getScene().angleZ).toBeCloseTo(-14);
  });

  it('клик по пустому месту в «Выборе» снимает выделение', () => {
    const stereo = create();
    const canvas = canvasOf(stereo);

    pickTemplate(stereo, 'pyramid4');
    pickTool(stereo, 'select');
    clickVertex(canvas, [3, 0, 0]);
    expect(propsOf(stereo).querySelector('select')).not.toBeNull();

    clickAt(canvas, EMPTY_CORNER);
    expect(propsOf(stereo).querySelector('.rte-builder__props-title')?.textContent).toBe('Вид');
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

    pickTemplate(stereo, 'pyramid4');
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

    pickTemplate(stereo, 'pyramid4');
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
    pickTemplate(stereo, 'pyramid4');
    pointerAt(canvas, 'pointermove', EMPTY_CORNER);
    expect(canvas.querySelector('.rte-sketch__overlay line')).toBeNull();
    expect(viewField(stereo, 'pointHeight').value).toBe('0');
  });

  it('после шаблона все вершины лежат внутри полотна', () => {
    const stereo = create();
    const canvas = canvasOf(stereo);

    ['pyramid3', 'pyramid4', 'prism3', 'parallelepiped', 'cylinder'].forEach((template) => {
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

    pickTemplate(stereo, 'pyramid4');
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

    pickTemplate(stereo, 'pyramid4');

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

    pickTemplate(stereo, 'pyramid4');
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

    pickTemplate(stereo, 'pyramid4');
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

    pickTemplate(stereo, 'pyramid4');
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

    pickTemplate(stereo, 'pyramid4');

    // Вращение.
    pointerAt(canvas, 'pointerdown', EMPTY_CORNER);
    pointerAt(canvas, 'pointermove', { x: 16, y: 6 });
    pointerAt(canvas, 'pointermove', { x: 26, y: 6 });
    expect(stereo.getScene().angleZ).toBeCloseTo(-22);
    press(canvas, 'z', { ctrlKey: true });
    press(canvas, 'y', { ctrlKey: true });
    expect(stereo.getScene().angleZ).toBeCloseTo(-22);
    pointerAt(canvas, 'pointerup', { x: 26, y: 6 });
    press(canvas, 'z', { ctrlKey: true });
    expect(stereo.getScene().angleZ).toBe(-30);

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

    pickTemplate(stereo, 'pyramid4');
    pickTool(stereo, 'section');
    clickVertex(canvas, [-3, -3, 0]);
    clickVertex(canvas, [3, -3, 0]);
    clickVertex(canvas, [3, 3, 0]);

    const at = svgOf([3, 3, 0]);

    canvas.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: at.x, clientY: at.y }));
    expect(stereo.getScene().sections).toEqual([{ vertices: ['A', 'B', 'C'], fill: 'rgba(16, 185, 129, 0.25)', stroke: '#10b981' }]);
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
  const source = readFileSync(resolve(process.cwd(), 'packages/editor-drawings/src/builders/stereometry-editor.ts'), 'utf8');

  it('английская таблица повторяет набор ключей русской', () => {
    expect(Object.keys(STEREOMETRY_MESSAGES.en).sort()).toEqual(Object.keys(STEREOMETRY_MESSAGES.ru).sort());
  });

  it('все ключи с префиксом drawings_stereo_ и читаются кодом конструктора целиком', () => {
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
