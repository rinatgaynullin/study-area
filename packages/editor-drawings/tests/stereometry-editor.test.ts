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
} from '../src/builders/stereometry-editor';
import { STEREOMETRY_MESSAGES } from '../src/builders/stereometry-messages';
import type { SceneEditor } from '../src/builders/types';
import { DRAWINGS_MESSAGES } from '../src/messages';
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

/** Вид шаблонов и пустой сцены. */
const TEMPLATE_VIEW = { angleY: 15, angleZ: -30 };

interface At {
  x: number;
  y: number;
}

const svgOf = (point: Point, view = TEMPLATE_VIEW): At => projectVertex(point, view.angleY, view.angleZ, VIEWPORT);

const pointerAt = (target: HTMLElement, type: 'pointerdown' | 'pointermove' | 'pointerup', at: At, init: Partial<PointerEventInit> = {}): void => {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: at.x, clientY: at.y, pointerId: 1, ...init }));
};

const clickAt = (target: HTMLElement, at: At, init: Partial<PointerEventInit> = {}): void => {
  pointerAt(target, 'pointerdown', at, init);
  pointerAt(target, 'pointerup', at, init);
};

const clickVertex = (target: HTMLElement, point: Point, view = TEMPLATE_VIEW): void => clickAt(target, svgOf(point, view));

const press = (target: HTMLElement, key: string, init: Partial<KeyboardEventInit> = {}): void => {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
};

const pickTool = (editor: SceneEditor, tool: string): void => {
  editor.element.querySelector<HTMLButtonElement>(`button[data-tool="${tool}"]`)?.click();
};

const pickTemplate = (editor: SceneEditor, template: string): void => {
  editor.element.querySelector<HTMLButtonElement>(`button[data-template="${template}"]`)?.click();
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
    expect(stereo.element.querySelector('.rte-builder__hint')?.textContent).toContain('правой кнопкой');
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

    // Левая кнопка в режиме выбора не вращает.
    pointerAt(canvas, 'pointerdown', { x: 20, y: 20 });
    pointerAt(canvas, 'pointermove', { x: 60, y: 60 });
    pointerAt(canvas, 'pointerup', { x: 60, y: 60 });
    expect(stereo.getScene().angleZ).toBe(-22);
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
