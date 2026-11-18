import { createDisposer, el, on, sanitizeSvg, type Unsubscribe } from '@rich-editor/core';
import { svgToWorld, worldToSvg, type SvgPoint, type Viewport } from '../render/coords';
import type { Vec2 } from '../scene/types';

/** Порог попадания курсора в точку или линию, в пикселях экрана. */
export const HIT_RADIUS_PX = 15;

/** Пределы масштаба при зуме колесом. */
const MIN_SCALE = 6;
const MAX_SCALE = 200;

/** Сдвиг указателя в пикселях экрана, после которого нажатие становится перетаскиванием. */
export const DRAG_THRESHOLD_PX = 4;

/** Пока вид двигают, курсор — «схваченная рука». */
const PANNING_CLASS = 'rte-sketch--panning';

/** Над пустым местом лист можно взять: курсор — «рука». */
const GRAB_CLASS = 'rte-sketch--grab';

/** Стрелки сдвигают вид, как камеру: «влево» показывает то, что левее, — содержимое едет вправо. */
const PAN_KEYS: Record<string, readonly [number, number]> = {
  ArrowLeft: [1, 0],
  ArrowRight: [-1, 0],
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
};

/**
 * Жест вида. `client` и `cx`, `cy` — указатель и центр окна, от которых
 * считается сдвиг. `press` — придержанное нажатие основной кнопкой: пока
 * порог не пройден, это может оказаться кликом; `null` — вид уже двигают.
 */
interface PanGesture {
  pointerId: number;
  client: [number, number];
  cx: number;
  cy: number;
  press: PointerInfo | null;
}

/**
 * Жест двумя пальцами: масштаб вокруг точки между пальцами и сдвиг вместе с
 * ними. `mid`, `distance` и `scale`, `cx`, `cy` — середина и расстояние между
 * пальцами и окно просмотра в начале жеста.
 */
interface PinchGesture {
  /** Пальцы жеста; `null` — один из них подняли: оставшиеся ничего не делают до отпускания. */
  ids: [number, number] | null;
  mid: [number, number];
  distance: number;
  scale: number;
  cx: number;
  cy: number;
}

/**
 * Отпускание — на самом деле отмена жеста: `pointercancel`, второй палец или
 * потерянный захват. Отменённый жест не оставляет результата.
 */
export const isCancelled = (info: PointerInfo): boolean => info.event.type === 'pointercancel';

const clampScale = (scale: number): number => Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));

