import type { PhysicsElement, PhysicsElementType, PhysicsHighlight, PhysicsScene, Vec2 } from '../scene/types';
import { DEFAULT_PHYSICS_SCALE, fitViewport, worldToSvg, type SvgPoint, type Viewport } from './coords';
import { latexToPlainText, latexToSvgTspans } from './latex-label';
import {
  PAPER_CLASS,
  PAPER_FILL,
  drawAngleArc,
  drawArc,
  drawArrow,
  drawBalloon,
  drawCircuitComponent,
  drawDoubleArrow,
  drawEllipsePlatform,
  drawHatchedSurface,
  drawMidArrowLine,
  drawSpring,
  drawStickman,
  segmentDirection,
  shiftPoint,
  type HatchingSide,
} from './physics-primitives';
import { HIGHLIGHT_COLOR, INK, SvgBuilder, fmt, polylinePath, wrapSvg } from './svg-builder';

/**
 * Физическая схема → SVG.
 *
 * На вход приходит уже нормализованная `PhysicsScene`: типы элементов —
 * только из `PhysicsElementType`, числа конечные, синонимы раскрыты. Здесь
 * остаётся геометрия: перевод мира в пиксели, подбор масштаба при `autoFit`,
 * подсветка выбранного элемента и обход элементов по типам. Любой элемент
 * без нужных ему полей пропускается, а рендер никогда не бросает — сломанная
 * сцена показывает то, что удалось нарисовать.
 */

export interface PhysicsRenderOptions {
  width?: number;
  height?: number;
  highlight?: PhysicsHighlight | null;
  /** Подобрать масштаб и центр по охватывающему прямоугольнику элементов. */
  autoFit?: boolean;
}

export const DEFAULT_PHYSICS_WIDTH = 340;
export const DEFAULT_PHYSICS_HEIGHT = 300;

const FIT_PADDING = 40;
const FIT_MIN_SCALE = 12;
const FIT_MAX_SCALE = 80;
/** Радиус, который берётся для вписывания элемента с центром без явного радиуса. */
const FIT_DEFAULT_RADIUS = 1.5;

const SVG_CLASS = 'rte-drawing__svg';
const GRID_CLASS = 'rte-drawing__grid';
const AXIS_CLASS = 'rte-drawing__axis';
const GRID_COLOR = '#f1f5f9';
const AXIS_COLOR = '#64748b';

const FORCE_COLOR = '#2563eb';
const ACCELERATION_COLOR = '#dc2626';
const POSITIVE_COLOR = '#ef4444';
const NEGATIVE_COLOR = '#3b82f6';
const ELECTRIC_FIELD_COLOR = '#3b82f6';
const MAGNETIC_FIELD_COLOR = '#10b981';
const RAY_FIRST_COLOR = '#f59e0b';
const RAY_NEXT_COLOR = '#ef4444';
const RAY_DASHED_COLOR = '#38bdf8';
const GLASS_FILL = 'rgba(56, 189, 248, 0.12)';
const GLASS_STROKE = 'rgba(14, 165, 233, 0.5)';
const BLOCK_FILL = '#e2e8f0';
const BALL_FILL = '#cbd5e1';
const PULLEY_FILL = '#f1f5f9';
const WEIGHT_FILL = '#94a3b8';

const ISOTHERM_SEGMENTS = 15;
const WAVE_AMPLITUDE = 4;
const WAVE_PERIOD = 12;
/** Потолок точек волны на один провод, чтобы километровая линия не раздувала SVG. */
const MAX_WAVE_SAMPLES = 4000;

/** Точки мира, которые нужно вписать в картинку при `autoFit`. */
export const collectPhysicsPoints = (scene: PhysicsScene): Vec2[] =>
  scene.elements.flatMap((element) => {
    const points: Vec2[] = [...(element.points ?? [])];

    if (element.coords) points.push(element.coords);

    if (element.center) {
      const [x, y] = element.center;
      const radius = element.radius ?? FIT_DEFAULT_RADIUS;

      points.push([x - radius, y - radius], [x + radius, y + radius]);

      // Линза тянет за собой оптическую ось с отметками 2F по обе стороны.
      if (element.type === 'lens') {
        const reach = (element.focalLength ?? 2) * 2;

        points.push([x - reach, y], [x + reach, y]);
      }
    }

    // Оси термографика не имеют точек, но занимают место от начала до стрелок.
    if (element.type === 'thermo_axes') {
      const [ox, oy] = element.offset ?? [0, 0];

      points.push([ox, oy], [ox + (element.xLength ?? 7), oy], [ox, oy + (element.yLength ?? 5.5)]);
    }

    return points;
  });

/**
 * Масштаб и центр картинки. Без `autoFit` — масштаб сцены и её смещение от
 * центра; с ним — вписывание точек, а если вписывать нечего, снова сцена.
 */
