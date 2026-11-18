import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SketchCanvas, type PointerInfo, type SketchCanvasOptions } from '../src/builders/sketch-canvas';

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

/**
 * Полотно 560×420 при масштабе 40: центр окна в (280, 210). В jsdom
 * `getBoundingClientRect` даёт нули, поэтому координаты viewBox равны клиентским.
 */
const WIDTH = 560;
const HEIGHT = 420;

type PointerType = 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel';

const pointer = (target: HTMLElement, type: PointerType, x: number, y: number, init: Partial<PointerEventInit> = {}): void => {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y, pointerId: 1, ...init }));
};

const svgOf = (info: PointerInfo | undefined): [number, number] | undefined => (info ? [info.svg.x, info.svg.y] : undefined);

describe('полотно конструктора: перемещение вида', () => {
  let canvas: SketchCanvas | undefined;

  afterEach(() => {
    canvas?.destroy();
    canvas = undefined;
  });

  const create = (options: Partial<SketchCanvasOptions> = {}) => {
    const calls = {
      down: vi.fn<(info: PointerInfo) => void>(),
      move: vi.fn<(info: PointerInfo) => void>(),
      up: vi.fn<(info: PointerInfo) => void>(),
      viewport: vi.fn<() => void>(),
    };

    canvas = new SketchCanvas({
      width: WIDTH,
      height: HEIGHT,
      scale: 40,
      onPointerDown: calls.down,
      onPointerMove: calls.move,
      onPointerUp: calls.up,
      onViewportChange: calls.viewport,
      ...options,
    });
    document.body.appendChild(canvas.element);

    return { sketch: canvas, element: canvas.element, calls };
  };

  it('протяжка с места, откуда можно двигать вид, двигает вид, а конструктор нажатия не получает', () => {
    const { sketch, element, calls } = create({ canPanFrom: () => true });

    pointer(element, 'pointerdown', 100, 100);
    // В пределах порога это ещё клик: вид на месте.
    pointer(element, 'pointermove', 103, 102);
    expect(sketch.viewport).toEqual({ scale: 40, cx: 280, cy: 210 });
    expect(element.classList.contains('rte-sketch--panning')).toBe(false);
    // Порог пройден: сдвиг считается отсюда, поэтому рывка нет.
    pointer(element, 'pointermove', 110, 100);
    expect(element.classList.contains('rte-sketch--panning')).toBe(true);
    expect(sketch.panning).toBe(true);
    pointer(element, 'pointermove', 130, 115);
    pointer(element, 'pointerup', 130, 115);

    expect(sketch.viewport).toEqual({ scale: 40, cx: 300, cy: 225 });
    expect(calls.viewport).toHaveBeenCalled();
    expect(calls.down).not.toHaveBeenCalled();
    expect(calls.move).not.toHaveBeenCalled();
    expect(calls.up).not.toHaveBeenCalled();
    expect(element.classList.contains('rte-sketch--panning')).toBe(false);
    expect(sketch.panning).toBe(false);
  });

  it('нажатие без движения доходит до конструктора обычным нажатием в исходной точке', () => {
    const { sketch, element, calls } = create({ canPanFrom: () => true });

    pointer(element, 'pointerdown', 100, 100);
    pointer(element, 'pointermove', 102, 101);
    expect(calls.down).not.toHaveBeenCalled();
    pointer(element, 'pointerup', 102, 101);

    expect(calls.down).toHaveBeenCalledTimes(1);
    expect(calls.up).toHaveBeenCalledTimes(1);
    expect(svgOf(calls.down.mock.calls[0]?.[0])).toEqual([100, 100]);
    expect(svgOf(calls.up.mock.calls[0]?.[0])).toEqual([100, 100]);
    expect(calls.up.mock.calls[0]?.[0].event.type).toBe('pointerup');
    expect(calls.move).not.toHaveBeenCalled();
    expect(sketch.viewport).toEqual({ scale: 40, cx: 280, cy: 210 });
  });

  it('ответ «нет» — колбэки приходят сразу, вид не меняется', () => {
    const canPanFrom = vi.fn(() => false);
    const { sketch, element, calls } = create({ canPanFrom });

    pointer(element, 'pointerdown', 100, 100);
    expect(calls.down).toHaveBeenCalledTimes(1);
    pointer(element, 'pointermove', 140, 100);
    expect(calls.move).toHaveBeenCalledTimes(1);
    pointer(element, 'pointerup', 140, 100);
    expect(calls.up).toHaveBeenCalledTimes(1);
    expect(sketch.viewport).toEqual({ scale: 40, cx: 280, cy: 210 });
    expect(canPanFrom).toHaveBeenCalledTimes(1);
  });

  it('с правой кнопкой полотно не придерживает нажатие', () => {
    const canPanFrom = vi.fn(() => true);
    const { element, calls } = create({ canPanFrom });

    pointer(element, 'pointerdown', 100, 100, { button: 2 });
    expect(calls.down).toHaveBeenCalledTimes(1);
    expect(canPanFrom).not.toHaveBeenCalled();
  });

  it('pointercancel обрывает жест: нажатие не доставляется, вид дальше не едет', () => {
    const { sketch, element, calls } = create({ canPanFrom: () => true });

    pointer(element, 'pointerdown', 100, 100);
    pointer(element, 'pointercancel', 100, 100);
    pointer(element, 'pointermove', 160, 100);
    expect(calls.down).not.toHaveBeenCalled();
    expect(calls.up).not.toHaveBeenCalled();
    expect(sketch.viewport.cx).toBe(280);

    pointer(element, 'pointerdown', 100, 100);
    pointer(element, 'pointermove', 120, 100);
    pointer(element, 'pointermove', 140, 100);
    pointer(element, 'pointercancel', 140, 100);
    expect(element.classList.contains('rte-sketch--panning')).toBe(false);
    pointer(element, 'pointermove', 200, 100);
    expect(sketch.viewport.cx).toBe(300);
    expect(calls.down).not.toHaveBeenCalled();
    expect(calls.up).not.toHaveBeenCalled();
  });

  it('потеря захвата обрывает придержанное нажатие без клика', () => {
    const { element, calls } = create({ canPanFrom: () => true });

    pointer(element, 'pointerdown', 100, 100);
    element.dispatchEvent(new PointerEvent('lostpointercapture', { pointerId: 1 }));
    pointer(element, 'pointerup', 100, 100);
    expect(calls.down).not.toHaveBeenCalled();
  });

  it('потеря захвата посреди жеста конструктора приходит ему как pointercancel', () => {
    const { element, calls } = create({ canPanFrom: () => false });

    pointer(element, 'pointerdown', 100, 100);
    pointer(element, 'pointermove', 130, 100);
    element.dispatchEvent(new PointerEvent('lostpointercapture', { pointerId: 1 }));
    expect(calls.up).toHaveBeenCalledTimes(1);
    expect(calls.up.mock.calls[0]?.[0].event.type).toBe('pointercancel');
    expect(svgOf(calls.up.mock.calls[0]?.[0])).toEqual([130, 100]);

    // Потеря захвата после обычного отпускания второй раз ничего не присылает.
    pointer(element, 'pointerdown', 100, 100);
    pointer(element, 'pointerup', 100, 100);
    element.dispatchEvent(new PointerEvent('lostpointercapture', { pointerId: 1 }));
    expect(calls.up).toHaveBeenCalledTimes(2);
    expect(calls.up.mock.calls[1]?.[0].event.type).toBe('pointerup');
  });

  it('средняя кнопка двигает вид сразу, без порога и без опроса конструктора', () => {
    const canPanFrom = vi.fn(() => false);
    const { sketch, element, calls } = create({ canPanFrom });

    pointer(element, 'pointerdown', 100, 100, { button: 1 });
    pointer(element, 'pointermove', 102, 103, { button: 1 });
    pointer(element, 'pointerup', 102, 103, { button: 1 });
    expect(sketch.viewport).toEqual({ scale: 40, cx: 282, cy: 213 });
    expect(canPanFrom).not.toHaveBeenCalled();
    expect(calls.down).not.toHaveBeenCalled();
    expect(calls.up).not.toHaveBeenCalled();
  });

  it('курсор «рука» — над местом, откуда можно двигать вид, только когда конструктор просит', () => {
    let grab = true;
    let empty = true;
    const { element } = create({ canPanFrom: () => empty, grabOnHover: () => grab });

    pointer(element, 'pointermove', 100, 100);
    expect(element.classList.contains('rte-sketch--grab')).toBe(true);
    empty = false;
    pointer(element, 'pointermove', 110, 100);
    expect(element.classList.contains('rte-sketch--grab')).toBe(false);
    empty = true;
    grab = false;
    pointer(element, 'pointermove', 120, 100);
    expect(element.classList.contains('rte-sketch--grab')).toBe(false);
    grab = true;
    pointer(element, 'pointermove', 130, 100);
    element.dispatchEvent(new PointerEvent('pointerleave', { pointerId: 1 }));
    expect(element.classList.contains('rte-sketch--grab')).toBe(false);
  });

  it('стрелка сдвигает вид на шаг в единицах мира, остальные клавиши — нет', () => {
    const { sketch, calls } = create();

    expect(sketch.panByKey('ArrowLeft', 0.5)).toBe(true);
    expect(sketch.viewport).toEqual({ scale: 40, cx: 300, cy: 210 });
    expect(sketch.panByKey('ArrowUp', 1)).toBe(true);
    expect(sketch.viewport).toEqual({ scale: 40, cx: 300, cy: 250 });
    expect(sketch.panByKey('ArrowRight', 0.5)).toBe(true);
    expect(sketch.panByKey('ArrowDown', 1)).toBe(true);
    expect(sketch.viewport).toEqual({ scale: 40, cx: 280, cy: 210 });
    expect(sketch.panByKey('a', 1)).toBe(false);
    expect(calls.viewport).toHaveBeenCalledTimes(4);
  });

  it('движение мыши без нажатых кнопок обрывает жест вида: потерянное отпускание не оставляет лист у курсора', () => {
    const { sketch, element, calls } = create({ canPanFrom: () => true });
    const mouse = (type: PointerType, x: number, y: number, buttons: number): void => {
      pointer(element, type, x, y, { pointerType: 'mouse', buttons });
    };

    mouse('pointerdown', 100, 100, 1);
    mouse('pointermove', 110, 100, 1);
    mouse('pointermove', 130, 100, 1);
    expect(sketch.viewport.cx).toBe(300);

    // Отпускание потерялось: следующее движение — уже без кнопок.
    mouse('pointermove', 170, 100, 0);
    expect(sketch.panning).toBe(false);
    expect(element.classList.contains('rte-sketch--panning')).toBe(false);
    mouse('pointermove', 200, 120, 0);
    expect(sketch.viewport).toEqual({ scale: 40, cx: 300, cy: 210 });
    // Движения без кнопок — обычное наведение, конструктор их получает.
    expect(calls.move).toHaveBeenCalledTimes(2);

    // Придержанное нажатие с потерянным отпусканием кликом не становится.
    mouse('pointerdown', 100, 100, 1);
    mouse('pointermove', 101, 100, 0);
    mouse('pointerup', 101, 100, 0);
    expect(calls.down).not.toHaveBeenCalled();
    expect(sketch.viewport.cx).toBe(300);
  });

  it('колесо во время придержанного нажатия или перемещения вида масштаб не меняет', () => {
    const { sketch, element, calls } = create({ canPanFrom: () => true });
    const wheel = (x: number, y: number): void => {
      element.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: x, clientY: y, deltaY: -100 }));
    };

    // Придержанное нажатие: колесо не сдвигает точку, куда придёт клик.
    pointer(element, 'pointerdown', 100, 100);
    wheel(400, 300);
    expect(sketch.viewport).toEqual({ scale: 40, cx: 280, cy: 210 });
    pointer(element, 'pointerup', 100, 100);
    expect(calls.down.mock.calls[0]?.[0].world).toEqual([-4.5, 2.75]);

    // Перемещение вида: колесо ничего не меняет, протяжка продолжается без рывка.
    pointer(element, 'pointerdown', 100, 100);
    pointer(element, 'pointermove', 110, 100);
    pointer(element, 'pointermove', 130, 100);
    wheel(400, 300);
    expect(sketch.viewport).toEqual({ scale: 40, cx: 300, cy: 210 });
    pointer(element, 'pointermove', 140, 100);
    expect(sketch.viewport).toEqual({ scale: 40, cx: 310, cy: 210 });
    pointer(element, 'pointerup', 140, 100);

    // Жест кончился — колесо снова масштабирует.
    wheel(400, 300);
    expect(sketch.viewport.scale).toBeCloseTo(44);
  });

  it('сброс жестов: придержанное нажатие и перемещение вида пропадают без колбэков', () => {
    const { sketch, element, calls } = create({ canPanFrom: () => true });

    pointer(element, 'pointerdown', 100, 100);
    sketch.resetGestures();
    pointer(element, 'pointerup', 100, 100);
    expect(calls.down).not.toHaveBeenCalled();

    pointer(element, 'pointerdown', 100, 100);
    pointer(element, 'pointermove', 110, 100);
    pointer(element, 'pointermove', 130, 100);
    sketch.resetGestures();
    expect(sketch.panning).toBe(false);
    expect(element.classList.contains('rte-sketch--panning')).toBe(false);
    pointer(element, 'pointermove', 180, 100);
    expect(sketch.viewport.cx).toBe(300);
    expect(calls.down).not.toHaveBeenCalled();
  });

  it('сброс жестов: нажатие, полученное конструктором, забывается без pointercancel', () => {
    const { sketch, element, calls } = create({ canPanFrom: () => false });

    pointer(element, 'pointerdown', 100, 100);
    sketch.resetGestures();
    element.dispatchEvent(new PointerEvent('lostpointercapture', { pointerId: 1 }));
    expect(calls.up).not.toHaveBeenCalled();
  });
});

