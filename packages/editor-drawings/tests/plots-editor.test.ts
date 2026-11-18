import type { Translate } from '@rich-editor/core';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { BUILDER_MESSAGES } from '../src/builders/messages';
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

const t: Translate = (key, params = {}) =>
  (PLOTS_MESSAGES.ru?.[key] ?? DRAWINGS_MESSAGES.ru?.[key] ?? key).replace(/\{(\w+)\}/g, (match, name: string) => String(params[name] ?? match));

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

/** Плитка палитры цвета (`data-color` — id цвета, `other` или `default`). */
const colorTile = (editor: SceneEditor, color: string): HTMLButtonElement => {
  const tile = editor.element.querySelector<HTMLButtonElement>(`.rte-builder__props [data-color="${color}"]`);

  if (!tile) throw new Error(`Нет плитки «${color}»`);

  return tile;
};

/** Ползунок или числовое поле параметра блока «Функция». */
const paramControl = (editor: SceneEditor, id: string, kind: 'range' | 'number'): HTMLInputElement => {
  const input = editor.element.querySelector<HTMLInputElement>(`.rte-plots-fn input[type="${kind}"][data-prop="${id}"]`);

  if (!input) throw new Error(`Нет поля параметра ${id}`);

  return input;
};

const paramIds = (editor: SceneEditor): string[] =>
  [...editor.element.querySelectorAll<HTMLInputElement>('.rte-plots-fn input[type="range"]')].map((input) => input.dataset.prop ?? '');

const formulaOf = (editor: SceneEditor): string | null | undefined =>
  editor.element.querySelector('.rte-plots-fn__formula[role="img"]')?.getAttribute('aria-label');

/** Поле записи функции. */
const exprOf = (editor: SceneEditor): HTMLInputElement => {
  const input = editor.element.querySelector<HTMLInputElement>('.rte-plots-fn input[data-prop="expr"]');

  if (!input) throw new Error('Нет поля записи');

  return input;
};

