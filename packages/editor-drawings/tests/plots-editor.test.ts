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

    change(controlOf<HTMLInputElement>(plots, 'Коэффициент k'), '2');
    expect(plotsOf(plots)[0].k).toBe(2);

    // Ноль для гиперболы не годится — значение остаётся прежним.
    change(controlOf<HTMLInputElement>(plots, 'Коэффициент k'), '0');
    expect(plotsOf(plots)[0].k).toBe(2);

    // Одна граница — полуоткрытая область: бесконечный конец в JSON становится `null`.
    change(controlsOf<HTMLInputElement>(plots, 'Область по x (от, до)')[0], '0.5');
    expect(plotsOf(plots)[0].domain).toEqual([0.5, null]);
    change(controlsOf<HTMLInputElement>(plots, 'Область по x (от, до)')[1], '4');
    expect(plotsOf(plots)[0].domain).toEqual([0.5, 4]);
    change(controlsOf<HTMLInputElement>(plots, 'Область по x (от, до)')[0], '');
    change(controlsOf<HTMLInputElement>(plots, 'Область по x (от, до)')[1], '');
    expect(plotsOf(plots)[0].domain).toBeUndefined();

    pickTemplate(plots, 'circle');
    change(controlOf<HTMLInputElement>(plots, 'Радиус'), '1.5');

    const fill = controlOf<HTMLInputElement>(plots, 'Заливка');

    fill.checked = true;
    fill.dispatchEvent(new Event('change', { bubbles: true }));
    expect(plotsOf(plots)[1]).toMatchObject({ type: 'circle', radius: 1.5, fill: true });

    pickTemplate(plots, 'line');
    change(controlOf<HTMLInputElement>(plots, 'Сдвиг b'), '-1');
    expect(plotsOf(plots)[2]).toMatchObject({ type: 'line', k: 1, b: -1 });

    pickTemplate(plots, 'sqrt');
    change(controlOf<HTMLSelectElement>(plots, 'Направление по x'), 'left');
    expect(plotsOf(plots)[3]).toMatchObject({ type: 'sqrt', directionX: 'left', directionY: 'up', stretch: 1 });
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

describe('подписи конструктора графиков', () => {
  it('английская таблица повторяет набор ключей русской, все ключи с префиксом конструктора', () => {
    const ru = Object.keys(PLOTS_MESSAGES.ru);

    expect(Object.keys(PLOTS_MESSAGES.en).sort()).toEqual([...ru].sort());
    expect(ru.every((key) => key.startsWith('drawings_plots_'))).toBe(true);
    // Таблица вкладки влита в таблицы возможности: диалог переводит её ключи.
    expect(ru.every((key) => key in DRAWINGS_MESSAGES.ru)).toBe(true);
  });
});