export const resolvePhysicsViewport = (scene: PhysicsScene, options: PhysicsRenderOptions = {}): Viewport => {
  const width = options.width ?? DEFAULT_PHYSICS_WIDTH;
  const height = options.height ?? DEFAULT_PHYSICS_HEIGHT;
  const points = options.autoFit ? collectPhysicsPoints(scene) : [];

  if (points.length > 0) {
    return fitViewport(points, {
      width,
      height,
      padding: FIT_PADDING,
      minScale: FIT_MIN_SCALE,
      maxScale: FIT_MAX_SCALE,
      fallbackScale: DEFAULT_PHYSICS_SCALE,
    });
  }

  return {
    scale: scene.scale ?? DEFAULT_PHYSICS_SCALE,
    cx: width / 2 + scene.offsetX,
    cy: height / 2 + scene.offsetY,
  };
};

interface RenderContext {
  width: number;
  height: number;
  scale: number;
  toSvg: (point: Vec2) => SvgPoint;
}

/** Цвет и толщина элемента с учётом подсветки: явный цвет остаётся, толщина растёт. */
interface ElementStyle {
  color: string;
  width: number;
  highlighted: boolean;
  dashed: boolean;
}

type ElementRenderer = (svg: SvgBuilder, element: PhysicsElement, ctx: RenderContext, style: ElementStyle) => void;

/** Полупрозрачная широкая подложка подсветки под линиями. */
const glow = (width: number) => ({
  color: HIGHLIGHT_COLOR,
  width,
  opacity: 0.3,
  linecap: 'round' as const,
  linejoin: 'round' as const,
});

/** Пунктирный контур подсветки вокруг фигур. */
const outline = { color: HIGHLIGHT_COLOR, width: 2, dashed: '3,3' };

/** Залитая точка без обводки. */
const dot = (svg: SvgBuilder, at: SvgPoint, radius: number, color: string): void =>
  svg.circle(at, radius, { fill: color, color: 'none', width: 0 });

const paper = { fill: PAPER_FILL, className: PAPER_CLASS };

const twoPoints = (element: PhysicsElement): [Vec2, Vec2] | null =>
  element.points && element.points.length >= 2 ? [element.points[0], element.points[1]] : null;

/** Цвета, которые нейросеть ставит «по умолчанию»: для сил и ускорений они заменяются на свои. */
const isDefaultInk = (color: string | undefined): boolean =>
  !color || color === '#1e293b' || color === '#000000' || color === 'black';

/** `inner`/`outer` относятся к дугам; для прямой поверхности это сторона по умолчанию. */
const surfaceHatching = (element: PhysicsElement): HatchingSide | undefined =>
  element.hatching === 'inner' || element.hatching === 'outer' ? undefined : element.hatching;

const renderSurface: ElementRenderer = (svg, element, ctx, style) => {
  const points = twoPoints(element);

  if (!points) return;

  drawHatchedSurface(svg, ctx.toSvg(points[0]), ctx.toSvg(points[1]), {
    hatching: surfaceHatching(element),
    color: style.color,
    width: style.highlighted ? 4 : 2.5,
    dashed: style.dashed,
  });
};

const angleOf = (from: Vec2, to: Vec2): number => (Math.atan2(to[1] - from[1], to[0] - from[0]) * 180) / Math.PI;

const renderArcSurface: ElementRenderer = (svg, element, ctx, style) => {
  const points = twoPoints(element);

  if (!points || !element.center) return;

  const center = ctx.toSvg(element.center);
  const radius = Math.hypot(points[0][0] - element.center[0], points[0][1] - element.center[1]) * ctx.scale;
  const start = angleOf(element.center, points[0]);
  const end = angleOf(element.center, points[1]);

  if (style.highlighted) drawArc(svg, center, radius, start, end, { sweep: 'cw', color: HIGHLIGHT_COLOR, width: 6 });

  // По часовой от первой точки ко второй: так шли дуги в оригинале, и
  // сохранённые «жёлоба» перечислены под это направление.
  drawArc(svg, center, radius, start, end, {
    sweep: 'cw',
    color: style.color,
    width: style.highlighted ? 3.5 : 2.2,
    dashed: style.dashed,
  });
};

const renderBlock: ElementRenderer = (svg, element, ctx, style) => {
  if (!element.center) return;

  const center = ctx.toSvg(element.center);
  const stroke = { color: style.color, width: style.width, dashed: style.dashed };

  if (element.subtype === 'circle') {
    const radius = (element.radius ?? 0.5) * ctx.scale;

    if (style.highlighted) svg.circle(center, radius, { color: HIGHLIGHT_COLOR, width: 6, opacity: 0.4 });

    svg.circle(center, radius, { ...stroke, fill: BALL_FILL });

    return;
  }

  if (element.subtype === 'pulley') {
    const radius = (element.radius ?? 0.6) * ctx.scale;

    if (style.highlighted) svg.circle(center, radius, { color: HIGHLIGHT_COLOR, width: 6, opacity: 0.4 });

    svg.circle(center, radius, { ...stroke, fill: PULLEY_FILL });

    if (radius > 4) svg.circle(center, radius - 4, { color: style.color, width: 0.8, dashed: '2,2' });

    dot(svg, center, 3, style.color);

    return;
  }

  const width = (element.width ?? 0.8) * ctx.scale;
  const height = (element.height ?? 0.6) * ctx.scale;

  svg.group(center, -(element.angle ?? 0), (inner) => {
    if (style.highlighted) {
      inner.rect(-width / 2, -height / 2, width, height, { rx: 4, color: HIGHLIGHT_COLOR, width: 6, opacity: 0.4 });
    }

    inner.rect(-width / 2, -height / 2, width, height, { ...stroke, rx: 2, fill: BLOCK_FILL });
  });
};

