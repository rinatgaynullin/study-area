import type { CirclePlot, GeometryHighlight, GeometryScene, Plot, Vec2 } from '../scene/types';
import { worldToSvg, type SvgPoint, type Viewport } from './coords';
import { prettifyMathText, safeColor, translucent } from './geometry-marks';
import { HIGHLIGHT_COLOR, SvgBuilder, polylinePath, type StrokeOptions } from './svg-builder';

/**
 * Графики функций (`plot_2d`): сетка, оси со стрелками и тиками, кривые,
 * точки и подписи. Кривые рисуются выборкой: формула считается в мире,
 * точки за пределами картинки (с запасом) выпадают, и путь рвётся на
 * подпути, а не тянет хорду через разрыв.
 */

export interface PlotSize {
  width: number;
  height: number;
}

const PLOT_COLOR = '#3b82f6';
const AXIS_COLOR = '#475569';
const GRID_COLOR = '#e2e8f0';
const HOLLOW_FILL = '#fff';
const SHADING_FALLBACK_FILL = 'rgba(147, 197, 253, 0.25)';
/** Паттерн штриховки кладёт в `<defs>` обёртка `renderGeometrySvg`. */
const STRIPE_FILL = 'url(#rte-drawing-stripe)';

const AXIS_MARGIN = 10;
const ARROW_LENGTH = 8;
const ARROW_HALF_WIDTH = 4;
const TICK_HALF = 3;
/** Минимальный шаг тиков в пикселях: ближе подписи чисел слипаются. */
const MIN_TICK_PIXELS = 16;
const TICK_STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
/** Сетка не чаще шести пикселей, иначе она превращается в заливку. */
const MIN_GRID_PIXELS = 6;

const CURVE_WIDTH = 2;
const CURVE_DASH = '4';
const POINT_RADIUS = 5;
const CENTER_RADIUS = 2.5;
const LABEL_SIZE = 11;

/** Параметр кривых: парабола по `t ∈ [-15, 15]`, корень по `s ∈ [0, 50]`. */
const PARABOLA_RANGE = 15;
const PARABOLA_STEP = 0.1;
const SQRT_RANGE = 50;
const SQRT_STEP = 0.02;
const HYPERBOLA_NEAR_ZERO = 0.05;
const HYPERBOLA_STEP = 0.05;
/** Запас за краем картинки для парабол и корней — путь обрезается там, а не в бесконечности. */
const PARABOLA_MARGIN = 300;
const SQRT_MARGIN = 50;

const HIGHLIGHT_STROKE: StrokeOptions = { color: HIGHLIGHT_COLOR, width: 7, opacity: 0.35, linecap: 'round' };

const isInside = (point: SvgPoint, size: PlotSize, margin: number): boolean =>
  point.x >= -margin && point.x <= size.width + margin && point.y >= -margin && point.y <= size.height + margin;

/** Путь по выборке: `null` — разрыв, после него начинается новый подпуть. */
const sampledPath = (samples: Array<SvgPoint | null>): string => {
  const runs: SvgPoint[][] = [[]];

  samples.forEach((sample) => {
    if (sample) {
      runs[runs.length - 1].push(sample);
    } else if (runs[runs.length - 1].length > 0) {
      runs.push([]);
    }
  });

  return runs
    .filter((run) => run.length > 1)
    .map((run) => polylinePath(run))
    .join(' ');
};

/** Группа с `color`: внутри неё `currentColor` штриховки становится цветом графика. */
const withColor = (builder: SvgBuilder, color: string, draw: (inner: SvgBuilder) => void): void => {
  const inner = new SvgBuilder();

  draw(inner);
  builder.raw(`<g color="${color}">${inner.toString()}</g>`);
};

const drawCurve = (builder: SvgBuilder, d: string, color: string, dashed: boolean, highlighted: boolean): void => {
  if (!d) return;

  if (highlighted) builder.path(d, HIGHLIGHT_STROKE);

  builder.path(d, { color, width: CURVE_WIDTH, dashed: dashed && CURVE_DASH });
};

/** Подпись графика: дроби и греческие буквы в юникод, остальные команды — без слеша. */
const plotLabelText = (label: string): string => prettifyMathText(label).replace(/\\/g, '');

const tickStep = (scale: number): number => TICK_STEPS.find((step) => step * scale >= MIN_TICK_PIXELS) ?? TICK_STEPS[TICK_STEPS.length - 1];