describe('полотно конструктора: жест двумя пальцами', () => {
  let canvas: SketchCanvas | undefined;

  afterEach(() => {
    canvas?.destroy();
    canvas = undefined;
  });

  const create = (options: Partial<SketchCanvasOptions> = {}) => {
    const calls = {
      down: vi.fn<(info: PointerInfo) => void>(),
      move: vi.fn<(info: PointerInfo) => void>(),
      up: vi.fn<(info: PointerInfo) => void>(),
      viewport: vi.fn<() => void>(),
    };

    canvas = new SketchCanvas({
      width: WIDTH,
      height: HEIGHT,
      scale: 40,
      onPointerDown: calls.down,
      onPointerMove: calls.move,
      onPointerUp: calls.up,
      onViewportChange: calls.viewport,
      ...options,
    });
    document.body.appendChild(canvas.element);

    return { sketch: canvas, element: canvas.element, calls };
  };

  const touch = (target: HTMLElement, type: PointerType, id: number, x: number, y: number): void => {
    pointer(target, type, x, y, { pointerId: id, isPrimary: id === 1, pointerType: 'touch' });
  };

  it('пальцы разводят — масштаб растёт, точка листа под их серединой остаётся на месте', () => {
    const { sketch, element, calls } = create({ canPanFrom: () => true });
    const before = sketch.toWorld({ x: 250, y: 200 });

    touch(element, 'pointerdown', 1, 200, 200);
    touch(element, 'pointerdown', 2, 300, 200);
    touch(element, 'pointermove', 1, 175, 200);
    touch(element, 'pointermove', 2, 325, 200);
    touch(element, 'pointermove', 1, 150, 200);
    touch(element, 'pointermove', 2, 350, 200);

    expect(sketch.viewport.scale).toBeCloseTo(80);

    const after = sketch.toWorld({ x: 250, y: 200 });

    expect(after[0]).toBeCloseTo(before[0], 6);
    expect(after[1]).toBeCloseTo(before[1], 6);
    expect(calls.viewport).toHaveBeenCalled();

    touch(element, 'pointerup', 1, 150, 200);
    touch(element, 'pointerup', 2, 350, 200);
    expect(calls.down).not.toHaveBeenCalled();
    expect(calls.move).not.toHaveBeenCalled();
    expect(calls.up).not.toHaveBeenCalled();
  });

  it('пальцы движутся вместе — вид едет за ними, масштаб прежний', () => {
    const { sketch, element } = create();

    touch(element, 'pointerdown', 1, 200, 200);
    touch(element, 'pointerdown', 2, 300, 260);
    touch(element, 'pointermove', 1, 230, 180);
    touch(element, 'pointermove', 2, 330, 240);

    expect(sketch.viewport.scale).toBeCloseTo(40);
    expect(sketch.viewport.cx).toBeCloseTo(310);
    expect(sketch.viewport.cy).toBeCloseTo(190);
  });

  it('масштаб жеста ограничен теми же пределами, что у колеса', () => {
    const { sketch, element } = create();

    touch(element, 'pointerdown', 1, 270, 200);
    touch(element, 'pointerdown', 2, 290, 200);
    touch(element, 'pointermove', 2, 900, 200);
    expect(sketch.viewport.scale).toBe(200);
    touch(element, 'pointermove', 2, 271, 200);
    expect(sketch.viewport.scale).toBe(6);
  });

  it('второй палец обрывает начатое конструктором как pointercancel, дальше колбэков нет', () => {
    const { sketch, element, calls } = create({ canPanFrom: () => false });

    touch(element, 'pointerdown', 1, 100, 100);
    touch(element, 'pointermove', 1, 120, 100);
    expect(calls.down).toHaveBeenCalledTimes(1);
    expect(calls.move).toHaveBeenCalledTimes(1);

    touch(element, 'pointerdown', 2, 200, 100);
    expect(calls.up).toHaveBeenCalledTimes(1);
    expect(calls.up.mock.calls[0]?.[0].event.type).toBe('pointercancel');
    expect(calls.up.mock.calls[0]?.[0].event.pointerId).toBe(1);
    expect(svgOf(calls.up.mock.calls[0]?.[0])).toEqual([120, 100]);

    touch(element, 'pointermove', 1, 140, 100);
    touch(element, 'pointermove', 2, 220, 100);
    touch(element, 'pointerup', 2, 220, 100);

    // Один палец подняли: оставшийся ничего не двигает и конструктору не виден.
    const view = { ...sketch.viewport };

    touch(element, 'pointermove', 1, 60, 140);
    expect(sketch.viewport).toEqual(view);
    touch(element, 'pointerup', 1, 60, 140);
    expect(calls.down).toHaveBeenCalledTimes(1);
    expect(calls.move).toHaveBeenCalledTimes(1);
    expect(calls.up).toHaveBeenCalledTimes(1);
    expect(sketch.panning).toBe(false);

    // Жест кончился: следующее касание — снова обычное нажатие.
    touch(element, 'pointerdown', 1, 100, 100);
    touch(element, 'pointerup', 1, 100, 100);
    expect(calls.down).toHaveBeenCalledTimes(2);
    expect(calls.up).toHaveBeenCalledTimes(2);
  });

  it('второй палец во время придержанного нажатия: нажатие пропадает', () => {
    const { element, calls } = create({ canPanFrom: () => true });

    touch(element, 'pointerdown', 1, 100, 100);
    touch(element, 'pointerdown', 2, 200, 100);
    touch(element, 'pointerup', 1, 100, 100);
    touch(element, 'pointerup', 2, 200, 100);
    expect(calls.down).not.toHaveBeenCalled();
    expect(calls.up).not.toHaveBeenCalled();
    expect(element.classList.contains('rte-sketch--panning')).toBe(false);
  });

  it('второй палец во время перемещения вида одним пальцем переводит в жест двумя пальцами', () => {
    const { sketch, element } = create({ canPanFrom: () => true });

    touch(element, 'pointerdown', 1, 100, 100);
    touch(element, 'pointermove', 1, 110, 100);
    touch(element, 'pointermove', 1, 130, 100);
    expect(sketch.viewport.cx).toBe(300);

    touch(element, 'pointerdown', 2, 230, 100);
    expect(element.classList.contains('rte-sketch--panning')).toBe(false);
    touch(element, 'pointermove', 1, 140, 110);
    touch(element, 'pointermove', 2, 240, 110);
    expect(sketch.viewport.cx).toBeCloseTo(310);
    expect(sketch.viewport.cy).toBeCloseTo(220);
  });

  it('стрелки во время жеста двумя пальцами вид не трогают', () => {
    const { sketch, element } = create();

    touch(element, 'pointerdown', 1, 100, 100);
    touch(element, 'pointerdown', 2, 200, 100);
    expect(sketch.panByKey('ArrowLeft', 1)).toBe(false);
    expect(sketch.panning).toBe(true);
  });

  it('сброс жестов обрывает жест двумя пальцами; следующее касание — обычное нажатие', () => {
    const { sketch, element, calls } = create({ canPanFrom: () => false });

    touch(element, 'pointerdown', 1, 100, 100);
    touch(element, 'pointerdown', 2, 200, 100);
    sketch.resetGestures();
    expect(sketch.panning).toBe(false);
    touch(element, 'pointermove', 2, 400, 100);
    expect(sketch.viewport).toEqual({ scale: 40, cx: 280, cy: 210 });

    touch(element, 'pointerdown', 1, 100, 100);
    touch(element, 'pointerup', 1, 100, 100);
    expect(calls.down).toHaveBeenCalledTimes(2);
    expect(calls.up.mock.calls.at(-1)?.[0].event.type).toBe('pointerup');
  });

  it('колесо во время жеста двумя пальцами масштаб не меняет', () => {
    const { sketch, element } = create();

    touch(element, 'pointerdown', 1, 100, 100);
    touch(element, 'pointerdown', 2, 200, 100);
    element.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 150, clientY: 100, deltaY: -100 }));
    expect(sketch.viewport.scale).toBe(40);
  });
});