const renderRope: ElementRenderer = (svg, element, ctx, style) => {
  if (!element.points || element.points.length < 2) return;

  const d = polylinePath(element.points.map(ctx.toSvg));

  if (style.highlighted) svg.path(d, glow(6));

  svg.path(d, { color: style.color, width: style.width, dashed: style.dashed, linecap: 'round', linejoin: 'round' });
};

const renderSpring: ElementRenderer = (svg, element, ctx, style) => {
  const points = twoPoints(element);

  if (!points) return;

  const from = ctx.toSvg(points[0]);
  const to = ctx.toSvg(points[1]);

  if (style.highlighted) svg.line(from, to, glow(8));

  drawSpring(svg, from, to, { color: style.color, width: style.highlighted ? 2.5 : 1.5, dashed: style.dashed });
};

const vectorColor = (element: PhysicsElement, style: ElementStyle): string => {
  if (style.highlighted && !element.color) return HIGHLIGHT_COLOR;

  if (element.vectorType === 'force') return isDefaultInk(element.color) ? FORCE_COLOR : (element.color as string);

  if (element.vectorType === 'acc') return isDefaultInk(element.color) ? ACCELERATION_COLOR : (element.color as string);

  return element.color ?? style.color;
};

const renderVector: ElementRenderer = (svg, element, ctx, style) => {
  const points = twoPoints(element);

  if (!points) return;

  const from = ctx.toSvg(points[0]);
  const to = ctx.toSvg(points[1]);
  const color = vectorColor(element, style);

  drawArrow(svg, from, to, { color, width: style.highlighted ? 3.5 : 2.2, headSize: 9, dashed: style.dashed });

  const direction = segmentDirection(from, to);

  if (!element.label || !direction) return;

  const at = shiftPoint(to, direction, 12);

  svg.text({ x: at.x, y: at.y + 4 }, latexToSvgTspans(element.label), { markup: true, size: 13.5, color, halo: 3.5 });
};

const renderAngle: ElementRenderer = (svg, element, ctx, style) => {
  const points = twoPoints(element);

  if (!points || !element.center) return;

  const vertex = ctx.toSvg(element.center);

  if (style.highlighted) svg.circle(vertex, 8, { color: HIGHLIGHT_COLOR, width: 2 });

  // Радиус дуги задан в пикселях при масштабе 25 и растёт вместе со сценой.
  const unit = ctx.scale / DEFAULT_PHYSICS_SCALE;
  const radius = (element.arcRadius ?? 32) * unit;

  drawAngleArc(svg, vertex, ctx.toSvg(points[0]), ctx.toSvg(points[1]), {
    radius,
    labelDistance: radius + 15 * unit,
    label: element.label,
    angleType: element.angleType,
    color: style.color,
    width: style.highlighted ? 2.5 : 1.5,
  });
};

const renderStickman: ElementRenderer = (svg, element, ctx, style) => {
  if (!element.center) return;

  const at = ctx.toSvg(element.center);
  const height = (element.height ?? 1.6) * ctx.scale;

  if (style.highlighted) svg.circle({ x: at.x, y: at.y - height * 0.1 }, height / 2, outline);

  drawStickman(svg, at, height, { color: style.color, width: style.highlighted ? 3 : 1.8, dashed: style.dashed });
};

const renderBalloon: ElementRenderer = (svg, element, ctx, style) => {
  if (!element.center) return;

  const at = ctx.toSvg(element.center);
  const radius = (element.radius ?? 0.6) * ctx.scale;
  const ropeEnd = element.points && element.points.length > 0 ? ctx.toSvg(element.points[0]) : null;

  if (style.highlighted) svg.ellipse(at, radius + 4, radius * 1.25 + 4, outline);

  drawBalloon(svg, at, radius, ropeEnd, { color: style.color, width: style.highlighted ? 3 : 1.8, dashed: style.dashed });
};

const renderEllipsePlatform: ElementRenderer = (svg, element, ctx, style) => {
  if (!element.center) return;

  const at = ctx.toSvg(element.center);
  const rx = (element.rx ?? 2) * ctx.scale;
  const ry = (element.ry ?? 0.5) * ctx.scale;
  const angle = element.angle ?? 0;

  if (style.highlighted) {
    svg.group(at, -angle, (inner) => inner.ellipse({ x: 0, y: 0 }, rx + 4, ry + 4, outline));
  }

  drawEllipsePlatform(svg, at, rx, ry, angle, {
    color: style.color,
    width: style.highlighted ? 3 : 1.8,
    dashed: style.dashed,
  });
};

