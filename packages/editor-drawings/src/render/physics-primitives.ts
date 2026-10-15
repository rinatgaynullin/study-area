import type { SvgPoint } from './coords';
import { latexToSvgTspans } from './latex-label';
import { fmt, INK, type SvgBuilder } from './svg-builder';

/**
 * Примитивы физических схем поверх `SvgBuilder`: стрелки, штриховка,
 * дуги, пружина, человечек, элементы цепи.
 *
 * Все координаты здесь уже в пикселях SVG (ось y вниз); из единиц мира их
 * переводит `physics-svg.ts`. Каждый примитив рисует в переданный builder и
 * ничего не возвращает. Вырожденная геометрия (совпавшие точки, нулевой
 * радиус) молча пропускается: сцена от нейросети с дублями точек не должна
 * ронять рендер.
 */

export interface PrimitiveStroke {
  color?: string;
  width?: number;
  dashed?: boolean | string;
}

export interface ArrowOptions extends PrimitiveStroke {
  /** Длина наконечника в пикселях. */
  headSize?: number;
}

/** Единичное направление отрезка и его длина. */
export interface Direction {
  ux: number;
  uy: number;
  length: number;
}

/** Белая «бумага» под элементами (головка человечка, приборы): класс даёт теме перекрасить её. */
export const PAPER_FILL = '#fff';
export const PAPER_CLASS = 'rte-drawing__paper';

/** Направление от `from` к `to`; `null`, если точки совпали или координаты битые. */
export const segmentDirection = (from: SvgPoint, to: SvgPoint): Direction | null => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);

  // `!(length > 0)` ловит и NaN: такие точки не стоит рисовать вовсе.
  if (!(length > 0) || !Number.isFinite(length)) return null;

  return { ux: dx / length, uy: dy / length, length };
};

/**
 * Точка, сдвинутая вдоль направления на `along` и поперёк на `across`.
 * Поперечная ось — нормаль `(-uy, ux)`: для отрезка слева направо это низ
 * экрана, что совпадает с тем, как оригинал кладёт штриховку и подписи.
 */
export const shiftPoint = (point: SvgPoint, direction: Direction, along: number, across = 0): SvgPoint => ({
  x: point.x + direction.ux * along - direction.uy * across,
  y: point.y + direction.uy * along + direction.ux * across,
});

const reversed = (direction: Direction): Direction => ({ ux: -direction.ux, uy: -direction.uy, length: direction.length });

const midpoint = (a: SvgPoint, b: SvgPoint): SvgPoint => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** Угол в диапазоне [0, 360). */
export const normalizeDegrees = (degrees: number): number => ((degrees % 360) + 360) % 360;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

const arrowHead = (svg: SvgBuilder, tip: SvgPoint, direction: Direction, size: number, spread: number, color: string): void => {
  const base = shiftPoint(tip, direction, -size);

  svg.polygon([tip, shiftPoint(base, direction, 0, size * spread), shiftPoint(base, direction, 0, -size * spread)], {
    fill: color,
  });
};

/** Стрелка от `from` к `to` с наконечником у конца. */
export const drawArrow = (svg: SvgBuilder, from: SvgPoint, to: SvgPoint, options: ArrowOptions = {}): void => {
  const direction = segmentDirection(from, to);

  if (!direction) return;

  const color = options.color ?? INK;

  svg.line(from, to, { color, width: options.width ?? 2, dashed: options.dashed, linecap: 'round' });
  arrowHead(svg, to, direction, options.headSize ?? 8, 0.4, color);
};

/** Линия с наконечником посередине: процессы на термодиаграммах, лучи, силовые линии. */
export const drawMidArrowLine = (svg: SvgBuilder, from: SvgPoint, to: SvgPoint, options: ArrowOptions = {}): void => {
  const direction = segmentDirection(from, to);

  if (!direction) return;

  const color = options.color ?? INK;
  const headSize = options.headSize ?? 7;

  svg.line(from, to, { color, width: options.width ?? 1.5, dashed: options.dashed });
  arrowHead(svg, shiftPoint(midpoint(from, to), direction, headSize / 2), direction, headSize, 0.4, color);
};

