import { createRichEditor, type RichEditorUi, type Translate } from '@rich-editor/core';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  DRAWINGS_MESSAGES,
  HistoryStack,
  createDrawingsFeature,
  fitCircle,
  fitLine,
  fitParabola,
  planimetryEditorFactory,
  recognizeStroke,
  type SceneEditor,
} from '../src';

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

const t: Translate = (key) => DRAWINGS_MESSAGES.ru[key] ?? key;

/** Полотно 560×420 при масштабе 40: начало координат мира в (280, 210), ось y вверх. */
const CX = 280;
const CY = 210;
const SCALE = 40;

const svgOf = ([x, y]: [number, number]): [number, number] => [CX + x * SCALE, CY - y * SCALE];

const pointer = (target: HTMLElement, type: 'pointerdown' | 'pointermove' | 'pointerup', world: [number, number], init: Partial<PointerEventInit> = {}): void => {
  const [clientX, clientY] = svgOf(world);

  target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, clientX, clientY, pointerId: 1, ...init }));
};

const click = (target: HTMLElement, world: [number, number], init: Partial<PointerEventInit> = {}): void => {
  pointer(target, 'pointerdown', world, init);
  pointer(target, 'pointerup', world, init);
};

const pickTool = (editor: SceneEditor, tool: string): void => {
  editor.element.querySelector<HTMLButtonElement>(`button[data-tool="${tool}"]`)?.click();
};

const canvasOf = (editor: SceneEditor): HTMLElement => {
  const canvas = editor.element.querySelector<HTMLElement>('.rte-sketch');

  if (!canvas) throw new Error('Нет полотна');

  return canvas;
};

/** Линии сцены без сетки, осей и шаблона штриховки в `<defs>`. */
const sceneLines = (root: ParentNode): Element[] =>
  [...root.querySelectorAll('.rte-sketch__layer line:not(.rte-drawing__grid):not(.rte-drawing__axis)')].filter(
    (line) => !line.closest('defs'),
  );

const TRIANGLE = {
  type: '2d',
  vertices: { A: [0, 0], B: [4, 0], C: [0, 3] },
  edges: [['A', 'B'], ['B', 'C'], ['C', 'A']],
  angles: [{ points: ['B', 'A', 'C'], style: 'right' }],
  labels: { A: 'below left' },
};