const gridStep = (scale: number): number => (scale < MIN_GRID_PIXELS ? scale * Math.ceil(MIN_GRID_PIXELS / scale) : scale);

/** Первая линия сетки от левого/верхнего края, кратная шагу относительно начала координат. */
const firstGridLine = (origin: number, step: number): number => ((origin % step) + step) % step;

const renderGrid = (builder: SvgBuilder, viewport: Viewport, size: PlotSize): void => {
  const step = gridStep(viewport.scale);
  const stroke: StrokeOptions = { color: GRID_COLOR, width: 0.5, className: 'rte-drawing__grid' };

  for (let x = firstGridLine(viewport.cx, step); x < size.width; x += step) {
    if (Math.abs(x - viewport.cx) >= 1) builder.line({ x, y: 0 }, { x, y: size.height }, stroke);
  }

  for (let y = firstGridLine(viewport.cy, step); y < size.height; y += step) {
    if (Math.abs(y - viewport.cy) >= 1) builder.line({ x: 0, y }, { x: size.width, y }, stroke);
  }
};

const renderAxes = (builder: SvgBuilder, viewport: Viewport, size: PlotSize, labels: GeometryScene['axes']): void => {
  const { cx, cy } = viewport;
  const stroke: StrokeOptions = { color: AXIS_COLOR, width: 1.5, className: 'rte-drawing__axis' };
  const head: StrokeOptions = { fill: AXIS_COLOR, className: 'rte-drawing__axis' };
  const right = size.width - AXIS_MARGIN;
  const top = AXIS_MARGIN;

  builder.line({ x: AXIS_MARGIN, y: cy }, { x: right, y: cy }, stroke);
  builder.line({ x: cx, y: size.height - AXIS_MARGIN }, { x: cx, y: top }, stroke);
  builder.polygon(
    [
      { x: right, y: cy },
      { x: right - ARROW_LENGTH, y: cy - ARROW_HALF_WIDTH },
      { x: right - ARROW_LENGTH, y: cy + ARROW_HALF_WIDTH },
    ],
    head,
  );
  builder.polygon(
    [
      { x: cx, y: top },
      { x: cx - ARROW_HALF_WIDTH, y: top + ARROW_LENGTH },
      { x: cx + ARROW_HALF_WIDTH, y: top + ARROW_LENGTH },
    ],
    head,
  );

  const text = { size: LABEL_SIZE, className: 'rte-drawing__axis-label', anchor: 'start' as const };

  if (labels.xLabel) builder.text({ x: size.width - 15, y: cy + 15 }, plotLabelText(labels.xLabel), text);

  if (labels.yLabel) builder.text({ x: cx - 15, y: 18 }, plotLabelText(labels.yLabel), text);
};

const renderTicks = (builder: SvgBuilder, viewport: Viewport, size: PlotSize): void => {
  const { scale, cx, cy } = viewport;
  const unit = tickStep(scale);
  const step = unit * scale;
  const stroke: StrokeOptions = { color: AXIS_COLOR, width: 1, className: 'rte-drawing__axis' };
  const number = { size: 9, weight: 400, className: 'rte-drawing__axis-label' };

  const tickX = (x: number): void => {
    builder.line({ x, y: cy - TICK_HALF }, { x, y: cy + TICK_HALF }, stroke);
    builder.text({ x, y: cy + 15 }, String(Math.round((x - cx) / scale)), number);
  };

  const tickY = (y: number): void => {
    builder.line({ x: cx - TICK_HALF, y }, { x: cx + TICK_HALF, y }, stroke);
    builder.text({ x: cx - 12, y: y + 3 }, String(Math.round((cy - y) / scale)), { ...number, anchor: 'end' });
  };

  for (let x = cx + step; x < size.width - 20; x += step) tickX(x);

  for (let x = cx - step; x > 20; x -= step) tickX(x);

  for (let y = cy - step; y > 20; y -= step) tickY(y);

  for (let y = cy + step; y < size.height - 20; y += step) tickY(y);

  builder.text({ x: cx - 4, y: cy + 12 }, '0', { ...number, anchor: 'end' });
};

/** Видимый диапазон мира по x с запасом в единицу — им ограничиваются прямые и гиперболы без `domain`. */
const visibleXRange = (viewport: Viewport, size: PlotSize): [number, number] => [
  (0 - viewport.cx) / viewport.scale - 1,
  (size.width - viewport.cx) / viewport.scale + 1,
];

const inDomain = (x: number, domain: [number, number] | undefined): boolean =>
  domain === undefined || (x >= domain[0] && x <= domain[1]);

