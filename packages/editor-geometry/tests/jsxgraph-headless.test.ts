import { COORDS_BY_USER, Dump, JSXGraph } from 'jsxgraph';
import { DEFAULT_SCRIPT } from '../src/default-script';
import { GeometryBoard, type GeometryBoardOptions } from '../src/geometry-board';
import { loadJsxGraph } from '../src/jsxgraph';
import type { BoundingBox } from '../src/types';

/**
 * Вопросы спайка: разбирается ли JessieCode без DOM-рендера, следует ли глайдер
 * за графиком при смене параметра и переживает ли построение сериализацию.
 */
const createBoard = (script: string) => {
  const host = document.createElement('div');

  document.body.appendChild(host);

  const board = JSXGraph.initBoard(host, {
    boundingbox: [-6, 5, 6, -5],
    axis: true,
    renderer: 'no',
    showCopyright: false,
    showNavigation: false,
  } as never);

  board.jc.parse(script);

  return board;
};

// Загрузчик пакета переключает JessieCode в режим интерпретатора для всех досок.
beforeAll(async () => {
  await loadJsxGraph();
});

type Valued = { Value(): number; setValue?(value: number): unknown };
type Pointlike = { X(): number; Y(): number };
type Movable = { moveTo(coords: [number, number]): unknown };

describe('JSXGraph без рендера (renderer: no)', () => {
  it('разбирает построение по умолчанию: слайдер, график и глайдер', () => {
    const board = createBoard(DEFAULT_SCRIPT);
    const a = board.select('a') as unknown as Valued;
    const P = board.select('P') as unknown as Pointlike;

    expect(a.Value()).toBe(1);
    expect(P.Y()).toBeCloseTo(a.Value() * Math.sin(P.X()), 6);

    JSXGraph.freeBoard(board);
  });

  it('график и точка на нём следуют за параметром', () => {
    const board = createBoard(DEFAULT_SCRIPT);
    const a = board.select('a') as unknown as Valued & Movable;
    const P = board.select('P') as unknown as Pointlike;

    // Двигаем ползунок, как это делает указатель: зависимые элементы обновляются за
    // один проход. Программный `setValue` требует двух `board.update()` подряд.
    a.moveTo([-2, 4.2]);
    board.update();

    expect(a.Value()).not.toBe(1);
    expect(P.Y()).toBeCloseTo(a.Value() * Math.sin(P.X()), 6);

    JSXGraph.freeBoard(board);
  });

  it('формулу можно подменить текстом, и график перестраивается', () => {
    const board = createBoard('f = functiongraph(function(x) { return x * x; }, -6, 6);\nP = glider(2, 0, f) << name: "P" >>;');
    const P = board.select('P') as unknown as Pointlike;

    expect(P.Y()).toBeCloseTo(P.X() * P.X(), 6);

    JSXGraph.freeBoard(board);
  });

  it('Dump.toJessie — полный дамп доски, а не правка авторского скрипта (поэтому не формат хранения)', () => {
    const board = createBoard(DEFAULT_SCRIPT);
    const script = Dump.toJessie(board);

    // Дамп воспроизводит элементы автора...
    expect(script).toContain('functiongraph');
    expect(script).toContain('glider');
    // ...но вместе с осями доски и служебными скрытыми точками слайдера.
    expect(script).toContain('axis(');
    expect(script).toContain('visible: false');
    expect(script.length).toBeGreaterThan(DEFAULT_SCRIPT.length * 5);

    JSXGraph.freeBoard(board);
  });

  it('ошибка разбора не роняет доску, а уходит в onError', async () => {
    const host = document.createElement('div');
    const onError = vi.fn();
    const board = new GeometryBoard({
      element: host,
      script: 'this is not jessiecode (',
      bbox: [-5, 5, 5, -5],
      interactive: false,
      renderer: 'no',
      onError,
    });

    await loadJsxGraph();
    await new Promise((resolve) => { setTimeout(resolve, 0); });

    expect(onError).toHaveBeenCalled();

    board.destroy();
  });
});

describe('JessieCode без eval', () => {
  it('доска считает формулу в режиме интерпретатора, даже если eval недоступен', async () => {
    const originalEval = globalThis.eval;
    const host = document.createElement('div');
    const errors: unknown[] = [];

    document.body.appendChild(host);
    // Строгая CSP запрещает eval; эмулируем это, и доска всё равно должна работать.
    const evalCalls: string[] = [];

    globalThis.eval = () => {
      evalCalls.push(new Error('eval').stack ?? '');
      throw new EvalError('blocked by CSP');
    };

    try {
      const board = new GeometryBoard({
        element: host,
        script: 'f = functiongraph(function(x) { return 2 * x + 1; }, -6, 6);\nP = glider(1, 0, f) << name: "P" >>;',
        bbox: [-6, 5, 6, -5],
        interactive: false,
        renderer: 'no',
        onError: (error) => errors.push(error),
      });

      await loadJsxGraph();
      await new Promise((resolve) => { setTimeout(resolve, 0); });

      const P = board.instance?.select('P') as unknown as Pointlike | undefined;

      expect(evalCalls).toEqual([]);
      expect(errors).toEqual([]);
      expect(P?.Y()).toBeCloseTo(2 * (P?.X() ?? 0) + 1, 6);

      board.destroy();
    } finally {
      globalThis.eval = originalEval;
    }
  });
});

