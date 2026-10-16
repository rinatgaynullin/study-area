import { el, type Translate, type Unsubscribe } from '@rich-editor/core';
import { renderGeometrySvg, resolveGeometryViewport } from '../render/geometry-svg';
import { fmt, pointsAttr } from '../render/svg-builder';
import { normalizeGeometryScene } from '../scene/normalize';
import type { GeometryHighlight, GeometryScene, Plot, Vec2 } from '../scene/types';
import { distance, distanceToSegment, recognizeStroke, roundPoint, roundTo, snapToGrid } from './geometry-utils';
import { HistoryStack, cloneScene } from './history';
import { ChangeEmitter, SketchCanvas, type PointerInfo } from './sketch-canvas';
import { ToolBar, actionButton, propertyField, selectControl, type ToolButton } from './tool-bar';
import type { RawScene, SceneEditor, SceneEditorContext, SceneEditorFactory } from './types';

type Tool = 'select' | 'point' | 'pencil' | 'shading' | 'text' | 'delete';

const TOOLS: ToolButton<Tool>[] = [
  { id: 'select', labelKey: 'drawings_tool_select', glyph: '↖' },
  { id: 'point', labelKey: 'drawings_tool_point', glyph: '•' },
  { id: 'pencil', labelKey: 'drawings_tool_pencil', glyph: '✎' },
  { id: 'shading', labelKey: 'drawings_tool_shading', glyph: '▨' },
  { id: 'text', labelKey: 'drawings_tool_text', glyph: 'T' },
  { id: 'delete', labelKey: 'drawings_tool_delete', glyph: '✕' },
];

type TemplateId = 'parabola' | 'hyperbola' | 'line' | 'circle' | 'sqrt';

const TEMPLATES: TemplateId[] = ['parabola', 'hyperbola', 'line', 'circle', 'sqrt'];

/** Цвета шаблонов — те же, что в оригинале: по цвету ученик узнаёт вид графика. */
const TEMPLATE_COLORS: Record<TemplateId, string> = {
  parabola: '#3b82f6',
  hyperbola: '#10b981',
  line: '#ef4444',
  circle: '#f59e0b',
  sqrt: '#8b5cf6',
};

const NAMED_COLORS: Array<{ id: string; value: string }> = [
  { id: 'blue', value: '#3b82f6' },
  { id: 'red', value: '#ef4444' },
  { id: 'green', value: '#10b981' },
  { id: 'orange', value: '#f59e0b' },
  { id: 'purple', value: '#8b5cf6' },
  { id: 'gray', value: '#475569' },
];

const HEX_COLOR = /^#[0-9a-f]{6}$/;

const CANVAS_WIDTH = 560;
const CANVAS_HEIGHT = 420;
/** Начальный масштаб полотна: при 30 px на единицу видно примерно ±9 по x и ±7 по y. */
const DEFAULT_SCALE = 30;
const GRID_STEP = 0.5;
/** Вставленная копия сдвигается вправо-вниз, чтобы не слиться с оригиналом. */
const PASTE_OFFSET: Vec2 = [0.5, -0.5];
const DRAFT_COLOR = '#8b5cf6';
const HANDLE_RADIUS = 7;

/** Шаг параметра при выборке кривых для хит-теста и пределы параметра. */
const SAMPLE_STEP = 0.05;
const PARABOLA_REACH = 15;
const SQRT_REACH = 50;
const HYPERBOLA_REACH = 15;
const HYPERBOLA_NEAR_ZERO = 0.05;
/** Концы прямой `y = kx + b` без области: достаточно далеко, чтобы считать её бесконечной. */
const LINE_FAR = 1e4;
/** Точки штриха ближе этого шага не добавляются: дрожание руки не должно раздувать ломаную. */
const STROKE_MIN_STEP = 0.02;
const MIN_RADIUS = 0.25;
const MIN_STRETCH = 0.05;

/** Поля сцены, которые конструктор понимает; остальные уходят обратно нетронутыми. */
const KNOWN_SCENE_KEYS = new Set(['type', 'plots', 'axes', 'circle', 'circles', 'showGrid', 'grid', 'showAxesTicks', 'scale', 'offsetX', 'offsetY']);

/** Поля графика, которые конструктор понимает; остальные хранятся в `extra` элемента. */
const KNOWN_PLOT_KEYS = new Set([
  'id',
  'type',
  'color',
  'stroke',
  'label',
  'style',
  'center',
  'centerVertex',
  'radius',
  'fill',
  'vertex',
  'direction',
  'stretch',
  'stretchX',
  'stretchY',
  'domain',
  'directionX',
  'directionY',
  'k',
  'b',
  'p1',
  'p2',
  'coords',
  'points',
  'bounds',
]);

/** График живой сцены: всегда с `id`; чужие поля элемента — в `extra`. */
type WithId<T> = T extends Plot ? T & { id: string; extra?: RawScene } : never;
type PlotItem = WithId<Plot>;
type CurvePlot = Extract<PlotItem, { type: 'parabola' | 'sqrt' | 'hyperbola' }>;
type DomainPlot = Extract<PlotItem, { type: 'parabola' | 'sqrt' | 'hyperbola' | 'line' }>;

interface PlotsState {
  plots: PlotItem[];
  xLabel: string;
  yLabel: string;
  showGrid: boolean;
  showAxesTicks: boolean;
  /** Поля сцены, которых конструктор не знает: уходят обратно нетронутыми. */
  extra: RawScene;
}

const isRecord = (value: unknown): value is RawScene => typeof value === 'object' && value !== null && !Array.isArray(value);

const extraOf = (raw: unknown, known: Set<string>): RawScene => {
  const extra: RawScene = {};

  if (isRecord(raw)) {
    Object.entries(raw).forEach(([key, value]) => {
      if (!known.has(key)) extra[key] = value;
    });
  }

  return extra;
};

/** Бесконечные концы области — `null`: JSON их иначе не переживает, а нормализация понимает `null`. */
const serializeDomain = (domain: [number, number]): Array<number | null> => domain.map((value) => (Number.isFinite(value) ? roundTo(value) : null));