/** Размерная линия: наконечники с обоих концов. */
export const drawDoubleArrow = (svg: SvgBuilder, from: SvgPoint, to: SvgPoint, options: ArrowOptions = {}): void => {
  const direction = segmentDirection(from, to);

  if (!direction) return;

  const color = options.color ?? INK;
  const headSize = options.headSize ?? 8;

  svg.line(from, to, { color, width: options.width ?? 1.8, dashed: options.dashed, linecap: 'round' });
  arrowHead(svg, to, direction, headSize, 0.35, color);
  arrowHead(svg, from, reversed(direction), headSize, 0.35, color);
};

export type HatchingSide = 'top' | 'bottom' | 'left' | 'right';

export interface HatchedSurfaceOptions extends PrimitiveStroke {
  hatching?: HatchingSide;
}

const HATCH_STEP = 6;
const HATCH_SIZE = 6;
/** Потолок числа штрихов: километровая линия от нейросети не должна раздувать SVG. */
const MAX_HATCHES = 2000;

/**
 * Опорная поверхность: линия и косые штрихи с одной стороны.
 *
 * Сторона считается от направления отрезка, а не от экрана: `bottom`/`right`
 * — нормаль `(-uy, ux)`, `top`/`left` — противоположная. Так делал оригинал,
 * и сохранённые сцены подобраны под это.
 */
export const drawHatchedSurface = (
  svg: SvgBuilder,
  from: SvgPoint,
  to: SvgPoint,
  options: HatchedSurfaceOptions = {},
): void => {
  const color = options.color ?? INK;

  svg.line(from, to, { color, width: options.width ?? 2, dashed: options.dashed, linecap: 'round' });

  const direction = segmentDirection(from, to);

  if (!direction) return;

  const side = options.hatching === 'top' || options.hatching === 'left' ? -1 : 1;
  const count = Math.min(Math.floor(direction.length / HATCH_STEP), MAX_HATCHES);

  for (let index = 0; index <= count; index += 1) {
    const base = shiftPoint(from, direction, index * HATCH_STEP);
    const tip = shiftPoint(base, direction, -0.7 * HATCH_SIZE, side * 0.7 * HATCH_SIZE);

    svg.line(base, tip, { color, width: 0.8 });
  }
};

export interface ArcOptions extends PrimitiveStroke {
  /** Куда идти от начального угла к конечному: против часовой в мире (умолчание) или по часовой. */
  sweep?: 'ccw' | 'cw';
}

/** Точка окружности по углу мира (0 — вправо, против часовой); ось y SVG смотрит вниз. */
const polarWorld = (center: SvgPoint, radius: number, degrees: number): SvgPoint => ({
  x: center.x + radius * Math.cos(toRadians(degrees)),
  y: center.y - radius * Math.sin(toRadians(degrees)),
});

/**
 * Путь дуги по центру, радиусу и углам мира в градусах.
 *
 * Против часовой в мире на экране тоже против часовой, а положительное
 * направление SVG (`sweep-flag=1`) — по часовой, поэтому флаги считаются от
 * `sweep`. Нулевой размах — полная окружность двумя полудугами.
 */
export const arcPath = (
  center: SvgPoint,
  radius: number,
  startDegrees: number,
  endDegrees: number,
  sweep: 'ccw' | 'cw' = 'ccw',
): string => {
  const span = sweep === 'ccw' ? normalizeDegrees(endDegrees - startDegrees) : normalizeDegrees(startDegrees - endDegrees);
  const flag = sweep === 'ccw' ? 0 : 1;
  const start = polarWorld(center, radius, startDegrees);
  const r = fmt(radius);

  if (span === 0) {
    const half = polarWorld(center, radius, startDegrees + (sweep === 'ccw' ? 180 : -180));

    return `M ${fmt(start.x)} ${fmt(start.y)} A ${r} ${r} 0 0 ${flag} ${fmt(half.x)} ${fmt(half.y)} A ${r} ${r} 0 0 ${flag} ${fmt(start.x)} ${fmt(start.y)}`;
  }

  const end = polarWorld(center, radius, endDegrees);

  return `M ${fmt(start.x)} ${fmt(start.y)} A ${r} ${r} 0 ${span > 180 ? 1 : 0} ${flag} ${fmt(end.x)} ${fmt(end.y)}`;
};

