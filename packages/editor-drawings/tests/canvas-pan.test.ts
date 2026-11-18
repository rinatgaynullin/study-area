import type { Translate } from '@rich-editor/core';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { BUILDER_MESSAGES } from '../src/builders/messages';
import { physicsEditorFactory } from '../src/builders/physics-editor';
import { PHYSICS_BUILDER_MESSAGES } from '../src/builders/physics-messages';
import { planimetryEditorFactory } from '../src/builders/planimetry-editor';
import { plotsEditorFactory } from '../src/builders/plots-editor';
import { PLOTS_MESSAGES } from '../src/builders/plots-messages';
import type { SceneEditor, SceneEditorFactory } from '../src/builders/types';

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

const t: Translate = (key) => PHYSICS_BUILDER_MESSAGES.ru[key] ?? PLOTS_MESSAGES.ru[key] ?? BUILDER_MESSAGES.ru[key] ?? key;

/** Полотно 560×420; в jsdom `getBoundingClientRect` даёт нули, поэтому координаты viewBox равны клиентским. */
const WIDTH = 560;
const HEIGHT = 420;

type Vec = [number, number];
type PointerType = 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel';

/**
 * Вид, от которого считаются нажатия: центр окна и масштаб. Конструктор вид
 * наружу не отдаёт — то, что он сдвинулся, видно по тому, куда попадают клики.
 */
let view = { scale: 40, cx: WIDTH / 2, cy: HEIGHT / 2 };

const clientOf = ([x, y]: Vec): Vec => [view.cx + x * view.scale, view.cy - y * view.scale];

const moveView = (dx: number, dy: number): void => {
  view = { ...view, cx: view.cx + dx, cy: view.cy + dy };
};

const pointer = (target: HTMLElement, type: PointerType, [clientX, clientY]: Vec, init: Partial<PointerEventInit> = {}): void => {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, clientX, clientY, pointerId: 1, ...init }));
};

const click = (target: HTMLElement, at: Vec): void => {
  pointer(target, 'pointerdown', at);
  pointer(target, 'pointerup', at);
};

const drag = (target: HTMLElement, from: Vec, to: Vec): void => {
  pointer(target, 'pointerdown', from);
  pointer(target, 'pointermove', [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]);
  pointer(target, 'pointermove', to);
  pointer(target, 'pointerup', to);
};

/** Протяжка: первый шаг в 5 px проходит порог и становится точкой отсчёта, дальше — сдвиг на `by`. */
const panBy = (target: HTMLElement, from: Vec, [dx, dy]: Vec): void => {
  const start: Vec = [from[0] + 5, from[1]];

  pointer(target, 'pointerdown', from);
  pointer(target, 'pointermove', start);
  pointer(target, 'pointermove', [start[0] + dx / 2, start[1] + dy / 2]);
  pointer(target, 'pointermove', [start[0] + dx, start[1] + dy]);
  pointer(target, 'pointerup', [start[0] + dx, start[1] + dy]);
};

const key = (target: HTMLElement, name: string, init: Partial<KeyboardEventInit> = {}): void => {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init }));
};

const pickTool = (editor: SceneEditor, tool: string): void => {
  editor.element.querySelector<HTMLButtonElement>(`button[data-tool="${tool}"]`)?.click();
};

const canvasOf = (editor: SceneEditor): HTMLElement => {
  const canvas = editor.element.querySelector<HTMLElement>('.rte-sketch');

  if (!canvas) throw new Error('Нет полотна');

  return canvas;
};

let editor: SceneEditor | undefined;

afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

const create = (factory: SceneEditorFactory, scale: number): SceneEditor => {
  view = { scale, cx: WIDTH / 2, cy: HEIGHT / 2 };
  editor = factory.create({ t });
  document.body.appendChild(editor.element);

  return editor;
};