const renderDimensionLine: ElementRenderer = (svg, element, ctx, style) => {
  const points = twoPoints(element);

  if (!points) return;

  const from = ctx.toSvg(points[0]);
  const to = ctx.toSvg(points[1]);
  const color = style.highlighted ? HIGHLIGHT_COLOR : style.color;

  drawDoubleArrow(svg, from, to, { color, width: style.highlighted ? 3 : 1.6, dashed: style.dashed });

  if (!element.label) return;

  const direction = segmentDirection(from, to);
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  const at = direction ? shiftPoint(mid, direction, 0, 12) : { x: mid.x - 12, y: mid.y };

  svg.text({ x: at.x, y: at.y + 4 }, latexToSvgTspans(element.label), { markup: true, size: 10.5, color, halo: 2.5 });
};

const renderThermoAxes: ElementRenderer = (svg, element, ctx, style) => {
  const [ox, oy] = element.offset ?? [0, 0];
  const origin = ctx.toSvg([ox, oy]);
  const xEnd = ctx.toSvg([ox + (element.xLength ?? 7), oy]);
  const yEnd = ctx.toSvg([ox, oy + (element.yLength ?? 5.5)]);
  const color = style.color;
  const arrow = { color, width: style.width - 0.5, headSize: 8 };

  drawArrow(svg, origin, xEnd, arrow);
  drawArrow(svg, origin, yEnd, arrow);
  svg.text({ x: xEnd.x, y: xEnd.y + 16 }, latexToSvgTspans(element.xLabel ?? 'V'), { markup: true, size: 12, color });
  svg.text({ x: yEnd.x - 12, y: yEnd.y + 4 }, latexToSvgTspans(element.yLabel ?? 'p'), {
    markup: true,
    size: 12,
    color,
    anchor: 'end',
  });
  svg.text({ x: origin.x - 8, y: origin.y + 12 }, latexToSvgTspans(element.originLabel ?? '0'), {
    markup: true,
    size: 10,
    weight: 400,
    color,
    anchor: 'end',
  });

  const seenX = new Set<number>();

  element.xTicks?.forEach((tick) => {
    if (seenX.has(tick.val)) return;

    seenX.add(tick.val);

    const at = ctx.toSvg([ox + tick.val, oy]);

    svg.line(at, { x: at.x, y: at.y + 4 }, { color, width: 1 });
    svg.text({ x: at.x, y: at.y + 15 }, latexToSvgTspans(tick.label ?? String(tick.val)), {
      markup: true,
      size: 10,
      weight: 400,
      color,
    });
  });

  const seenY = new Set<number>();

  element.yTicks?.forEach((tick) => {
    if (seenY.has(tick.val)) return;

    seenY.add(tick.val);

    const at = ctx.toSvg([ox, oy + tick.val]);

    svg.line(at, { x: at.x - 4, y: at.y }, { color, width: 1 });
    svg.text({ x: at.x - 8, y: at.y + 3 }, latexToSvgTspans(tick.label ?? String(tick.val)), {
      markup: true,
      size: 10,
      weight: 400,
      color,
      anchor: 'end',
    });
  });
};

const renderThermoPoint: ElementRenderer = (svg, element, ctx, style) => {
  if (!element.coords) return;

  const at = ctx.toSvg(element.coords);

  dot(svg, at, 3.5, style.color);

  if (element.label) {
    svg.text({ x: at.x + 8, y: at.y - 6 }, latexToSvgTspans(element.label), {
      markup: true,
      size: 11,
      color: style.color,
      anchor: 'start',
    });
  }
};

/**
 * Изотерма pV = const между двумя точками: ломаная по гиперболе и
 * наконечник в её середине по касательной. Константа интерполируется между
 * точками, поэтому кривая проходит точно через обе, даже если они не на
 * одной изотерме.
 */
const renderIsotherm = (svg: SvgBuilder, from: Vec2, to: Vec2, ctx: RenderContext, style: ElementStyle): void => {
  const constantFrom = from[0] * from[1];
  const constantTo = to[0] * to[1];
  const stepX = (to[0] - from[0]) / ISOTHERM_SEGMENTS;
  const samples: SvgPoint[] = [];

  for (let index = 0; index <= ISOTHERM_SEGMENTS; index += 1) {
    const x = from[0] + stepX * index;
    const y = (constantFrom + (constantTo - constantFrom) * (index / ISOTHERM_SEGMENTS)) / x;

    if (Number.isFinite(y)) samples.push(ctx.toSvg([x, y]));
  }

  if (samples.length < 2) return;

  const d = polylinePath(samples);

  if (style.highlighted) svg.path(d, { color: HIGHLIGHT_COLOR, width: 5, opacity: 0.3 });

  svg.path(d, { color: style.color, width: style.width, dashed: style.dashed });

  const midX = from[0] + (to[0] - from[0]) / 2;
  const midConstant = (constantFrom + constantTo) / 2;

  if (midX === 0) return;

  const slope = -midConstant / (midX * midX);
  const tip = ctx.toSvg([midX, midConstant / midX]);
  const tangent = segmentDirection({ x: 0, y: 0 }, { x: ctx.scale, y: -slope * ctx.scale });

  if (!tangent) return;

  const sign = to[0] > from[0] ? 1 : -1;
  const base = shiftPoint(tip, tangent, -6 * sign);

  svg.polygon([tip, shiftPoint(base, tangent, 0, 2.4), shiftPoint(base, tangent, 0, -2.4)], { fill: style.color });
};