/**
 * Окружность с точкой центра, пунктирным радиусом под 30° и его числом.
 * Общая для графиков и 2D-чертежей — там центр может быть вершиной.
 */
export const renderCirclePlot = (
  builder: SvgBuilder,
  plot: CirclePlot,
  center: SvgPoint,
  scale: number,
  highlighted: boolean,
  defaultColor = PLOT_COLOR,
): void => {
  const radius = plot.radius * scale;
  const color = safeColor(plot.color, defaultColor);
  const dashed = plot.style === 'dashed' && CURVE_DASH;

  if (highlighted) builder.circle(center, radius, HIGHLIGHT_STROKE);

  if (plot.fill) {
    builder.circle(center, radius, { fill: translucent(color), color: 'none', width: 0 });
    withColor(builder, color, (inner) => inner.circle(center, radius, { fill: STRIPE_FILL, color, width: CURVE_WIDTH, dashed }));
  } else {
    builder.circle(center, radius, { color, width: CURVE_WIDTH, dashed });
  }

  builder.circle(center, CENTER_RADIUS, { fill: color, color: 'none', width: 0 });

  const angle = (30 * Math.PI) / 180;
  const rim = { x: center.x + radius * Math.cos(angle), y: center.y - radius * Math.sin(angle) };

  builder.line(center, rim, { color, width: 1.2, dashed: '3 3', opacity: 0.8 });
  builder.text({ x: (center.x + rim.x) / 2, y: (center.y + rim.y) / 2 - 4 }, String(plot.radius), { size: 10, halo: true });

  if (plot.label) {
    builder.text({ x: center.x + radius + 8, y: center.y - 8 }, plotLabelText(plot.label), {
      size: LABEL_SIZE,
      color,
      anchor: 'start',
      halo: 3.5,
    });
  }
};

interface PlotContext {
  builder: SvgBuilder;
  viewport: Viewport;
  size: PlotSize;
  toSvg: (point: Vec2) => SvgPoint;
}

const renderParabola = (context: PlotContext, plot: Extract<Plot, { type: 'parabola' }>, color: string, highlighted: boolean): void => {
  const [vx, vy] = plot.vertex;
  const sign = plot.direction === 'down' ? -1 : 1;
  const samples: Array<SvgPoint | null> = [];

  for (let t = -PARABOLA_RANGE; t <= PARABOLA_RANGE; t += PARABOLA_STEP) {
    const x = vx + t * plot.stretchX;

    if (!inDomain(x, plot.domain)) {
      samples.push(null);

      continue;
    }

    const point = context.toSvg([x, vy + t * t * plot.stretchY * sign]);

    samples.push(isInside(point, context.size, PARABOLA_MARGIN) ? point : null);
  }

  drawCurve(context.builder, sampledPath(samples), color, plot.style === 'dashed', highlighted);
};

const renderSqrt = (context: PlotContext, plot: Extract<Plot, { type: 'sqrt' }>, color: string, highlighted: boolean): void => {
  const [vx, vy] = plot.vertex;
  const dirX = plot.directionX === 'left' ? -1 : 1;
  const dirY = plot.directionY === 'down' ? -1 : 1;
  const samples: Array<SvgPoint | null> = [];

  for (let s = 0; s <= SQRT_RANGE; s += SQRT_STEP) {
    const x = vx + s * dirX;

    if (!inDomain(x, plot.domain)) {
      samples.push(null);

      continue;
    }

    const point = context.toSvg([x, vy + Math.sqrt(s) * plot.stretch * dirY]);

    // Ветвь ушла за край по x — дальше она уже не вернётся.
    if ((dirX === 1 && point.x > context.size.width + SQRT_MARGIN) || (dirX === -1 && point.x < -SQRT_MARGIN)) break;

    samples.push(isInside(point, context.size, SQRT_MARGIN) ? point : null);
  }

  drawCurve(context.builder, sampledPath(samples), color, plot.style === 'dashed', highlighted);
};