/** Дуга окружности: центр, радиус в пикселях, углы мира в градусах. */
export const drawArc = (
  svg: SvgBuilder,
  center: SvgPoint,
  radius: number,
  startDegrees: number,
  endDegrees: number,
  options: ArcOptions = {},
): void => {
  if (!(radius > 0) || !Number.isFinite(radius)) return;

  svg.path(arcPath(center, radius, startDegrees, endDegrees, options.sweep), {
    color: options.color ?? INK,
    width: options.width ?? 2,
    dashed: options.dashed,
    linecap: 'round',
  });
};

/** Человечек: `at` — примерно середина фигуры, `height` — её рост в пикселях. */
export const drawStickman = (svg: SvgBuilder, at: SvgPoint, height: number, options: PrimitiveStroke = {}): void => {
  if (!(height > 0)) return;

  const color = options.color ?? INK;
  const width = options.width ?? 1.8;
  const dashed = options.dashed === true ? '4,4' : options.dashed;
  const stroke = { color, width, dashed, linecap: 'round' as const };
  const headRadius = height * 0.14;
  const neckY = at.y - height * 0.22;
  const hipY = at.y + height * 0.15;

  svg.circle({ x: at.x, y: neckY - headRadius }, headRadius, { ...stroke, fill: PAPER_FILL, className: PAPER_CLASS });
  svg.line({ x: at.x, y: neckY }, { x: at.x, y: hipY }, stroke);

  const shoulderY = neckY + height * 0.08;
  const arm = height * 0.3;

  svg.line({ x: at.x, y: shoulderY }, { x: at.x - arm * 0.8, y: shoulderY + arm * 0.5 }, stroke);
  svg.line({ x: at.x, y: shoulderY }, { x: at.x + arm * 0.8, y: shoulderY + arm * 0.5 }, stroke);

  const leg = height * 0.45;

  svg.line({ x: at.x, y: hipY }, { x: at.x - leg * 0.5, y: hipY + leg * 0.85 }, stroke);
  svg.line({ x: at.x, y: hipY }, { x: at.x + leg * 0.5, y: hipY + leg * 0.85 }, stroke);
};

/** Шарик на нитке: эллипс с узлом внизу и нить до `ropeEnd` (если он есть). */
export const drawBalloon = (
  svg: SvgBuilder,
  at: SvgPoint,
  radius: number,
  ropeEnd: SvgPoint | null,
  options: PrimitiveStroke = {},
): void => {
  if (!(radius > 0)) return;

  const color = options.color ?? INK;
  const dashed = options.dashed === true ? '4,4' : options.dashed;
  const ry = radius * 1.25;
  const knot = { x: at.x, y: at.y + ry };

  if (ropeEnd) {
    // Нить слегка провисает: кубическая кривая с контрольными точками по бокам от середины.
    const midX = (knot.x + ropeEnd.x) / 2;
    const midY = (knot.y + ropeEnd.y) / 2;
    const d =
      `M ${fmt(knot.x)} ${fmt(knot.y)} C ${fmt(midX - 8)} ${fmt((knot.y + midY) / 2)}, `
      + `${fmt(midX + 8)} ${fmt((midY + ropeEnd.y) / 2)}, ${fmt(ropeEnd.x)} ${fmt(ropeEnd.y)}`;

    svg.path(d, { color, width: 1, dashed, linecap: 'round' });
  }

  svg.polygon([knot, { x: knot.x - 3, y: knot.y + 4 }, { x: knot.x + 3, y: knot.y + 4 }], { fill: color });
  svg.ellipse(at, radius, ry, { color, width: options.width ?? 1.8, dashed, fill: 'rgba(252, 165, 165, 0.3)' });
};