/** График в формате PinQueen: округлённые числа, без `undefined`, чужие поля элемента как были. */
const serializePlot = (plot: PlotItem): RawScene => {
  const out: RawScene = { ...(plot.extra ?? {}), id: plot.id, type: plot.type };

  if (plot.color) out.color = plot.color;

  if (plot.label) out.label = plot.label;

  if (plot.type !== 'point' && plot.type !== 'shading') out.style = plot.style === 'dashed' ? 'dashed' : 'solid';

  switch (plot.type) {
    case 'circle':
      out.center = roundPoint(plot.center);
      out.radius = roundTo(plot.radius);

      if (plot.fill) out.fill = true;
      break;
    case 'parabola':
      out.vertex = roundPoint(plot.vertex);
      out.direction = plot.direction;
      out.stretchX = roundTo(plot.stretchX);
      out.stretchY = roundTo(plot.stretchY);
      break;
    case 'sqrt':
      out.vertex = roundPoint(plot.vertex);
      out.directionX = plot.directionX;
      out.directionY = plot.directionY;
      out.stretch = roundTo(plot.stretch);
      break;
    case 'hyperbola':
      out.center = roundPoint(plot.center);
      out.k = roundTo(plot.k);
      break;
    case 'line':
      if (plot.p1 && plot.p2) {
        out.p1 = roundPoint(plot.p1);
        out.p2 = roundPoint(plot.p2);
      } else {
        out.k = roundTo(plot.k ?? 0);
        out.b = roundTo(plot.b ?? 0);
      }
      break;
    case 'point':
      out.coords = roundPoint(plot.coords);
      out.style = plot.pointStyle;
      break;
    case 'shading':
      if (plot.points) out.points = plot.points.map((point) => roundPoint(point));
      else if (plot.bounds) out.bounds = plot.bounds.map((value) => roundTo(value));
      break;
    case 'freehand':
      out.points = plot.points.map((point) => roundPoint(point));
      break;
    default:
      break;
  }

  if ('domain' in plot && plot.domain) out.domain = serializeDomain(plot.domain);

  return out;
};

const shiftDomain = (domain: [number, number] | undefined, dx: number): [number, number] | undefined =>
  domain ? [Number.isFinite(domain[0]) ? roundTo(domain[0] + dx) : domain[0], Number.isFinite(domain[1]) ? roundTo(domain[1] + dx) : domain[1]] : undefined;

/** Копия графика, сдвинутая целиком: так двигает перетаскивание и вставка. */
const translatePlot = (plot: PlotItem, [dx, dy]: Vec2): PlotItem => {
  const shift = (point: Vec2): Vec2 => roundPoint([point[0] + dx, point[1] + dy]);

  switch (plot.type) {
    case 'point':
      return { ...plot, coords: shift(plot.coords) };
    case 'circle':
      return { ...plot, center: shift(plot.center) };
    case 'hyperbola':
      return { ...plot, center: shift(plot.center), domain: shiftDomain(plot.domain, dx) };
    case 'parabola':
      return { ...plot, vertex: shift(plot.vertex), domain: shiftDomain(plot.domain, dx) };
    case 'sqrt':
      return { ...plot, vertex: shift(plot.vertex), domain: shiftDomain(plot.domain, dx) };
    case 'line':
      if (plot.p1 && plot.p2) return { ...plot, p1: shift(plot.p1), p2: shift(plot.p2) };

      // Сдвиг прямой `y = kx + b` на (dx, dy) — это новый `b`: b + dy − k·dx.
      return { ...plot, b: roundTo((plot.b ?? 0) + dy - (plot.k ?? 0) * dx), domain: shiftDomain(plot.domain, dx) };
    case 'shading':
      if (plot.points) return { ...plot, points: plot.points.map(shift) };

      if (plot.bounds) {
        const [x1, x2, y1, y2] = plot.bounds;

        return { ...plot, bounds: [roundTo(x1 + dx), roundTo(x2 + dx), roundTo(y1 + dy), roundTo(y2 + dy)] };
      }

      return plot;
    case 'freehand':
      return { ...plot, points: plot.points.map(shift) };
    default:
      return plot;
  }
};

/** Опорная точка графика — её прилипание к сетке задаёт сдвиг всего графика. */
const anchorOf = (plot: PlotItem): Vec2 | null => {
  switch (plot.type) {
    case 'point':
      return plot.coords;
    case 'circle':
    case 'hyperbola':
      return plot.center;
    case 'parabola':
    case 'sqrt':
      return plot.vertex;
    case 'line':
      return plot.p1 ?? null;
    case 'shading':
      return plot.points?.[0] ?? (plot.bounds ? [plot.bounds[0], plot.bounds[2]] : null);
    case 'freehand':
      return plot.points[0] ?? null;
    default:
      return null;
  }
};

/** Ручки выделенного графика в оверлее: характерные точки, за которые его удобно тянуть. */
const handlesOf = (plot: PlotItem): Vec2[] => {
  switch (plot.type) {
    case 'point':
      return [plot.coords];
    case 'circle':
      return [plot.center, [plot.center[0] + plot.radius, plot.center[1]]];
    case 'hyperbola':
      return [plot.center];
    case 'parabola':
    case 'sqrt':
      return [plot.vertex];
    case 'line':
      return plot.p1 && plot.p2 ? [plot.p1, plot.p2] : [];
    case 'shading':
      return shadingPolygon(plot);
    default:
      return [];
  }
};

const shadingPolygon = (plot: Extract<PlotItem, { type: 'shading' }>): Vec2[] => {
  if (plot.points && plot.points.length > 0) return plot.points;

  if (!plot.bounds) return [];

  const [x1, x2, y1, y2] = plot.bounds;

  return [
    [x1, y1],
    [x2, y1],
    [x2, y2],
    [x1, y2],
  ];
};