const renderHyperbola = (context: PlotContext, plot: Extract<Plot, { type: 'hyperbola' }>, color: string, highlighted: boolean): void => {
  const [hx, hy] = plot.center;
  const [visibleMin, visibleMax] = visibleXRange(context.viewport, context.size);
  const reach = Math.max(5, visibleMax - hx, hx - visibleMin);

  // Две ветви — два пути: у каждой своя выборка от особой точки наружу.
  [1, -1].forEach((branch) => {
    const samples: Array<SvgPoint | null> = [];

    for (let t = HYPERBOLA_NEAR_ZERO; t <= reach; t += HYPERBOLA_STEP) {
      const x = hx + t * branch;

      if (!inDomain(x, plot.domain)) {
        samples.push(null);

        continue;
      }

      const point = context.toSvg([x, hy + plot.k / (t * branch)]);

      samples.push(isInside(point, context.size, 0) ? point : null);
    }

    drawCurve(context.builder, sampledPath(samples), color, plot.style === 'dashed', highlighted);
  });
};

/** Концы прямой: отрезок по `p1/p2` или `y = kx + b` на `domain` (без него — на видимой ширине). */
const lineEndpoints = (context: PlotContext, plot: Extract<Plot, { type: 'line' }>): [SvgPoint, SvgPoint] | null => {
  if (plot.p1 && plot.p2) return [context.toSvg(plot.p1), context.toSvg(plot.p2)];

  if (plot.k === undefined || plot.b === undefined) return null;

  const [visibleMin, visibleMax] = visibleXRange(context.viewport, context.size);
  const from = plot.domain && Number.isFinite(plot.domain[0]) ? plot.domain[0] : visibleMin;
  const to = plot.domain && Number.isFinite(plot.domain[1]) ? plot.domain[1] : visibleMax;

  return [context.toSvg([from, plot.k * from + plot.b]), context.toSvg([to, plot.k * to + plot.b])];
};

const renderLine = (context: PlotContext, plot: Extract<Plot, { type: 'line' }>, color: string, highlighted: boolean): void => {
  const ends = lineEndpoints(context, plot);

  if (!ends) return;

  if (highlighted) context.builder.line(ends[0], ends[1], HIGHLIGHT_STROKE);

  context.builder.line(ends[0], ends[1], { color, width: CURVE_WIDTH, dashed: plot.style === 'dashed' && CURVE_DASH });
};

const renderShading = (context: PlotContext, plot: Extract<Plot, { type: 'shading' }>, highlighted: boolean): void => {
  const { builder } = context;
  const color = safeColor(plot.color, PLOT_COLOR);
  const fill = plot.color ? translucent(color) : SHADING_FALLBACK_FILL;
  const outline: StrokeOptions = { fill: STRIPE_FILL, color, width: 1.2, dashed: '3 3' };

  if (plot.points && plot.points.length > 1) {
    const points = plot.points.map(context.toSvg);

    if (highlighted) builder.polygon(points, { ...HIGHLIGHT_STROKE, fill: 'none' });

    builder.polygon(points, { fill });
    withColor(builder, color, (inner) => inner.polygon(points, outline));

    return;
  }

  if (!plot.bounds) return;

  const [x1, x2, y1, y2] = plot.bounds;
  const corner = context.toSvg([Math.min(x1, x2), Math.max(y1, y2)]);
  const opposite = context.toSvg([Math.max(x1, x2), Math.min(y1, y2)]);
  const width = Math.abs(opposite.x - corner.x);
  const height = Math.abs(opposite.y - corner.y);

  if (highlighted) builder.rect(corner.x, corner.y, width, height, { ...HIGHLIGHT_STROKE, fill: 'none' });

  builder.rect(corner.x, corner.y, width, height, { fill, color: 'none', width: 0 });
  withColor(builder, color, (inner) => inner.rect(corner.x, corner.y, width, height, outline));
};

const renderFreehand = (context: PlotContext, plot: Extract<Plot, { type: 'freehand' }>, color: string, highlighted: boolean): void => {
  const points = plot.points.map(context.toSvg);

  if (points.length < 2) return;

  if (highlighted) context.builder.polyline(points, { ...HIGHLIGHT_STROKE, linejoin: 'round' });

  context.builder.polyline(points, { color, width: 1.8, dashed: plot.style === 'dashed' && CURVE_DASH });
};

const renderPoint = (context: PlotContext, plot: Extract<Plot, { type: 'point' }>, color: string, highlighted: boolean): void => {
  const { builder } = context;
  const at = context.toSvg(plot.coords);

  if (highlighted) {
    builder.circle(at, 11, { color: HIGHLIGHT_COLOR, width: 2, opacity: 0.8 });
    builder.circle(at, 15, { fill: HIGHLIGHT_COLOR, color: 'none', width: 0, opacity: 0.25 });
  }

  if (plot.pointStyle === 'hollow') {
    builder.circle(at, POINT_RADIUS, { fill: HOLLOW_FILL, color, width: 2 });
  } else {
    builder.circle(at, POINT_RADIUS, { fill: color, color: 'none', width: 0 });
  }

  if (plot.label) {
    builder.text({ x: at.x, y: at.y - 10 }, plotLabelText(plot.label), { size: LABEL_SIZE, halo: 3.5 });
  }
};