const renderThermoProcess: ElementRenderer = (svg, element, ctx, style) => {
  const points = twoPoints(element);

  if (!points) return;

  if (element.subtype === 'isotherm') {
    renderIsotherm(svg, points[0], points[1], ctx, style);

    return;
  }

  drawMidArrowLine(svg, ctx.toSvg(points[0]), ctx.toSvg(points[1]), {
    color: style.color,
    width: style.width,
    headSize: 7,
    dashed: style.dashed,
  });
};

const renderPistonVessel: ElementRenderer = (svg, element, ctx, style) => {
  if (!element.center) return;

  const width = (element.width ?? 2) * ctx.scale;
  const height = (element.height ?? 3.5) * ctx.scale;
  const pistonY = (0.5 - (element.pistonHeight ?? 0.6)) * height;
  const thickness = (element.pistonThickness ?? 0.15) * ctx.scale;
  const innerWidth = Math.max(0, width - 4);
  const pistonTop = pistonY - thickness / 2;
  const walls = `M ${fmt(-width / 2)} ${fmt(-height / 2)} L ${fmt(-width / 2)} ${fmt(height / 2)} L ${fmt(width / 2)} ${fmt(height / 2)} L ${fmt(width / 2)} ${fmt(-height / 2)}`;
  const stroke = { color: style.color, width: style.width, dashed: style.dashed };

  svg.group(ctx.toSvg(element.center), -(element.angle ?? 0), (inner) => {
    if (style.highlighted) {
      inner.path(walls, { color: HIGHLIGHT_COLOR, width: 6, opacity: 0.4 });
      inner.rect(-innerWidth / 2, pistonTop, innerWidth, thickness, { rx: 1, color: HIGHLIGHT_COLOR, width: 6, opacity: 0.4 });
    }

    inner.path(walls, stroke);
    inner.rect(-innerWidth / 2, pistonTop, innerWidth, thickness, { rx: 1, fill: style.color, color: 'none', width: 0 });
    inner.line({ x: 0, y: pistonTop }, { x: 0, y: pistonTop - 15 }, stroke);

    if (element.weight) {
      inner.rect(-8, pistonTop - 8, 16, 8, { fill: WEIGHT_FILL, color: style.color, width: 1 });
    }

    if (element.label) {
      inner.text({ x: 0, y: height / 2 + 16 }, latexToSvgTspans(element.label), {
        markup: true,
        size: 11,
        weight: 600,
        color: style.color,
      });
    }
  });
};

const renderCircuitComponent: ElementRenderer = (svg, element, ctx, style) => {
  const points = twoPoints(element);

  if (!points) return;

  const from = ctx.toSvg(points[0]);
  const to = ctx.toSvg(points[1]);

  if (style.highlighted) svg.line(from, to, glow(6));

  drawCircuitComponent(svg, from, to, element.subtype, { color: style.color, width: style.width });
};

/** Волнистый провод: синусоида поперёк каждого отрезка с шагом в пиксель. */
const wavyPath = (points: SvgPoint[]): string => {
  const samples: SvgPoint[] = [points[0]];

  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index];
    const to = points[index + 1];
    const direction = segmentDirection(from, to);

    if (direction && direction.length >= 1) {
      const count = Math.min(Math.floor(direction.length), MAX_WAVE_SAMPLES);
      const step = direction.length / count;

      for (let sample = 1; sample <= count; sample += 1) {
        const along = sample * step;

        samples.push(shiftPoint(from, direction, along, WAVE_AMPLITUDE * Math.sin((2 * Math.PI * along) / WAVE_PERIOD)));
      }
    }

    samples.push(to);
  }

  return polylinePath(samples);
};

const renderWire: ElementRenderer = (svg, element, ctx, style) => {
  if (!element.points || element.points.length < 2) return;

  const points = element.points.map(ctx.toSvg);
  const d = element.wavy ? wavyPath(points) : polylinePath(points);

  if (style.highlighted) svg.path(d, glow(6));

  svg.path(d, { color: style.color, width: style.width, dashed: style.dashed, linecap: 'round', linejoin: 'round' });
};