/** Расстояние до ломаной по отрезкам: выборка кривой, штрих карандаша, контур штриховки. */
const distanceToPolyline = (p: Vec2, points: Vec2[], closed = false): number => {
  if (points.length === 0) return Infinity;

  if (points.length === 1) return distance(p, points[0]);

  let best = Infinity;

  for (let i = 1; i < points.length; i += 1) best = Math.min(best, distanceToSegment(p, points[i - 1], points[i]));

  if (closed) best = Math.min(best, distanceToSegment(p, points[points.length - 1], points[0]));

  return best;
};

/** Точка внутри многоугольника: луч вправо пересекает контур нечётное число раз. */
const isInsidePolygon = ([x, y]: Vec2, polygon: Vec2[]): boolean => {
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];

    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }

  return inside;
};

/**
 * Выборка кривой ломаными в мире — так же, как её рисует рендер. Разрыв
 * (`domain`, особая точка гиперболы) начинает новую ломаную, чтобы хит-тест
 * не считал хорду через разрыв частью графика.
 */
const curveRuns = (plot: CurvePlot): Vec2[][] => {
  const runs: Vec2[][] = [[]];
  const push = (point: Vec2 | null): void => {
    if (point) runs[runs.length - 1].push(point);
    else if (runs[runs.length - 1].length > 0) runs.push([]);
  };
  const inDomain = (x: number): boolean => !plot.domain || (x >= plot.domain[0] && x <= plot.domain[1]);

  if (plot.type === 'parabola') {
    const sign = plot.direction === 'down' ? -1 : 1;

    for (let t = -PARABOLA_REACH; t <= PARABOLA_REACH; t += SAMPLE_STEP) {
      const x = plot.vertex[0] + t * plot.stretchX;

      push(inDomain(x) ? [x, plot.vertex[1] + t * t * plot.stretchY * sign] : null);
    }
  } else if (plot.type === 'sqrt') {
    const dirX = plot.directionX === 'left' ? -1 : 1;
    const dirY = plot.directionY === 'down' ? -1 : 1;

    for (let s = 0; s <= SQRT_REACH; s += SAMPLE_STEP) {
      const x = plot.vertex[0] + s * dirX;

      push(inDomain(x) ? [x, plot.vertex[1] + Math.sqrt(s) * plot.stretch * dirY] : null);
    }
  } else {
    [1, -1].forEach((branch) => {
      push(null);

      for (let t = HYPERBOLA_NEAR_ZERO; t <= HYPERBOLA_REACH; t += SAMPLE_STEP) {
        const x = plot.center[0] + t * branch;

        push(inDomain(x) ? [x, plot.center[1] + plot.k / (t * branch)] : null);
      }
    });
  }

  return runs.filter((run) => run.length > 0);
};

/** Концы прямой: отрезок `p1–p2` или `y = kx + b` на области (без неё — «бесконечный»). */
const lineEnds = (plot: Extract<PlotItem, { type: 'line' }>): [Vec2, Vec2] | null => {
  if (plot.p1 && plot.p2) return [plot.p1, plot.p2];

  if (plot.k === undefined || plot.b === undefined) return null;

  const from = plot.domain && Number.isFinite(plot.domain[0]) ? plot.domain[0] : -LINE_FAR;
  const to = plot.domain && Number.isFinite(plot.domain[1]) ? plot.domain[1] : LINE_FAR;

  return [
    [from, plot.k * from + plot.b],
    [to, plot.k * to + plot.b],
  ];
};

/** Расстояние от точки мира до графика; внутри штриховки — ноль. */
const plotDistance = (plot: PlotItem, p: Vec2): number => {
  switch (plot.type) {
    case 'point':
      return distance(p, plot.coords);
    case 'circle':
      return Math.min(Math.abs(distance(p, plot.center) - plot.radius), distance(p, plot.center));
    case 'line': {
      const ends = lineEnds(plot);

      return ends ? distanceToSegment(p, ends[0], ends[1]) : Infinity;
    }
    case 'parabola':
    case 'sqrt':
    case 'hyperbola':
      return Math.min(...curveRuns(plot).map((run) => distanceToPolyline(p, run)));
    case 'freehand':
      return distanceToPolyline(p, plot.points);
    case 'shading': {
      const polygon = shadingPolygon(plot);

      return isInsidePolygon(p, polygon) ? 0 : distanceToPolyline(p, polygon, true);
    }
    default:
      return Infinity;
  }
};

/** Точки важнее кривых, кривые важнее областей: точка на параболе выбирается первой. */
const hitRank = (plot: PlotItem): number => (plot.type === 'point' ? 0 : plot.type === 'shading' ? 2 : 1);

/** Шаблоны кнопок палитры: единичные кривые в начале координат. */
const TEMPLATE_PLOTS: Record<TemplateId, (id: string, color: string) => PlotItem> = {
  parabola: (id, color) => ({ id, type: 'parabola', vertex: [0, 0], direction: 'up', stretchX: 1, stretchY: 1, color }),
  hyperbola: (id, color) => ({ id, type: 'hyperbola', center: [0, 0], k: 1, color }),
  line: (id, color) => ({ id, type: 'line', k: 1, b: 0, color }),
  circle: (id, color) => ({ id, type: 'circle', center: [0, 0], radius: 2, color }),
  sqrt: (id, color) => ({ id, type: 'sqrt', vertex: [0, 0], directionX: 'right', directionY: 'up', stretch: 1, color }),
};

const templatePlot = (template: TemplateId, id: string): PlotItem => TEMPLATE_PLOTS[template](id, TEMPLATE_COLORS[template]);

/** Размах штриха: больший из размеров его охватывающего прямоугольника. */
const strokeSpan = (points: Vec2[]): number => {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);

  return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
};

/**
 * Конструктор графиков функций: шаблоны кривых, точки, штриховка и карандаш,
 * который распознаёт прямую, окружность и параболу.
 *
 * Инструмент, штрих, черновик области, выделение, буфер копирования и
 * история — общее состояние обработчиков указателя, клавиатуры и панели
 * свойств, поэтому класс.
 */
class PlotsEditor implements SceneEditor {
  readonly element: HTMLElement;

  private readonly t: Translate;