/** Середина и расстояние между двумя экранными точками. */
const spreadOf = (a: [number, number], b: [number, number]): { mid: [number, number]; distance: number } => ({
  mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
  distance: Math.hypot(a[0] - b[0], a[1] - b[1]),
});

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
  /**
   * Можно ли с этого нажатия основной кнопкой начать перемещение вида: под
   * указателем нет объекта и ручки, инструмент не рисует протяжкой. «Да» —
   * полотно придерживает нажатие: указатель ушёл дальше порога — двигается
   * вид, а конструктор за весь жест колбэков указателя не получает; отпустили
   * на месте — конструктор получает обычные `onPointerDown` и `onPointerUp`
   * в исходной точке. Вызывается и при наведении, поэтому без побочных эффектов.
   */
  canPanFrom?(info: PointerInfo): boolean;
  /** Показывать ли над местом, откуда можно двигать вид, курсор «рука» — обычно в инструменте «Выбрать». */
  grabOnHover?(): boolean;
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

  private pan: PanGesture | null = null;

  private pinch: PinchGesture | null = null;

  /** Указатели, нажатые на полотне: id → последняя экранная точка. */
  private readonly pointers = new Map<number, [number, number]>();

  /** Указатель, чьё нажатие получил конструктор и чьего отпускания он ещё ждёт. */
  private delivered: number | null = null;

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
    // Захват отняли без отпускания кнопки: указатель ушёл с полотна, жест вида
    // обрывается, отложенный клик не доставляется, начатое конструктором
    // отменяется, как при `pointercancel`.
    this.disposer.add(
      on(this.element, 'lostpointercapture', (event) => {
        if (!this.pointers.has(event.pointerId)) return;

        if (this.delivered === event.pointerId) this.cancelDelivered();

        this.pointers.delete(event.pointerId);

        if (this.pinch) this.leavePinch(event.pointerId);
        else if (this.pan?.pointerId === event.pointerId) this.cancelPan();
      }),
    );
    this.disposer.add(on(this.element, 'pointerleave', () => this.element.classList.remove(GRAB_CLASS)));
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

  /** Вид сейчас двигают — средней кнопкой, протяжкой с пустого места или двумя пальцами. */
  get panning(): boolean {
    return (this.pan !== null && this.pan.press === null) || this.pinch !== null;
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

  /**
   * Стрелка сдвигает вид на `step` единиц мира; `false` — клавиша не стрелка
   * или идёт жест вида. Сцена и история не меняются.
   */
  panByKey(key: string, step: number): boolean {
    const direction = PAN_KEYS[key];

    if (!direction || this.pan || this.pinch) return false;

    const [dx, dy] = direction;
    const shift = step * this.viewport.scale;

    this.setViewport({ cx: this.viewport.cx + dx * shift, cy: this.viewport.cy + dy * shift });

    return true;
  }

  /** Обрывает жест вида одним указателем; придержанное нажатие конструктору не доставляется. */
  cancelPan(): void {
    this.pan = null;
    this.element.classList.remove(PANNING_CLASS);
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
    this.capture(event.pointerId, true);

    // Мышь или первый палец: прочие указатели уже отпущены, даже если их отпускание потерялось.
    if (event.isPrimary) {
      this.pointers.clear();
      this.pinch = null;
    }

    this.pointers.set(event.pointerId, [event.clientX, event.clientY]);

    // Второй палец — жест вида двумя пальцами, конструктор нажатия не получает.
    if (this.pointers.size > 1) {
      this.startPinch(event.pointerId);

      return;
    }

    // Новое нажатие обрывает недоделанный жест вида: потерянное отпускание.
    this.cancelPan();

    // Средняя кнопка двигает вид сразу, с любого места.
    if (event.button === 1) {
      event.preventDefault();
      this.startPan(event, null);
      this.element.classList.add(PANNING_CLASS);

      return;
    }

    const info = this.info(event);

    // Пустое место: клик это или перемещение вида, станет ясно по движению или отпусканию.
    if (event.button === 0 && this.options.canPanFrom?.(info) === true) {
      this.startPan(event, info);

      return;
    }

    this.delivered = event.pointerId;
    this.options.onPointerDown?.(info);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    const { pan, pinch } = this;

    if (this.pointers.has(event.pointerId)) this.pointers.set(event.pointerId, [event.clientX, event.clientY]);

    // Пока идёт жест двумя пальцами — и после подъёма одного, до отпускания остальных, — конструктор движений не получает.
    if (pinch) {
      if (pinch.ids?.includes(event.pointerId)) this.continuePinch(pinch);

      return;
    }

    if (pan && pan.pointerId === event.pointerId) {
      this.continuePan(pan, event);

      return;
    }

    const info = this.info(event);

    this.updateGrab(info);
    this.options.onPointerMove?.(info);
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    const { pan } = this;

    this.pointers.delete(event.pointerId);

    if (this.pinch) {
      this.capture(event.pointerId, false);
      this.leavePinch(event.pointerId);

      return;
    }

    if (pan && pan.pointerId === event.pointerId) {
      // Жест снят до отпускания захвата: `lostpointercapture` его уже не застанет.
      this.cancelPan();
      this.capture(event.pointerId, false);

      // Отпустили, не уйдя за порог, — обычное нажатие в исходной точке. Отменённое нажатие — не клик.
      if (pan.press && event.type !== 'pointercancel') {
        this.options.onPointerDown?.(pan.press);
        this.options.onPointerUp?.({ ...pan.press, event });
      }

      return;
    }

    this.capture(event.pointerId, false);

    if (this.delivered === event.pointerId) this.delivered = null;

    this.options.onPointerUp?.(this.info(event));
  };

  /**
   * Второй палец на полотне. Жест одним пальцем обрывается: придержанное
   * нажатие пропадает, начатое конструктором завершается, как при
   * `pointercancel`. Третий палец жест не меняет.
   */
  private startPinch(pointerId: number): void {
    if (this.pinch?.ids) return;

    this.cancelPan();
    this.cancelDelivered();

    const other = [...this.pointers.keys()].find((id) => id !== pointerId);
    const a = other === undefined ? undefined : this.pointers.get(other);
    const b = this.pointers.get(pointerId);

    if (other === undefined || !a || !b) return;

    const { mid, distance } = spreadOf(a, b);
    const { scale, cx, cy } = this.viewport;

    this.pinch = { ids: [other, pointerId], mid, distance, scale, cx, cy };
  }

  /** Конструктор ждёт отпускания указателя: вместо него приходит `pointercancel` в последней точке. */
  private cancelDelivered(): void {
    const { delivered } = this;

    if (delivered === null) return;

    const [clientX, clientY] = this.pointers.get(delivered) ?? [0, 0];

    this.delivered = null;
    this.options.onPointerUp?.(this.info(new PointerEvent('pointercancel', { pointerId: delivered, clientX, clientY })));
  }

  /** Палец ушёл с полотна: жест двумя пальцами кончился, но полотно ждёт, пока отпустят все. */
  private leavePinch(pointerId: number): void {
    const { pinch } = this;

    if (!pinch) return;

    if (pinch.ids?.includes(pointerId)) pinch.ids = null;

    if (this.pointers.size === 0) this.pinch = null;
  }

  /**
   * Масштаб — по отношению расстояний между пальцами, в пределах колеса;
   * точка листа, бывшая под серединой пальцев, остаётся под их серединой.
   */
  private continuePinch(pinch: PinchGesture): void {
    const a = pinch.ids ? this.pointers.get(pinch.ids[0]) : undefined;
    const b = pinch.ids ? this.pointers.get(pinch.ids[1]) : undefined;

    if (!a || !b) return;

    const { mid, distance } = spreadOf(a, b);
    const scale = clampScale(pinch.distance > 0 ? (pinch.scale * distance) / pinch.distance : pinch.scale);
    const ratio = scale / pinch.scale;
    const from = this.clientToSvg(pinch.mid[0], pinch.mid[1]);
    const to = this.clientToSvg(mid[0], mid[1]);

    this.viewport.scale = scale;
    this.viewport.cx = to.x - (from.x - pinch.cx) * ratio;
    this.viewport.cy = to.y - (from.y - pinch.cy) * ratio;
    this.options.onViewportChange?.();
  }

  /**
   * Захват указателя полотном. Браузер бросает исключение, если указатель уже
   * не активен (отпущен раньше, чем дошло событие, или событие синтетическое):
   * тогда жест идёт без захвата.
   */
  private capture(pointerId: number, take: boolean): void {
    try {
      if (take) this.element.setPointerCapture?.(pointerId);
      else this.element.releasePointerCapture?.(pointerId);
    } catch {
      // Указатель не активен — захватывать нечего.
    }
  }

  private startPan(event: PointerEvent, press: PointerInfo | null): void {
    this.pan = { pointerId: event.pointerId, client: [event.clientX, event.clientY], cx: this.viewport.cx, cy: this.viewport.cy, press };
  }

  /**
   * Окно просмотра едет за указателем: смещение в единицах полотна с учётом
   * масштаба CSS. Ни сцена, ни история не меняются.
   */
  private continuePan(pan: PanGesture, event: PointerEvent): void {
    if (pan.press) {
      if (Math.hypot(event.clientX - pan.client[0], event.clientY - pan.client[1]) <= DRAG_THRESHOLD_PX) return;

      // Порог пройден — двигаем вид; сдвиг считается отсюда, чтобы полотно не дёрнулось.
      pan.press = null;
      pan.client = [event.clientX, event.clientY];
      pan.cx = this.viewport.cx;
      pan.cy = this.viewport.cy;
      this.element.classList.add(PANNING_CLASS);

      return;
    }

    const rect = this.overlay.getBoundingClientRect();
    const factorX = this.options.width / (rect.width || this.options.width);
    const factorY = this.options.height / (rect.height || this.options.height);

    this.viewport.cx = pan.cx + (event.clientX - pan.client[0]) * factorX;
    this.viewport.cy = pan.cy + (event.clientY - pan.client[1]) * factorY;
    this.options.onViewportChange?.();
  }

  /** Курсор «рука» над местом, откуда можно двигать вид, — только без нажатых кнопок. */
  private updateGrab(info: PointerInfo): void {
    const grab = info.event.buttons === 0 && this.options.grabOnHover?.() === true && this.options.canPanFrom?.(info) === true;

    this.element.classList.toggle(GRAB_CLASS, grab);
  }

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