describe('слой состояния', () => {
  const SCRIPT = `a = slider([-5, 4.2], [-1, 4.2], [-3, 1, 3]);
f = functiongraph(function(x) { return a * sin(x); }, -6, 6);
P = glider(1, 0, f);
Q = point(-3, -2);
c = circle(Q, 2);
K = glider(-1, -2, c);
F = point(2, 2) << fixed: true >>;
`;
  const BBOX: BoundingBox = [-6, 5, 6, -5];

  const settle = async () => {
    await loadJsxGraph();
    await new Promise((resolve) => { setTimeout(resolve, 0); });
  };

  const mountBoard = async (options: Partial<GeometryBoardOptions> = {}) => {
    const host = document.createElement('div');

    document.body.appendChild(host);

    const board = new GeometryBoard({
      element: host,
      script: SCRIPT,
      bbox: BBOX,
      interactive: true,
      renderer: 'no',
      ...options,
    });

    await settle();

    return board;
  };

  it('снимает только видимые подвижные элементы с именами', async () => {
    const board = await mountBoard();
    const state = board.captureState();

    // Слайдер, глайдеры и свободная точка — да; закреплённая F и скрытые
    // служебные точки слайдера — нет.
    expect(Object.keys(state).sort()).toEqual(['K', 'P', 'Q', 'a']);
    expect(state.a).toEqual({ value: 1 });
    expect(state.Q).toEqual({ coords: [-3, -2] });

    board.destroy();
  });

  it('восстанавливает значения и координаты на новой доске, глайдер остаётся на кривой', async () => {
    const source = await mountBoard();
    const instance = source.instance as unknown as { select(name: string, onlyElements: boolean): unknown; update(): void };
    const a = instance.select('a', false) as Valued & Movable;
    const Q = instance.select('Q', false) as Movable & { setPosition(method: number, coords: number[]): unknown };

    a.moveTo([-2, 4.2]);
    Q.setPosition(COORDS_BY_USER, [1, 1]);
    instance.update();
    instance.update();

    const state = source.captureState();
    const restored = await mountBoard({ state, interactive: false });
    const target = restored.instance as unknown as { select(name: string, onlyElements: boolean): unknown };
    const a2 = target.select('a', false) as Valued;
    const Q2 = target.select('Q', false) as Pointlike;
    const P2 = target.select('P', false) as Pointlike;

    expect(a2.Value()).toBeCloseTo((state.a as { value: number }).value, 3);
    expect([Q2.X(), Q2.Y()]).toEqual([1, 1]);
    expect(P2.Y()).toBeCloseTo(a2.Value() * Math.sin(P2.X()), 3);
    // Снимок отличий содержит сдвинутые элементы и глайдеры, которых увели за собой
    // изменившиеся график и окружность; закреплённая F не попадает.
    expect(Object.keys(source.captureChanges()).sort()).toEqual(['K', 'P', 'Q', 'a']);

    source.destroy();
    restored.destroy();
  });

  it('onStateChange зовётся при отпускании указателя и только если положения изменились', async () => {
    const onStateChange = vi.fn();
    const board = await mountBoard({ onStateChange });
    const instance = board.instance as unknown as {
      select(name: string, onlyElements: boolean): unknown;
      update(): void;
      triggerEventHandlers(events: string[], args: unknown[]): void;
    };

    instance.triggerEventHandlers(['up'], [new Event('pointerup')]);
    expect(onStateChange).not.toHaveBeenCalled();

    (instance.select('Q', false) as Movable).moveTo([2, -1]);
    instance.update();
    instance.triggerEventHandlers(['up'], [new Event('pointerup')]);

    expect(onStateChange).toHaveBeenCalledTimes(1);
    // В документ уезжают только отличия от скрипта: сдвинутая точка и глайдер K
    // на окружности вокруг неё, которую она утащила за собой; слайдер и P — нет.
    const emitted = onStateChange.mock.calls[0]?.[0] as Record<string, unknown>;

    expect(emitted).toMatchObject({ Q: { coords: [2, -1] } });
    expect(Object.keys(emitted).sort()).toEqual(['K', 'Q']);

    board.destroy();
  });

  it('setState накладывает состояние снаружи (например, после отмены) без пересборки доски', async () => {
    const board = await mountBoard();
    const before = board.instance;

    board.setState({ a: { value: -2 }, Q: { coords: [0, 3] } });

    const instance = board.instance as unknown as { select(name: string, onlyElements: boolean): unknown };

    expect(board.instance).toBe(before);
    expect((instance.select('a', false) as Valued).Value()).toBeCloseTo(-2, 3);
    expect(board.captureState().Q).toEqual({ coords: [0, 3] });

    board.destroy();
  });
});

describe('отличия от скрипта', () => {
  it('без сдвигов отличий нет, даже если состояние снималось', async () => {
    const host = document.createElement('div');
    const board = new GeometryBoard({
      element: host,
      script: DEFAULT_SCRIPT,
      bbox: [-6, 5, 6, -5],
      interactive: true,
      renderer: 'no',
    });

    await loadJsxGraph();
    await new Promise((resolve) => { setTimeout(resolve, 0); });

    expect(board.captureChanges()).toEqual({});
    expect(Object.keys(board.captureState()).sort()).toEqual(['P', 'a']);

    board.destroy();
  });
});