const renderPlot = (context: PlotContext, plot: Plot, highlighted: boolean): void => {
  const color = safeColor(plot.color, PLOT_COLOR);

  switch (plot.type) {
    case 'parabola':
      renderParabola(context, plot, color, highlighted);
      break;
    case 'sqrt':
      renderSqrt(context, plot, color, highlighted);
      break;
    case 'hyperbola':
      renderHyperbola(context, plot, color, highlighted);
      break;
    case 'line':
      renderLine(context, plot, color, highlighted);
      break;
    case 'circle':
      renderCirclePlot(context.builder, plot, context.toSvg(plot.center), context.viewport.scale, highlighted);
      break;
    case 'shading':
      renderShading(context, plot, highlighted);
      break;
    case 'freehand':
      renderFreehand(context, plot, color, highlighted);
      break;
    case 'point':
      // Точки идут поверх всех кривых — отдельным проходом.
      break;
    default:
      break;
  }
};

/** Подпись кривой у характерной точки: вершина параболы, центр гиперболы, середина прямой. */
const renderPlotLabel = (context: PlotContext, plot: Plot): void => {
  if (!plot.label || plot.type === 'point' || plot.type === 'circle') return;

  const color = safeColor(plot.color, PLOT_COLOR);
  let at: SvgPoint | null = null;

  if (plot.type === 'parabola') {
    at = context.toSvg([plot.vertex[0] + 1.5, plot.vertex[1] + 2.25 * (plot.direction === 'down' ? -1 : 1)]);
  } else if (plot.type === 'hyperbola') {
    at = context.toSvg([plot.center[0] + 2, plot.center[1] + plot.k / 2 + 0.5]);
  } else if (plot.type === 'line') {
    const ends = lineEndpoints(context, plot);

    if (ends) at = { x: (ends[0].x + ends[1].x) / 2 + 10, y: (ends[0].y + ends[1].y) / 2 - 10 };
  } else if (plot.type === 'sqrt') {
    at = context.toSvg([plot.vertex[0] + (plot.directionX === 'left' ? -2 : 2), plot.vertex[1] + (plot.directionY === 'down' ? -1.5 : 1.5)]);
  }

  if (at) context.builder.text(at, plotLabelText(plot.label), { size: LABEL_SIZE, color, anchor: 'start', halo: 3.5 });
};

const isPlotHighlighted = (plot: Plot, highlight: GeometryHighlight | null): boolean =>
  highlight !== null
  && (highlight.type === 'plot' || highlight.type === 'circle_plot')
  && plot.id !== undefined
  && highlight.id === plot.id;

/** Битый график пропускается молча: остальная картинка важнее. */
const attempt = (draw: () => void): void => {
  try {
    draw();
  } catch {
    // Намеренно пусто: см. комментарий выше.
  }
};

/**
 * Содержимое картинки графика функций в заданный `builder`: сетка и оси,
 * затем кривые, поверх них точки и подписи. Обёртку `<svg>` с `<defs>`
 * штриховки даёт `renderGeometrySvg`.
 */
export const renderPlot2dContent = (
  scene: GeometryScene,
  viewport: Viewport,
  size: PlotSize,
  highlight: GeometryHighlight | null,
  builder: SvgBuilder,
): void => {
  const context: PlotContext = {
    builder,
    viewport,
    size,
    toSvg: (point) => worldToSvg(point, viewport.scale, viewport.cx, viewport.cy),
  };

  if (scene.showGrid) renderGrid(builder, viewport, size);

  renderAxes(builder, viewport, size, scene.axes);

  if (scene.showAxesTicks) renderTicks(builder, viewport, size);

  scene.plots.forEach((plot) => attempt(() => renderPlot(context, plot, isPlotHighlighted(plot, highlight))));

  scene.plots.forEach((plot) => {
    if (plot.type === 'point') attempt(() => renderPoint(context, plot, safeColor(plot.color, PLOT_COLOR), isPlotHighlighted(plot, highlight)));
  });

  scene.plots.forEach((plot) => attempt(() => renderPlotLabel(context, plot)));
};

