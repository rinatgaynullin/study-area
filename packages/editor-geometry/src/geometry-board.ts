import type JXG from 'jsxgraph';
import { loadJsxGraph } from './jsxgraph';
import type { BoundingBox } from './types';

export interface GeometryBoardOptions {
  element: HTMLElement;
  script: string;
  bbox: BoundingBox;
  /** Можно ли двигать точки и слайдеры. Положение в документ не записывается. */
  interactive: boolean;
  /** Рендерер JSXGraph; `'no'` — для тестов без DOM-измерений. */
  renderer?: 'auto' | 'svg' | 'canvas' | 'no';
  onError?(error: unknown): void;
}

/**
 * Доска JSXGraph внутри элемента: грузит библиотеку, разбирает JessieCode,
 * пересобирается при смене построения и освобождает ресурсы при уничтожении.
 *
 * Источник истины — скрипт автора. Перетаскивание точек на доске не
 * сериализуется обратно: `JXG.Dump.toJessie` выдаёт полный дамп доски вместе с
 * осями и служебными элементами, а не правку авторского текста. Сохранение
 * положений отдельным слоем состояния — следующий шаг после спайка.
 */
export class GeometryBoard {
  private board: JXG.Board | null = null;

  private jsxgraph: typeof JXG | null = null;

  private isDestroyed = false;

  private script: string;

  private bbox: BoundingBox;

  constructor(private readonly options: GeometryBoardOptions) {
    this.script = options.script;
    this.bbox = options.bbox;
    this.mount().catch((error: unknown) => this.options.onError?.(error));
  }

  /** Живая доска JSXGraph; `null`, пока библиотека не загрузилась. */
  get instance(): JXG.Board | null {
    return this.board;
  }

  update(script: string, bbox: BoundingBox): void {
    this.script = script;
    this.bbox = bbox;
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

    if (!interactive) {
      board.objectsList.forEach((object) => {
        const target = object as { setAttribute?: (attributes: Record<string, boolean>) => void };

        target.setAttribute?.({ fixed: true });
      });
    }
  }

  private releaseBoard(): void {
    if (!this.board || !this.jsxgraph) return;

    this.jsxgraph.JSXGraph.freeBoard(this.board);
    this.board = null;
  }
}