/** Эллиптическая платформа, повёрнутая на `angleDegrees` против часовой в мире. */
export const drawEllipsePlatform = (
  svg: SvgBuilder,
  at: SvgPoint,
  rx: number,
  ry: number,
  angleDegrees: number,
  options: PrimitiveStroke = {},
): void => {
  if (!(rx > 0) || !(ry > 0)) return;

  svg.group(at, -angleDegrees, (inner) => {
    inner.ellipse({ x: 0, y: 0 }, rx, ry, {
      color: options.color ?? INK,
      width: options.width ?? 1.8,
      dashed: options.dashed,
      fill: 'rgba(226, 232, 240, 0.4)',
    });
  });
};

export interface AngleArcOptions extends PrimitiveStroke {
  /** Радиус дуги в пикселях. */
  radius?: number;
  /** Подпись в LaTeX-подмножестве; ставится на биссектрисе. */
  label?: string;
  /** `inner` — меньшая из двух дуг между лучами, `outer` — большая. */
  angleType?: 'inner' | 'outer';
  /** Расстояние подписи от вершины; по умолчанию радиус + 15. */
  labelDistance?: number;
}

/** Точка по углу в координатах SVG (y вниз): для дуг, посчитанных через `atan2` экранных точек. */
const polarSvg = (center: SvgPoint, radius: number, degrees: number): SvgPoint => ({
  x: center.x + radius * Math.cos(toRadians(degrees)),
  y: center.y + radius * Math.sin(toRadians(degrees)),
});

/** Дуга угла между лучами `vertex→a` и `vertex→b` с подписью на биссектрисе. */
export const drawAngleArc = (
  svg: SvgBuilder,
  vertex: SvgPoint,
  a: SvgPoint,
  b: SvgPoint,
  options: AngleArcOptions = {},
): void => {
  const radius = options.radius ?? 32;

  if (!(radius > 0)) return;

  const color = options.color ?? INK;
  let start = normalizeDegrees((Math.atan2(a.y - vertex.y, a.x - vertex.x) * 180) / Math.PI);
  let end = normalizeDegrees((Math.atan2(b.y - vertex.y, b.x - vertex.x) * 180) / Math.PI);
  let span = normalizeDegrees(end - start);
  const inner = options.angleType !== 'outer';

  // Углы экранные, поэтому дуга идёт по часовой (`sweep-flag=1`); чтобы
  // получить нужную из двух дуг, при необходимости меняем лучи местами.
  if ((inner && span > 180) || (!inner && span <= 180)) {
    [start, end] = [end, start];
    span = 360 - span;
  }

  const from = polarSvg(vertex, radius, start);
  const to = polarSvg(vertex, radius, end);
  const r = fmt(radius);

  svg.path(`M ${fmt(from.x)} ${fmt(from.y)} A ${r} ${r} 0 ${span > 180 ? 1 : 0} 1 ${fmt(to.x)} ${fmt(to.y)}`, {
    color,
    width: options.width ?? 1.5,
    dashed: options.dashed,
  });

  if (options.label) {
    const at = polarSvg(vertex, options.labelDistance ?? radius + 15, start + span / 2);

    svg.text(at, latexToSvgTspans(options.label), { markup: true, size: 11, baseline: 'central', color });
  }
};

const SPRING_AMPLITUDE = 7;
const SPRING_PITCH = 7;

