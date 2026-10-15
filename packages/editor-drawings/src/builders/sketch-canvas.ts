import { createDisposer, el, on, sanitizeSvg, type Unsubscribe } from '@rich-editor/core';
import { svgToWorld, worldToSvg, type SvgPoint, type Viewport } from '../render/coords';
import type { Vec2 } from '../scene/types';

/** Порог попадания курсора в точку или линию, в пикселях экрана. */
export const HIT_RADIUS_PX = 15;

/** Пределы масштаба при зуме колесом. */
const MIN_SCALE = 6;
const MAX_SCALE = 200;

export interface PointerInfo {
  /** Координаты мира с учётом текущего масштаба и сдвига. */
  world: Vec2;
  svg: SvgPoint;
  button: number;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
  event: PointerEvent;
}

export interface SketchCanvasOptions {
  width: number;
  height: number;
  scale: number;
  onPointerDown?(info: PointerInfo): void;
  onPointerMove?(info: PointerInfo): void;
  onPointerUp?(info: PointerInfo): void;
  onDoubleClick?(info: PointerInfo): void;
  onKeyDown?(event: KeyboardEvent): void;
  /** Масштаб или сдвиг изменились: сцену надо перерисовать. */
  onViewportChange?(): void;
}

/**
 * Полотно конструктора: статичный слой с SVG сцены и оверлей для ручек.
 *
 * Сцена рисуется общим рендером (тем же, что и в документе) и кладётся в
 * слой через санитайзер; ручки, черновики и подсветки — отдельный SVG
 * поверх. Полотно переводит события указателя в координаты мира, умеет
 * зум к курсору и панорамирование. Состояние окна просмотра — общее для
 * всех обработчиков, поэтому это класс.
 */
export class SketchCanvas {
  readonly element: HTMLElement;

  readonly viewport: Viewport;

  private readonly layer: HTMLElement;

  private readonly overlay: SVGSVGElement;

  private readonly disposer = createDisposer();

  private panStart: { client: [number, number]; cx: number; cy: number } | null = null;

  constructor(private readonly options: SketchCanvasOptions) {
    this.viewport = { scale: options.scale, cx: options.width / 2, cy: options.height / 2 };

    this.layer = el('div', { class: 'rte-sketch__layer', attrs: { 'aria-hidden': 'true' } });

    this.overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.overlay.setAttribute('class', 'rte-sketch__overlay');
    this.overlay.setAttribute('viewBox', `0 0 ${options.width} ${options.height}`);
    this.overlay.setAttribute('aria-hidden', 'true');

    this.element = el('div', {
      class: 'rte-sketch',
      attrs: { tabindex: 0, role: 'application' },
      children: [this.layer, this.overlay],
    });

    this.element.style.setProperty('--rte-sketch-ratio', `${options.width} / ${options.height}`);

    this.disposer.add(on(this.element, 'pointerdown', this.onPointerDown));
    this.disposer.add(on(this.element, 'pointermove', this.onPointerMove));
    this.disposer.add(on(this.element, 'pointerup', this.onPointerUp));
    this.disposer.add(on(this.element, 'pointercancel', this.onPointerUp));
    this.disposer.add(on(this.element, 'dblclick', this.onDoubleClick));
    this.disposer.add(on(this.element, 'wheel', this.onWheel, { passive: false }));
    this.disposer.add(on(this.element, 'contextmenu', (event) => event.preventDefault()));
    this.disposer.add(
      on(this.element, 'keydown', (event) => {
        this.options.onKeyDown?.(event);
      }),
    );
  }

  get width(): number {
    return this.options.width;
  }

  get height(): number {
    return this.options.height;
  }

  /** Радиус попадания в единицах мира при текущем масштабе. */
  get hitRadius(): number {
    return HIT_RADIUS_PX / this.viewport.scale;
  }

  /** Кладёт SVG сцены в статичный слой. */
  setScene(svg: string): void {
    this.layer.innerHTML = sanitizeSvg(svg);
  }