  private readonly changes = new ChangeEmitter();

  private readonly history = new HistoryStack<PlotsState>();

  private readonly canvas: SketchCanvas;

  private readonly tools: ToolBar<Tool>;

  private readonly hint: HTMLElement;

  private readonly properties: HTMLElement;

  private state: PlotsState = PlotsEditor.emptyState();

  private tool: Tool = 'select';

  private selectedId: string | null = null;

  /** Счётчик `plot_n` для графиков без id: уникальность проверяется по сцене. */
  private plotCount = 0;

  /** Штрих карандаша в координатах мира, пока кнопка зажата. */
  private stroke: Vec2[] | null = null;

  /** Вершины будущей области штриховки. */
  private draft: Vec2[] = [];

  private cursor: Vec2 | null = null;

  private drag: { id: string; origin: Vec2; snapshot: PlotItem; moved: boolean } | null = null;

  private clipboard: PlotItem | null = null;

  constructor(context: SceneEditorContext) {
    this.t = context.t;

    this.canvas = new SketchCanvas({
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      scale: DEFAULT_SCALE,
      onPointerDown: this.onPointerDown,
      onPointerMove: this.onPointerMove,
      onPointerUp: this.onPointerUp,
      onDoubleClick: this.onDoubleClick,
      onKeyDown: this.onKeyDown,
      onViewportChange: () => this.render(),
    });

    this.tools = new ToolBar<Tool>({ t: this.t, tools: TOOLS, onSelect: (tool) => this.setTool(tool) });

    const actions = el('div', {
      class: 'rte-builder__actions',
      children: [
        actionButton(this.t('drawings_undo'), '↶', () => this.undo()),
        actionButton(this.t('drawings_redo'), '↷', () => this.redo()),
        actionButton(this.t('drawings_plots_copy'), '⧉', () => this.copySelected()),
        actionButton(this.t('drawings_plots_paste'), '⎘', () => this.paste()),
        actionButton(this.t('drawings_grid'), '#', () => this.toggleGrid()),
        actionButton(this.t('drawings_zoom_in'), '+', () => this.canvas.zoomBy(1.25)),
        actionButton(this.t('drawings_zoom_out'), '−', () => this.canvas.zoomBy(0.8)),
        actionButton(this.t('drawings_zoom_reset'), '⌂', () => this.fitView()),
      ],
    });

    const palette = el('div', {
      class: 'rte-builder__palette rte-plots__palette',
      attrs: { role: 'group', 'aria-label': this.t('drawings_plots_templates') },
    });

    TEMPLATES.forEach((template) => {
      const label = this.t(`drawings_plots_template_${template}`);
      const button = el('button', {
        class: 'rte-builder__tool rte-plots__template',
        attrs: { type: 'button', title: label, 'data-plot-template': template },
        text: label,
      });

      button.addEventListener('click', () => this.addTemplate(template));
      palette.appendChild(button);
    });

    this.hint = el('p', { class: 'rte-builder__hint', attrs: { role: 'status' } });
    this.properties = el('div', { class: 'rte-builder__props', attrs: { 'aria-live': 'polite' } });

    this.element = el('div', {
      class: 'rte-builder rte-builder--plots',
      children: [
        el('div', { class: 'rte-builder__bar', children: [this.tools.element, actions] }),
        palette,
        el('div', { class: 'rte-builder__body', children: [this.canvas.element, this.properties] }),
        this.hint,
      ],
    });

    this.setTool('select');
    this.render();
    this.renderProperties();
  }

  static emptyState(): PlotsState {
    return { plots: [], xLabel: 'x', yLabel: 'y', showGrid: true, showAxesTicks: true, extra: {} };
  }

  // ----------------------------------------------------------- SceneEditor

  load(raw: RawScene): void {
    const scene = normalizeGeometryScene(raw);
    const rawPlots = Array.isArray(raw.plots) ? raw.plots : [];
    const used = new Set<string>();
    const plots: PlotItem[] = [];

    // Графики нормализуются по одному: так известно, из какого сырого объекта
    // вышел каждый, и его чужие поля можно сохранить.
    rawPlots.forEach((item) => {
      const [plot] = normalizeGeometryScene({ type: 'plot_2d', vertices: raw.vertices, plots: [item] }).plots;

      if (plot) plots.push(this.adoptPlot(plot, used, extraOf(item, KNOWN_PLOT_KEYS)));
    });

    // Окружности верхнего уровня (`circle`/`circles`) нормализация дописывает после списка.
    scene.plots.slice(plots.length).forEach((plot) => plots.push(this.adoptPlot(plot, used)));

    this.state = {
      plots,
      xLabel: scene.axes.xLabel,
      yLabel: scene.axes.yLabel,
      showGrid: scene.showGrid,
      showAxesTicks: scene.showAxesTicks,
      extra: extraOf(raw, KNOWN_SCENE_KEYS),
    };
    this.history.clear();
    this.selectedId = null;
    this.stroke = null;
    this.draft = [];
    this.drag = null;
    this.fitView();
    this.renderProperties();
  }

  getScene(): RawScene {
    const { state } = this;
    const scene: RawScene = {
      ...state.extra,
      type: 'plot_2d',
      axes: { x_label: state.xLabel, y_label: state.yLabel },
      plots: state.plots.map(serializePlot),
    };

    if (!state.showGrid) scene.showGrid = false;

    if (!state.showAxesTicks) scene.showAxesTicks = false;

    return scene;
  }

  onChange(listener: () => void): Unsubscribe {
    return this.changes.on(listener);
  }

  focus(): void {
    this.canvas.focus();
  }

  destroy(): void {
    this.changes.clear();
    this.tools.destroy();
    this.canvas.destroy();
    this.element.remove();
  }

  // --------------------------------------------------------------- рендер

  /** Сцена для рендера: окно просмотра полотна вместо autoFit. */
  private renderScene(): GeometryScene {
    const { viewport } = this.canvas;

    return {
      ...normalizeGeometryScene(this.getScene()),
      scale: viewport.scale,
      offsetX: viewport.cx - CANVAS_WIDTH / 2,
      offsetY: viewport.cy - CANVAS_HEIGHT / 2,
    };
  }