/** Пружина: прямые хвосты и зигзаг между ними. */
export const drawSpring = (svg: SvgBuilder, from: SvgPoint, to: SvgPoint, options: PrimitiveStroke = {}): void => {
  const direction = segmentDirection(from, to);

  if (!direction) return;

  const color = options.color ?? INK;
  const width = options.width ?? 1.5;
  const dashed = options.dashed === true ? '4,4' : options.dashed;
  const tail = Math.min(15, direction.length * 0.15);
  const coilLength = direction.length - tail * 2;

  if (coilLength <= 0) {
    svg.line(from, to, { color, width, dashed });

    return;
  }

  const coilStart = shiftPoint(from, direction, tail);
  const turns = Math.max(5, Math.floor(coilLength / SPRING_PITCH));
  const step = coilLength / turns;
  let d = `M ${fmt(from.x)} ${fmt(from.y)} L ${fmt(coilStart.x)} ${fmt(coilStart.y)}`;

  for (let index = 1; index <= turns; index += 1) {
    const side = index % 2 === 0 ? 1 : -1;
    const peak = shiftPoint(coilStart, direction, index * step - step / 2, side * SPRING_AMPLITUDE);
    const node = shiftPoint(coilStart, direction, index * step);

    d += ` L ${fmt(peak.x)} ${fmt(peak.y)} L ${fmt(node.x)} ${fmt(node.y)}`;
  }

  d += ` L ${fmt(to.x)} ${fmt(to.y)}`;

  svg.path(d, { color, width, dashed, linecap: 'round', linejoin: 'round' });
};

/** Что рисует `drawCircuitComponent`; любой другой подтип — просто провод. */
export type CircuitSubtype =
  | 'resistor'
  | 'capacitor'
  | 'inductor'
  | 'coil'
  | 'switch'
  | 'source'
  | 'battery'
  | 'voltmeter'
  | 'ammeter'
  | 'lamp'
  | 'diode';

const RESISTOR_LENGTH = 36;
const RESISTOR_HEIGHT = 14;
const CAPACITOR_GAP = 8;
const CAPACITOR_PLATE = 22;
const COIL_LENGTH = 32;
const COIL_TURNS = 4;
const COIL_BULGE = 7.5;
const SWITCH_LENGTH = 26;
const SWITCH_CONTACT = 2.8;
const SOURCE_GAP = 8;
const SOURCE_LONG_PLATE = 26;
const SOURCE_SHORT_PLATE = 14;
const METER_RADIUS = 14;
const LAMP_RADIUS = 18;
const DIODE_SIZE = 14;

/**
 * Элемент электрической цепи между двумя точками: символ посередине и
 * подводящие провода к концам.
 */