const chargeColor = (element: PhysicsElement, style: ElementStyle): string => {
  if (element.color) return element.color;

  const sign = element.charge?.trim() ?? '';

  if (sign.startsWith('+')) return ACCELERATION_COLOR;

  if (sign.startsWith('-') || sign.startsWith('−')) return FORCE_COLOR;

  return style.color;
};

const renderCharge: ElementRenderer = (svg, element, ctx, style) => {
  if (!element.coords) return;

  const at = ctx.toSvg(element.coords);
  const color = chargeColor(element, style);

  if (style.highlighted) svg.circle(at, 12, { color: HIGHLIGHT_COLOR, width: 2, opacity: 0.5 });

  svg.circle(at, 9, { ...paper, color, width: 1.8, dashed: style.dashed ? '3,3' : false });
  svg.text({ x: at.x, y: at.y + 3.5 }, latexToSvgTspans(element.charge ?? 'q'), { markup: true, size: 11, color });
};

const renderFieldLine: ElementRenderer = (svg, element, ctx, style) => {
  if (!element.points || element.points.length < 2) return;

  const color =
    element.color
    ?? (element.subtype === 'electric' ? ELECTRIC_FIELD_COLOR : element.subtype === 'magnetic' ? MAGNETIC_FIELD_COLOR : style.color);
  const points = element.points.map(ctx.toSvg);

  for (let index = 0; index < points.length - 1; index += 1) {
    drawMidArrowLine(svg, points[index], points[index + 1], { color, width: 1, headSize: 6, dashed: style.dashed });
  }
};

const renderCapacitorPlate: ElementRenderer = (svg, element, ctx, style) => {
  const points = twoPoints(element);

  if (!points) return;

  const from = ctx.toSvg(points[0]);
  const to = ctx.toSvg(points[1]);
  const color = element.color ?? style.color;

  if (style.highlighted) svg.line(from, to, glow(8));

  svg.line(from, to, { color, width: 4, linecap: 'round', dashed: style.dashed });

  const direction = segmentDirection(from, to);

  if (!direction || direction.length <= 10 || !element.plateType || element.plateType === 'neutral') return;

  const positive = element.plateType === 'positive';
  const spacing = 20;
  const count = Math.max(1, Math.floor(direction.length / spacing));
  const first = (direction.length - (count - 1) * spacing) / 2;

  for (let index = 0; index < count; index += 1) {
    const at = shiftPoint(from, direction, first + index * spacing, 10);

    svg.text({ x: at.x, y: at.y + 3.5 }, positive ? '+' : '−', { size: 12, color: positive ? POSITIVE_COLOR : NEGATIVE_COLOR });
  }
};

const renderCurrentConductor: ElementRenderer = (svg, element, ctx, style) => {
  if (!element.coords) return;

  const at = ctx.toSvg(element.coords);
  const color = element.color ?? style.color;

  if (style.highlighted) svg.circle(at, 12, { color: HIGHLIGHT_COLOR, width: 2, opacity: 0.5 });

  svg.circle(at, 9, { ...paper, color, width: 1.8, dashed: style.dashed ? '3,3' : false });

  if (element.subtype === 'cross') {
    svg.line({ x: at.x - 2.5, y: at.y - 2.5 }, { x: at.x + 2.5, y: at.y + 2.5 }, { color, width: 1.5 });
    svg.line({ x: at.x + 2.5, y: at.y - 2.5 }, { x: at.x - 2.5, y: at.y + 2.5 }, { color, width: 1.5 });
  } else {
    dot(svg, at, 2, color);
  }
};

const renderCircleShape: ElementRenderer = (svg, element, ctx, style) => {
  if (!element.center) return;

  const at = ctx.toSvg(element.center);
  const radius = (element.radius ?? 0.8) * ctx.scale;

  if (style.highlighted) svg.circle(at, radius, { color: HIGHLIGHT_COLOR, width: 6, opacity: 0.4 });

  svg.circle(at, radius, { ...paper, color: style.color, width: style.width, dashed: style.dashed });
};