describe('перемещение листа в планиметрии', () => {
  const verticesOf = (planimetry: SceneEditor): Record<string, number[]> => planimetry.getScene().vertices as Record<string, number[]>;

  it('в «Выбрать» протяжка пустого места двигает вид; сцена и история прежние', () => {
    const planimetry = create(planimetryEditorFactory, 40);
    const canvas = canvasOf(planimetry);
    let changes = 0;

    pickTool(planimetry, 'point');
    click(canvas, clientOf([1, 1]));
    pickTool(planimetry, 'select');
    planimetry.onChange(() => {
      changes += 1;
    });

    const before = planimetry.getScene();

    panBy(canvas, clientOf([-5, -4]), [40, -20]);
    moveView(40, -20);
    expect(planimetry.getScene()).toEqual(before);
    expect(changes).toBe(0);

    // Отмена снимает точку: перемещение вида шагом истории не было.
    key(canvas, 'z', { ctrlKey: true });
    expect(verticesOf(planimetry)).toEqual({});

    // Клик по сдвинутому листу попадает туда, куда уехала клетка.
    pickTool(planimetry, 'point');
    click(canvas, clientOf([2, 2]));
    expect(verticesOf(planimetry)).toEqual({ A: [2, 2] });
  });

  it('в «Точке» клик без движения ставит точку, протяжка двигает вид и точку не ставит', () => {
    const planimetry = create(planimetryEditorFactory, 40);
    const canvas = canvasOf(planimetry);

    pickTool(planimetry, 'point');
    click(canvas, clientOf([1, 1]));
    expect(verticesOf(planimetry)).toEqual({ A: [1, 1] });

    panBy(canvas, clientOf([-4, -3]), [40, 0]);
    moveView(40, 0);
    expect(verticesOf(planimetry)).toEqual({ A: [1, 1] });

    click(canvas, clientOf([2, 1]));
    expect(verticesOf(planimetry)).toEqual({ A: [1, 1], B: [2, 1] });
  });

  it('перетаскивание вершины по-прежнему двигает вершину, а не вид', () => {
    const planimetry = create(planimetryEditorFactory, 40);
    const canvas = canvasOf(planimetry);

    pickTool(planimetry, 'point');
    click(canvas, clientOf([1, 1]));
    pickTool(planimetry, 'select');
    drag(canvas, clientOf([1, 1]), clientOf([3, 2]));
    expect(verticesOf(planimetry)).toEqual({ A: [3, 2] });

    pickTool(planimetry, 'point');
    click(canvas, clientOf([-2, -2]));
    expect(verticesOf(planimetry)).toEqual({ A: [3, 2], B: [-2, -2] });
  });

  it('черновик отрезка переживает перемещение вида', () => {
    const planimetry = create(planimetryEditorFactory, 40);
    const canvas = canvasOf(planimetry);

    pickTool(planimetry, 'segment');
    click(canvas, clientOf([0, 0]));
    panBy(canvas, clientOf([-4, -3]), [40, 20]);
    moveView(40, 20);
    click(canvas, clientOf([2, 0]));

    expect(verticesOf(planimetry)).toEqual({ A: [0, 0], B: [2, 0] });
    expect(planimetry.getScene().edges).toHaveLength(1);
  });

  it('курсор «рука» — над пустым местом в «Выбрать»', () => {
    const planimetry = create(planimetryEditorFactory, 40);
    const canvas = canvasOf(planimetry);

    pickTool(planimetry, 'point');
    click(canvas, clientOf([1, 1]));
    pointer(canvas, 'pointermove', clientOf([-3, -3]));
    expect(canvas.classList.contains('rte-sketch--grab')).toBe(false);

    pickTool(planimetry, 'select');
    pointer(canvas, 'pointermove', clientOf([-3, -3]));
    expect(canvas.classList.contains('rte-sketch--grab')).toBe(true);
    pointer(canvas, 'pointermove', clientOf([1, 1]));
    expect(canvas.classList.contains('rte-sketch--grab')).toBe(false);
  });

  it('стрелки без выделения двигают вид на шаг сетки, с выделением — не трогают', () => {
    const planimetry = create(planimetryEditorFactory, 40);
    const canvas = canvasOf(planimetry);

    // «Влево» показывает то, что левее: лист едет вправо на полклетки.
    key(canvas, 'ArrowLeft');
    key(canvas, 'ArrowDown');
    moveView(20, -20);

    pickTool(planimetry, 'point');
    click(canvas, clientOf([1, 1]));
    expect(verticesOf(planimetry)).toEqual({ A: [1, 1] });

    pickTool(planimetry, 'select');
    click(canvas, clientOf([1, 1]));
    key(canvas, 'ArrowLeft');
    expect(verticesOf(planimetry)).toEqual({ A: [1, 1] });

    pickTool(planimetry, 'point');
    click(canvas, clientOf([2, 2]));
    expect(verticesOf(planimetry)).toEqual({ A: [1, 1], B: [2, 2] });
  });

  it('второй палец отменяет перетаскивание вершины: она на месте; оставшийся палец ничего не двигает', () => {
    const planimetry = create(planimetryEditorFactory, 40);
    const canvas = canvasOf(planimetry);

    pickTool(planimetry, 'point');
    click(canvas, clientOf([1, 1]));
    pickTool(planimetry, 'select');

    const first = clientOf([2, 1]);

    pointer(canvas, 'pointerdown', clientOf([1, 1]), { pointerId: 1 });
    pointer(canvas, 'pointermove', first, { pointerId: 1 });
    expect(verticesOf(planimetry)).toEqual({ A: [2, 1] });

    // Оба пальца сдвигаются на (20, 20): лист едет за ними, вершина стоит.
    pointer(canvas, 'pointerdown', [500, 60], { pointerId: 2 });
    pointer(canvas, 'pointermove', [first[0] + 20, first[1] + 20], { pointerId: 1 });
    pointer(canvas, 'pointermove', [520, 80], { pointerId: 2 });
    moveView(20, 20);
    pointer(canvas, 'pointerup', [520, 80], { pointerId: 2 });
    pointer(canvas, 'pointermove', [300, 300], { pointerId: 1 });
    pointer(canvas, 'pointerup', [300, 300], { pointerId: 1 });
    expect(verticesOf(planimetry)).toEqual({ A: [1, 1] });

    // Ничего не залипло: движение без нажатия вершину не тащит; отмена снимает саму точку — шага переноса нет.
    pointer(canvas, 'pointermove', clientOf([-3, -3]));
    expect(verticesOf(planimetry)).toEqual({ A: [1, 1] });
    key(canvas, 'z', { ctrlKey: true });
    expect(verticesOf(planimetry)).toEqual({});

    pickTool(planimetry, 'point');
    click(canvas, clientOf([-2, -2]));
    expect(Object.values(verticesOf(planimetry))).toEqual([[-2, -2]]);
  });
});

