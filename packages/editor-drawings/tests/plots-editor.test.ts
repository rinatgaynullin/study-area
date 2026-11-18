import type { Translate } from '@rich-editor/core';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { plotsEditorFactory } from '../src/builders/plots-editor';
import { PLOTS_MESSAGES } from '../src/builders/plots-messages';
import type { SceneEditor } from '../src/builders/types';
import { DRAWINGS_MESSAGES } from '../src/messages';

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

const t: Translate = (key) => PLOTS_MESSAGES.ru[key] ?? DRAWINGS_MESSAGES.ru[key] ?? key;

/** Полотно 560×420 при масштабе 30: начало координат мира в (280, 210), ось y вверх. */
const CX = 280;
const CY = 210;
const SCALE = 30;

type Point = [number, number];

const svgOf = ([x, y]: Point): Point => [CX + x * SCALE, CY - y * SCALE];

const pointer = (target: HTMLElement, type: 'pointerdown' | 'pointermove' | 'pointerup', world: Point, init: Partial<PointerEventInit> = {}): void => {
  const [clientX, clientY] = svgOf(world);

  target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, clientX, clientY, pointerId: 1, ...init }));
};

const click = (target: HTMLElement, world: Point, init: Partial<PointerEventInit> = {}): void => {
  pointer(target, 'pointerdown', world, init);
  pointer(target, 'pointerup', world, init);
};

const doubleClick = (target: HTMLElement, world: Point): void => {
  const [clientX, clientY] = svgOf(world);

  target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, button: 0, clientX, clientY }));
};

/** Штрих карандаша: нажатие в первой точке, движение по остальным, отпускание в последней. */
const stroke = (target: HTMLElement, points: Point[]): void => {
  pointer(target, 'pointerdown', points[0]);
  points.slice(1).forEach((point) => pointer(target, 'pointermove', point));
  pointer(target, 'pointerup', points[points.length - 1]);
};

const key = (target: HTMLElement, name: string, init: Partial<KeyboardEventInit> = {}): void => {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init }));
};

const pickTool = (editor: SceneEditor, tool: string): void => {
  editor.element.querySelector<HTMLButtonElement>(`button[data-tool="${tool}"]`)?.click();
};

const pickTemplate = (editor: SceneEditor, template: string): void => {
  editor.element.querySelector<HTMLButtonElement>(`button[data-plot-template="${template}"]`)?.click();
};

const actionButton = (editor: SceneEditor, label: string): HTMLButtonElement => {
  const found = [...editor.element.querySelectorAll<HTMLButtonElement>('.rte-builder__actions button')].find(
    (button) => button.getAttribute('aria-label') === label,
  );

  if (!found) throw new Error(`Нет кнопки «${label}»`);

  return found;
};

const canvasOf = (editor: SceneEditor): HTMLElement => {
  const canvas = editor.element.querySelector<HTMLElement>('.rte-sketch');

  if (!canvas) throw new Error('Нет полотна');

  return canvas;
};

const propsTitle = (editor: SceneEditor): string | null | undefined =>
  editor.element.querySelector('.rte-builder__props-title')?.textContent;

/** Элементы управления поля панели свойств по его подписи. */
const controlsOf = <T extends HTMLElement>(editor: SceneEditor, label: string): T[] => {
  const field = [...editor.element.querySelectorAll<HTMLElement>('.rte-builder__props .rte-builder__prop')].find(
    (prop) => prop.querySelector('.rte-builder__prop-label')?.textContent === label,
  );

  if (!field) throw new Error(`Нет поля «${label}»`);

  return [...field.querySelectorAll<T>('input, select')];
};

const controlOf = <T extends HTMLElement>(editor: SceneEditor, label: string): T => controlsOf<T>(editor, label)[0];

const change = (control: HTMLInputElement | HTMLSelectElement, value: string): void => {
  control.value = value;
  control.dispatchEvent(new Event('change', { bubbles: true }));
};

const plotsOf = (editor: SceneEditor): Array<Record<string, unknown>> => editor.getScene().plots as Array<Record<string, unknown>>;

/** Ползунок или числовое поле параметра блока «Функция». */
const paramControl = (editor: SceneEditor, id: string, kind: 'range' | 'number'): HTMLInputElement => {
  const input = editor.element.querySelector<HTMLInputElement>(`.rte-plots-fn input[type="${kind}"][data-param="${id}"]`);

  if (!input) throw new Error(`Нет поля параметра ${id}`);

  return input;
};

const paramIds = (editor: SceneEditor): string[] =>
  [...editor.element.querySelectorAll<HTMLInputElement>('.rte-plots-fn input[type="range"]')].map((input) => input.dataset.param ?? '');

const formulaOf = (editor: SceneEditor): string | null | undefined =>
  editor.element.querySelector('.rte-plots-fn__formula[role="img"]')?.getAttribute('aria-label');