  private highlight(): GeometryHighlight | null {
    return this.selectedId === null ? null : { type: 'plot', id: this.selectedId };
  }

  private render(): void {
    this.canvas.setScene(renderGeometrySvg(this.renderScene(), { width: CANVAS_WIDTH, height: CANVAS_HEIGHT, highlight: this.highlight() }));
    this.renderOverlay();
  }

  /** Оверлей: штрих карандаша, черновик области и ручки выделенного графика. */
  private renderOverlay(): void {
    const parts: string[] = [];
    const toSvg = (point: Vec2) => this.canvas.toSvg(point);

    if (this.stroke && this.stroke.length > 1) {
      parts.push(
        `<polyline points="${pointsAttr(this.stroke.map(toSvg))}" fill="none" stroke="${DRAFT_COLOR}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />`,
      );
    }

    if (this.draft.length > 0) {
      const points = this.draft.map(toSvg);

      if (points.length > 1) {
        parts.push(`<polyline points="${pointsAttr(points)}" fill="none" stroke="${DRAFT_COLOR}" stroke-width="1.5" stroke-dasharray="4 3" />`);
      }

      if (this.cursor) {
        const last = points[points.length - 1];
        const to = toSvg(this.cursor);

        parts.push(`<line x1="${fmt(last.x)}" y1="${fmt(last.y)}" x2="${fmt(to.x)}" y2="${fmt(to.y)}" stroke="${DRAFT_COLOR}" stroke-width="1" stroke-dasharray="3 3" />`);
      }

      points.forEach((point) => {
        parts.push(`<circle cx="${fmt(point.x)}" cy="${fmt(point.y)}" r="4" fill="${DRAFT_COLOR}" />`);
      });
    }

    const selected = this.selectedPlot();

    if (selected) {
      handlesOf(selected).forEach((handle) => {
        const at = toSvg(handle);

        parts.push(
          `<circle cx="${fmt(at.x)}" cy="${fmt(at.y)}" r="${HANDLE_RADIUS}" fill="none" stroke="${DRAFT_COLOR}" stroke-width="1.5" stroke-dasharray="3 3" />`,
        );
      });
    }

    this.canvas.setOverlay(parts.join(''));
  }

  private fitView(): void {
    const scene = normalizeGeometryScene(this.getScene());

    this.canvas.setViewport(
      scene.plots.length > 0
        ? resolveGeometryViewport(scene, { width: CANVAS_WIDTH, height: CANVAS_HEIGHT, autoFit: true })
        : { scale: DEFAULT_SCALE, cx: CANVAS_WIDTH / 2, cy: CANVAS_HEIGHT / 2 },
    );
  }

  // ------------------------------------------------------------ изменения

  private commit(mutate: (state: PlotsState) => void): void {
    this.history.record(this.state);
    mutate(this.state);
    this.afterChange();
  }

  private afterChange(): void {
    if (this.selectedId !== null && !this.state.plots.some((plot) => plot.id === this.selectedId)) this.selectedId = null;

    this.render();
    this.renderProperties();
    this.changes.emit();
  }

  private undo(): void {
    const previous = this.history.undo(this.state);

    if (!previous) return;

    this.state = previous;
    this.afterChange();
  }

  private redo(): void {
    const next = this.history.redo(this.state);

    if (!next) return;

    this.state = next;
    this.afterChange();
  }

  private toggleGrid(): void {
    this.commit((state) => {
      state.showGrid = !state.showGrid;
    });
  }

  private setTool(tool: Tool): void {
    this.tool = tool;
    this.draft = [];
    this.stroke = null;
    this.tools.setActive(tool);
    this.hint.textContent = this.t(`drawings_plots_hint_${tool}`);
    this.renderOverlay();
  }

  private selectedPlot(): PlotItem | null {
    return this.state.plots.find((plot) => plot.id === this.selectedId) ?? null;
  }

  /** Свободный `plot_n`: счётчик растёт, пока не найдётся id, которого нет среди занятых. */
  private freshId(used: Set<string>): string {
    let id: string;

    do {
      this.plotCount += 1;
      id = `plot_${this.plotCount}`;
    } while (used.has(id));

    return id;
  }

  private nextId(): string {
    return this.freshId(new Set(this.state.plots.map((plot) => plot.id)));
  }

  /** График из нормализованной сцены: с уникальным id и без привязки центра к вершине — центр уже разрешён. */
  private adoptPlot(plot: Plot, used: Set<string>, extra: RawScene = {}): PlotItem {
    const id = plot.id && !used.has(plot.id) ? plot.id : this.freshId(used);

    used.add(id);

    const item: PlotItem = { ...plot, id, ...(Object.keys(extra).length > 0 ? { extra } : {}) };

    if (item.type === 'circle') delete item.centerVertex;

    return item;
  }

  private addPlot(plot: PlotItem): void {
    this.selectedId = plot.id;
    this.commit((state) => {
      state.plots.push(plot);
    });
  }

  private addTemplate(template: TemplateId): void {
    this.addPlot(templatePlot(template, this.nextId()));
  }

  private snap(point: Vec2, info: PointerInfo): Vec2 {
    return info.shift ? roundPoint(point) : snapToGrid(point, GRID_STEP);
  }

  private plotAt(point: Vec2): PlotItem | null {
    const radius = this.canvas.hitRadius;
    let best: { plot: PlotItem; d: number; rank: number } | null = null;

    for (const plot of this.state.plots) {
      const d = plotDistance(plot, point);

      if (d > radius) continue;

      const rank = hitRank(plot);

      if (best === null || rank < best.rank || (rank === best.rank && d < best.d)) best = { plot, d, rank };
    }

    return best === null ? null : best.plot;
  }

  // ------------------------------------------------------------- указатель