describe('перемещение листа в графиках', () => {
  const plotsOf = (plots: SceneEditor): Array<Record<string, unknown>> => plots.getScene().plots as Array<Record<string, unknown>>;
  const addLine = (plots: SceneEditor): void => {
    plots.element.querySelector<HTMLButtonElement>('button[data-plot-template="line"]')?.click();
  };
  /** Точка инструментом «Точка»: по её координатам видно, куда смотрит полотно. */
  const pointAt = (plots: SceneEditor, at: Vec): unknown => {
    pickTool(plots, 'point');
    click(canvasOf(plots), clientOf(at));

    return plotsOf(plots)[plotsOf(plots).length - 1]?.coords;
  };

  it('протяжка пустого места двигает вид, графики на месте', () => {
    const plots = create(plotsEditorFactory, 30);
    const canvas = canvasOf(plots);

    addLine(plots);
    pickTool(plots, 'select');

    const before = plots.getScene();

    panBy(canvas, clientOf([-8, -6]), [30, 15]);
    moveView(30, 15);
    expect(plots.getScene()).toEqual(before);
    expect(pointAt(plots, [2, 2])).toEqual([2, 2]);
  });

  it('перетаскивание прямой двигает прямую, а не вид', () => {
    const plots = create(plotsEditorFactory, 30);
    const canvas = canvasOf(plots);

    addLine(plots);
    pickTool(plots, 'select');

    // Шаблон — прямая y = x: сдвиг на клетку вправо даёт y = x − 1.
    expect(plotsOf(plots)[0]).toMatchObject({ type: 'line', k: 1, b: 0 });
    drag(canvas, clientOf([1, 1]), clientOf([2, 1]));
    expect(plotsOf(plots)[0]).toMatchObject({ type: 'line', k: 1, b: -1 });
    expect(pointAt(plots, [-3, -3])).toEqual([-3, -3]);
  });

  it('в «Карандаше» протяжка с пустого места рисует штрих, вид не двигается', () => {
    const plots = create(plotsEditorFactory, 30);
    const canvas = canvasOf(plots);

    pickTool(plots, 'pencil');
    pointer(canvas, 'pointerdown', clientOf([-3, -3]));
    [-2, -1, 0, 1, 2, 3].forEach((x) => pointer(canvas, 'pointermove', clientOf([x, -3])));
    pointer(canvas, 'pointerup', clientOf([3, -3]));

    expect(plotsOf(plots)).toHaveLength(1);
    expect(plotsOf(plots)[0]?.type).toBe('line');
    expect(pointAt(plots, [1, 1])).toEqual([1, 1]);
  });

  it('стрелки без выделения двигают вид, с выделенным графиком — нет', () => {
    const plots = create(plotsEditorFactory, 30);
    const canvas = canvasOf(plots);

    key(canvas, 'ArrowRight');
    moveView(-15, 0);

    addLine(plots);

    const before = plots.getScene();

    key(canvas, 'ArrowRight');
    expect(plots.getScene()).toEqual(before);
    expect(pointAt(plots, [2, 2])).toEqual([2, 2]);
  });
});