describe('конструктор планиметрии', () => {
  let editor: SceneEditor | undefined;

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
  });

  const create = (): SceneEditor => {
    editor = planimetryEditorFactory.create({ t });
    document.body.appendChild(editor.element);

    return editor;
  };

  it('загружает сцену и отдаёт её обратно в формате PinQueen', () => {
    const planimetry = create();

    planimetry.load(TRIANGLE);

    const scene = planimetry.getScene();

    expect(scene.type).toBe('2d');
    expect(scene.vertices).toEqual({ A: [0, 0], B: [4, 0], C: [0, 3] });
    expect(scene.edges).toEqual([
      { from: 'A', to: 'B', style: 'solid' },
      { from: 'B', to: 'C', style: 'solid' },
      { from: 'C', to: 'A', style: 'solid' },
    ]);
    expect(scene.angles).toEqual([{ points: ['B', 'A', 'C'], style: 'right' }]);
    expect(scene.labels).toEqual({ A: 'below left' });
    expect(canvasOf(planimetry).querySelector('svg')).not.toBeNull();
  });

  it('точка, отрезок, окружность и угол ставятся кликами с прилипанием к сетке', () => {
    const planimetry = create();
    const canvas = canvasOf(planimetry);
    let changes = 0;

    planimetry.onChange(() => {
      changes += 1;
    });

    pickTool(planimetry, 'point');
    click(canvas, [1.02, 0.03]);
    expect(planimetry.getScene().vertices).toEqual({ A: [1, 0] });

    pickTool(planimetry, 'segment');
    click(canvas, [1, 0]);
    click(canvas, [0, 1]);
    expect(planimetry.getScene().vertices).toEqual({ A: [1, 0], B: [0, 1] });
    expect(planimetry.getScene().edges).toEqual([{ from: 'A', to: 'B', style: 'solid' }]);

    pickTool(planimetry, 'circle');
    click(canvas, [-2, -2]);
    click(canvas, [-1, -2]);

    const { plots, vertices } = planimetry.getScene() as { plots: Array<Record<string, unknown>>; vertices: Record<string, unknown> };

    expect(vertices.O).toEqual([-2, -2]);
    expect(plots[0]).toMatchObject({ type: 'circle', centerVertex: 'O', radius: 1 });

    pickTool(planimetry, 'angle');
    click(canvas, [1, 0]);
    click(canvas, [0, 1]);
    click(canvas, [-2, -2]);
    expect(planimetry.getScene().angles).toEqual([{ points: ['A', 'B', 'O'], style: 'single' }]);
    expect(changes).toBeGreaterThanOrEqual(6);
  });

  /** Отрезок A(-2,0)–B(2,0) кликами: `load` подгоняет окно просмотра, а клики считают от исходного. */
  const drawBaseSegment = (planimetry: SceneEditor, canvas: HTMLElement): void => {
    pickTool(planimetry, 'segment');
    click(canvas, [-2, 0]);
    click(canvas, [2, 0]);
  };

  it('точка на отрезке делит его, засечки и подписи меняются кликом', () => {
    const planimetry = create();
    const canvas = canvasOf(planimetry);

    drawBaseSegment(planimetry, canvas);
    expect(planimetry.getScene().edges).toEqual([{ from: 'A', to: 'B', style: 'solid' }]);

    pickTool(planimetry, 'ticks');
    click(canvas, [0.5, 0]);
    click(canvas, [0.5, 0]);
    expect(planimetry.getScene().edges).toEqual([{ from: 'A', to: 'B', style: 'solid', ticks: 2 }]);

    pickTool(planimetry, 'point');
    click(canvas, [1, 0.1]);
    expect(planimetry.getScene().vertices).toMatchObject({ C: [1, 0] });
    // Отрезок разрезан новой точкой при сохранении.
    expect(planimetry.getScene().edges).toHaveLength(2);

    pickTool(planimetry, 'text');
    click(canvas, [-1, 0]);
    expect((planimetry.getScene().text_labels as unknown[])[0]).toMatchObject({ text: '?', position: ['A', 'C'] });
  });

  it('перетаскивание двигает точку, отмена возвращает её, повтор — снова двигает', () => {
    const planimetry = create();
    const canvas = canvasOf(planimetry);

    drawBaseSegment(planimetry, canvas);

    pickTool(planimetry, 'select');
    pointer(canvas, 'pointerdown', [-2, 0]);
    pointer(canvas, 'pointermove', [-1.5, 0.5]);
    pointer(canvas, 'pointermove', [-1, 1]);
    pointer(canvas, 'pointerup', [-1, 1]);
    expect(planimetry.getScene().vertices).toMatchObject({ A: [-1, 1] });

    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
    expect(planimetry.getScene().vertices).toMatchObject({ A: [-2, 0] });

    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true, cancelable: true }));
    expect(planimetry.getScene().vertices).toMatchObject({ A: [-1, 1] });
  });

  it('выбор точки показывает свойства; переименование тянет рёбра и углы; удаление чистит связи', () => {
    const planimetry = create();
    const canvas = canvasOf(planimetry);

    // Треугольник кликами: A(0,0), B(4,0), C(0,3) с прямым углом при A.
    pickTool(planimetry, 'segment');
    click(canvas, [0, 0]);
    click(canvas, [4, 0]);
    click(canvas, [4, 0]);
    click(canvas, [0, 3]);
    click(canvas, [0, 3]);
    click(canvas, [0, 0]);
    pickTool(planimetry, 'angle');
    click(canvas, [4, 0]);
    click(canvas, [0, 0]);
    click(canvas, [0, 3]);
    expect(planimetry.getScene().angles).toEqual([{ points: ['B', 'A', 'C'], style: 'right' }]);

    pickTool(planimetry, 'select');
    click(canvas, [0, 0]);

    const name = planimetry.element.querySelector<HTMLInputElement>('.rte-builder__props input');

    expect(name?.value).toBe('A');

    name!.value = 'M';
    name!.dispatchEvent(new Event('change', { bubbles: true }));

    const renamed = planimetry.getScene();

    expect(Object.keys(renamed.vertices as object)).toEqual(['B', 'C', 'M']);
    expect(renamed.edges).toContainEqual({ from: 'M', to: 'B', style: 'solid' });
    expect(renamed.angles).toEqual([{ points: ['B', 'M', 'C'], style: 'right' }]);

    pickTool(planimetry, 'delete');
    click(canvas, [0, 0]);

    const after = planimetry.getScene();

    expect(Object.keys(after.vertices as object)).toEqual(['B', 'C']);
    expect(after.edges).toEqual([{ from: 'B', to: 'C', style: 'solid' }]);
    expect(after.angles).toBeUndefined();
  });

  it('неизвестные поля сцены и чужие графики возвращаются нетронутыми', () => {
    const planimetry = create();

    planimetry.load({ ...TRIANGLE, custom: { keep: true }, plots: [{ type: 'parabola', vertex: [0, 0] }] });

    const scene = planimetry.getScene();

    expect(scene.custom).toEqual({ keep: true });
    expect((scene.plots as Array<{ type: string }>).map((plot) => plot.type)).toEqual(['parabola']);
  });

  it('принимает только плоские сцены', () => {
    expect(planimetryEditorFactory.accepts(TRIANGLE)).toBe(true);
    expect(planimetryEditorFactory.accepts({ type: '3d', vertices: { S: [0, 0, 2] } })).toBe(false);
    expect(planimetryEditorFactory.accepts({ plots: [{ type: 'parabola', vertex: [0, 0] }] })).toBe(false);
  });
});