  private readonly onPointerDown = (info: PointerInfo): void => {
    if (info.button !== 0) return;

    switch (this.tool) {
      case 'select':
        this.selectAt(info);
        break;
      case 'point':
        this.addPlot({ id: this.nextId(), type: 'point', coords: this.snap(info.world, info), pointStyle: 'solid' });
        break;
      case 'pencil':
        this.stroke = [info.world];
        this.renderOverlay();
        break;
      case 'shading':
        this.draft.push(this.snap(info.world, info));
        this.renderOverlay();
        break;
      case 'text':
        this.editLabelAt(info);
        break;
      case 'delete': {
        const plot = this.plotAt(info.world);

        if (plot) {
          this.selectedId = plot.id;
          this.deleteSelection();
        }
        break;
      }
      default:
        break;
    }
  };

  private readonly onPointerMove = (info: PointerInfo): void => {
    this.cursor = info.world;

    if (this.stroke) {
      const last = this.stroke[this.stroke.length - 1];

      if (distance(last, info.world) >= STROKE_MIN_STEP) this.stroke.push(info.world);

      this.renderOverlay();

      return;
    }

    if (this.drag) {
      const index = this.state.plots.findIndex((plot) => plot.id === this.drag?.id);

      if (index < 0) return;

      const delta = this.dragDelta(info);

      if (!this.drag.moved) {
        if (delta[0] === 0 && delta[1] === 0) return;

        this.history.record(this.state);
        this.drag.moved = true;
      }

      this.state.plots[index] = translatePlot(this.drag.snapshot, delta);
      this.render();

      return;
    }

    if (this.draft.length > 0) this.renderOverlay();
  };

  private readonly onPointerUp = (info: PointerInfo): void => {
    if (this.stroke) {
      const points = this.stroke;

      this.stroke = null;
      this.finishStroke(points, info);

      return;
    }

    if (this.drag?.moved) this.afterChange();

    this.drag = null;
  };

  private readonly onDoubleClick = (info: PointerInfo): void => {
    if (this.tool === 'shading') {
      // Второй клик двойного уже добавил вершину в той же точке — она лишняя.
      const last = this.draft[this.draft.length - 1];
      const previous = this.draft[this.draft.length - 2];

      if (last && previous && distance(last, previous) < 1e-6) this.draft.pop();

      this.closeShading();

      return;
    }

    this.editLabelAt(info);
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const ctrl = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();

    if (ctrl && key === 'z') {
      event.preventDefault();

      if (event.shiftKey) this.redo();
      else this.undo();

      return;
    }

    if (ctrl && key === 'y') {
      event.preventDefault();
      this.redo();

      return;
    }

    if (ctrl && key === 'c') {
      if (this.selectedPlot()) {
        event.preventDefault();
        this.copySelected();
      }

      return;
    }

    if (ctrl && key === 'v') {
      if (this.clipboard) {
        event.preventDefault();
        this.paste();
      }

      return;
    }

    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (this.selectedId !== null) {
        event.preventDefault();
        this.deleteSelection();
      }

      return;
    }

    if (event.key === 'Enter') {
      if (this.tool === 'shading' && this.draft.length >= 3) {
        event.preventDefault();
        this.closeShading();
      }

      return;
    }