export const drawCircuitComponent = (
  svg: SvgBuilder,
  from: SvgPoint,
  to: SvgPoint,
  subtype: string | undefined,
  options: PrimitiveStroke = {},
): void => {
  const direction = segmentDirection(from, to);

  if (!direction) return;

  const color = options.color ?? INK;
  const width = options.width ?? 1.8;
  const stroke = { color, width };
  const mid = midpoint(from, to);
  const wire = (a: SvgPoint, b: SvgPoint): void => svg.line(a, b, stroke);
  /** Провода к символу длиной `bodyLength`, лежащему по центру. */
  const leads = (bodyLength: number): [SvgPoint, SvgPoint] => {
    const bodyStart = shiftPoint(mid, direction, -bodyLength / 2);
    const bodyEnd = shiftPoint(mid, direction, bodyLength / 2);

    wire(from, bodyStart);
    wire(bodyEnd, to);

    return [bodyStart, bodyEnd];
  };
  const sign = (at: SvgPoint, text: string, size = 12): void => svg.text(at, text, { size, color });

  switch (subtype as CircuitSubtype | undefined) {
    case 'resistor': {
      if (direction.length < RESISTOR_LENGTH) {
        wire(from, to);

        return;
      }

      const [bodyStart, bodyEnd] = leads(RESISTOR_LENGTH);
      const half = RESISTOR_HEIGHT / 2;

      svg.polygon(
        [
          shiftPoint(bodyStart, direction, 0, half),
          shiftPoint(bodyEnd, direction, 0, half),
          shiftPoint(bodyEnd, direction, 0, -half),
          shiftPoint(bodyStart, direction, 0, -half),
        ],
        { ...stroke, fill: PAPER_FILL, className: PAPER_CLASS },
      );

      return;
    }
    case 'capacitor': {
      const [left, right] = leads(CAPACITOR_GAP);
      const half = CAPACITOR_PLATE / 2;
      const plate = { color, width: width * 1.2, linecap: 'square' as const };

      svg.line(shiftPoint(left, direction, 0, half), shiftPoint(left, direction, 0, -half), plate);
      svg.line(shiftPoint(right, direction, 0, half), shiftPoint(right, direction, 0, -half), plate);

      return;
    }
    case 'inductor':
    case 'coil': {
      if (direction.length < COIL_LENGTH) {
        wire(from, to);

        return;
      }

      const [bodyStart] = leads(COIL_LENGTH);
      const pitch = COIL_LENGTH / COIL_TURNS;
      let d = `M ${fmt(bodyStart.x)} ${fmt(bodyStart.y)}`;

      for (let turn = 0; turn < COIL_TURNS; turn += 1) {
        const control = shiftPoint(bodyStart, direction, (turn + 0.5) * pitch, COIL_BULGE);
        const next = shiftPoint(bodyStart, direction, (turn + 1) * pitch);

        d += ` Q ${fmt(control.x)} ${fmt(control.y)} ${fmt(next.x)} ${fmt(next.y)}`;
      }

      svg.path(d, { ...stroke, linecap: 'round' });

      return;
    }
    case 'switch': {
      const [contactA, contactB] = leads(SWITCH_LENGTH);
      const contact = { color, width: 1.5, fill: PAPER_FILL, className: PAPER_CLASS };
      // Нож приподнят на 30° над линией: так видно, что цепь разомкнута.
      const lift = toRadians(-30);
      const blade: Direction = {
        ux: direction.ux * Math.cos(lift) - direction.uy * Math.sin(lift),
        uy: direction.ux * Math.sin(lift) + direction.uy * Math.cos(lift),
        length: SWITCH_LENGTH,
      };
      const hinge = shiftPoint(contactA, direction, SWITCH_CONTACT);

      svg.circle(contactA, SWITCH_CONTACT, contact);
      svg.circle(contactB, SWITCH_CONTACT, contact);
      svg.line(hinge, shiftPoint(hinge, blade, SWITCH_LENGTH), stroke);

      return;
    }
    case 'source':
    case 'battery': {
      const [longPlate, shortPlate] = leads(SOURCE_GAP);
      const longHalf = SOURCE_LONG_PLATE / 2;
      const shortHalf = SOURCE_SHORT_PLATE / 2;

      svg.line(shiftPoint(longPlate, direction, 0, longHalf), shiftPoint(longPlate, direction, 0, -longHalf), stroke);
      svg.line(shiftPoint(shortPlate, direction, 0, shortHalf), shiftPoint(shortPlate, direction, 0, -shortHalf), {
        color,
        width: width * 2.2,
      });
      sign(shiftPoint(longPlate, direction, -12, 16), '+');
      sign(shiftPoint(shortPlate, direction, 10, 14), '−');

      return;
    }
    case 'voltmeter':
    case 'ammeter': {
      leads(METER_RADIUS * 2);
      svg.circle(mid, METER_RADIUS, { ...stroke, fill: PAPER_FILL, className: PAPER_CLASS });
      sign({ x: mid.x, y: mid.y + 4.5 }, subtype === 'voltmeter' ? 'V' : 'A', 13);

      return;
    }
    case 'lamp': {
      const cross = LAMP_RADIUS * 0.707;

      leads(LAMP_RADIUS * 2);
      svg.circle(mid, LAMP_RADIUS, { ...stroke, fill: PAPER_FILL, className: PAPER_CLASS });
      svg.line(shiftPoint(mid, direction, -cross, -cross), shiftPoint(mid, direction, cross, cross), stroke);
      svg.line(shiftPoint(mid, direction, -cross, cross), shiftPoint(mid, direction, cross, -cross), stroke);

      return;
    }
    case 'diode': {
      const [base, tip] = leads(DIODE_SIZE);
      const half = DIODE_SIZE / 2;

      svg.polygon([shiftPoint(base, direction, 0, half), shiftPoint(base, direction, 0, -half), tip], {
        ...stroke,
        fill: PAPER_FILL,
        className: PAPER_CLASS,
      });
      svg.line(shiftPoint(tip, direction, 0, half), shiftPoint(tip, direction, 0, -half), { ...stroke, linecap: 'square' });

      return;
    }
    default:
      wire(from, to);
  }
};