describe('диалог с конструктором', () => {
  let ui: RichEditorUi | undefined;
  let host: HTMLElement | undefined;

  afterEach(() => {
    ui?.destroy();
    ui = undefined;
    host?.remove();
    host = undefined;
  });

  const mountEditor = (options: Record<string, unknown> = {}): RichEditorUi => {
    host = document.createElement('div');
    document.body.appendChild(host);
    ui = createRichEditor({ element: host, content: '<p>привет</p>', features: [createDrawingsFeature(options)] });

    return ui;
  };

  const openDialog = (): HTMLElement => {
    const dialog = document.querySelector<HTMLElement>('.rte-modal:not([hidden])');

    if (!dialog) throw new Error('Диалог не открыт');

    return dialog;
  };

  const toolbarButton = (label: string): HTMLButtonElement => {
    const found = [...document.querySelectorAll<HTMLButtonElement>('.rte-toolbar button')].find(
      (button) => button.getAttribute('aria-label') === label,
    );

    if (!found) throw new Error(`Нет кнопки «${label}»`);

    return found;
  };

  it('новый чертёж открывается на вкладке планиметрии; шаблон попадает в конструктор; вставка берёт его сцену', () => {
    const editor = mountEditor();

    toolbarButton('Чертёж').click();

    const dialog = openDialog();
    const tabs = [...dialog.querySelectorAll<HTMLButtonElement>('[role="tab"]')].map((tab) => tab.textContent);

    expect(tabs).toEqual(['Планиметрия', 'Стереометрия', 'Графики', 'JSON']);
    expect(dialog.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Планиметрия');
    expect(dialog.querySelector('.rte-builder--planimetry')).not.toBeNull();

    dialog.querySelector<HTMLButtonElement>('button[data-template="triangle"]')?.click();
    expect(sceneLines(dialog).length).toBeGreaterThanOrEqual(3);
    expect(dialog.querySelector('.rte-drawing-dialog__preview svg')).not.toBeNull();

    dialog.querySelector<HTMLButtonElement>('.rte-button--primary')?.click();

    const html = editor.core.getHTML();

    expect(html).toContain('data-geometry-data=');
    expect(html).toContain('&quot;C&quot;:[0,3]');
    expect(html).toContain('data-tikz-code=');
  });

  it('вкладка JSON показывает сцену конструктора, а правка JSON возвращается в конструктор', () => {
    mountEditor();
    toolbarButton('Чертёж').click();

    const dialog = openDialog();

    dialog.querySelector<HTMLButtonElement>('button[data-template="triangle"]')?.click();
    dialog.querySelector<HTMLButtonElement>('[data-tab="json"]')?.click();

    const code = dialog.querySelector<HTMLTextAreaElement>('textarea:not([readonly])');

    expect(code?.hidden).toBe(false);
    expect(code?.value).toContain('"B": [');

    code!.value = '{"type":"2d","vertices":{"P":[1,1],"Q":[3,1]},"edges":[["P","Q"]]}';
    code!.dispatchEvent(new Event('input', { bubbles: true }));
    dialog.querySelector<HTMLButtonElement>('[data-tab="planimetry"]')?.click();

    expect(sceneLines(dialog).length).toBe(1);
  });

  it('физическая схема открывается на своём конструкторе; 3D-сцена — на стереометрии', () => {
    const editor = mountEditor();

    toolbarButton('Физическая схема').click();

    let dialog = openDialog();

    expect(dialog.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Механика');
    expect(dialog.querySelector('.rte-builder__palette')).not.toBeNull();
    dialog.querySelector<HTMLButtonElement>('.rte-button')?.click();

    editor.core.setHTML('<div data-geometry-data=\'{"type":"3d","vertices":{"S":[0,0,2],"A":[0,0,0]},"edges":[["S","A"]]}\'></div>');
    editor.element
      .querySelector<HTMLElement>('.rte-content .rte-drawing')
      ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    dialog = openDialog();
    expect(dialog.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Стереометрия');
  });

  it('сканы ученика показываются рядом с полотном', () => {
    mountEditor({ scans: () => ['blob:http://localhost/scan-1', 'blob:http://localhost/scan-2'] });
    toolbarButton('Чертёж').click();

    const images = openDialog().querySelectorAll<HTMLImageElement>('.rte-drawing-dialog__scan');

    expect(images).toHaveLength(2);
    expect(images[0].getAttribute('src')).toBe('blob:http://localhost/scan-1');
  });
});

describe('история и распознавание фигур', () => {
  it('снимок делается до изменения: одна отмена возвращает прошлое состояние', () => {
    const history = new HistoryStack<{ n: number }>(2);
    const state = { n: 0 };

    history.record(state);
    state.n = 1;
    history.record(state);
    state.n = 2;
    history.record(state);
    state.n = 3;

    expect(history.undo(state)).toEqual({ n: 2 });
    expect(history.undo({ n: 2 })).toEqual({ n: 1 });
    // Третий снимок вытеснен пределом.
    expect(history.undo({ n: 1 })).toBeNull();
    expect(history.redo({ n: 1 })).toEqual({ n: 2 });
  });

  it('подбирает прямую, окружность и параболу', () => {
    const line = fitLine([[0, 1], [1, 3], [2, 5]]);

    expect(line?.k).toBeCloseTo(2);
    expect(line?.b).toBeCloseTo(1);

    const circle = fitCircle([[1, 0], [0, 1], [-1, 0], [0, -1]]);

    expect(circle?.center[0]).toBeCloseTo(0);
    expect(circle?.radius).toBeCloseTo(1);

    const parabola = fitParabola([[-1, 1], [0, 0], [1, 1], [2, 4]]);

    expect(parabola?.a).toBeCloseTo(1);
    expect(parabola?.vertex[0]).toBeCloseTo(0);
  });

  it('штрих карандаша распознаётся как прямая, окружность, парабола или остаётся ломаной', () => {
    const straight = Array.from({ length: 12 }, (_, i) => [i / 4, 1 + i / 2] as [number, number]);

    expect(recognizeStroke(straight).type).toBe('line');

    const round = Array.from({ length: 24 }, (_, i) => {
      const angle = (i / 24) * Math.PI * 2;

      return [2 * Math.cos(angle), 2 * Math.sin(angle)] as [number, number];
    });

    expect(recognizeStroke(round).type).toBe('circle');

    const curve = Array.from({ length: 16 }, (_, i) => {
      const x = -2 + i / 4;

      return [x, x * x] as [number, number];
    });

    expect(recognizeStroke(curve).type).toBe('parabola');

    const scribble: Array<[number, number]> = [[0, 0], [1, 2], [2, -1], [3, 3], [4, -2], [5, 1]];

    expect(recognizeStroke(scribble).type).toBe('freehand');
  });
});