/** Набор в поле записи: событие `input` на каждое значение, как при печати. */
const typeExpr = (editor: SceneEditor, ...values: string[]): void => {
  const input = exprOf(editor);

  values.forEach((value) => {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

/** Правка поля записи закончена: `change`, как при Enter или потере фокуса. */
const commitExpr = (editor: SceneEditor): void => {
  exprOf(editor).dispatchEvent(new Event('change', { bubbles: true }));
};

const errorOf = (editor: SceneEditor): string | null => {
  const error = editor.element.querySelector<HTMLElement>('.rte-plots-fn__error');

  return error && !error.hidden ? error.textContent : null;
};

/** Движение ползунка: событие `input`, а `change` — когда отпустили. */
const slide = (input: HTMLInputElement, value: string): void => {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

const release = (input: HTMLInputElement): void => {
  input.dispatchEvent(new Event('change', { bubbles: true }));
};

/** Клик по первой точке пути кривой данного цвета: после загрузки окно просмотра подогнано под сцену. */
const clickCurve = (editor: SceneEditor, color: string): void => {
  const layer = canvasOf(editor).querySelector('.rte-sketch__layer');
  const d = layer?.querySelector(`path[stroke="${color}"]`)?.getAttribute('d') ?? '';
  const points = layer?.querySelector(`polyline[stroke="${color}"]`)?.getAttribute('points') ?? '';
  const [, x, y] = /M\s*(-?[\d.]+)[\s,]+(-?[\d.]+)/.exec(d) ?? /^\s*(-?[\d.]+)[\s,]+(-?[\d.]+)/.exec(points) ?? [];

  if (x === undefined || y === undefined) throw new Error(`Нет кривой цвета ${color}`);

  const init = { bubbles: true, cancelable: true, button: 0, clientX: Number(x), clientY: Number(y), pointerId: 1 };

  canvasOf(editor).dispatchEvent(new PointerEvent('pointerdown', init));
  canvasOf(editor).dispatchEvent(new PointerEvent('pointerup', init));
};

const formulaLabelToggle = (editor: SceneEditor): HTMLInputElement | null => editor.element.querySelector<HTMLInputElement>('.rte-plots-fn input[data-prop="formula-label"]');

const addFunction = (editor: SceneEditor): void => {
  editor.element.querySelector<HTMLButtonElement>('button[data-plot-add="function"]')?.click();
};

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

  it('готовая парабола выбирается кликом по ветви и перетаскивается за вершину', () => {
    const plots = create();
    const canvas = canvasOf(plots);

    // Карандаш по параболе — готовая кривая `parabola`.
    pickTool(plots, 'pencil');
    stroke(
      canvas,
      Array.from({ length: 17 }, (_, i) => {
        const x = -2 + i / 4;

        return [x, x * x] as Point;
      }),
    );
    expect(plotsOf(plots)[0]).toMatchObject({ type: 'parabola', vertex: [0, 0], stretchY: 1 });
    pickTool(plots, 'select');
    click(canvas, [4, 0]);
    expect(propsTitle(plots)).toBe('Оси');

    click(canvas, [2, 4]);
    expect(propsTitle(plots)).toBe('Парабола');
    expect(canvas.querySelector('.rte-sketch__layer path[stroke="#ec4899"]')).not.toBeNull();
    expect(exprOf(plots).value).toBe('x^2');

    pointer(canvas, 'pointerdown', [0, 0]);
    pointer(canvas, 'pointermove', [0.4, -0.6]);
    pointer(canvas, 'pointermove', [1.1, -0.9]);
    pointer(canvas, 'pointerup', [1.1, -0.9]);
    expect(plotsOf(plots)[0]).toMatchObject({ vertex: [1, -1] });
    expect(exprOf(plots).value).toBe('(x-1)^2-1');

    // Точка на кривой выбирается раньше кривой.
    pickTool(plots, 'point');
    click(canvas, [1, -1]);
    pickTool(plots, 'select');
    click(canvas, [1, -1]);
    expect(propsTitle(plots)).toBe('Точка');
  });

  it('панель свойств меняет цвет, пунктир, подпись и область функции; у окружности — центр, радиус и заливка', () => {
    const plots = create();

    pickTemplate(plots, 'hyperbola');
    expect(propsTitle(plots)).toBe('Функция');
    expect(exprOf(plots).value).toBe('1/x');

    // Шаблон гиперболы — зелёный из палитры.
    expect(colorTile(plots, 'green').getAttribute('aria-checked')).toBe('true');
    colorTile(plots, 'red').click();
    expect(plotsOf(plots).map((plot) => plot.color)).toEqual(['#dc2626', '#dc2626']);
    expect(colorTile(plots, 'red').getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(colorTile(plots, 'red'));

    // «Обычный цвет» убирает цвет кривой, как прежде пустое поле hex; поля hex больше нет.
    colorTile(plots, 'default').click();
    expect(plotsOf(plots)[0]).not.toHaveProperty('color');
    expect(colorTile(plots, 'default').getAttribute('aria-pressed')).toBe('true');
    expect(plots.element.querySelector('.rte-builder__props input[maxlength="7"]')).toBeNull();
    colorTile(plots, 'red').click();

    const dashed = controlOf<HTMLInputElement>(plots, 'Пунктир');

    dashed.checked = true;
    dashed.dispatchEvent(new Event('change', { bubbles: true }));
    expect(plotsOf(plots).map((plot) => plot.style)).toEqual(['dashed', 'dashed']);

    // Подпись — только у первой ветви.
    change(controlOf<HTMLInputElement>(plots, 'Метка'), 'y = 1/x');
    expect(plotsOf(plots).map((plot) => plot.label)).toEqual(['y = 1/x', undefined]);

    // Одна граница — полуоткрытая область: бесконечный конец в JSON становится `null`; ветвь левее нуля пропадает.
    change(controlsOf<HTMLInputElement>(plots, 'Область по x (от, до)')[0], '0.5');
    expect(plotsOf(plots)).toHaveLength(1);
    expect(plotsOf(plots)[0].domain).toEqual([0.5, null]);
    expect((plotsOf(plots)[0].points as Point[])[0]?.[0]).toBe(0.5);
    change(controlsOf<HTMLInputElement>(plots, 'Область по x (от, до)')[1], '4');
    expect(plotsOf(plots)[0].domain).toEqual([0.5, 4]);
    change(controlsOf<HTMLInputElement>(plots, 'Область по x (от, до)')[0], '');
    change(controlsOf<HTMLInputElement>(plots, 'Область по x (от, до)')[1], '');
    expect(plotsOf(plots)[0].domain).toBeUndefined();
    expect(plotsOf(plots)).toHaveLength(2);

    // Окружность — готовая кривая: блока «Функция» нет, центр и радиус — числами.
    pickTemplate(plots, 'circle');
    expect(plots.element.querySelector('.rte-plots-fn')).toBeNull();
    change(controlsOf<HTMLInputElement>(plots, 'Центр (x, y)')[0], '1');
    change(controlOf<HTMLInputElement>(plots, 'Радиус'), '1.5');
    change(controlOf<HTMLInputElement>(plots, 'Радиус'), '0.2');

    const fill = controlOf<HTMLInputElement>(plots, 'Заливка');

    fill.checked = true;
    fill.dispatchEvent(new Event('change', { bubbles: true }));
    expect(plotsOf(plots)[2]).toMatchObject({ type: 'circle', center: [1, 0], radius: 0.5, fill: true });
  });

  it('цвет из чертежа: чужой цвет — одиннадцатая плитка, синоним — плитка палитры; сцена без действий не переписывается', () => {
    const plots = create();
    let changes = 0;

    plots.onChange(() => {
      changes += 1;
    });
    plots.load({
      type: 'plot_2d',
      plots: [
        { id: 'p', type: 'parabola', vertex: [0, 0], direction: 'up', stretchX: 1, stretchY: 1, color: '#ABCDEF' },
        { id: 'q', type: 'parabola', vertex: [0, -4], direction: 'up', stretchX: 1, stretchY: 1, color: '#3b82f6' },
      ],
    });
    pickTool(plots, 'select');

    clickCurve(plots, '#ABCDEF');
    expect(propsTitle(plots)).toBe('Парабола');
    expect(colorTile(plots, 'other').getAttribute('aria-checked')).toBe('true');
    expect(colorTile(plots, 'other').getAttribute('aria-label')).toBe('Цвет из чертежа');
    expect(plots.element.querySelectorAll('.rte-builder__props .rte-builder__colors [role="radio"]')).toHaveLength(11);

    // Синоним прежней палитры — с плиткой «Синий», значение в сцене прежнее.
    clickCurve(plots, '#3b82f6');
    expect(colorTile(plots, 'blue').getAttribute('aria-checked')).toBe('true');
    expect(plots.element.querySelector('.rte-builder__props [data-color="other"]')).toBeNull();
    expect(plotsOf(plots).map((plot) => plot.color)).toEqual(['#ABCDEF', '#3b82f6']);
    expect(changes).toBe(0);

    // Выбор плитки палитры — правка; плитка «Цвет из чертежа» исчезает.
    clickCurve(plots, '#ABCDEF');
    colorTile(plots, 'purple').click();
    expect(plotsOf(plots)[0].color).toBe('#8b5cf6');
    expect(changes).toBe(1);
    expect(plots.element.querySelector('.rte-builder__props [data-color="other"]')).toBeNull();
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

    // Набранная функция копируется целиком, со своим `fn`; её место задаёт запись — копия на том же месте.
    pickTemplate(plots, 'hyperbola');
    actionButton(plots, 'Копировать график').click();
    actionButton(plots, 'Вставить график').click();

    const branches = plotsOf(plots).slice(3);

    expect(branches.map((plot) => [plot.expr, plot.fn])).toEqual([
      ['1/x', 'plot_4'],
      ['1/x', 'plot_4'],
      ['1/x', 'plot_5'],
      ['1/x', 'plot_5'],
    ]);
    expect(branches[2]?.points).toEqual(branches[0]?.points);
    expect(propsTitle(plots)).toBe('Функция');
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

describe('набранная функция', () => {
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

  it('«+ Функция» → набор x^2-1 → ветви freehand с expr и fn; загрузка собирает одну функцию; нетронутая отдаётся дословно', () => {
    const plots = create();
    let changes = 0;

    plots.onChange(() => {
      changes += 1;
    });

    addFunction(plots);
    expect(propsTitle(plots)).toBe('Функция');
    expect(document.activeElement).toBe(exprOf(plots));
    expect(exprOf(plots).getAttribute('inputmode')).toBe('text');
    expect(exprOf(plots).getAttribute('autocapitalize')).toBe('off');
    expect(exprOf(plots).getAttribute('spellcheck')).toBe('false');
    // Пустая функция в сцену не попадает.
    expect(plotsOf(plots)).toEqual([]);
    expect(changes).toBe(0);

    typeExpr(plots, 'x', 'x^', 'x^2', 'x^2-', 'x^2-1');
    commitExpr(plots);
    expect(changes).toBe(1);
    expect(formulaOf(plots)).toBe('y = x² − 1');

    const scene = plots.getScene();
    const branches = scene.plots as Array<Record<string, unknown>>;

    expect(branches).toHaveLength(1);
    expect(branches[0]).toMatchObject({ id: 'plot_1', type: 'freehand', expr: 'x^2-1', fn: 'plot_1', style: 'solid', color: '#2563eb' });
    expect(branches[0]).not.toHaveProperty('params');
    expect((branches[0]?.points as Point[]).length).toBeGreaterThan(10);

    // Загрузка: одна функция с той же записью; сцена без правок — дословно такая же.
    const saved = JSON.parse(JSON.stringify({ ...scene, plots: [{ ...branches[0], note: 'keep' }] })) as Record<string, unknown>;

    plots.load(saved);
    expect(plots.getScene()).toEqual(saved);
    clickCurve(plots, '#2563eb');
    expect(propsTitle(plots)).toBe('Функция');
    expect(exprOf(plots).value).toBe('x^2-1');
    // Выделение и показ блока сцену не меняют.
    expect(plots.getScene()).toEqual(saved);

    // Правка — ветви заново, чужое поле первой ветви остаётся.
    typeExpr(plots, 'x^2-2');
    commitExpr(plots);
    expect(plotsOf(plots)[0]).toMatchObject({ expr: 'x^2-2', note: 'keep' });
    expect(plotsOf(plots)[0]?.points).not.toEqual((saved.plots as Array<Record<string, unknown>>)[0]?.points);
  });

  it('ветви одной функции собираются по fn и записи; обычная ломаная без expr остаётся ломаной', () => {
    const plots = create();
    const scene = {
      type: 'plot_2d',
      plots: [
        { id: 'a', type: 'freehand', points: [[-3, -0.333], [-0.1, -10]], expr: '1/x', fn: 'f', color: '#16a34a', label: 'y = 1/x' },
        { id: 'z', type: 'freehand', points: [[0, 0], [1, 2], [2, -1]] },
        { id: 'b', type: 'freehand', points: [[0.1, 10], [3, 0.333]], expr: '1/x', fn: 'f', color: '#16a34a' },
      ],
    };

    plots.load(scene);
    // Ветви дословно, функция — на месте первой ветви.
    expect(plotsOf(plots)).toEqual([scene.plots[0], scene.plots[2], { ...scene.plots[1], style: 'solid' }]);
    pickTool(plots, 'select');
    clickCurve(plots, '#16a34a');
    expect(propsTitle(plots)).toBe('Функция');
    // Подпись, равная записи, — признак подписи формулой.
    expect(formulaLabelToggle(plots)?.checked).toBe(true);

    // Обе ветви — один объект: одна команда удаляет обе.
    key(canvasOf(plots), 'Delete');
    expect(plotsOf(plots).map((plot) => plot.id)).toEqual(['z']);
    key(canvasOf(plots), 'z', { ctrlKey: true });
    expect(plotsOf(plots).map((plot) => plot.id)).toEqual(['a', 'b', 'z']);
  });

  it('правка записи — один шаг истории; неправильная запись показывает ошибку и не меняет сцену; Escape возвращает прежнюю', () => {
    const plots = create();
    const canvas = canvasOf(plots);

    pickTemplate(plots, 'parabola');
    expect(exprOf(plots).value).toBe('x^2');
    expect(document.activeElement).toBe(exprOf(plots));

    const before = JSON.stringify(plots.getScene());

    typeExpr(plots, 'x^2 ', 'x^2 -', 'x^2 - 4');
    expect(formulaOf(plots)).toBe('y = x² − 4');
    commitExpr(plots);
    expect(plotsOf(plots)[0]?.expr).toBe('x^2 - 4');

    const edited = JSON.stringify(plots.getScene());

    // Неправильная запись: ошибка под полем, на полотне и в сцене — последняя правильная.
    typeExpr(plots, 'x^2 - 4)');
    expect(errorOf(plots)).toBe('Лишняя закрывающая скобка');
    expect(exprOf(plots).getAttribute('aria-invalid')).toBe('true');
    expect(formulaOf(plots)).toBe('y = x² − 4');
    commitExpr(plots);
    expect(JSON.stringify(plots.getScene())).toBe(edited);

    typeExpr(plots, 'x^');
    expect(errorOf(plots)).toBe('Здесь должно быть число или x');
    typeExpr(plots, 'foo');
    expect(errorOf(plots)).toBe('Не понимаю «foo»');

    // Escape — запись на начало правки, сцена прежняя, окно не закрывается (событие обработано).
    typeExpr(plots, 'x^3');
    expect(plotsOf(plots)[0]?.expr).toBe('x^3');

    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });

    exprOf(plots).dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(exprOf(plots).value).toBe('x^2 - 4');
    expect(errorOf(plots)).toBeNull();
    expect(JSON.stringify(plots.getScene())).toBe(edited);

    // Отмена: правка записи была одним шагом.
    key(canvas, 'z', { ctrlKey: true });
    expect(JSON.stringify(plots.getScene())).toBe(before);
    key(canvas, 'y', { ctrlKey: true });
    expect(JSON.stringify(plots.getScene())).toBe(edited);
  });

  it('буква a — ползунок от −10 до 10, жест — один шаг; пропавшие буквы забываются', () => {
    const plots = create();
    const canvas = canvasOf(plots);

    addFunction(plots);
    typeExpr(plots, 'a*x^2');
    commitExpr(plots);
    expect(paramIds(plots)).toEqual(['a']);

    const slider = paramControl(plots, 'a', 'range');

    expect(slider).toMatchObject({ min: '-10', max: '10', step: '0.1', value: '1' });
    expect(paramControl(plots, 'a', 'number').hasAttribute('min')).toBe(false);

    const start = JSON.stringify(plots.getScene());

    slide(slider, '1.5');
    slide(slider, '2');
    // Во время жеста блок не пересоздаётся.
    expect(paramControl(plots, 'a', 'range')).toBe(slider);
    expect(plotsOf(plots)[0]?.params).toEqual({ a: 2 });
    release(slider);
    key(canvas, 'z', { ctrlKey: true });
    expect(JSON.stringify(plots.getScene())).toBe(start);
    key(canvas, 'y', { ctrlKey: true });

    // Число в поле — тоже шаг.
    change(paramControl(plots, 'a', 'number'), '-3');
    expect(plotsOf(plots)[0]?.params).toEqual({ a: -3 });

    // Новая буква — со значением 1; пропавшая забывается при фиксации правки.
    typeExpr(plots, 'a*x^2 + b');
    expect(paramIds(plots)).toEqual(['a', 'b']);
    typeExpr(plots, 'b');
    commitExpr(plots);
    expect(paramIds(plots)).toEqual(['b']);
    expect(plotsOf(plots)[0]?.params).toEqual({ b: 1 });
  });

  it('функция выделяется нажатием на ветвь, но не перетаскивается', () => {
    const plots = create();
    const canvas = canvasOf(plots);

    pickTemplate(plots, 'line');
    plots.cancel();

    const points = plotsOf(plots)[0]?.points;

    pointer(canvas, 'pointerdown', [1, 1]);
    expect(propsTitle(plots)).toBe('Функция');
    pointer(canvas, 'pointermove', [2, 0]);
    pointer(canvas, 'pointerup', [2, 0]);
    expect(plotsOf(plots)[0]?.points).toEqual(points);
    // Подсветка выделения — на ветви.
    expect(canvas.querySelector('.rte-sketch__layer polyline[stroke="#ec4899"]')).not.toBeNull();
  });

  it('пустая функция исчезает, когда выделение ушло', () => {
    const plots = create();

    addFunction(plots);
    typeExpr(plots, 'x^');
    plots.cancel();
    expect(plotsOf(plots)).toEqual([]);
    expect(plots.element.querySelector('.rte-plots-fn')).toBeNull();

    // Набранная остаётся.
    addFunction(plots);
    typeExpr(plots, 'sin x');
    commitExpr(plots);
    plots.cancel();
    expect(plotsOf(plots).every((plot) => plot.expr === 'sin x')).toBe(true);
  });

  it('готовая парабола показывает запись; правка заменяет её набранной функцией с тем же цветом и местом', () => {
    const plots = create();

    plots.load({
      type: 'plot_2d',
      plots: [
        { id: 'p', type: 'parabola', vertex: [1, -3], direction: 'up', stretchX: 1, stretchY: 2, color: '#3b82f6', style: 'dashed', label: 'моя' },
        { id: 'q', type: 'point', coords: [0, 0] },
      ],
    });
    clickCurve(plots, '#3b82f6');
    expect(propsTitle(plots)).toBe('Парабола');
    expect(exprOf(plots).value).toBe('2(x-1)^2-3');
    expect(formulaOf(plots)).toBe('y = 2(x − 1)² − 3');
    // Ползунков коэффициентов нет.
    expect(paramIds(plots)).toEqual([]);

    const before = JSON.stringify(plots.getScene());

    typeExpr(plots, '2(x-1)^2-5');
    expect(propsTitle(plots)).toBe('Функция');
    commitExpr(plots);
    expect(plotsOf(plots)[0]).toMatchObject({ id: 'p', type: 'freehand', expr: '2(x-1)^2-5', fn: 'p', color: '#3b82f6', style: 'dashed', label: 'моя' });
    expect(plotsOf(plots).at(-1)).toMatchObject({ id: 'q', type: 'point' });

    // Один шаг истории: отмена возвращает готовую параболу.
    key(canvasOf(plots), 'z', { ctrlKey: true });
    expect(JSON.stringify(plots.getScene())).toBe(before);
  });

  it('у отрезка по двум точкам и окружности блока «Функция» нет', () => {
    const plots = create();

    pickTool(plots, 'pencil');
    stroke(
      canvasOf(plots),
      Array.from({ length: 5 }, (_, i) => [i / 2, i / 2] as Point),
    );
    expect(plotsOf(plots)[0]).toMatchObject({ type: 'line', p1: [0, 0], p2: [2, 2] });
    expect(plots.element.querySelector('.rte-plots-fn')).toBeNull();
    expect(controlsOf<HTMLInputElement>(plots, 'Первая точка (x, y)').map((input) => input.value)).toEqual(['0', '0']);
  });

  it('подпись формулой следует за правкой записи и не трогает чужие подписи; ручная правка снимает флажок', () => {
    const plots = create();
    // Подписи по графикам: у функции — только у первой ветви, остальные ветви без подписи.
    const labels = (): unknown[] => plotsOf(plots).flatMap((plot) => (plot.type === 'freehand' && plot.id !== plot.fn ? [] : [plot.label]));

    plots.load({
      type: 'plot_2d',
      plots: [{ id: 'q', type: 'parabola', vertex: [0, -1], direction: 'up', stretchX: 1, stretchY: 0.5, color: '#16a34a', label: 'y=0.5x^2-1' }],
    });
    pickTemplate(plots, 'sine');
    expect(exprOf(plots).value).toBe('sin(x)');

    const toggle = formulaLabelToggle(plots);

    if (!toggle) throw new Error('Нет флажка подписи-формулы');

    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    expect(labels()[1]).toBe('y = sin(x)');

    typeExpr(plots, '2sin x');
    commitExpr(plots);
    expect(labels()).toEqual(['y=0.5x^2-1', 'y = 2sin(x)']);
    expect(controlOf<HTMLInputElement>(plots, 'Метка').value).toBe('y = 2sin(x)');

    change(controlOf<HTMLInputElement>(plots, 'Метка'), 'синус');
    expect(formulaLabelToggle(plots)?.checked).toBe(false);
    typeExpr(plots, '3sin x');
    commitExpr(plots);
    expect(labels()[1]).toBe('синус');

    // Подпись готовой кривой, равная её формуле, тоже следует за правкой.
    clickCurve(plots, '#16a34a');
    expect(formulaLabelToggle(plots)?.checked).toBe(true);
    typeExpr(plots, '0,5x^2-2');
    commitExpr(plots);
    expect(labels()).toEqual(['y = 0,5x^2 - 2', 'синус']);
  });

  it('кнопки-подсказки вставляют текст в позицию курсора и не уводят фокус', () => {
    const plots = create();
    const keyButton = (text: string): HTMLButtonElement => {
      const button = plots.element.querySelector<HTMLButtonElement>(`.rte-plots-fn__keys button[data-key="${text}"]`);

      if (!button) throw new Error(`Нет кнопки ${text}`);

      return button;
    };

    addFunction(plots);
    expect([...plots.element.querySelectorAll('.rte-plots-fn__keys button')].map((button) => button.textContent)).toEqual([
      'x²',
      'xⁿ',
      '√',
      '|x|',
      '( )',
      'π',
      'sin',
      'cos',
      'tg',
      'ln',
    ]);
    expect(keyButton('√').getAttribute('aria-label')).toBe('Корень');

    keyButton('x²').click();
    expect(exprOf(plots).value).toBe('x^2');
    keyButton('x²').click();
    expect(exprOf(plots).value).toBe('x^2^2');
    exprOf(plots).value = '2';
    exprOf(plots).setSelectionRange(1, 1);
    keyButton('sin').click();
    expect(exprOf(plots).value).toBe('2sin()');
    expect(exprOf(plots).selectionStart).toBe(5);
    keyButton('π').click();
    expect(exprOf(plots).value).toBe('2sin(π)');
    expect(document.activeElement).toBe(exprOf(plots));
    // Вставка — как набор: график сразу.
    expect(plotsOf(plots)[0]?.expr).toBe('2sin(π)');

    // Выделенное оказывается внутри пары.
    exprOf(plots).value = 'x - 2';
    exprOf(plots).setSelectionRange(0, 5);
    keyButton('|x|').click();
    expect(exprOf(plots).value).toBe('|x - 2|');
    expect(plotsOf(plots)[0]?.expr).toBe('|x - 2|');
  });

  it('при выделенной функции палитра — строка значков, подсказка — о записи функции', () => {
    const plots = create();
    const palette = plots.element.querySelector('.rte-plots__palette');
    const hint = (): string | null | undefined => plots.element.querySelector('.rte-builder__hint')?.textContent;

    expect(palette?.classList.contains('rte-plots__palette--compact')).toBe(false);
    expect(hint()).toContain('«+ Функция»');
    expect(palette?.querySelector('button')?.textContent).toBe('+ Функция');
    [...(palette?.querySelectorAll('button[data-plot-template]') ?? [])].forEach((button) => {
      expect(button.getAttribute('aria-label')).toBe(button.getAttribute('title'));
    });

    pickTemplate(plots, 'abs');
    expect(exprOf(plots).value).toBe('|x|');
    expect(palette?.classList.contains('rte-plots__palette--compact')).toBe(true);
    expect(hint()).toBe('Напиши функцию — график построится сам. Буквы вроде a и b станут ползунками');

    // Точка — не функция: палитра с подписями, подсказка инструмента.
    pickTool(plots, 'point');
    click(canvasOf(plots), [5, 5]);
    expect(palette?.classList.contains('rte-plots__palette--compact')).toBe(false);

    plots.cancel();
    expect(hint()).toContain('«+ Функция»');
  });

  it('вид полотна изменился — ветви пересчитываются под новое окно', async () => {
    const plots = create();

    pickTemplate(plots, 'line');

    const before = plotsOf(plots)[0]?.points as Point[];

    actionButton(plots, 'Мельче').click();
    // Сцена, взятая до кадра, уже пересчитана.
    const after = plotsOf(plots)[0]?.points as Point[];

    expect(after[0]?.[0]).toBeLessThan(before[0]?.[0] ?? 0);
    await new Promise((resolve) => {
      setTimeout(resolve, 40);
    });
    expect(plotsOf(plots)[0]?.points).toEqual(after);
  });
});

describe('подписи конструктора графиков', () => {
  it('английская таблица повторяет набор ключей русской, все ключи с префиксом конструктора', () => {
    const ru = Object.keys(PLOTS_MESSAGES.ru);

    expect(Object.keys(PLOTS_MESSAGES.en).sort()).toEqual([...ru].sort());
    expect(ru.filter((key) => !key.startsWith('drawings_plots_'))).toEqual([]);
    // Десятичный разделитель — общий для чертежей.
    expect([BUILDER_MESSAGES.ru?.drawings_decimal_separator, BUILDER_MESSAGES.en?.drawings_decimal_separator]).toEqual([',', '.']);
    // Таблица вкладки влита в таблицы возможности: диалог переводит её ключи.
    expect(ru.every((key) => key in DRAWINGS_MESSAGES.ru)).toBe(true);
  });
});
