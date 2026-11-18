import type { CirclePlot, GeometryHighlight, GeometryScene, Plot, Vec2 } from '../scene/types';
import { worldToSvg, type SvgPoint, type Viewport } from './coords';
import { prettifyMathText, safeColor, translucent } from './geometry-marks';
import { HIGHLIGHT_COLOR, SvgBuilder, escapeXml, polylinePath, type StrokeOptions, type TextOptions } from './svg-builder';

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
/** Не больше стольких тиков на оси: при далёком или мелком виде шаг растёт, а не число тиков. */
const MAX_TICKS = 40;
/** Ближе этого к краю листа, за которым они продолжались бы, тики не ставятся. */
const TICK_EDGE = 20;
/** Шаги тиков и сетки — ряд 1, 2, 5, 10, 20, 50, 100… */
const STEP_MANTISSAS = [1, 2, 5];
/** Предел перебора ряда: 10^308 — последний конечный шаг. */
const MAX_STEP_INDEX = 3 * 308;
/** Сетка не чаще шести пикселей, иначе она превращается в заливку. */
const MIN_GRID_PIXELS = 6;

const CURVE_WIDTH = 2;
const CURVE_DASH = '4';
const POINT_RADIUS = 5;
const CENTER_RADIUS = 2.5;
const LABEL_SIZE = 11;
/** Показатель степени в подписи графика: мельче и выше строки, как индекс в `latex-label.ts`, только вверх. */
const POWER_SIZE = 8.5;
const POWER_SHIFT = 4.5;