  /** Кладёт разметку ручек и черновиков в оверлей. */
  setOverlay(markup: string): void {
    this.overlay.innerHTML = sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`).replace(/^<svg[^>]*>|<\/svg>$/g, '');
  }

  toSvg(point: Vec2): SvgPoint {
    return worldToSvg(point, this.viewport.scale, this.viewport.cx, this.viewport.cy);
  }

  toWorld(point: SvgPoint): Vec2 {
    return svgToWorld(point, this.viewport.scale, this.viewport.cx, this.viewport.cy);
  }

  /** Экранные координаты события → координаты viewBox. */
  clientToSvg(clientX: number, clientY: number): SvgPoint {
    const rect = this.overlay.getBoundingClientRect();
    const width = rect.width || this.options.width;
    const height = rect.height || this.options.height;

    return {
      x: ((clientX - rect.left) / width) * this.options.width,
      y: ((clientY - rect.top) / height) * this.options.height,
    };
  }

  /** Зум к точке: она остаётся под курсором. */
  zoomAt(point: SvgPoint, factor: number): void {
    const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, this.viewport.scale * factor));
    const ratio = next / this.viewport.scale;

    this.viewport.cx = point.x - (point.x - this.viewport.cx) * ratio;
    this.viewport.cy = point.y - (point.y - this.viewport.cy) * ratio;
    this.viewport.scale = next;
    this.options.onViewportChange?.();
  }

  zoomBy(factor: number): void {
    this.zoomAt({ x: this.options.width / 2, y: this.options.height / 2 }, factor);
  }

  resetView(): void {
    this.viewport.scale = this.options.scale;
    this.viewport.cx = this.options.width / 2;
    this.viewport.cy = this.options.height / 2;
    this.options.onViewportChange?.();
  }

  /** Сдвиг и масштаб под сцену: начало координат в точке (cx, cy). */
  setViewport(next: Partial<Viewport>): void {
    Object.assign(this.viewport, next);
    this.options.onViewportChange?.();
  }

  focus(): void {
    this.element.focus();
  }

  destroy(): void {
    this.disposer.dispose();
    this.element.remove();
  }

  private info(event: PointerEvent | MouseEvent): PointerInfo {
    const svg = this.clientToSvg(event.clientX, event.clientY);

    return {
      world: this.toWorld(svg),
      svg,
      button: event.button,
      shift: event.shiftKey,
      ctrl: event.ctrlKey || event.metaKey,
      alt: event.altKey,
      event: event as PointerEvent,
    };
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    this.element.focus({ preventScroll: true });
    this.element.setPointerCapture?.(event.pointerId);

    // Средняя кнопка или пробел-перетаскивание — панорамирование.
    if (event.button === 1) {
      event.preventDefault();
      this.panStart = { client: [event.clientX, event.clientY], cx: this.viewport.cx, cy: this.viewport.cy };

      return;
    }

    this.options.onPointerDown?.(this.info(event));
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (this.panStart) {
      const rect = this.overlay.getBoundingClientRect();
      const factorX = this.options.width / (rect.width || this.options.width);
      const factorY = this.options.height / (rect.height || this.options.height);

      this.viewport.cx = this.panStart.cx + (event.clientX - this.panStart.client[0]) * factorX;
      this.viewport.cy = this.panStart.cy + (event.clientY - this.panStart.client[1]) * factorY;
      this.options.onViewportChange?.();

      return;
    }

    this.options.onPointerMove?.(this.info(event));
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    this.element.releasePointerCapture?.(event.pointerId);

    if (this.panStart) {
      this.panStart = null;

      return;
    }

    this.options.onPointerUp?.(this.info(event));
  };

  private readonly onDoubleClick = (event: MouseEvent): void => {
    this.options.onDoubleClick?.(this.info(event));
  };

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.zoomAt(this.clientToSvg(event.clientX, event.clientY), event.deltaY < 0 ? 1.1 : 1 / 1.1);
  };
}

/** Подписка на изменения: конструкторы оповещают диалог через неё. */
export class ChangeEmitter {
  private readonly listeners = new Set<() => void>();

  on(listener: () => void): Unsubscribe {
    this.listeners.add(listener);

    return () => this.listeners.delete(listener);
  }

  emit(): void {
    this.listeners.forEach((listener) => listener());
  }

  clear(): void {
    this.listeners.clear();
  }
}