describe('перемещение листа в физике', () => {
  const elementsOf = (physics: SceneEditor): Array<Record<string, unknown>> => physics.getScene().elements as Array<Record<string, unknown>>;
  const nothingSelected = (physics: SceneEditor): boolean => physics.element.querySelector('.rte-builder__props-empty') !== null;

  const addBlock = (physics: SceneEditor): void => {
    physics.element.querySelector<HTMLButtonElement>('button[data-element="block_rect"]')?.click();
  };

  it('протяжка пустого места двигает вид и выделение не снимает; клик без движения — снимает', () => {
    const physics = create(physicsEditorFactory, 30);
    const canvas = canvasOf(physics);

    addBlock(physics);
    pickTool(physics, 'select');
    click(canvas, clientOf([0.3, 0.2]));
    expect(nothingSelected(physics)).toBe(false);

    const before = physics.getScene();

    panBy(canvas, clientOf([-6, -5]), [-30, 30]);
    moveView(-30, 30);
    expect(physics.getScene()).toEqual(before);
    expect(nothingSelected(physics)).toBe(false);

    click(canvas, clientOf([-6, -5]));
    expect(nothingSelected(physics)).toBe(true);

    // Брусок уехал вместе с листом: его берут на новом месте.
    drag(canvas, clientOf([0.3, 0.2]), clientOf([2.3, 1.2]));
    expect(elementsOf(physics)[0]?.center).toEqual([2, 1]);
  });

  it('перетаскивание элемента двигает элемент, а не вид', () => {
    const physics = create(physicsEditorFactory, 30);
    const canvas = canvasOf(physics);

    addBlock(physics);
    pickTool(physics, 'select');
    drag(canvas, clientOf([0.3, 0.2]), clientOf([2.3, 1.2]));
    expect(elementsOf(physics)[0]?.center).toEqual([2, 1]);
    drag(canvas, clientOf([2.3, 1.2]), clientOf([0.3, 1.2]));
    expect(elementsOf(physics)[0]?.center).toEqual([0, 1]);
  });

  it('стрелки без выделения двигают вид, с выделением — нет', () => {
    const physics = create(physicsEditorFactory, 30);
    const canvas = canvasOf(physics);

    key(canvas, 'ArrowUp');
    moveView(0, 15);

    addBlock(physics);
    click(canvas, clientOf([0.3, 0.7]));
    expect(nothingSelected(physics)).toBe(false);

    // Палитра ставит элемент в центр видимой части: лист сдвинут на полклетки вверх.
    expect(elementsOf(physics)[0]?.center).toEqual([0, 0.5]);

    const before = physics.getScene();

    key(canvas, 'ArrowUp');
    expect(physics.getScene()).toEqual(before);
    drag(canvas, clientOf([0.3, 0.7]), clientOf([1.3, 0.7]));
    expect(elementsOf(physics)[0]?.center).toEqual([1, 0.5]);
  });

  it('второй палец отменяет перетаскивание элемента, дальше всё как обычно', () => {
    const physics = create(physicsEditorFactory, 30);
    const canvas = canvasOf(physics);

    addBlock(physics);
    pickTool(physics, 'select');

    const first = clientOf([1.3, 0.2]);

    pointer(canvas, 'pointerdown', clientOf([0.3, 0.2]), { pointerId: 1 });
    pointer(canvas, 'pointermove', first, { pointerId: 1 });
    expect(elementsOf(physics)[0]?.center).toEqual([1, 0]);

    pointer(canvas, 'pointerdown', [500, 60], { pointerId: 2 });
    pointer(canvas, 'pointermove', [first[0] + 30, first[1]], { pointerId: 1 });
    pointer(canvas, 'pointermove', [530, 60], { pointerId: 2 });
    moveView(30, 0);
    pointer(canvas, 'pointerup', [530, 60], { pointerId: 2 });
    pointer(canvas, 'pointermove', [120, 320], { pointerId: 1 });
    pointer(canvas, 'pointerup', [120, 320], { pointerId: 1 });
    expect(elementsOf(physics)[0]?.center).toEqual([0, 0]);

    drag(canvas, clientOf([0.3, 0.2]), clientOf([2.3, 1.2]));
    expect(elementsOf(physics)[0]?.center).toEqual([2, 1]);
  });
});