const renderLens: ElementRenderer = (svg, element, ctx, style) => {
  if (!element.center) return;

  const at = ctx.toSvg(element.center);
  const height = (element.height ?? 3) * ctx.scale;
  const top = { x: at.x, y: at.y - height / 2 };
  const bottom = { x: at.x, y: at.y + height / 2 };
  const converging = element.subtype !== 'diverging';
  const glass = { fill: GLASS_FILL, color: GLASS_STROKE, width: 1 };
  const stroke = { color: style.color, width: style.width };
  const x = fmt(at.x);

  if (converging) {
    svg.path(
      `M ${x} ${fmt(top.y)} Q ${fmt(at.x + 10)} ${fmt(at.y)} ${x} ${fmt(bottom.y)} Q ${fmt(at.x - 10)} ${fmt(at.y)} ${x} ${fmt(top.y)}`,
      glass,
    );
  } else {
    svg.path(
      `M ${fmt(at.x - 10)} ${fmt(top.y)} L ${fmt(at.x + 10)} ${fmt(top.y)} Q ${fmt(at.x + 4)} ${fmt(at.y)} ${fmt(at.x + 10)} ${fmt(bottom.y)} `
        + `L ${fmt(at.x - 10)} ${fmt(bottom.y)} Q ${fmt(at.x - 4)} ${fmt(at.y)} ${fmt(at.x - 10)} ${fmt(top.y)} Z`,
      glass,
    );
  }

  svg.line(bottom, top, { ...stroke, dashed: style.dashed });

  // Наконечники наружу у собирающей и внутрь у рассеивающей.
  const tipOffset = converging ? 6 : -6;
  const tailOffset = converging ? 0 : -2;

  svg.polyline([{ x: top.x - 4, y: top.y + tipOffset + tailOffset }, top, { x: top.x + 4, y: top.y + tipOffset + tailOffset }], stroke);
  svg.polyline(
    [{ x: bottom.x - 4, y: bottom.y - tipOffset - tailOffset }, bottom, { x: bottom.x + 4, y: bottom.y - tipOffset - tailOffset }],
    stroke,
  );

  // Главная оптическая ось через всю картинку.
  const axisEnd = { x: ctx.width - 15, y: at.y };

  svg.line({ x: 10, y: at.y }, axisEnd, { color: AXIS_COLOR, width: 0.9, dashed: true, className: AXIS_CLASS });
  svg.polygon([{ x: axisEnd.x, y: at.y - 3.5 }, { x: ctx.width - 5, y: at.y }, { x: axisEnd.x, y: at.y + 3.5 }], { fill: AXIS_COLOR });
  svg.text({ x: ctx.width - 10, y: at.y - 8 }, 'x', { size: 9.5, color: AXIS_COLOR });
  dot(svg, at, 2.5, style.color);

  const focal = (element.focalLength ?? 2) * ctx.scale;
  const marks: Array<[number, string]> = [
    [at.x - focal, 'F'],
    [at.x + focal, 'F'],
    [at.x - 2 * focal, '2F'],
    [at.x + 2 * focal, '2F'],
  ];

  marks.forEach(([markX, label]) => {
    svg.line({ x: markX, y: at.y - 4 }, { x: markX, y: at.y + 4 }, { color: AXIS_COLOR, width: 1.2 });
    svg.text({ x: markX, y: at.y + 15 }, label, { size: 9, color: AXIS_COLOR });
  });
};

const renderMirror: ElementRenderer = (svg, element, ctx, style) => {
  const points = twoPoints(element);

  if (!points) return;

  drawHatchedSurface(svg, ctx.toSvg(points[0]), ctx.toSvg(points[1]), {
    hatching: surfaceHatching(element),
    color: style.color,
    width: style.width,
    dashed: style.dashed,
  });
};

const renderRay: ElementRenderer = (svg, element, ctx, style) => {
  if (!element.points || element.points.length < 2) return;

  const points = element.points.map(ctx.toSvg);

  for (let index = 0; index < points.length - 1; index += 1) {
    if (element.dashed) {
      drawMidArrowLine(svg, points[index], points[index + 1], {
        color: element.color ?? RAY_DASHED_COLOR,
        width: 1,
        headSize: 6,
        dashed: true,
      });
    } else {
      drawMidArrowLine(svg, points[index], points[index + 1], {
        color: element.color ?? (index > 0 ? RAY_NEXT_COLOR : RAY_FIRST_COLOR),
        width: style.highlighted ? 2.5 : 1.3,
        headSize: 7,
      });
    }
  }
};

const renderOpticsArrow: ElementRenderer = (svg, element, ctx, style) => {
  if (!element.center) return;

  const height = element.height ?? 1;
  const up = height >= 0;
  const base = ctx.toSvg(element.center);
  const tip = ctx.toSvg([element.center[0], element.center[1] + height]);
  const color = element.color ?? (up ? FORCE_COLOR : ACCELERATION_COLOR);
  const sign = up ? 1 : -1;

  svg.line(base, tip, { color, width: 2, dashed: style.dashed ? '4,3' : false });
  svg.polygon([{ x: tip.x - 3.5, y: tip.y + sign * 5.5 }, tip, { x: tip.x + 3.5, y: tip.y + sign * 5.5 }], { fill: color });

  // Первая буква подписи у основания, остальное у острия: «AB» → A внизу, B вверху.
  const label = [...latexToPlainText(element.label ?? '')];
  const head = label[0];
  const tail = label.slice(1).join('');

  if (head) svg.text({ x: base.x, y: up ? base.y + 13 : base.y - 7 }, head, { size: 9.5, color });

  if (tail) svg.text({ x: tip.x, y: up ? tip.y - 6 : tip.y + 13 }, tail, { size: 9.5, color });
};