/** Движение ползунка: событие `input`, а `change` — когда отпустили. */
const slide = (input: HTMLInputElement, value: string): void => {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

const release = (input: HTMLInputElement): void => {
  input.dispatchEvent(new Event('change', { bubbles: true }));
};

const option = (editor: SceneEditor, value: string): HTMLButtonElement => {
  const button = editor.element.querySelector<HTMLButtonElement>(`.rte-plots-fn [role="radio"][data-value="${value}"]`);

  if (!button) throw new Error(`Нет переключателя ${value}`);

  return button;
};

/** Клик по первой точке пути кривой данного цвета: после загрузки окно просмотра подогнано под сцену. */
const clickCurve = (editor: SceneEditor, color: string): void => {
  const d = canvasOf(editor).querySelector(`.rte-sketch__layer path[stroke="${color}"]`)?.getAttribute('d') ?? '';
  const [, x, y] = /M\s*(-?[\d.]+)[\s,]+(-?[\d.]+)/.exec(d) ?? [];

  if (x === undefined || y === undefined) throw new Error(`Нет кривой цвета ${color}`);

  const init = { bubbles: true, cancelable: true, button: 0, clientX: Number(x), clientY: Number(y), pointerId: 1 };

  canvasOf(editor).dispatchEvent(new PointerEvent('pointerdown', init));
  canvasOf(editor).dispatchEvent(new PointerEvent('pointerup', init));
};

/** Нажатие по окружности цвета `color`: правая точка обода. */
const clickCircle = (editor: SceneEditor, color: string): void => {
  const ring = canvasOf(editor).querySelector(`.rte-sketch__layer circle[stroke="${color}"]`);
  const [cx, cy, r] = ['cx', 'cy', 'r'].map((name) => Number(ring?.getAttribute(name)));

  if (!ring || cx === undefined || cy === undefined || r === undefined) throw new Error(`Нет окружности цвета ${color}`);

  const init = { bubbles: true, cancelable: true, button: 0, clientX: cx + r, clientY: cy, pointerId: 1 };

  canvasOf(editor).dispatchEvent(new PointerEvent('pointerdown', init));
  canvasOf(editor).dispatchEvent(new PointerEvent('pointerup', init));
};

const formulaLabelToggle = (editor: SceneEditor): HTMLInputElement | null => editor.element.querySelector<HTMLInputElement>('.rte-plots-fn input[data-formula-label]');

/** Сцена графика из README PinQueen: парабола с вершиной в A и сама точка A. */
const README_SCENE = {
  type: 'plot_2d',
  axes: { x_label: 'x', y_label: 'y' },
  plots: [
    { type: 'parabola', vertex: [1, -2], direction: 'up', stretchY: 1, label: 'y = (x-1)^2 - 2' },
    { type: 'point', coords: [1, -2], style: 'solid', label: 'A' },
  ],
};

describe('конструктор графиков', () => {
  let editor: SceneEditor | undefined;

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
  });

  const create = (): SceneEditor => {
    editor = plotsEditorFactory.create({ t });
    document.body.appendChild(editor.element);

    return editor;
  };

  it('загружает сцену из README и отдаёт её обратно с id у графиков', () => {
    const plots = create();

    plots.load(README_SCENE);

    const scene = plots.getScene();

    expect(scene.type).toBe('plot_2d');
    expect(scene.axes).toEqual({ x_label: 'x', y_label: 'y' });
    expect(scene.showGrid).toBeUndefined();
    expect(scene.plots).toEqual([
      { id: 'plot_1', type: 'parabola', vertex: [1, -2], direction: 'up', stretchX: 1, stretchY: 1, style: 'solid', label: 'y = (x-1)^2 - 2' },
      { id: 'plot_2', type: 'point', coords: [1, -2], style: 'solid', label: 'A' },
    ]);
    expect(canvasOf(plots).querySelector('.rte-sketch__layer svg path')).not.toBeNull();
    expect(canvasOf(plots).querySelector('.rte-sketch__layer svg circle')).not.toBeNull();
  });

  it('точка ставится кликом с прилипанием к сетке 0,5; Shift отключает прилипание', () => {
    const plots = create();
    const canvas = canvasOf(plots);
    let changes = 0;

    plots.onChange(() => {
      changes += 1;
    });

    pickTool(plots, 'point');
    click(canvas, [1.02, 0.47]);
    expect(plotsOf(plots)).toEqual([{ id: 'plot_1', type: 'point', coords: [1, 0.5], style: 'solid' }]);

    click(canvas, [2.13, 1.08], { shiftKey: true });
    expect(plotsOf(plots)[1]).toMatchObject({ type: 'point', coords: [2.13, 1.08] });
    expect(changes).toBe(2);
    expect(propsTitle(plots)).toBe('Точка');
  });

  it('штрих карандаша по прямой, окружности и параболе распознаётся, зигзаг остаётся ломаной', () => {
    const plots = create();
    const canvas = canvasOf(plots);

    pickTool(plots, 'pencil');
    stroke(
      canvas,
      Array.from({ length: 9 }, (_, i) => [-2 + i / 2, -2 + i / 2] as Point),
    );
    expect(plotsOf(plots)[0]).toEqual({ id: 'plot_1', type: 'line', p1: [-2, -2], p2: [2, 2], style: 'solid' });

    stroke(
      canvas,
      Array.from({ length: 24 }, (_, i) => {
        const angle = (i / 24) * Math.PI * 2;

        return [1 + 2 * Math.cos(angle), 1 + 2 * Math.sin(angle)] as Point;
      }),
    );
    expect(plotsOf(plots)[1]).toMatchObject({ type: 'circle', center: [1, 1], radius: 2 });

    stroke(
      canvas,
      Array.from({ length: 17 }, (_, i) => {
        const x = -2 + i / 4;

        return [x, x * x + 1] as Point;
      }),
    );
    expect(plotsOf(plots)[2]).toMatchObject({ type: 'parabola', vertex: [0, 1], direction: 'up', stretchX: 1, stretchY: 1 });

    const zigzag: Point[] = [[0, 0], [1, 2], [2, -1], [3, 3], [4, -2], [5, 1]];

    stroke(canvas, zigzag);
    expect(plotsOf(plots)[3]).toMatchObject({ type: 'freehand', points: zigzag });

    // Пока кнопка зажата, штрих виден в оверлее.
    pointer(canvas, 'pointerdown', [-4, -4]);
    pointer(canvas, 'pointermove', [-3, -3]);
    expect(canvas.querySelector('.rte-sketch__overlay polyline')).not.toBeNull();
    pointer(canvas, 'pointerup', [-3, -3]);
    // Слишком короткий штрих отбрасывается.
    expect(plotsOf(plots)).toHaveLength(4);
  });

  it('штриховка собирается кликами и замыкается Enter или двойным кликом', () => {
    const plots = create();
    const canvas = canvasOf(plots);

    pickTool(plots, 'shading');
    click(canvas, [0, 0]);
    click(canvas, [2.02, 0]);
    expect(canvas.querySelectorAll('.rte-sketch__overlay circle')).toHaveLength(2);
    expect(plotsOf(plots)).toHaveLength(0);

    // Две вершины — ещё не область.
    key(canvas, 'Enter');
    expect(plotsOf(plots)).toHaveLength(0);

    click(canvas, [0, 2]);
    key(canvas, 'Enter');
    expect(plotsOf(plots)).toEqual([{ id: 'plot_1', type: 'shading', points: [[0, 0], [2, 0], [0, 2]] }]);
    expect(propsTitle(plots)).toBe('Штриховка');

    click(canvas, [-1, -1]);
    click(canvas, [-3, -1]);
    click(canvas, [-3, -3]);
    click(canvas, [-3, -3]);
    doubleClick(canvas, [-3, -3]);
    expect(plotsOf(plots)[1]).toMatchObject({ type: 'shading', points: [[-1, -1], [-3, -1], [-3, -3]] });
  });

  it('парабола из шаблона выбирается кликом по ветви и перетаскивается за вершину', () => {
    const plots = create();
    const canvas = canvasOf(plots);

    pickTemplate(plots, 'parabola');
    expect(plotsOf(plots)[0]).toMatchObject({ type: 'parabola', vertex: [0, 0], stretchX: 1, stretchY: 1, color: '#3b82f6' });
    expect(propsTitle(plots)).toBe('Парабола');

    pickTool(plots, 'select');
    click(canvas, [4, 0]);
    expect(propsTitle(plots)).toBe('Оси');

    click(canvas, [2, 4]);
    expect(propsTitle(plots)).toBe('Парабола');
    expect(canvas.querySelector('.rte-sketch__layer path[stroke="#ec4899"]')).not.toBeNull();

    pointer(canvas, 'pointerdown', [0, 0]);
    pointer(canvas, 'pointermove', [0.4, -0.6]);
    pointer(canvas, 'pointermove', [1.1, -0.9]);
    pointer(canvas, 'pointerup', [1.1, -0.9]);
    expect(plotsOf(plots)[0]).toMatchObject({ vertex: [1, -1] });

    // Точка на кривой выбирается раньше кривой.
    pickTool(plots, 'point');
    click(canvas, [1, -1]);
    pickTool(plots, 'select');
    click(canvas, [1, -1]);
    expect(propsTitle(plots)).toBe('Точка');
  });

  it('панель свойств меняет цвет, пунктир, подпись, k гиперболы и область', () => {
    const plots = create();

    pickTemplate(plots, 'hyperbola');
    expect(propsTitle(plots)).toBe('Гипербола');

    change(controlOf<HTMLSelectElement>(plots, 'Цвет'), '#ef4444');
    expect(plotsOf(plots)[0]).toMatchObject({ type: 'hyperbola', k: 1, color: '#ef4444' });

    change(controlOf<HTMLInputElement>(plots, 'Цвет (hex)'), '#123456');
    expect(plotsOf(plots)[0].color).toBe('#123456');
    expect(controlOf<HTMLSelectElement>(plots, 'Цвет').value).toBe('#123456');

    const dashed = controlOf<HTMLInputElement>(plots, 'Пунктир');

    dashed.checked = true;
    dashed.dispatchEvent(new Event('change', { bubbles: true }));
    expect(plotsOf(plots)[0].style).toBe('dashed');

    change(controlOf<HTMLInputElement>(plots, 'Метка'), 'y = 2/x');
    expect(plotsOf(plots)[0].label).toBe('y = 2/x');

    change(paramControl(plots, 'k', 'number'), '2');
    expect(plotsOf(plots)[0].k).toBe(2);

    // Ноль для гиперболы не годится — наименьшее допустимое со знаком прежнего значения.
    change(paramControl(plots, 'k', 'number'), '0');
    expect(plotsOf(plots)[0].k).toBe(0.1);
    // Пустое число не меняет кривую, поле показывает прежнее значение.
    change(paramControl(plots, 'k', 'number'), '');
    expect(plotsOf(plots)[0].k).toBe(0.1);
    expect(paramControl(plots, 'k', 'number').value).toBe('0.1');

    // Одна граница — полуоткрытая область: бесконечный конец в JSON становится `null`.
    change(controlsOf<HTMLInputElement>(plots, 'Область по x (от, до)')[0], '0.5');
    expect(plotsOf(plots)[0].domain).toEqual([0.5, null]);
    change(controlsOf<HTMLInputElement>(plots, 'Область по x (от, до)')[1], '4');
    expect(plotsOf(plots)[0].domain).toEqual([0.5, 4]);
    change(controlsOf<HTMLInputElement>(plots, 'Область по x (от, до)')[0], '');
    change(controlsOf<HTMLInputElement>(plots, 'Область по x (от, до)')[1], '');
    expect(plotsOf(plots)[0].domain).toBeUndefined();

    pickTemplate(plots, 'circle');
    change(paramControl(plots, 'r', 'number'), '1.5');

    const fill = controlOf<HTMLInputElement>(plots, 'Заливка');

    fill.checked = true;
    fill.dispatchEvent(new Event('change', { bubbles: true }));
    expect(plotsOf(plots)[1]).toMatchObject({ type: 'circle', radius: 1.5, fill: true });

    pickTemplate(plots, 'line');
    change(paramControl(plots, 'b', 'number'), '-1');
    expect(plotsOf(plots)[2]).toMatchObject({ type: 'line', k: 1, b: -1 });

    pickTemplate(plots, 'sqrt');
    expect(option(plots, 'right').getAttribute('aria-checked')).toBe('true');
    option(plots, 'left').click();
    expect(plotsOf(plots)[3]).toMatchObject({ type: 'sqrt', directionX: 'left', directionY: 'up', stretch: 1 });
    expect(option(plots, 'left').getAttribute('aria-checked')).toBe('true');
    expect(formulaOf(plots)).toBe('y = √(−x)');

    // Знак a заменяет «Направление по y».
    change(paramControl(plots, 'a', 'number'), '-2');
    expect(plotsOf(plots)[3]).toMatchObject({ directionX: 'left', directionY: 'down', stretch: 2 });
  });

  it('без выделения панель правит подписи осей и числа на них; кнопка сетки выключает сетку', () => {
    const plots = create();

    expect(propsTitle(plots)).toBe('Оси');
    change(controlOf<HTMLInputElement>(plots, 'Подпись оси x'), 't');
    change(controlOf<HTMLInputElement>(plots, 'Подпись оси y'), 's');
    expect(plots.getScene().axes).toEqual({ x_label: 't', y_label: 's' });

    const ticks = controlOf<HTMLInputElement>(plots, 'Числа на осях');

    ticks.checked = false;
    ticks.dispatchEvent(new Event('change', { bubbles: true }));
    expect(plots.getScene().showAxesTicks).toBe(false);

    actionButton(plots, 'Сетка').click();
    expect(plots.getScene().showGrid).toBe(false);
    actionButton(plots, 'Сетка').click();
    expect(plots.getScene().showGrid).toBeUndefined();
  });

  it('инструмент подписи и двойной клик открывают поле «Метка» выбранного графика', () => {
    const plots = create();
    const canvas = canvasOf(plots);

    pickTemplate(plots, 'circle');
    pickTool(plots, 'text');
    click(canvas, [2, 0]);
    expect(propsTitle(plots)).toBe('Окружность');
    expect(document.activeElement).toBe(controlOf<HTMLInputElement>(plots, 'Метка'));

    key(canvas, 'Escape');
    expect(propsTitle(plots)).toBe('Оси');

    pickTool(plots, 'select');
    doubleClick(canvas, [0, 2]);
    expect(propsTitle(plots)).toBe('Окружность');
    change(controlOf<HTMLInputElement>(plots, 'Метка'), 'ω');
    expect(plotsOf(plots)[0].label).toBe('ω');
  });

  it('Ctrl+C и Ctrl+V копируют выбранный график со сдвигом, повторная вставка идёт лесенкой', () => {
    const plots = create();
    const canvas = canvasOf(plots);

    pickTemplate(plots, 'circle');
    key(canvas, 'c', { ctrlKey: true });
    key(canvas, 'v', { ctrlKey: true });

    expect(plotsOf(plots)).toHaveLength(2);
    expect(plotsOf(plots)[1]).toMatchObject({ id: 'plot_2', type: 'circle', center: [0.5, -0.5], radius: 2 });
    expect(propsTitle(plots)).toBe('Окружность');

    key(canvas, 'v', { ctrlKey: true });
    expect(plotsOf(plots)[2]).toMatchObject({ id: 'plot_3', center: [1, -1] });

    // Прямая `y = kx + b` сдвигается через `b`: вправо на 0,5 и вниз на 0,5 при k = 1 даёт b = −1.
    pickTemplate(plots, 'line');
    actionButton(plots, 'Копировать график').click();
    actionButton(plots, 'Вставить график').click();
    expect(plotsOf(plots)[4]).toMatchObject({ type: 'line', k: 1, b: -1 });
  });

  it('отмена возвращает сцену, повтор — снова меняет; перетаскивание отменяется одним шагом', () => {
    const plots = create();
    const canvas = canvasOf(plots);

    pickTool(plots, 'point');
    click(canvas, [1, 1]);
    expect(plotsOf(plots)).toHaveLength(1);

    key(canvas, 'z', { ctrlKey: true });
    expect(plotsOf(plots)).toHaveLength(0);

    key(canvas, 'y', { ctrlKey: true });
    expect(plotsOf(plots)).toEqual([{ id: 'plot_1', type: 'point', coords: [1, 1], style: 'solid' }]);

    pickTool(plots, 'select');
    pointer(canvas, 'pointerdown', [1, 1]);
    pointer(canvas, 'pointermove', [2, 2]);
    pointer(canvas, 'pointermove', [3, 3]);
    pointer(canvas, 'pointerup', [3, 3]);
    expect(plotsOf(plots)[0].coords).toEqual([3, 3]);

    actionButton(plots, 'Отменить').click();
    expect(plotsOf(plots)[0].coords).toEqual([1, 1]);
    actionButton(plots, 'Повторить').click();
    expect(plotsOf(plots)[0].coords).toEqual([3, 3]);
  });

  it('удаление: инструментом, клавишей Delete и кнопкой панели', () => {
    const plots = create();
    const canvas = canvasOf(plots);

    pickTool(plots, 'point');
    click(canvas, [1, 1]);
    click(canvas, [-1, -1]);
    click(canvas, [3, -2]);
    expect(plotsOf(plots)).toHaveLength(3);

    pickTool(plots, 'delete');
    click(canvas, [1, 1]);
    expect(plotsOf(plots).map((plot) => plot.coords)).toEqual([[-1, -1], [3, -2]]);

    pickTool(plots, 'select');
    click(canvas, [-1, -1]);
    key(canvas, 'Delete');
    expect(plotsOf(plots).map((plot) => plot.coords)).toEqual([[3, -2]]);

    click(canvas, [3, -2]);
    plots.element.querySelector<HTMLButtonElement>('.rte-builder__remove')?.click();
    expect(plotsOf(plots)).toHaveLength(0);
    expect(propsTitle(plots)).toBe('Оси');
  });

  it('принимает только сцены графиков', () => {
    expect(plotsEditorFactory.accepts(README_SCENE)).toBe(true);
    expect(plotsEditorFactory.accepts({ plots: [{ type: 'parabola', vertex: [0, 0] }] })).toBe(true);
    expect(plotsEditorFactory.accepts({ type: '2d', vertices: { A: [0, 0], B: [1, 0] }, edges: [['A', 'B']] })).toBe(false);
    expect(plotsEditorFactory.accepts({ type: '3d', vertices: { S: [0, 0, 2] } })).toBe(false);
    expect(plotsEditorFactory.accepts({})).toBe(false);
    expect(plotsEditorFactory.id).toBe('plots');
    expect(plotsEditorFactory.kind).toBe('geometry');
    expect(plotsEditorFactory.labelKey).toBe('drawings_tab_plots');
  });

  it('чужие поля сцены и графиков возвращаются нетронутыми; окружность верхнего уровня попадает в графики', () => {
    const plots = create();

    plots.load({
      type: 'plot_2d',
      custom: { keep: true },
      showAxes: true,
      grid: false,
      axes: { x_label: 't', y_label: 'v' },
      circle: { center: [2, 2], radius: 1 },
      plots: [
        { id: 'own', type: 'point', coords: [1, 1], note: 'hi' },
        { id: 'own', type: 'line', k: 2, b: 1, domain: [null, 3] },
        { type: 'nonsense' },
      ],
    });

    const scene = plots.getScene();
    const items = scene.plots as Array<Record<string, unknown>>;

    expect(scene.custom).toEqual({ keep: true });
    expect(scene.showAxes).toBe(true);
    expect(scene.grid).toBeUndefined();
    expect(scene.showGrid).toBe(false);
    expect(scene.axes).toEqual({ x_label: 't', y_label: 'v' });
    expect(items).toHaveLength(3);
    expect(items[0]).toEqual({ id: 'own', type: 'point', coords: [1, 1], style: 'solid', note: 'hi' });
    // Повторный id заменяется свободным, бесконечная граница области остаётся `null`.
    expect(items[1]).toMatchObject({ id: 'plot_1', type: 'line', k: 2, b: 1, domain: [null, 3] });
    expect(items[2]).toMatchObject({ id: 'plot_2', type: 'circle', center: [2, 2], radius: 1 });
  });
});

