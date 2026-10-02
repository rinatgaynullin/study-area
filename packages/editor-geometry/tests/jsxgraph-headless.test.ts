import { Dump, JSXGraph } from 'jsxgraph';
import { DEFAULT_SCRIPT } from '../src/default-script';
import { GeometryBoard } from '../src/geometry-board';
import { loadJsxGraph } from '../src/jsxgraph';

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