const renderPrism: ElementRenderer = (svg, element, ctx) => {
  if (!element.points || element.points.length < 3) return;

  svg.polygon(element.points.slice(0, 3).map(ctx.toSvg), {
    fill: GLASS_FILL,
    color: 'rgba(14, 165, 233, 0.6)',
    width: 1.3,
    linejoin: 'round',
  });
};

const renderGlassSlab: ElementRenderer = (svg, element, ctx) => {
  if (!element.center) return;

  const at = ctx.toSvg(element.center);
  const width = (element.width ?? 2) * ctx.scale;
  const height = (element.height ?? 1) * ctx.scale;

  svg.rect(at.x - width / 2, at.y - height / 2, width, height, {
    rx: 3,
    fill: 'rgba(56, 189, 248, 0.1)',
    color: GLASS_STROKE,
    width: 1.3,
  });
};

const renderTextLabel: ElementRenderer = (svg, element, ctx, style) => {
  if (!element.coords) return;

  const text = element.text ?? element.label;

  if (!text) return;

  const at = ctx.toSvg(element.coords);

  if (style.highlighted) svg.circle(at, 14, { color: HIGHLIGHT_COLOR, width: 2, opacity: 0.5 });

  svg.text({ x: at.x, y: at.y + 4 }, latexToSvgTspans(text), {
    markup: true,
    size: 11,
    color: element.color ?? style.color,
    halo: 2.5,
  });
};

const RENDERERS: Record<PhysicsElementType, ElementRenderer> = {
  surface: renderSurface,
  arc_surface: renderArcSurface,
  block: renderBlock,
  rope: renderRope,
  spring: renderSpring,
  vector: renderVector,
  angle: renderAngle,
  stickman: renderStickman,
  balloon: renderBalloon,
  ellipse_platform: renderEllipsePlatform,
  dimension_line: renderDimensionLine,
  thermo_axes: renderThermoAxes,
  thermo_point: renderThermoPoint,
  thermo_process: renderThermoProcess,
  piston_vessel: renderPistonVessel,
  circuit_component: renderCircuitComponent,
  wire: renderWire,
  charge: renderCharge,
  field_line: renderFieldLine,
  capacitor_plate: renderCapacitorPlate,
  current_conductor: renderCurrentConductor,
  circle_shape: renderCircleShape,
  lens: renderLens,
  mirror: renderMirror,
  ray: renderRay,
  optics_arrow: renderOpticsArrow,
  prism: renderPrism,
  glass_slab: renderGlassSlab,
  text_label: renderTextLabel,
};

const drawGrid = (svg: SvgBuilder, width: number, height: number, viewport: Viewport): void => {
  // Слишком мелкий шаг — тысячи линий ради ничего; битый — бесконечный цикл.
  if (!(viewport.scale >= 2)) return;

  const grid = { color: GRID_COLOR, width: 0.8, className: GRID_CLASS };

  for (let x = ((viewport.cx % viewport.scale) + viewport.scale) % viewport.scale; x < width; x += viewport.scale) {
    svg.line({ x, y: 0 }, { x, y: height }, grid);
  }

  for (let y = ((viewport.cy % viewport.scale) + viewport.scale) % viewport.scale; y < height; y += viewport.scale) {
    svg.line({ x: 0, y }, { x: width, y }, grid);
  }
};

const elementStyle = (element: PhysicsElement, highlight: PhysicsHighlight | null | undefined): ElementStyle => {
  const highlighted = highlight?.id === element.id;

  return {
    highlighted,
    color: element.color ?? (highlighted ? HIGHLIGHT_COLOR : INK),
    width: highlighted ? 3.5 : (element.strokeWidth ?? 1.8),
    dashed: element.dashed === true,
  };
};

/** Полный `<svg>` физической схемы. Никогда не бросает: битые элементы пропускаются. */
export const renderPhysicsSvg = (scene: PhysicsScene, options: PhysicsRenderOptions = {}): string => {
  const width = options.width ?? DEFAULT_PHYSICS_WIDTH;
  const height = options.height ?? DEFAULT_PHYSICS_HEIGHT;
  const svg = new SvgBuilder();

  try {
    const viewport = resolvePhysicsViewport(scene, { ...options, width, height });
    const ctx: RenderContext = {
      width,
      height,
      scale: viewport.scale,
      toSvg: (point) => worldToSvg(point, viewport.scale, viewport.cx, viewport.cy),
    };

    if (scene.showGrid) drawGrid(svg, width, height, viewport);

    for (const element of scene.elements) {
      // Один элемент с битыми полями не должен прятать остальную сцену:
      // рисуем его в отдельный слой и переносим только целиком.
      try {
        const renderer = RENDERERS[element.type];

        if (!renderer) continue;

        const layer = new SvgBuilder();

        renderer(layer, element, ctx, elementStyle(element, options.highlight));
        svg.raw(layer.toString());
      } catch {
        // Элемент пропущен.
      }
    }
  } catch {
    // Сцена целиком не поддаётся — отдаём то, что успели собрать.
  }

  return wrapSvg(svg.toString(), { width, height, className: SVG_CLASS });
};