/** Параметр кривых: парабола по `t ∈ [-15, 15]`, корень по `s ∈ [0, 50]`. */
const PARABOLA_RANGE = 15;
const PARABOLA_STEP = 0.1;
const SQRT_RANGE = 50;
const SQRT_STEP = 0.02;
const HYPERBOLA_NEAR_ZERO = 0.05;
const HYPERBOLA_STEP = 0.05;
/** Больше точек на ветвь гиперболы не берём: дальше шаг выборки растёт. */
const HYPERBOLA_MAX_SAMPLES = 4000;
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
    const run = runs[runs.length - 1];

    if (!run) return;

    if (sample) {
      run.push(sample);
    } else if (run.length > 0) {
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

interface LabelPiece {
  text: string;
  power: boolean;
}

/** Закрывающая фигурная скобка к открытой в `text[open]` с учётом вложенных; пары нет — `-1`. */
const closingBrace = (text: string, open: number): number => {
  let depth = 0;
  let index = open;
  let found = -1;

  while (index < text.length && found < 0) {
    const char = text.charAt(index);

    if (char === '{') depth += 1;

    if (char === '}') depth -= 1;

    if (char === '}' && depth === 0) found = index;

    index += 1;
  }

  return found;
};

/**
 * Степень в подписи с позиции `at` (там `^`): `^2`, один знак или `^{…}` с
 * вложенными скобками. Вложенная степень поднята вместе с внешней, внутри —
 * строкой со знаком `^` и обычными скобками: `^{x^{x + 1}}` → `x^(x + 1)`.
 * Не степень (`^` в конце, перед пробелом, без пары к `{`) — `null`.
 */
const powerAt = (label: string, at: number): { text: string; end: number } | null => {
  const next = label.charAt(at + 1);

  if (next === '{') {
    const close = closingBrace(label, at + 1);

    return close < 0 ? null : { text: label.slice(at + 2, close).replace(/\{/g, '(').replace(/\}/g, ')'), end: close + 1 };
  }

  return next === '' || /[\s{}]/.test(next) ? null : { text: next, end: at + 2 };
};

/** Подпись графика кусками: обычный текст и показатели степени по порядку; пустые куски выброшены. */
const labelPieces = (label: string): LabelPiece[] => {
  const pieces: LabelPiece[] = [];
  let from = 0;
  let at = label.indexOf('^');

  while (at >= 0) {
    const power = powerAt(label, at);

    if (power) {
      pieces.push({ text: label.slice(from, at), power: false }, { text: power.text, power: true });
      from = power.end;
    }

    at = label.indexOf('^', power ? power.end : at + 1);
  }

  pieces.push({ text: label.slice(from), power: false });

  return pieces.filter((piece) => piece.text !== '');
};

/**
 * Подпись графика → разметка для `<text>`: показатель степени поднят и
 * мельче, текст после него возвращается на строку. Без степеней — `null`:
 * подпись идёт простой строкой, как раньше. Всё экранировано.
 */
const plotLabelMarkup = (label: string): string | null => {
  const pieces = labelPieces(plotLabelText(label));

  if (!pieces.some((piece) => piece.power)) return null;

  let raised = false;

  return pieces
    .map((piece) => {
      const safe = escapeXml(piece.text);
      const shift = piece.power === raised ? '' : ` dy="${piece.power ? -POWER_SHIFT : POWER_SHIFT}"`;

      raised = piece.power;

      if (piece.power) return `<tspan${shift} font-size="${POWER_SIZE}">${safe}</tspan>`;

      return shift ? `<tspan${shift}>${safe}</tspan>` : safe;
    })
    .join('');
};

/** Подпись кривой: степени верхним индексом, остальное — строкой через `plotLabelText`. */
const drawPlotLabel = (builder: SvgBuilder, at: SvgPoint, label: string, options: TextOptions): void => {
  const markup = plotLabelMarkup(label);

  builder.text(at, markup ?? plotLabelText(label), { ...options, markup: markup !== null });
};

/** Шаг ряда 1, 2, 5, 10, 20, 50… по его номеру, начиная с нуля. */
const seriesStep = (index: number): number => (STEP_MANTISSAS[index % STEP_MANTISSAS.length] ?? 1) * 10 ** Math.floor(index / STEP_MANTISSAS.length);

/**
 * Наименьший шаг ряда (в единицах мира), для которого `fits`; `fits`
 * монотонно: подошёл шаг — подойдёт и крупнее. Перебор начинается на порядок
 * ниже оценки `least`, поэтому идёт несколько шагов при любом масштабе.
 */
const niceStep = (least: number, fits: (step: number) => boolean): number => {
  const from = Number.isFinite(least) && least > 1 ? 3 * Math.floor(Math.log10(least)) - 3 : 0;
  let index = Math.max(0, from);

  while (index < MAX_STEP_INDEX && !fits(seriesStep(index))) index += 1;

  return seriesStep(index);
};

/** Шаг тиков в единицах мира: числа не слипаются и на длинной стороне листа их не больше `MAX_TICKS`. */
const tickStep = (scale: number, size: PlotSize): number => {
  const length = Math.max(size.width, size.height) - 2 * TICK_EDGE;

  return niceStep(
    Math.max(MIN_TICK_PIXELS, length / MAX_TICKS) / scale,
    (step) => step * scale >= MIN_TICK_PIXELS && length <= MAX_TICKS * step * scale,
  );
};

/** Шаг сетки в единицах мира: не чаще `MIN_GRID_PIXELS` и делит шаг тиков, чтобы тики ложились на линии. */
const gridStep = (scale: number, unit: number): number =>
  niceStep(MIN_GRID_PIXELS / scale, (step) => step * scale >= MIN_GRID_PIXELS && unit % step === 0);

/** Шаг в пикселях годится для обхода листа: конечный и положительный. */
const isUsableStep = (step: number): boolean => Number.isFinite(step) && step > 0;

/** Первая линия сетки от левого/верхнего края, кратная шагу относительно начала координат. */
const firstGridLine = (origin: number, step: number): number => ((origin % step) + step) % step;

const renderGrid = (builder: SvgBuilder, viewport: Viewport, size: PlotSize): void => {
  const step = gridStep(viewport.scale, tickStep(viewport.scale, size)) * viewport.scale;
  const stroke: StrokeOptions = { color: GRID_COLOR, width: 0.5, className: 'rte-drawing__grid' };

  if (!isUsableStep(step)) return;

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

/**
 * Номер первого тика (от начала координат, с единицы), который уже на листе:
 * `beyond` — на сколько пикселей начало координат вышло за край листа с той
 * стороны, откуда тики идут. Начало координат на листе — тики с первого.
 */
const firstTick = (beyond: number, step: number): number => Math.max(1, Math.ceil(beyond / step));

const renderTicks = (builder: SvgBuilder, viewport: Viewport, size: PlotSize): void => {
  const { scale, cx, cy } = viewport;
  const unit = tickStep(scale, size);
  const step = unit * scale;
  const stroke: StrokeOptions = { color: AXIS_COLOR, width: 1, className: 'rte-drawing__axis' };
  const number = { size: 9, weight: 400, className: 'rte-drawing__axis-label' };
  const xAxisShown = cy >= 0 && cy <= size.height;
  const yAxisShown = cx >= 0 && cx <= size.width;

  if (!isUsableStep(step)) return;

  const tickX = (x: number): void => {
    builder.line({ x, y: cy - TICK_HALF }, { x, y: cy + TICK_HALF }, stroke);
    builder.text({ x, y: cy + 15 }, String(Math.round((x - cx) / scale)), number);
  };

  const tickY = (y: number): void => {
    builder.line({ x: cx - TICK_HALF, y }, { x: cx + TICK_HALF, y }, stroke);
    builder.text({ x: cx - 12, y: y + 3 }, String(Math.round((cy - y) / scale)), { ...number, anchor: 'end' });
  };

  // Ось за листом — без тиков и чисел; на листе — только видимые тики, сколько бы ни было до начала координат.
  if (xAxisShown) {
    for (let x = cx + firstTick(-cx, step) * step; x < size.width - TICK_EDGE; x += step) tickX(x);

    for (let x = cx - firstTick(cx - size.width, step) * step; x > TICK_EDGE; x -= step) tickX(x);
  }

  if (yAxisShown) {
    for (let y = cy - firstTick(cy - size.height, step) * step; y > TICK_EDGE; y -= step) tickY(y);

    for (let y = cy + firstTick(-cy, step) * step; y < size.height - TICK_EDGE; y += step) tickY(y);
  }

  if (xAxisShown && yAxisShown) builder.text({ x: cx - 4, y: cy + 12 }, '0', { ...number, anchor: 'end' });
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
    drawPlotLabel(builder, { x: center.x + radius + 8, y: center.y - 8 }, plot.label, {
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
  // Вид может оказаться очень далеко от центра гиперболы (далёкая точка в той
  // же сцене): с постоянным шагом выборка шла бы миллионы шагов и вешала
  // страницу. Обычный вид шаг не меняет.
  const step = Math.max(HYPERBOLA_STEP, reach / HYPERBOLA_MAX_SAMPLES);

  // Две ветви — два пути: у каждой своя выборка от особой точки наружу.
  [1, -1].forEach((branch) => {
    const samples: Array<SvgPoint | null> = [];

    for (let t = HYPERBOLA_NEAR_ZERO; t <= reach; t += step) {
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

/** Отступ места подписи ломаной от краёв рисунка. */
const FREEHAND_LABEL_INSET = 12;

/** Где по видимой ширине ломаной стоит её подпись: ближе к правому концу, но с местом для текста. */
const FREEHAND_LABEL_AT = 0.75;

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const lerp = (a: SvgPoint, b: SvgPoint, t: number): SvgPoint => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** Часть отрезка `a–b` внутри прямоугольника (отсечение Лянга — Барски): доли `[t0, t1]` или `null`. */
const clipSegment = (a: SvgPoint, b: SvgPoint, box: Box): [number, number] | null => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const sides: Array<[number, number]> = [
    [-dx, a.x - box.left],
    [dx, box.right - a.x],
    [-dy, a.y - box.top],
    [dy, box.bottom - a.y],
  ];
  let from = 0;
  let to = 1;
  let outside = false;

  sides.forEach(([p, q]) => {
    if (p === 0) {
      // Отрезок параллелен стороне: снаружи от неё — целиком снаружи.
      if (q < 0) outside = true;

      return;
    }

    if (p < 0) from = Math.max(from, q / p);
    else to = Math.min(to, q / p);
  });

  return outside || from > to ? null : [from, to];
};

/**
 * Место подписи ломаной: точка её видимой части на `FREEHAND_LABEL_AT`
 * видимой ширины — ближе к правому концу, внутри рисунка. Ломаная целиком
 * за краем — `null`.
 */
const freehandLabelPoint = (points: SvgPoint[], size: PlotSize): SvgPoint | null => {
  const box: Box = {
    left: FREEHAND_LABEL_INSET,
    top: FREEHAND_LABEL_INSET,
    right: size.width - FREEHAND_LABEL_INSET,
    bottom: size.height - FREEHAND_LABEL_INSET,
  };
  const pieces: Array<[SvgPoint, SvgPoint]> = [];

  points.forEach((point, index) => {
    const next = points[index + 1];
    const part = next ? clipSegment(point, next, box) : null;

    if (next && part) pieces.push([lerp(point, next, part[0]), lerp(point, next, part[1])]);
  });

  const ends = pieces.flat();
  const first = ends[0];

  if (!first) return null;

  const left = ends.reduce((min, point) => Math.min(min, point.x), first.x);
  const right = ends.reduce((max, point) => Math.max(max, point.x), first.x);
  const target = left + (right - left) * FREEHAND_LABEL_AT;
  // Последний по ходу кусок над нужным x; если там разрыв — ближайший к нему конец куска.
  const piece = [...pieces].reverse().find(([a, b]) => Math.min(a.x, b.x) <= target && target <= Math.max(a.x, b.x));

  if (!piece) return ends.reduce((best, point) => (Math.abs(point.x - target) < Math.abs(best.x - target) ? point : best), first);

  const [a, b] = piece;

  return lerp(a, b, b.x === a.x ? 0 : (target - a.x) / (b.x - a.x));
};

/** Подпись кривой у характерной точки: вершина параболы, центр гиперболы, середина прямой, правый край ломаной. */
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
  } else if (plot.type === 'freehand') {
    const on = freehandLabelPoint(plot.points.map(context.toSvg), context.size);

    if (on) at = { x: on.x + 10, y: on.y - 10 };
  }

  if (at) drawPlotLabel(context.builder, at, plot.label, { size: LABEL_SIZE, color, anchor: 'start', halo: 3.5 });
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