    if (event.key === 'Escape') {
      this.stroke = null;
      this.draft = [];
      this.drag = null;
      this.selectedId = null;
      this.render();
      this.renderProperties();
    }
  };

  // ----------------------------------------------------------- инструменты

  private selectAt(info: PointerInfo): void {
    const plot = this.plotAt(info.world);

    this.selectedId = plot?.id ?? null;
    this.drag = plot ? { id: plot.id, origin: info.world, snapshot: cloneScene(plot), moved: false } : null;
    this.render();
    this.renderProperties();
  }

  /** Сдвиг перетаскивания: опорная точка графика прилипает к сетке, Shift отключает. */
  private dragDelta(info: PointerInfo): Vec2 {
    if (!this.drag) return [0, 0];

    const raw: Vec2 = [info.world[0] - this.drag.origin[0], info.world[1] - this.drag.origin[1]];

    if (info.shift) return raw;

    const anchor = anchorOf(this.drag.snapshot);

    if (!anchor) return snapToGrid(raw, GRID_STEP);

    const target = snapToGrid([anchor[0] + raw[0], anchor[1] + raw[1]], GRID_STEP);

    return [target[0] - anchor[0], target[1] - anchor[1]];
  }

  /** Штрих карандаша → прямая, окружность, парабола или ломаная; слишком короткий штрих отбрасывается. */
  private finishStroke(points: Vec2[], info: PointerInfo): void {
    if (points.length < 3 || strokeSpan(points) < this.canvas.hitRadius) {
      this.renderOverlay();

      return;
    }

    const shape = recognizeStroke(points);
    const id = this.nextId();
    const snap = (point: Vec2): Vec2 => this.snap(point, info);

    switch (shape.type) {
      case 'line':
        this.addPlot({ id, type: 'line', p1: snap(shape.p1), p2: snap(shape.p2) });
        break;
      case 'circle':
        this.addPlot({ id, type: 'circle', center: snap(shape.center), radius: Math.max(MIN_RADIUS, roundTo(shape.radius)) });
        break;
      case 'parabola':
        this.addPlot({
          id,
          type: 'parabola',
          vertex: snap(shape.vertex),
          direction: shape.direction,
          stretchX: 1,
          stretchY: Math.max(MIN_STRETCH, roundTo(shape.stretchY)),
        });
        break;
      default:
        this.addPlot({ id, type: 'freehand', points: shape.points.map((point) => roundPoint(point)) });
        break;
    }
  }

  private closeShading(): void {
    if (this.draft.length < 3) {
      this.renderOverlay();

      return;
    }

    const points = this.draft;

    this.draft = [];
    this.addPlot({ id: this.nextId(), type: 'shading', points });
  }

  /** Подпись графика под курсором: выделяет его и ставит фокус в поле «Метка». */
  private editLabelAt(info: PointerInfo): void {
    const plot = this.plotAt(info.world);

    if (!plot) return;

    this.selectedId = plot.id;
    this.render();
    this.renderProperties();
    this.properties.querySelector<HTMLInputElement>('input[data-autofocus]')?.focus();
  }

  private copySelected(): void {
    const plot = this.selectedPlot();

    if (plot) this.clipboard = cloneScene(plot);
  }

  /** Вставка со сдвигом; буфер становится вставленной копией, чтобы повторная вставка шла лесенкой. */
  private paste(): void {
    if (!this.clipboard) return;

    const plot = translatePlot({ ...cloneScene(this.clipboard), id: this.nextId() }, PASTE_OFFSET);

    this.clipboard = cloneScene(plot);
    this.addPlot(plot);
  }

  private deleteSelection(): void {
    const { selectedId } = this;

    if (selectedId === null) return;

    this.commit((state) => {
      state.plots = state.plots.filter((plot) => plot.id !== selectedId);
    });
  }

  // --------------------------------------------------------- панель свойств

  private updatePlot<T extends PlotItem>(target: T, mutate: (draft: T) => void): void {
    this.commit((state) => {
      const draft = state.plots.find((plot) => plot.id === target.id);

      if (draft && draft.type === target.type) mutate(draft as T);
    });
  }

  private renderProperties(): void {
    const { t } = this;

    this.properties.replaceChildren();

    const plot = this.selectedPlot();

    if (!plot) {
      this.renderAxesProperties();

      return;
    }

    this.properties.appendChild(el('h4', { class: 'rte-builder__props-title', text: t(`drawings_plots_selected_${plot.type}`) }));
    this.appendColorFields(plot);

    if (plot.type !== 'point' && plot.type !== 'shading') {
      this.appendCheckbox(t('drawings_prop_dashed'), plot.style === 'dashed', (checked) =>
        this.updatePlot(plot, (draft) => {
          draft.style = checked ? 'dashed' : 'solid';
        }),
      );
    }

    this.appendText(
      t('drawings_prop_label'),
      plot.label ?? '',
      (value) =>
        this.updatePlot(plot, (draft) => {
          draft.label = value || undefined;
        }),
      true,
    );

    switch (plot.type) {
      case 'parabola':
        this.appendSelect(t('drawings_plots_prop_direction'), this.directionOptions('up', 'down'), plot.direction, (value) =>
          this.updatePlot(plot, (draft) => {
            draft.direction = value === 'down' ? 'down' : 'up';
          }),
        );
        this.appendNumber(t('drawings_plots_prop_stretch_x'), plot.stretchX, (value) =>
          this.updatePlot(plot, (draft) => {
            draft.stretchX = Math.max(MIN_STRETCH, value);
          }),
        );
        this.appendNumber(t('drawings_plots_prop_stretch_y'), plot.stretchY, (value) =>
          this.updatePlot(plot, (draft) => {
            draft.stretchY = Math.max(MIN_STRETCH, value);
          }),
        );
        this.appendDomain(plot);
        break;
      case 'sqrt':
        this.appendSelect(t('drawings_plots_prop_direction_x'), this.directionOptions('right', 'left'), plot.directionX, (value) =>
          this.updatePlot(plot, (draft) => {
            draft.directionX = value === 'left' ? 'left' : 'right';
          }),
        );
        this.appendSelect(t('drawings_plots_prop_direction_y'), this.directionOptions('up', 'down'), plot.directionY, (value) =>
          this.updatePlot(plot, (draft) => {
            draft.directionY = value === 'down' ? 'down' : 'up';
          }),
        );
        this.appendNumber(t('drawings_plots_prop_stretch'), plot.stretch, (value) =>
          this.updatePlot(plot, (draft) => {
            draft.stretch = Math.max(MIN_STRETCH, value);
          }),
        );
        this.appendDomain(plot);
        break;
      case 'hyperbola':
        this.appendNumber(
          t('drawings_plots_prop_k'),
          plot.k,
          (value) =>
            this.updatePlot(plot, (draft) => {
              draft.k = value;
            }),
          (value) => value !== 0,
        );
        this.appendDomain(plot);
        break;
      case 'circle':
        this.appendNumber(
          t('drawings_prop_radius'),
          plot.radius,
          (value) =>
            this.updatePlot(plot, (draft) => {
              draft.radius = value;
            }),
          (value) => value >= MIN_RADIUS,
        );
        this.appendCheckbox(t('drawings_plots_prop_fill'), plot.fill === true, (checked) =>
          this.updatePlot(plot, (draft) => {
            draft.fill = checked;
          }),
        );
        break;
      case 'point':
        this.appendCheckbox(t('drawings_plots_prop_hollow'), plot.pointStyle === 'hollow', (checked) =>
          this.updatePlot(plot, (draft) => {
            draft.pointStyle = checked ? 'hollow' : 'solid';
          }),
        );
        break;
      case 'line':
        if (plot.p1 && plot.p2) {
          this.appendPoint(t('drawings_plots_prop_p1'), plot.p1, (point) =>
            this.updatePlot(plot, (draft) => {
              draft.p1 = point;
            }),
          );
          this.appendPoint(t('drawings_plots_prop_p2'), plot.p2, (point) =>
            this.updatePlot(plot, (draft) => {
              draft.p2 = point;
            }),
          );
        } else {
          this.appendNumber(t('drawings_plots_prop_k'), plot.k ?? 0, (value) =>
            this.updatePlot(plot, (draft) => {
              draft.k = value;
            }),
          );
          this.appendNumber(t('drawings_plots_prop_b'), plot.b ?? 0, (value) =>
            this.updatePlot(plot, (draft) => {
              draft.b = value;
            }),
          );
          this.appendDomain(plot);
        }
        break;
      default:
        break;
    }

    const remove = el('button', { class: 'rte-button rte-button--danger rte-builder__remove', attrs: { type: 'button' }, text: t('drawings_remove_selected') });

    remove.addEventListener('click', () => this.deleteSelection());
    this.properties.appendChild(remove);
  }

  /** Без выделения панель показывает оси: подписи и числа на них. */
  private renderAxesProperties(): void {
    const { t, state } = this;

    this.properties.append(
      el('p', { class: 'rte-builder__props-empty', text: t('drawings_nothing_selected') }),
      el('h4', { class: 'rte-builder__props-title', text: t('drawings_plots_axes') }),
    );
    this.appendText(t('drawings_plots_prop_x_label'), state.xLabel, (value) =>
      this.commit((draft) => {
        draft.xLabel = value;
      }),
    );
    this.appendText(t('drawings_plots_prop_y_label'), state.yLabel, (value) =>
      this.commit((draft) => {
        draft.yLabel = value;
      }),
    );
    this.appendCheckbox(t('drawings_plots_prop_ticks'), state.showAxesTicks, (checked) =>
      this.commit((draft) => {
        draft.showAxesTicks = checked;
      }),
    );
  }

  private directionOptions(...values: Array<'up' | 'down' | 'left' | 'right'>): Array<{ value: string; label: string }> {
    return values.map((value) => ({ value, label: this.t(`drawings_plots_${value}`) }));
  }

  /** Цвет: именованный из списка или любой hex; пустой hex возвращает цвет по умолчанию. */
  private appendColorFields(plot: PlotItem): void {
    const { t } = this;
    const current = (plot.color ?? '').toLowerCase();
    const options = NAMED_COLORS.map((color) => ({ value: color.value, label: t(`drawings_plots_color_${color.id}`) }));

    if (current && !NAMED_COLORS.some((color) => color.value === current)) options.push({ value: current, label: current });

    const select = selectControl(options, current || NAMED_COLORS[0].value);

    select.addEventListener('change', () =>
      this.updatePlot(plot, (draft) => {
        draft.color = select.value;
      }),
    );
    this.properties.appendChild(propertyField(t('drawings_prop_color'), select));

    const hex = el('input', { class: 'rte-input', attrs: { type: 'text', value: plot.color ?? '', placeholder: NAMED_COLORS[0].value, maxlength: 7, spellcheck: 'false' } });

    hex.addEventListener('change', () => {
      const value = hex.value.trim().toLowerCase();

      if (value !== '' && !HEX_COLOR.test(value)) {
        this.renderProperties();

        return;
      }

      this.updatePlot(plot, (draft) => {
        draft.color = value || undefined;
      });
    });
    this.properties.appendChild(propertyField(t('drawings_plots_prop_hex'), hex));
  }

  private appendText(label: string, value: string, apply: (value: string) => void, autofocus = false): void {
    const input = el('input', { class: 'rte-input', attrs: { type: 'text', value, 'data-autofocus': autofocus } });

    input.addEventListener('change', () => apply(input.value.trim()));
    this.properties.appendChild(propertyField(label, input));
  }

  private appendNumber(label: string, value: number, apply: (value: number) => void, accept: (value: number) => boolean = () => true): void {
    const input = el('input', { class: 'rte-input', attrs: { type: 'number', step: '0.5', value: String(value) } });

    input.addEventListener('change', () => {
      const next = Number(input.value);

      if (input.value.trim() === '' || !Number.isFinite(next) || !accept(next)) {
        this.renderProperties();

        return;
      }

      apply(roundTo(next));
    });
    this.properties.appendChild(propertyField(label, input));
  }

  private appendSelect(label: string, options: Array<{ value: string; label: string }>, value: string, apply: (value: string) => void): void {
    const select = selectControl(options, value);

    select.addEventListener('change', () => apply(select.value));
    this.properties.appendChild(propertyField(label, select));
  }

  private appendCheckbox(label: string, checked: boolean, apply: (checked: boolean) => void): void {
    const input = el('input', { attrs: { type: 'checkbox' } });

    input.checked = checked;
    input.addEventListener('change', () => apply(input.checked));
    this.properties.appendChild(
      el('label', { class: 'rte-builder__prop rte-plots__check', children: [input, el('span', { class: 'rte-builder__prop-label', text: label })] }),
    );
  }

  /** Два числовых поля в строку: координаты точки или границы области. */
  private appendPair(label: string, values: [string, string], apply: (values: [string, string]) => void): void {
    const inputs = values.map((value) => el('input', { class: 'rte-input', attrs: { type: 'number', step: '0.5', value } }));
    const pair = el('div', { class: 'rte-plots__pair', children: inputs });

    inputs.forEach((input) => input.addEventListener('change', () => apply([inputs[0].value, inputs[1].value])));
    this.properties.appendChild(propertyField(label, pair));
  }

  private appendPoint(label: string, point: Vec2, apply: (point: Vec2) => void): void {
    this.appendPair(label, [String(point[0]), String(point[1])], ([x, y]) => {
      const next: Vec2 = [Number(x), Number(y)];

      if (x.trim() === '' || y.trim() === '' || !next.every(Number.isFinite)) {
        this.renderProperties();

        return;
      }

      apply(roundPoint(next));
    });
  }

  /** Область по x: пустое поле — граница в бесконечности, оба пустые — без ограничения. */
  private appendDomain(plot: DomainPlot): void {
    const show = (value: number | undefined): string => (value === undefined || !Number.isFinite(value) ? '' : String(value));
    const bound = (text: string, open: number): number => {
      const value = Number(text);

      return text.trim() === '' || !Number.isFinite(value) ? open : roundTo(value);
    };

    this.appendPair(this.t('drawings_plots_prop_domain'), [show(plot.domain?.[0]), show(plot.domain?.[1])], ([low, high]) => {
      const from = bound(low, -Infinity);
      const to = bound(high, Infinity);
      const domain: [number, number] | undefined = from === -Infinity && to === Infinity ? undefined : [Math.min(from, to), Math.max(from, to)];

      this.updatePlot(plot, (draft) => {
        draft.domain = domain;
      });
    });
  }
}

export const plotsEditorFactory: SceneEditorFactory = {
  id: 'plots',
  kind: 'geometry',
  labelKey: 'drawings_tab_plots',
  accepts: (scene) => normalizeGeometryScene(scene).type === 'plot_2d',
  create: (context) => new PlotsEditor(context),
};