/**
 * Отмены жеста: `pointercancel`, второй палец и Escape (`cancel()` конструктора).
 * После отмены отпускаются все пальцы — это ничего не должно менять.
 */
const CANCELS: Record<string, (target: HTMLElement, at: Vec) => void> = {
  pointercancel: (target, at) => pointer(target, 'pointercancel', at),
  'второй палец': (target) => pointer(target, 'pointerdown', [500, 60], { pointerId: 2 }),
  Escape: (target) => key(target, 'Escape'),
};

const releaseAll = (target: HTMLElement, at: Vec): void => {
  pointer(target, 'pointerup', [500, 60], { pointerId: 2 });
  pointer(target, 'pointerup', at);
};

describe('отменённый жест не оставляет результата', () => {
  it('планиметрия: вершина возвращается на место, шага истории нет', () => {
    const planimetry = create(planimetryEditorFactory, 40);
    const canvas = canvasOf(planimetry);
    const verticesOf = (): unknown => planimetry.getScene().vertices;
    let changes = 0;

    pickTool(planimetry, 'point');
    click(canvas, clientOf([1, 1]));
    planimetry.onChange(() => {
      changes += 1;
    });

    Object.entries(CANCELS).forEach(([name, cancel]) => {
      changes = 0;
      pickTool(planimetry, 'select');
      pointer(canvas, 'pointerdown', clientOf([1, 1]));
      pointer(canvas, 'pointermove', clientOf([3, 2]));
      expect(verticesOf(), name).toEqual({ A: [3, 2] });

      cancel(canvas, clientOf([3, 2]));
      expect(verticesOf(), name).toEqual({ A: [1, 1] });
      expect(changes, name).toBeLessThanOrEqual(1);
      releaseAll(canvas, clientOf([3, 2]));
      expect(verticesOf(), name).toEqual({ A: [1, 1] });
    });

    // Одна отмена снимает саму точку: от перетаскиваний шагов не осталось.
    key(canvas, 'z', { ctrlKey: true });
    expect(verticesOf()).toEqual({});
  });

  it('графики: прямая возвращается на место, шага истории нет', () => {
    const plots = create(plotsEditorFactory, 30);
    const canvas = canvasOf(plots);
    const plotsOf = (): Array<Record<string, unknown>> => plots.getScene().plots as Array<Record<string, unknown>>;
    let changes = 0;

    plots.element.querySelector<HTMLButtonElement>('button[data-plot-template="line"]')?.click();
    plots.onChange(() => {
      changes += 1;
    });

    Object.entries(CANCELS).forEach(([name, cancel]) => {
      changes = 0;
      pickTool(plots, 'select');
      pointer(canvas, 'pointerdown', clientOf([1, 1]));
      pointer(canvas, 'pointermove', clientOf([2, 1]));
      expect(plotsOf()[0], name).toMatchObject({ type: 'line', k: 1, b: -1 });

      cancel(canvas, clientOf([2, 1]));
      expect(plotsOf()[0], name).toMatchObject({ type: 'line', k: 1, b: 0 });
      expect(changes, name).toBeLessThanOrEqual(1);
      releaseAll(canvas, clientOf([2, 1]));
      expect(plotsOf()[0], name).toMatchObject({ type: 'line', k: 1, b: 0 });
    });

    key(canvas, 'z', { ctrlKey: true });
    expect(plotsOf()).toEqual([]);
  });

  it('графики: отменённый штрих карандаша отбрасывается целиком, обычный — рисует', () => {
    const plots = create(plotsEditorFactory, 30);
    const canvas = canvasOf(plots);
    const stroke = (): void => {
      pickTool(plots, 'pencil');
      pointer(canvas, 'pointerdown', clientOf([-3, -3]));
      [-2, -1, 0, 1, 2, 3].forEach((x) => pointer(canvas, 'pointermove', clientOf([x, -3])));
    };

    Object.entries(CANCELS).forEach(([name, cancel]) => {
      stroke();
      cancel(canvas, clientOf([3, -3]));
      releaseAll(canvas, clientOf([3, -3]));
      expect(plots.getScene().plots, name).toEqual([]);
      expect(canvas.querySelector('.rte-sketch__overlay polyline'), name).toBeNull();
    });

    stroke();
    pointer(canvas, 'pointerup', clientOf([3, -3]));
    expect(plots.getScene().plots).toMatchObject([{ type: 'line' }]);
  });

  it('физика: элемент возвращается на место, копия с Ctrl пропадает, шага истории нет', () => {
    const physics = create(physicsEditorFactory, 30);
    const canvas = canvasOf(physics);
    const elementsOf = (): Array<Record<string, unknown>> => physics.getScene().elements as Array<Record<string, unknown>>;
    let changes = 0;

    physics.element.querySelector<HTMLButtonElement>('button[data-element="block_rect"]')?.click();
    physics.onChange(() => {
      changes += 1;
    });

    Object.entries(CANCELS).forEach(([name, cancel]) => {
      changes = 0;
      pickTool(physics, 'select');
      pointer(canvas, 'pointerdown', clientOf([0.3, 0.2]));
      pointer(canvas, 'pointermove', clientOf([2.3, 1.2]));
      expect(elementsOf()[0]?.center, name).toEqual([2, 1]);

      cancel(canvas, clientOf([2.3, 1.2]));
      expect(elementsOf()[0]?.center, name).toEqual([0, 0]);
      expect(changes, name).toBeLessThanOrEqual(1);
      releaseAll(canvas, clientOf([2.3, 1.2]));
      expect(elementsOf()[0]?.center, name).toEqual([0, 0]);
    });

    // Ctrl тянет копию: отмена снимает и перенос, и саму копию.
    pointer(canvas, 'pointerdown', clientOf([0.3, 0.2]), { ctrlKey: true });
    pointer(canvas, 'pointermove', clientOf([2.3, 1.2]), { ctrlKey: true });
    expect(elementsOf()).toHaveLength(2);
    pointer(canvas, 'pointercancel', clientOf([2.3, 1.2]));
    expect(elementsOf()).toHaveLength(1);
    expect(elementsOf()[0]?.center).toEqual([0, 0]);

    key(canvas, 'z', { ctrlKey: true });
    expect(elementsOf()).toEqual([]);
  });
});
