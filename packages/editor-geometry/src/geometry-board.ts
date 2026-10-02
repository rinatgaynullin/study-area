import type JXG from 'jsxgraph';
import { loadJsxGraph } from './jsxgraph';
import { isSameGeometryState, type BoundingBox, type GeometryState } from './types';

export interface GeometryBoardOptions {
  element: HTMLElement;
  script: string;
  bbox: BoundingBox;
  /** Положения подвижных элементов поверх скрипта. */
  state?: GeometryState;
  /** Можно ли двигать точки и слайдеры. */
  interactive: boolean;
  /** Рендерер JSXGraph; `'no'` — для тестов без DOM-измерений. */
  renderer?: 'auto' | 'svg' | 'canvas' | 'no';
  /** Пользователь отпустил элемент, и положения изменились. */
  onStateChange?(state: GeometryState): void;
  onError?(error: unknown): void;
}

/** Точки, глайдеры и слайдеры: то, что пользователь может сдвинуть. */
const MOVABLE_TYPES = new Set(['point', 'glider', 'slider']);

interface MovableElement {
  name: string;
  elType: string;
  X(): number;
  Y(): number;
  Value?(): number;
  setValue?(value: number): unknown;
  setPosition(method: number, coords: number[]): unknown;
  evalVisProp(name: string): unknown;
}

const isMovable = (object: unknown): object is MovableElement => {
  const element = object as Partial<MovableElement>;

  return (
    typeof element.elType === 'string'
    && MOVABLE_TYPES.has(element.elType)
    && typeof element.name === 'string'
    && element.name !== ''
    && typeof element.evalVisProp === 'function'
    && element.evalVisProp('visible') === true
    && element.evalVisProp('fixed') !== true
  );
};

const roundCoordinate = (value: number): number => Number(value.toFixed(4));

/**
 * Доска JSXGraph внутри элемента: грузит библиотеку, разбирает JessieCode,
 * накладывает состояние, пересобирается при смене построения и освобождает
 * ресурсы при уничтожении.
 *
 * Источник истины — скрипт автора. Перетаскивание не переписывает скрипт
 * (`JXG.Dump.toJessie` выдаёт полный дамп доски, а не правку текста), а
 * снимается отдельным слоем: значения слайдеров и координаты точек по именам.
 */
export class GeometryBoard {
  private board: JXG.Board | null = null;

  private jsxgraph: typeof JXG | null = null;

  private isDestroyed = false;

  private script: string;

  private bbox: BoundingBox;

  /** Отличия от положений по скрипту — то, что хранит документ. */
  private state: GeometryState;

  /** Положения сразу после разбора скрипта, без наложенного состояния. */
  private pristine: GeometryState = {};

  constructor(private readonly options: GeometryBoardOptions) {
    this.script = options.script;
    this.bbox = options.bbox;
    this.state = options.state ?? {};
    this.mount().catch((error: unknown) => this.options.onError?.(error));
  }

  /** Живая доска JSXGraph; `null`, пока библиотека не загрузилась. */
  get instance(): JXG.Board | null {
    return this.board;
  }

  /** Только отличия от положений по скрипту. Пустой объект, пока доски нет. */
  captureChanges(): GeometryState {
    if (!this.board) return this.state;

    const current = this.captureState();

    return Object.fromEntries(
      Object.entries(current).filter(
        ([name, elementState]) =>
          JSON.stringify(elementState) !== JSON.stringify(this.pristine[name]),
      ),
    );
  }

  /** Текущие положения всех подвижных элементов. Пустой объект, пока доски нет. */
  captureState(): GeometryState {
    if (!this.board) return {};

    const state: GeometryState = {};

    this.board.objectsList.forEach((object) => {
      if (!isMovable(object)) return;

      state[object.name] =
        object.elType === 'slider' && object.Value
          ? { value: roundCoordinate(object.Value()) }
          : { coords: [roundCoordinate(object.X()), roundCoordinate(object.Y())] };
    });

    return state;
  }

  /** Накладывает состояние на живую доску, если оно отличается от текущего. */
  setState(state: GeometryState): void {
    if (isSameGeometryState(state, this.state)) return;

    // Пустое состояние — возврат к положениям из скрипта: только пересборкой.
    if (Object.keys(state).length === 0) {
      this.update(this.script, this.bbox, {});

      return;
    }

    this.state = state;

    if (this.board) this.applyState();
  }

  update(script: string, bbox: BoundingBox, state: GeometryState = this.state): void {
    this.script = script;
    this.bbox = bbox;
    this.state = state;
    this.releaseBoard();

    if (this.jsxgraph) this.createBoard(this.jsxgraph);
  }

  destroy(): void {
    this.isDestroyed = true;
    this.releaseBoard();
  }

  private async mount(): Promise<void> {
    const jsxgraph = await loadJsxGraph();

    if (this.isDestroyed) return;

    this.jsxgraph = jsxgraph;
    this.createBoard(jsxgraph);
  }

  private createBoard(jsxgraph: typeof JXG): void {
    const { element, interactive, renderer } = this.options;

    element.textContent = '';

    const attributes = {
      boundingbox: this.bbox,
      axis: true,
      showCopyright: false,
      showNavigation: false,
      // Окружность должна выглядеть окружностью: масштаб осей одинаковый.
      keepaspectratio: true,
      pan: { enabled: false },
      zoom: { enabled: false },
      renderer: renderer ?? 'auto',
    };

    const board = jsxgraph.JSXGraph.initBoard(element, attributes as Partial<JXG.BoardAttributes>);

    this.board = board;

    try {
      board.jc.parse(this.script);
    } catch (error) {
      this.options.onError?.(error);
    }

    this.pristine = this.captureState();
    this.applyState();

    if (!interactive) {
      board.objectsList.forEach((object) => {
        const target = object as { setAttribute?: (attributes: Record<string, boolean>) => void };

        target.setAttribute?.({ fixed: true });
      });
    }

    if (interactive && this.options.onStateChange) {
      board.on('up', this.onPointerUp);
    }
  }

  private applyState(): void {
    const { board, jsxgraph } = this;

    if (!board || !jsxgraph) return;

    Object.entries(this.state).forEach(([name, elementState]) => {
      const target = board.select(name, false) as unknown;

      if (!isMovable(target)) return;

      if ('value' in elementState) {
        target.setValue?.(elementState.value);
      } else {
        target.setPosition(jsxgraph.COORDS_BY_USER, elementState.coords);
      }
    });

    // Два прохода: первый пересчитывает зависимые кривые, второй перепроецирует
    // на них глайдеры. При перетаскивании указателем JSXGraph делает это сам.
    board.update();
    board.update();

    // Точка отсчёта — отличия после наложения: отпускание без сдвига не считается изменением.
    this.state = this.captureChanges();
  }

  private readonly onPointerUp = (): void => {
    const state = this.captureChanges();

    if (isSameGeometryState(state, this.state)) return;

    this.state = state;
    this.options.onStateChange?.(state);
  };

  private releaseBoard(): void {
    if (!this.board || !this.jsxgraph) return;

    this.jsxgraph.JSXGraph.freeBoard(this.board);
    this.board = null;
  }
}