describe('блок «Функция»', () => {
  let editor: SceneEditor | undefined;

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
  });

  const create = (): SceneEditor => {
    editor = plotsEditorFactory.create({ t });
    document.body.appendChild(editor.element);

    return editor;
  };

  it('у параболы — карточка формулы и три ползунка; жест ползунка — один шаг отмены', () => {
    const plots = create();
    const canvas = canvasOf(plots);

    pickTemplate(plots, 'parabola');
    expect(formulaOf(plots)).toBe('y = x²');
    expect(paramIds(plots)).toEqual(['a', 'm', 'n']);
    // Блок — первым в свойствах, под заголовком.
    expect(plots.element.querySelector('.rte-builder__props > .rte-plots-fn')?.previousElementSibling?.textContent).toBe('Парабола');

    const slider = paramControl(plots, 'a', 'range');

    expect(slider).toMatchObject({ min: '-5', max: '5', step: '0.1' });
    slide(slider, '1.5');
    expect(plotsOf(plots)[0]).toMatchObject({ direction: 'up', stretchX: 1, stretchY: 1.5 });
    expect(formulaOf(plots)).toBe('y = 1,5x²');
    // Во время жеста блок не пересоздаётся: ползунок — тот же элемент.
    expect(paramControl(plots, 'a', 'range')).toBe(slider);
    expect(paramControl(plots, 'a', 'number').value).toBe('1.5');

    slide(slider, '-2');
    slide(slider, '-2.5');
    release(slider);
    expect(plotsOf(plots)[0]).toMatchObject({ direction: 'down', stretchY: 2.5 });
    expect(formulaOf(plots)).toBe('y = −2,5x²');
    expect(paramControl(plots, 'a', 'range')).toBe(slider);

    key(canvas, 'z', { ctrlKey: true });
    expect(plotsOf(plots)[0]).toMatchObject({ direction: 'up', stretchX: 1, stretchY: 1 });
    expect(formulaOf(plots)).toBe('y = x²');
    expect(paramControl(plots, 'a', 'number').value).toBe('1');

    // Ещё одна отмена убирает саму параболу: жест был одним шагом.
    key(canvas, 'z', { ctrlKey: true });
    expect(plotsOf(plots)).toHaveLength(0);

    // Число — тоже шаг истории.
    pickTemplate(plots, 'parabola');
    change(paramControl(plots, 'm', 'number'), '1');
    change(paramControl(plots, 'n', 'number'), '-3');
    expect(plotsOf(plots)[0]).toMatchObject({ vertex: [1, -3] });
    expect(formulaOf(plots)).toBe('y = (x − 1)² − 3');
    key(canvas, 'z', { ctrlKey: true });
    expect(plotsOf(plots)[0]).toMatchObject({ vertex: [1, 0] });
  });

  it('общий вид параболы: параметры a, b, c, другая запись, та же сцена; выбор действует на все параболы', () => {
    const plots = create();

    plots.load({ type: 'plot_2d', plots: [{ type: 'parabola', vertex: [1, 3], direction: 'up', stretchX: 1, stretchY: 2, color: '#3b82f6' }] });
    clickCurve(plots, '#3b82f6');
    expect(formulaOf(plots)).toBe('y = 2(x − 1)² + 3');

    const scene = JSON.stringify(plots.getScene());

    expect(option(plots, 'vertex').getAttribute('aria-checked')).toBe('true');
    option(plots, 'standard').click();
    expect(paramIds(plots)).toEqual(['a', 'b', 'c']);
    expect(formulaOf(plots)).toBe('y = 2x² − 4x + 5');
    expect(option(plots, 'standard').getAttribute('aria-checked')).toBe('true');
    expect(JSON.stringify(plots.getScene())).toBe(scene);

    change(paramControl(plots, 'c', 'number'), '7');
    expect(plotsOf(plots)[0]).toMatchObject({ vertex: [1, 5], stretchY: 2 });

    // Новая парабола открывается в том же виде записи.
    pickTemplate(plots, 'parabola');
    expect(paramIds(plots)).toEqual(['a', 'b', 'c']);
    expect(formulaOf(plots)).toBe('y = x²');
  });

  it('перетаскивание параболы меняет формулу и значения m, n на каждом движении', () => {
    const plots = create();
    const canvas = canvasOf(plots);

    pickTemplate(plots, 'parabola');
    pickTool(plots, 'select');

    pointer(canvas, 'pointerdown', [0, 0]);

    const card = plots.element.querySelector('.rte-plots-fn__formula');
    const m = paramControl(plots, 'm', 'range');

    pointer(canvas, 'pointermove', [1.1, -0.9]);
    expect(formulaOf(plots)).toBe('y = (x − 1)² − 1');
    expect(m.value).toBe('1');
    expect(paramControl(plots, 'n', 'number').value).toBe('-1');
    pointer(canvas, 'pointermove', [-2, 2.1]);
    expect(formulaOf(plots)).toBe('y = (x + 2)² + 2');
    // Блок не пересоздавался.
    expect(plots.element.querySelector('.rte-plots-fn__formula')).toBe(card);
    pointer(canvas, 'pointerup', [-2, 2.1]);
    expect(plotsOf(plots)[0]).toMatchObject({ vertex: [-2, 2] });
    expect(paramControl(plots, 'm', 'number').value).toBe('-2');
  });

  it('флажок «Подписать график формулой»: подпись следует за параметром, ручная правка снимает флажок', () => {
    const plots = create();
    const canvas = canvasOf(plots);

    pickTemplate(plots, 'line');

    const toggle = formulaLabelToggle(plots);

    expect(toggle?.checked).toBe(false);

    if (!toggle) return;

    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    expect(plotsOf(plots)[0].label).toBe('y = x');
    expect(controlOf<HTMLInputElement>(plots, 'Метка').value).toBe('y = x');

    const b = paramControl(plots, 'b', 'range');

    slide(b, '2');
    expect(plotsOf(plots)[0].label).toBe('y = x + 2');
    release(b);
    change(paramControl(plots, 'k', 'number'), '-0.5');
    expect(plotsOf(plots)[0].label).toBe('y = -0,5x + 2');
    expect(controlOf<HTMLInputElement>(plots, 'Метка').value).toBe('y = -0,5x + 2');

    // Перетаскивание тоже переписывает подпись.
    pickTool(plots, 'select');
    pointer(canvas, 'pointerdown', [0, 2]);
    pointer(canvas, 'pointermove', [0, 3]);
    expect(plotsOf(plots)[0].label).toBe('y = -0,5x + 3');
    pointer(canvas, 'pointerup', [0, 3]);

    // Отмена возвращает и подпись.
    key(canvas, 'z', { ctrlKey: true });
    expect(plotsOf(plots)[0].label).toBe('y = -0,5x + 2');

    change(controlOf<HTMLInputElement>(plots, 'Метка'), 'моя прямая');
    expect(formulaLabelToggle(plots)?.checked).toBe(false);
    change(paramControl(plots, 'b', 'number'), '0');
    expect(plotsOf(plots)[0].label).toBe('моя прямая');

    // Выключенный флажок очищает подпись.
    const again = formulaLabelToggle(plots);

    if (!again) return;

    again.checked = true;
    again.dispatchEvent(new Event('change', { bubbles: true }));
    expect(plotsOf(plots)[0].label).toBe('y = -0,5x');
    again.checked = false;
    again.dispatchEvent(new Event('change', { bubbles: true }));
    expect(plotsOf(plots)[0].label).toBeUndefined();

    // Сцена с подписью-формулой открывается с включённым флажком.
    plots.load({ type: 'plot_2d', plots: [{ type: 'hyperbola', center: [1, 0], k: 2, label: 'y = 2/(x - 1)', color: '#10b981' }] });
    clickCurve(plots, '#10b981');
    expect(formulaLabelToggle(plots)?.checked).toBe(true);
    change(paramControl(plots, 'n', 'number'), '1');
    expect(plotsOf(plots)[0].label).toBe('y = 2/(x - 1) + 1');
  });

  it('старых полей направления, растяжения и радиуса нет; у всех кривых есть подпись-формула', () => {
    const plots = create();
    const labels = (): string[] =>
      [...plots.element.querySelectorAll('.rte-builder__props .rte-builder__prop-label')].map((label) => label.textContent ?? '');

    (['parabola', 'sqrt', 'hyperbola', 'line', 'circle'] as const).forEach((template) => {
      pickTemplate(plots, template);
      expect(plots.element.querySelector('.rte-plots-fn')).not.toBeNull();
      expect(labels().filter((label) => /Направление|Растяжение|Коэффициент|Сдвиг b/.test(label))).toEqual([]);
      expect(plots.element.querySelector('.rte-builder__props select:not([class*="select"])')).toBeNull();
    });

    pickTemplate(plots, 'parabola');
    expect(formulaLabelToggle(plots)?.checked).toBe(false);
    expect(labels()).toContain('Область по x (от, до)');

    pickTemplate(plots, 'circle');
    expect(formulaOf(plots)).toBe('x² + y² = 4');
    expect(paramIds(plots)).toEqual(['a', 'b', 'r']);
    expect(formulaLabelToggle(plots)?.checked).toBe(false);
    expect(labels()).toContain('Заливка');
    expect(labels()).not.toContain('Радиус');
    expect(plots.element.querySelector('.rte-plots__fn-hint')?.textContent).toBe('Двигай ползунки или тащи график — формула меняется вместе с ним');

    // У точки блока нет.
    pickTool(plots, 'point');
    click(canvasOf(plots), [5, 5]);
    expect(plots.element.querySelector('.rte-plots-fn')).toBeNull();
    expect(plots.element.querySelector('.rte-plots__fn-hint')).toBeNull();
  });

  it('окружность: центр a, b и радиус r ползунками с пояснениями; r меньше 0,5 — 0,5', () => {
    const plots = create();
    const canvas = canvasOf(plots);
    const hints = (): string[] => [...plots.element.querySelectorAll('.rte-plots-fn .rte-plots-fn__hint')].map((hint) => hint.textContent ?? '');

    pickTemplate(plots, 'circle');
    expect(hints()).toEqual(['Сдвиг центра влево-вправо', 'Сдвиг центра вверх-вниз', 'Радиус']);
    expect(paramControl(plots, 'a', 'range')).toMatchObject({ min: '-10', max: '10', step: '0.5' });
    expect(paramControl(plots, 'b', 'range')).toMatchObject({ min: '-10', max: '10', step: '0.5' });
    expect(paramControl(plots, 'r', 'range')).toMatchObject({ min: '0.5', max: '10', step: '0.5', value: '2' });

    const r = paramControl(plots, 'r', 'range');

    slide(r, '3');
    slide(r, '2.5');
    release(r);
    expect(plotsOf(plots)[0]).toMatchObject({ type: 'circle', center: [0, 0], radius: 2.5 });
    expect(formulaOf(plots)).toBe('x² + y² = 6,25');
    change(paramControl(plots, 'a', 'number'), '1');
    change(paramControl(plots, 'b', 'number'), '-2');
    expect(plotsOf(plots)[0]).toMatchObject({ center: [1, -2], radius: 2.5 });
    expect(formulaOf(plots)).toBe('(x − 1)² + (y + 2)² = 6,25');

    change(paramControl(plots, 'r', 'number'), '0.2');
    expect(plotsOf(plots)[0].radius).toBe(0.5);
    expect(paramControl(plots, 'r', 'number').value).toBe('0.5');

    // Жест ползунка — один шаг отмены, числа — по шагу.
    key(canvas, 'z', { ctrlKey: true });
    expect(plotsOf(plots)[0].radius).toBe(2.5);
    key(canvas, 'z', { ctrlKey: true });
    key(canvas, 'z', { ctrlKey: true });
    expect(plotsOf(plots)[0]).toMatchObject({ center: [0, 0], radius: 2.5 });
    key(canvas, 'z', { ctrlKey: true });
    expect(plotsOf(plots)[0]).toMatchObject({ center: [0, 0], radius: 2 });
  });

  it('подпись формулой у параболы и окружности: степень — ^2, подпись следует за параметром', () => {
    const plots = create();

    pickTemplate(plots, 'parabola');

    const toggle = formulaLabelToggle(plots);

    if (!toggle) throw new Error('Нет флажка подписи-формулы');

    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    change(paramControl(plots, 'a', 'number'), '2');
    change(paramControl(plots, 'm', 'number'), '1');
    change(paramControl(plots, 'n', 'number'), '-3');
    expect(plotsOf(plots)[0].label).toBe('y = 2(x - 1)^2 - 3');
    expect(controlOf<HTMLInputElement>(plots, 'Метка').value).toBe('y = 2(x - 1)^2 - 3');

    // Общий вид записи — и подпись в общем виде.
    option(plots, 'standard').click();
    change(paramControl(plots, 'c', 'number'), '5');
    expect(plotsOf(plots)[0].label).toBe('y = 2x^2 - 4x + 5');
    option(plots, 'vertex').click();

    pickTemplate(plots, 'circle');
    formulaLabelToggle(plots)?.click();
    expect(plotsOf(plots)[1].label).toBe('x^2 + y^2 = 4');
    change(paramControl(plots, 'a', 'number'), '1');
    change(paramControl(plots, 'b', 'number'), '-2');
    change(paramControl(plots, 'r', 'number'), '2.5');
    expect(plotsOf(plots)[1].label).toBe('(x - 1)^2 + (y + 2)^2 = 6,25');

    // Сцена с такой подписью открывается с включённым флажком.
    plots.load(plots.getScene());
    clickCircle(plots, String(plotsOf(plots)[1].color));
    expect(formulaLabelToggle(plots)?.checked).toBe(true);
  });

  it('округление: загрузка и сохранение без правок не меняют кривые, правка — то же значение после повторной загрузки', () => {
    const plots = create();
    const scene = {
      type: 'plot_2d',
      plots: [
        { id: 'p', type: 'parabola', vertex: [1.25, -0.75], direction: 'down', stretchX: 1.5, stretchY: 0.33, style: 'solid', color: '#3b82f6' },
        { id: 'h', type: 'hyperbola', center: [0.5, 1.25], k: -1.33, style: 'solid', color: '#10b981' },
        { id: 'c', type: 'circle', center: [-1.5, 0.25], radius: 1.75, style: 'solid', color: '#f59e0b' },
      ],
    };

    plots.load(scene);
    expect(plotsOf(plots)).toEqual(scene.plots);

    // Выделение и показ блока сцену не меняют.
    clickCurve(plots, '#3b82f6');
    expect(paramControl(plots, 'a', 'number').value).toBe('-0.15');
    option(plots, 'standard').click();
    clickCurve(plots, '#10b981');
    clickCircle(plots, '#f59e0b');
    expect(plotsOf(plots)).toEqual(scene.plots);

    // a = −0,33 / 1,5² = −0,1466…: в блоке −0,15, после сохранения и загрузки — тоже.
    clickCurve(plots, '#3b82f6');
    option(plots, 'vertex').click();

    const shown = (): Record<string, string> =>
      Object.fromEntries(paramIds(plots).map((id) => [id, paramControl(plots, id, 'number').value]));

    change(paramControl(plots, 'n', 'number'), '1.234');
    expect(shown()).toEqual({ a: '-0.15', m: '1.25', n: '1.23' });

    const formula = formulaOf(plots);
    const before = shown();

    plots.load(plots.getScene());
    clickCurve(plots, '#3b82f6');
    expect(shown()).toEqual(before);
    expect(formulaOf(plots)).toBe(formula);

    // Общий вид: c считается из вершины — после загрузки то же.
    option(plots, 'standard').click();
    change(paramControl(plots, 'b', 'number'), '0.777');

    const standard = shown();

    plots.load(plots.getScene());
    clickCurve(plots, '#3b82f6');
    expect(shown()).toEqual(standard);

    clickCircle(plots, '#f59e0b');
    change(paramControl(plots, 'r', 'number'), '2.345');
    expect(shown()).toEqual({ a: '-1.5', b: '0.25', r: '2.35' });
    plots.load(plots.getScene());
    clickCircle(plots, '#f59e0b');
    expect(shown()).toEqual({ a: '-1.5', b: '0.25', r: '2.35' });
    expect(formulaOf(plots)).toBe('(x + 1,5)² + (y − 0,25)² = 5,5225');
  });

  it('прямая по двум точкам: k и b вычислены; правка переводит её в запись k/b, точки из панели уходят', () => {
    const plots = create();

    pickTool(plots, 'pencil');
    stroke(
      canvasOf(plots),
      Array.from({ length: 9 }, (_, i) => [-2 + i / 2, -2 + i / 2] as Point),
    );
    expect(formulaOf(plots)).toBe('y = x');
    expect(controlsOf<HTMLInputElement>(plots, 'Первая точка (x, y)')).toHaveLength(2);

    change(paramControl(plots, 'b', 'number'), '1');
    expect(plotsOf(plots)[0]).toEqual({ id: 'plot_1', type: 'line', k: 1, b: 1, style: 'solid' });
    expect(() => controlsOf(plots, 'Первая точка (x, y)')).toThrow();
    expect(controlsOf(plots, 'Область по x (от, до)')).toHaveLength(2);
  });
});

describe('подписи конструктора графиков', () => {
  it('английская таблица повторяет набор ключей русской, все ключи с префиксом конструктора', () => {
    const ru = Object.keys(PLOTS_MESSAGES.ru);

    expect(Object.keys(PLOTS_MESSAGES.en).sort()).toEqual([...ru].sort());
    // Кроме десятичного разделителя: он общий для чертежей, конструктор графиков — первый, кому он нужен.
    expect(ru.filter((key) => !key.startsWith('drawings_plots_'))).toEqual(['drawings_decimal_separator']);
    expect([PLOTS_MESSAGES.ru.drawings_decimal_separator, PLOTS_MESSAGES.en.drawings_decimal_separator]).toEqual([',', '.']);
    // Таблица вкладки влита в таблицы возможности: диалог переводит её ключи.
    expect(ru.every((key) => key in DRAWINGS_MESSAGES.ru)).toBe(true);
  });
});
