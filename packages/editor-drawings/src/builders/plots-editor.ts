import { el, type Translate, type Unsubscribe } from '@rich-editor/core';
import { renderGeometrySvg, resolveGeometryViewport } from '../render/geometry-svg';
import { fmt, pointsAttr } from '../render/svg-builder';
import { normalizeGeometryScene } from '../scene/normalize';
import type { GeometryHighlight, GeometryScene, Plot, Vec2 } from '../scene/types';
import type { BuilderIconId } from './builder-icons';
import { DRAWING_COLORS, DRAWING_COLOR_HEX } from './color-picker';
import { checkField, colorField, numberField, pairField, propsEmpty, propsTitle, textField, type NumberPair } from './fields';
import { functionLabelText, parseFunction, sameLabel } from './function-expr';
import { FunctionPanel, type FunctionNotice, type FunctionView } from './function-panel';
import { sampleFunction } from './function-sampler';
import { distance, distanceToSegment, recognizeStroke, roundPoint, roundTo, snapToGrid } from './geometry-utils';
import { HistoryStack, cloneScene } from './history';
import { FINE_DIGITS, MIN_RADIUS, MIN_STRETCH, isReadyFunction, plotExpression } from './plot-functions';
import { ChangeEmitter, isCancelled, SketchCanvas, type PointerInfo } from './sketch-canvas';
import { ToolBar, actionButton, toolIcon, type ToolButton } from './tool-bar';
import type { RawScene, SceneEditor, SceneEditorContext, SceneEditorFactory } from './types';

type Tool = 'select' | 'point' | 'pencil' | 'shading' | 'text' | 'delete';

const TOOLS: ToolButton<Tool>[] = [
  { id: 'select', labelKey: 'drawings_tool_select', icon: 'select' },
  { id: 'point', labelKey: 'drawings_tool_point', icon: 'point' },
  { id: 'pencil', labelKey: 'drawings_tool_pencil', icon: 'pencil' },
  { id: 'shading', labelKey: 'drawings_tool_shading', icon: 'shading' },
  { id: 'text', labelKey: 'drawings_tool_text', icon: 'text' },
  { id: 'delete', labelKey: 'drawings_tool_delete', icon: 'delete' },
];

type TemplateId = 'parabola' | 'hyperbola' | 'line' | 'sqrt' | 'sine' | 'abs' | 'circle';

const TEMPLATES: TemplateId[] = ['parabola', 'hyperbola', 'line', 'sqrt', 'sine', 'abs', 'circle'];

/** Значки шаблонов в палитре: по форме кривой. */
const TEMPLATE_ICONS: Record<TemplateId, BuilderIconId> = {
  parabola: 'parabola',
  hyperbola: 'hyperbola',
  line: 'lineFn',
  sqrt: 'root',
  sine: 'sine',
  abs: 'modulus',
  circle: 'plotCircle',
};

/** Цвета шаблонов — из палитры, те же оттенки, что в оригинале: по цвету ученик узнаёт вид графика. */
const TEMPLATE_COLORS: Record<TemplateId, string> = {
  parabola: DRAWING_COLOR_HEX.blue,
  hyperbola: DRAWING_COLOR_HEX.green,
  line: DRAWING_COLOR_HEX.red,
  sqrt: DRAWING_COLOR_HEX.purple,
  sine: DRAWING_COLOR_HEX.cyan,
  abs: DRAWING_COLOR_HEX.pink,
  circle: DRAWING_COLOR_HEX.orange,
};

/** Шаблоны-функции: запись, с которой открывается набранная функция. Окружность — готовая кривая. */
const TEMPLATE_EXPRESSIONS: Partial<Record<TemplateId, string>> = {
  parabola: 'x^2',
  hyperbola: '1/x',
  line: 'x',
  sqrt: 'sqrt(x)',
  sine: 'sin(x)',
  abs: '|x|',
};

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

/** Поля сцены, которые конструктор понимает; остальные уходят обратно нетронутыми. */
const KNOWN_SCENE_KEYS = new Set(['type', 'plots', 'axes', 'circle', 'circles', 'showGrid', 'grid', 'showAxesTicks', 'scale', 'offsetX', 'offsetY']);

/** Поля ветви набранной функции: их понимает только конструктор, остальные читатели сцены пропускают. */
const FUNCTION_KEYS = ['expr', 'params', 'fn'];

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

/**
 * Набранная функция: один объект конструктора, в сцене — ветви `freehand`
 * с полями `expr`, `params`, `fn`, `domain` (подпись — только у первой).
 */
interface FunctionItem {
  id: string;
  type: 'function';
  /** Запись, как её набрали; пустая — функция ещё не набрана и в сцену не попадает. */
  expr: string;
  params: Record<string, number>;
  /** Общий идентификатор ветвей одной функции. */
  fn: string;
  domain?: [number, number];
  color?: string;
  style?: 'solid' | 'dashed';
  label?: string;
  /** Ветви под текущий вид полотна, а если в видимом окне графика нет — из запасного окна (см. `sample`). */
  branches: Vec2[][];
  /** Где нашлись ветви при последнем пересчёте; у загруженных дословно — не задано. */
  reach?: Reach;
  /** Ветви, как их загрузили: пока функцию не правили и вид не меняли, сцена отдаёт их дословно. */
  loaded?: RawScene[];
  /** Чужие поля первой ветви. */
  extra?: RawScene;
}

/**
 * Где нашлись ветви функции: в видимом окне; только в запасном — график за
 * краем листа, но в сцену пишется; нигде — точек у функции нет.
 */
type Reach = 'visible' | 'outside' | 'none';

/** Значения запасного окна не выше этого по модулю: обрезки по высоте как бы нет, но ветви конечны. */
const FALLBACK_HEIGHT = 1e4;
/** Отрезок по x запасного окна, если на видимом отрезке точек нет. */
const FALLBACK_WIDTH: [number, number] = [-100, 100];

/** Элемент конструктора: график сцены или набранная функция. */
type Item = PlotItem | FunctionItem;

/** Набранная функция или готовая кривая, записанная функцией: у них блок «Функция». */
type FunctionLike = FunctionItem | Extract<PlotItem, { type: 'line' | 'parabola' | 'hyperbola' | 'sqrt' }>;

const isFunctionItem = (item: Item): item is FunctionItem => item.type === 'function';

const hasFunctionBlock = (item: Item): item is FunctionLike => isFunctionItem(item) || isReadyFunction(item);

interface PlotsState {
  plots: Item[];
  xLabel: string;
  yLabel: string;
  showGrid: boolean;
  showAxesTicks: boolean;
  /** Поля сцены, которых конструктор не знает: уходят обратно нетронутыми. */
  extra: RawScene;
  /** Id кривых и функций, чья подпись — их формула и следует за ней. Не в сцене: только в конструкторе и истории. */
  formulaLabels: string[];
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
      // Вершина и растяжения — с запасом знаков: из них выводятся `b` и `c` общего вида.
      out.vertex = roundPoint(plot.vertex, FINE_DIGITS);
      out.direction = plot.direction;
      out.stretchX = roundTo(plot.stretchX, FINE_DIGITS);
      out.stretchY = roundTo(plot.stretchY, FINE_DIGITS);
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
        // Точки — с запасом знаков: из них выводятся `k` и `b`.
        out.p1 = roundPoint(plot.p1, FINE_DIGITS);
        out.p2 = roundPoint(plot.p2, FINE_DIGITS);
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

/**
 * Ветви набранной функции в формате сцены. Нетронутая функция отдаётся
 * дословно, как её загрузили; пустая в сцену не попадает. `forCanvas` —
 * сцена для полотна: у всех ветвей id функции, чтобы подсветка выделения
 * легла на каждую ветвь.
 */
const serializeFunction = (item: FunctionItem, forCanvas: boolean): RawScene[] => {
  if (item.loaded && !forCanvas) return cloneScene(item.loaded);

  if (item.expr === '') return [];

  return item.branches.map((points, index) => {
    const out: RawScene = { ...(item.extra ?? {}), id: index === 0 || forCanvas ? item.id : `${item.id}_${index + 1}`, type: 'freehand' };

    if (item.color) out.color = item.color;

    // Подпись — у первой ветви: иначе она повторилась бы у каждой.
    if (item.label && index === 0) out.label = item.label;

    out.style = item.style === 'dashed' ? 'dashed' : 'solid';
    out.points = points.map(([x, y]) => [x, y]);
    out.expr = item.expr;

    if (Object.keys(item.params).length > 0) out.params = { ...item.params };

    out.fn = item.fn;

    if (item.domain) out.domain = serializeDomain(item.domain);

    return out;
  });
};

const serializeItem = (item: Item, forCanvas = false): RawScene[] => (isFunctionItem(item) ? serializeFunction(item, forCanvas) : [serializePlot(item)]);

/** Значения параметров из сцены: только конечные числа. */
const readParams = (raw: unknown): Record<string, number> => {
  const params: Record<string, number> = {};

  if (isRecord(raw)) {
    Object.entries(raw).forEach(([name, value]) => {
      if (typeof value === 'number' && Number.isFinite(value)) params[name] = value;
    });
  }

  return params;
};

/** Область из сцены: `null` — бесконечный конец; иное — без области. */
const readDomain = (raw: unknown): [number, number] | undefined => {
  if (!Array.isArray(raw) || raw.length !== 2) return undefined;

  const [low, high] = raw.map((value: unknown, index) => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;

    return index === 0 ? -Infinity : Infinity;
  });

  return low === undefined || high === undefined || (low === -Infinity && high === Infinity) ? undefined : [low, high];
};

const shiftDomain = (domain: [number, number] | undefined, dx: number): [number, number] | undefined =>
  domain ? [Number.isFinite(domain[0]) ? roundTo(domain[0] + dx) : domain[0], Number.isFinite(domain[1]) ? roundTo(domain[1] + dx) : domain[1]] : undefined;

/** Копия графика, сдвинутая целиком: так двигает перетаскивание и вставка. Набранную функцию сдвигает только её запись. */
const translatePlot = (plot: Item, [dx, dy]: Vec2): Item => {
  const shift = (point: Vec2): Vec2 => roundPoint([point[0] + dx, point[1] + dy]);
  const shiftFine = (point: Vec2): Vec2 => roundPoint([point[0] + dx, point[1] + dy], FINE_DIGITS);

  switch (plot.type) {
    case 'point':
      return { ...plot, coords: shift(plot.coords) };
    case 'circle':
      return { ...plot, center: shift(plot.center) };
    case 'hyperbola':
      return { ...plot, center: shift(plot.center), domain: shiftDomain(plot.domain, dx) };
    case 'parabola':
      return { ...plot, vertex: shiftFine(plot.vertex), domain: shiftDomain(plot.domain, dx) };
    case 'sqrt':
      return { ...plot, vertex: shift(plot.vertex), domain: shiftDomain(plot.domain, dx) };
    case 'line':
      if (plot.p1 && plot.p2) return { ...plot, p1: shiftFine(plot.p1), p2: shiftFine(plot.p2) };

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
const anchorOf = (plot: Item): Vec2 | null => {
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
const handlesOf = (plot: Item): Vec2[] => {
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
  const [first] = points;
  const last = points[points.length - 1];

  if (!first || !last) return Infinity;

  if (points.length === 1) return distance(p, first);

  let best = Infinity;

  for (let i = 1; i < points.length; i += 1) {
    const start = points[i - 1];
    const end = points[i];

    if (start && end) best = Math.min(best, distanceToSegment(p, start, end));
  }

  if (closed) best = Math.min(best, distanceToSegment(p, last, first));

  return best;
};

/** Точка внутри многоугольника: луч вправо пересекает контур нечётное число раз. */
const isInsidePolygon = ([x, y]: Vec2, polygon: Vec2[]): boolean => {
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const current = polygon[i];
    const previous = polygon[j];

    if (current && previous) {
      const [xi, yi] = current;
      const [xj, yj] = previous;

      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
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
    const run = runs[runs.length - 1];

    if (!run) return;

    if (point) run.push(point);
    else if (run.length > 0) runs.push([]);
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
const plotDistance = (plot: Item, p: Vec2): number => {
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
    case 'function':
      return Math.min(Infinity, ...plot.branches.map((branch) => distanceToPolyline(p, branch)));
    case 'shading': {
      const polygon = shadingPolygon(plot);

      return isInsidePolygon(p, polygon) ? 0 : distanceToPolyline(p, polygon, true);
    }
    default:
      return Infinity;
  }
};

/** Точки важнее кривых, кривые важнее областей: точка на параболе выбирается первой. */
const hitRank = (plot: Item): number => (plot.type === 'point' ? 0 : plot.type === 'shading' ? 2 : 1);

/** Сообщение под полем записи: точек нет вовсе или график за краем листа. */
const noticeOf = (item: FunctionItem): FunctionNotice => {
  if (item.expr === '' || item.loaded) return null;

  if (item.reach === 'none') return 'none';

  return item.reach === 'outside' ? 'outside' : null;
};

/** Новая набранная функция: ветви считаются под вид полотна отдельно. */
const newFunction = (id: string, expr: string, color: string | undefined): FunctionItem => ({
  id,
  type: 'function',
  expr,
  params: {},
  fn: id,
  branches: [],
  ...(color ? { color } : {}),
});

/** Размах штриха: больший из размеров его охватывающего прямоугольника. */
const strokeSpan = (points: Vec2[]): number => {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);

  return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
};

/**
 * Конструктор графиков функций: набранные функции, шаблоны кривых, точки,
 * штриховка и карандаш, который распознаёт прямую, окружность и параболу.
 *
 * Инструмент, штрих, черновик области, выделение, буфер копирования,
 * идущая правка функции и история — общее состояние обработчиков указателя,
 * клавиатуры и панели свойств, поэтому класс.
 */
class PlotsEditor implements SceneEditor {
  readonly element: HTMLElement;

  private readonly t: Translate;

  private readonly changes = new ChangeEmitter();

  private readonly history = new HistoryStack<PlotsState>();

  private readonly canvas: SketchCanvas;

  private readonly tools: ToolBar<Tool>;

  private readonly hint: HTMLElement;

  /** Палитра шаблонов: при выделенной функции — одна строка значков, чтобы блоку «Функция» хватило места. */
  private readonly palette: HTMLElement;

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

  private drag: { id: string; origin: Vec2; snapshot: Item; moved: boolean } | null = null;

  private clipboard: Item | null = null;

  /** Десятичный разделитель в записях: `,` или `.` — из таблицы переводов. */
  private readonly separator: string;

  /** Блок «Функция»: живёт всё время, пересобирается при смене выделения. */
  private readonly functionPanel: FunctionPanel;

  /** Заголовок панели свойств: у готовой кривой, ставшей функцией, меняется на месте. */
  private propsHeading: HTMLElement | null = null;

  /** Поле «Метка» выделенного графика: подпись-формула обновляется в нём на месте. */
  private labelInput: HTMLInputElement | null = null;

  /** Сцена в начале правки записи или жеста ползунка параметра: шаг истории пишется по итогу. */
  private editFrom: PlotsState | null = null;

  /** Пересчёт ветвей функций под новый вид полотна — не чаще раза в кадр. */
  private resampleFrame: number | null = null;

  /** Вид меняет сам конструктор (подбор при загрузке): ветви загруженных функций остаются как были. */
  private quietView = false;

  constructor(context: SceneEditorContext) {
    this.t = context.t;
    this.separator = this.t('drawings_decimal_separator');
    this.functionPanel = new FunctionPanel({
      t: this.t,
      separator: this.separator,
      onInput: (expr, params, first) => this.typeFunction(expr, params, first),
      onCommit: () => this.finishEdit(),
      onRevert: () => this.revertEdit(),
      onParamSlide: (name, value, first) => this.slideParam(name, value, first),
      onParamRelease: () => this.finishEdit(),
      onParamChange: (name, value) => this.changeParam(name, value),
      onDomain: (domain) => this.setDomain(domain),
      onFormulaLabel: (checked) => this.setFormulaLabel(checked),
    });

    this.canvas = new SketchCanvas({
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      scale: DEFAULT_SCALE,
      onPointerDown: this.onPointerDown,
      onPointerMove: this.onPointerMove,
      onPointerUp: this.onPointerUp,
      onDoubleClick: this.onDoubleClick,
      onKeyDown: this.onKeyDown,
      onViewportChange: () => this.viewChanged(),
      canPanFrom: this.canPanFrom,
      grabOnHover: () => this.tool === 'select',
    });

    this.tools = new ToolBar<Tool>({ t: this.t, tools: TOOLS, onSelect: (tool) => this.setTool(tool) });

    const actions = el('div', {
      class: 'rte-builder__actions',
      children: [
        actionButton(this.t('drawings_undo'), 'undo', () => this.undo()),
        actionButton(this.t('drawings_redo'), 'redo', () => this.redo()),
        actionButton(this.t('drawings_plots_copy'), 'copy', () => this.copySelected()),
        actionButton(this.t('drawings_plots_paste'), 'paste', () => this.paste()),
        actionButton(this.t('drawings_grid'), 'grid', () => this.toggleGrid()),
        actionButton(this.t('drawings_zoom_in'), 'zoomIn', () => this.canvas.zoomBy(1.25)),
        actionButton(this.t('drawings_zoom_out'), 'zoomOut', () => this.canvas.zoomBy(0.8)),
        actionButton(this.t('drawings_zoom_reset'), 'fit', () => this.fitView()),
      ],
    });

    // «+ Функция» — первой в палитре, над шаблонами: заметна и при свёрнутой палитре.
    const addFunction = el('button', {
      class: 'rte-button rte-plots__add',
      attrs: { type: 'button', 'data-plot-add': 'function' },
      text: this.t('drawings_plots_fn_add'),
    });

    addFunction.addEventListener('click', () => this.addFunction());

    this.palette = el('div', {
      class: 'rte-builder__palette rte-plots__palette',
      attrs: { role: 'group', 'aria-label': this.t('drawings_plots_templates') },
      children: [addFunction],
    });

    TEMPLATES.forEach((template) => {
      const label = this.t(`drawings_plots_template_${template}`);
      // Имя кнопки — в `aria-label`: в строке значков подпись скрыта.
      const button = el('button', {
        class: 'rte-builder__tool rte-plots__template',
        attrs: { type: 'button', title: label, 'aria-label': label, 'data-plot-template': template },
        children: [toolIcon(TEMPLATE_ICONS[template]), el('span', { class: 'rte-builder__tool-label', text: label })],
      });

      button.addEventListener('click', () => this.addTemplate(template));
      this.palette.appendChild(button);
    });

    this.hint = el('p', { class: 'rte-builder__hint', attrs: { role: 'status' } });
    this.properties = el('div', { class: 'rte-builder__props', attrs: { 'aria-live': 'polite' } });

    this.element = el('div', {
      class: 'rte-builder rte-builder--plots',
      children: [
        el('div', { class: 'rte-builder__bar', children: [this.tools.element, actions] }),
        this.palette,
        el('div', {
          class: 'rte-builder__body',
          children: [el('div', { class: 'rte-builder__stage', children: [this.canvas.element] }), this.properties],
        }),
        this.hint,
      ],
    });

    this.setTool('select');
    this.render();
    this.renderProperties();
  }

  static emptyState(): PlotsState {
    return { plots: [], xLabel: 'x', yLabel: 'y', showGrid: true, showAxesTicks: true, extra: {}, formulaLabels: [] };
  }

  // ----------------------------------------------------------- SceneEditor

  load(raw: RawScene): void {
    const scene = normalizeGeometryScene(raw);
    const rawPlots = Array.isArray(raw.plots) ? raw.plots : [];
    const used = new Set<string>();
    const plots: Item[] = [];
    /** Функции по `fn` (как в сцене) и записи: их ветви собираются в один объект. */
    const functions = new Map<string, FunctionItem>();
    let adopted = 0;

    // Графики нормализуются по одному: так известно, из какого сырого объекта
    // вышел каждый, и его чужие поля можно сохранить.
    rawPlots.forEach((item) => {
      const [plot] = normalizeGeometryScene({ type: 'plot_2d', vertices: raw.vertices, plots: [item] }).plots;

      if (plot) adopted += 1;

      if (this.adoptBranch(item, plot, used, functions, plots)) return;

      if (plot) plots.push(this.adoptPlot(plot, used, extraOf(item, KNOWN_PLOT_KEYS)));
    });

    // Окружности верхнего уровня (`circle`/`circles`) нормализация дописывает после списка.
    scene.plots.slice(adopted).forEach((plot) => plots.push(this.adoptPlot(plot, used)));

    this.state = {
      plots,
      xLabel: scene.axes.xLabel,
      yLabel: scene.axes.yLabel,
      showGrid: scene.showGrid,
      showAxesTicks: scene.showAxesTicks,
      extra: extraOf(raw, KNOWN_SCENE_KEYS),
      // Подпись, уже равная формуле, — признак подписи-формулы (как у величины угла). Сама подпись не меняется.
      formulaLabels: plots.filter((item) => item.label !== undefined && sameLabel(item.label, this.formulaLabel(item) ?? undefined)).map((item) => item.id),
    };
    this.history.clear();
    this.selectedId = null;
    this.stroke = null;
    this.draft = [];
    this.drag = null;
    this.editFrom = null;
    // Жест, начатый над прежней сценой, в новую не переходит.
    this.canvas.resetGestures();
    // Подбор вида при загрузке — не правка: ветви функций остаются дословно такими, как пришли.
    this.quietView = true;
    this.fitView();
    this.quietView = false;
    this.renderProperties();
  }

  getScene(): RawScene {
    const { state } = this;

    // Новый вид полотна, ещё не пересчитанный к кадру, — в сцену уже с новыми ветвями.
    if (this.resampleFrame !== null) {
      this.resampleAll();
      this.refreshNotice();
    }

    const scene: RawScene = {
      ...state.extra,
      type: 'plot_2d',
      axes: { x_label: state.xLabel, y_label: state.yLabel },
      plots: state.plots.flatMap((item) => serializeItem(item)),
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

  /** Escape: штрих, черновик области и выделение — прочь, инструмент — «Выбрать». */
  cancel(): void {
    // Перетаскивание, уже сдвинувшее график, откатывается: график — на прежнем месте, шага истории нет.
    this.cancelDrag();
    this.canvas.cancelPan();
    this.select(null);
    this.setTool('select');
    this.render();
    this.renderProperties();
  }

  destroy(): void {
    this.cancelResample();
    this.changes.clear();
    this.tools.destroy();
    this.canvas.destroy();
    this.element.remove();
  }

  // --------------------------------------------------------------- рендер

  /** Сцена для рендера: окно просмотра полотна вместо autoFit; у ветвей функции — её id для подсветки. */
  private renderScene(): GeometryScene {
    const { viewport } = this.canvas;
    const { state } = this;

    return {
      ...normalizeGeometryScene({ ...this.getScene(), plots: state.plots.flatMap((item) => serializeItem(item, true)) }),
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

      const last = points[points.length - 1];

      if (this.cursor && last) {
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

  // ----------------------------------------------------- набранные функции

  /** Видимое окно полотна в координатах мира. */
  private visibleWindow(): { from: number; to: number; yFrom: number; yTo: number } {
    const { scale, cx, cy } = this.canvas.viewport;

    return { from: -cx / scale, to: (CANVAS_WIDTH - cx) / scale, yFrom: (cy - CANVAS_HEIGHT) / scale, yTo: cy / scale };
  }

  /**
   * Ветви функции под текущий вид полотна; запись не разбирается — ветвей нет.
   * Если в видимом окне графика нет, ветви для сцены — из запасного окна: тот
   * же отрезок по x без обрезки по высоте, затем x от −100 до 100 — иначе
   * правильная функция за краем листа (`x^2 + 100`) пропала бы из сцены.
   */
  private sample(item: FunctionItem): { branches: Vec2[][]; reach: Reach } {
    const parsed = parseFunction(item.expr);

    if (!parsed.ok) return { branches: [], reach: 'none' };

    const visible = this.visibleWindow();
    // Точность упрощения — полпикселя полотна.
    const common = { domain: item.domain, tolerance: 0.5 / this.canvas.viewport.scale };
    const branches = sampleFunction(parsed.ast, item.params, { ...visible, ...common });

    if (branches.length > 0) return { branches, reach: 'visible' };

    const tall = { yFrom: -FALLBACK_HEIGHT, yTo: FALLBACK_HEIGHT };
    const [from, to] = FALLBACK_WIDTH;
    const nearby = sampleFunction(parsed.ast, item.params, { from: visible.from, to: visible.to, ...tall, ...common });
    const outside = nearby.length > 0 ? nearby : sampleFunction(parsed.ast, item.params, { from, to, ...tall, ...common });

    return { branches: outside, reach: outside.length > 0 ? 'outside' : 'none' };
  }

  /** Функция с ветвями под текущий вид (или запасными). */
  private withBranches(item: FunctionItem): FunctionItem {
    const { branches, reach } = this.sample(item);

    return { ...item, branches, reach };
  }

  /** Функция после правки: ветви заново, загруженные ветви больше не отдаются дословно. */
  private resampled(item: FunctionItem): FunctionItem {
    const next: FunctionItem = { ...item };

    delete next.loaded;

    return this.withBranches(next);
  }

  /** Вид полотна изменился: картинка — сразу, ветви функций — к следующему кадру. */
  private viewChanged(): void {
    this.render();

    if (this.quietView || this.resampleFrame !== null || !this.state.plots.some(isFunctionItem)) return;

    const schedule = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (callback: () => void) => window.setTimeout(callback, 16);

    this.resampleFrame = schedule(() => {
      this.resampleFrame = null;
      this.resampleAll();
      this.render();
      this.refreshNotice();
    });
  }

  private cancelResample(): void {
    if (this.resampleFrame === null) return;

    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.resampleFrame);
    else window.clearTimeout(this.resampleFrame);

    this.resampleFrame = null;
  }

  /** Все функции — под текущий вид. Это следствие вида, а не правка: шага истории нет. */
  private resampleAll(): void {
    this.cancelResample();

    const resample = (plots: Item[]): Item[] => plots.map((item) => (isFunctionItem(item) && item.expr !== '' ? this.resampled(item) : item));

    this.state.plots = resample(this.state.plots);

    // Снимок начала правки — под тот же вид: правка, вернувшая всё как было, вернёт и ветви под текущий вид.
    if (this.editFrom) this.editFrom.plots = resample(this.editFrom.plots);
  }

  /** После отмены и повтора ветви правленых функций — под текущий вид, загруженные — как были. */
  private refreshBranches(): void {
    this.state.plots = this.state.plots.map((item) => (isFunctionItem(item) && !item.loaded ? this.withBranches(item) : item));
  }

  /** Подпись-формула элемента: у функции — её запись, у готовой кривой — её формула; иначе `null`. */
  private formulaLabel(item: Item): string | null {
    const expr = isFunctionItem(item) ? item.expr : plotExpression(item, this.separator);
    const parsed = expr ? parseFunction(expr) : null;

    return parsed?.ok ? functionLabelText(parsed.ast, this.separator) : null;
  }

  /**
   * Подпись-формула следует за изменённым элементом, пока у него стоит
   * флажок: переписывается, только если формула стала другой, — иначе
   * остаётся дословно такой, как была (например, загруженная `y=x^2`).
   */
  private followFormula<T extends Item>(before: Item, after: T): T {
    if (!this.state.formulaLabels.includes(after.id)) return after;

    const label = this.formulaLabel(after);

    return label === null || label === this.formulaLabel(before) ? after : { ...after, label };
  }

  /** Что показывает блок «Функция» для элемента. */
  private functionView(item: FunctionLike): FunctionView {
    const formulaLabel = this.state.formulaLabels.includes(item.id);

    if (!isFunctionItem(item)) {
      return { expr: plotExpression(item, this.separator) ?? '', params: [], domain: item.domain, color: item.color, formulaLabel, notice: null };
    }

    const parsed = parseFunction(item.expr);
    const names = parsed.ok ? parsed.params : [];

    return {
      expr: item.expr,
      params: names.map((name) => ({ name, value: item.params[name] ?? 1 })),
      domain: item.domain,
      color: item.color,
      formulaLabel,
      notice: noticeOf(item),
    };
  }

  /** Под видом полотна пересчитались ветви: сообщение под полем выделенной функции — заново. */
  private refreshNotice(): void {
    const selected = this.selectedPlot();

    if (selected && isFunctionItem(selected)) this.functionPanel.setNotice(noticeOf(selected));
  }

  private selectedIndex(): number {
    return this.state.plots.findIndex((item) => item.id === this.selectedId);
  }

  /** Элемент вместо выделенного — на том же месте списка. */
  private replaceSelected(next: Item): void {
    const index = this.selectedIndex();

    if (index >= 0) this.state.plots[index] = next;
  }

  /**
   * Набор в поле записи разобрался: график и карточка — сразу, шаг истории —
   * по итогу правки. Готовая кривая с изменённой записью становится набранной
   * функцией: цвет, пунктир, подпись и место в списке — прежние.
   */
  private typeFunction(expr: string, names: string[], first: boolean): void {
    const current = this.selectedPlot();

    if (!current || !hasFunctionBlock(current)) return;

    if (!isFunctionItem(current) && expr === plotExpression(current, this.separator)) return;

    if (first || !this.editFrom) this.editFrom = cloneScene(this.state);

    const base: FunctionItem = isFunctionItem(current)
      ? current
      : {
          id: current.id,
          type: 'function',
          expr,
          params: {},
          // `fn` не должен совпасть с занятым: id готовой кривой мог уже стать чьим-то `fn`.
          fn: this.uniqueFn(current.id, current.id),
          branches: [],
          ...(current.domain ? { domain: current.domain } : {}),
          ...(current.color ? { color: current.color } : {}),
          ...(current.style ? { style: current.style } : {}),
          ...(current.label ? { label: current.label } : {}),
          ...(current.extra ? { extra: current.extra } : {}),
        };
    // Новые буквы — со значением 1; пропавшие пока помнятся: их забывает конец правки.
    const params = { ...base.params };

    names.forEach((name) => {
      if (params[name] === undefined) params[name] = 1;
    });

    const next = this.followFormula(current, this.resampled({ ...base, expr, params }));

    this.replaceSelected(next);
    this.render();
    this.refreshFunction(next);
  }

  /**
   * Конец правки записи или жеста ползунка: забытые буквы прочь, шаг истории и
   * сцена наружу. Правка, вернувшая всё как было, шага не оставляет.
   */
  private finishEdit(): void {
    const from = this.editFrom;

    this.editFrom = null;

    if (!from) return;

    const current = this.selectedPlot();

    if (current && isFunctionItem(current)) {
      const parsed = parseFunction(current.expr);
      const names = parsed.ok ? parsed.params : [];
      const params: Record<string, number> = {};

      names.forEach((name) => {
        params[name] = current.params[name] ?? 1;
      });
      this.replaceSelected({ ...current, params });
    }

    const after = this.selectedPlot();
    const before = after ? from.plots.find((item) => item.id === after.id) : undefined;

    // Те же запись и параметры, что до правки: элемент — как был (загруженная функция снова отдаётся дословно), шага нет.
    if (after && before && this.sameFormula(before, after)) {
      this.replaceSelected(before);
      this.render();
      this.refreshFunction(before);

      return;
    }

    this.history.record(from);
    this.changes.emit();

    const selected = this.selectedPlot();

    if (selected) this.refreshFunction(selected);
  }

  /** Escape в поле записи: сцена — как до начала правки, без шага истории. */
  private revertEdit(): void {
    const from = this.editFrom;

    this.editFrom = null;

    if (!from) return;

    this.state = from;
    this.refreshBranches();
    this.render();

    // Блок — на месте, без пересоздания: фокус остаётся в поле записи.
    const selected = this.selectedPlot();

    if (selected) this.refreshFunction(selected);
    else this.renderProperties();
  }

  /** Запись элемента для сравнения: у функции — набранная, у готовой кривой — её формула. */
  private expressionOf(item: Item): string | null {
    if (isFunctionItem(item)) return item.expr;

    return hasFunctionBlock(item) ? plotExpression(item, this.separator) : null;
  }

  /** Одна и та же функция: та же запись и те же значения её букв-параметров (без значения — 1). */
  private sameFormula(a: Item, b: Item): boolean {
    const expr = this.expressionOf(a);

    if (expr === null || expr !== this.expressionOf(b)) return false;

    const parsed = parseFunction(expr);
    const names = parsed.ok ? parsed.params : [];
    const value = (item: Item, name: string): number => (isFunctionItem(item) ? (item.params[name] ?? 1) : 1);

    return names.every((name) => value(a, name) === value(b, name));
  }

  /** Ползунок параметра: живой просмотр, шаг истории — по итогу жеста. */
  private slideParam(name: string, value: number, first: boolean): void {
    const current = this.selectedPlot();

    if (!current || !isFunctionItem(current)) return;

    if (first || !this.editFrom) this.editFrom = cloneScene(this.state);

    const next = this.resampled({ ...current, params: { ...current.params, [name]: roundTo(value) } });

    this.replaceSelected(next);
    this.render();
    this.refreshFunction(next);
  }

  /** Число параметра — одна правка. */
  private changeParam(name: string, value: number): void {
    const current = this.selectedPlot();

    if (!current || !isFunctionItem(current) || current.params[name] === value) return;

    this.history.record(this.state);

    const next = this.resampled({ ...current, params: { ...current.params, [name]: value } });

    this.replaceSelected(next);
    this.render();
    this.changes.emit();
    this.refreshFunction(next);
  }

  private setDomain(domain: [number, number] | undefined): void {
    const current = this.selectedPlot();

    if (!current || !hasFunctionBlock(current)) return;

    const rounded: [number, number] | undefined = domain ? [roundTo(domain[0]), roundTo(domain[1])] : undefined;

    this.commit(() => {
      this.replaceSelected(isFunctionItem(current) ? this.resampled({ ...current, domain: rounded }) : { ...current, domain: rounded });
    });
  }

  private setFormulaLabel(checked: boolean): void {
    const current = this.selectedPlot();

    if (!current) return;

    const label = checked ? (this.formulaLabel(current) ?? current.label) : undefined;

    this.commit((state) => {
      state.formulaLabels = state.formulaLabels.filter((id) => id !== current.id);

      if (checked) state.formulaLabels.push(current.id);

      this.replaceSelected(this.touched({ ...current, label }));
    });
  }

  /** Правленая функция больше не отдаётся дословно; у графика сцены ничего не меняется. */
  private touched(item: Item): Item {
    if (!isFunctionItem(item) || !item.loaded) return item;

    const next = { ...item };

    delete next.loaded;

    return next;
  }

  /** Формула, параметры и подпись выделенного элемента — на месте, без пересоздания панели. */
  private refreshFunction(item: Item): void {
    if (this.labelInput) this.labelInput.value = item.label ?? '';

    if (!hasFunctionBlock(item)) return;

    this.functionPanel.update(this.functionView(item));

    if (this.propsHeading) this.propsHeading.textContent = this.t(`drawings_plots_selected_${item.type}`);
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

    // Отмена посреди перетаскивания его заканчивает: снимок жеста уже ушёл в повтор.
    this.drag = null;
    this.state = previous;
    this.refreshBranches();
    this.afterChange();
  }

  private redo(): void {
    const next = this.history.redo(this.state);

    if (!next) return;

    this.drag = null;
    this.state = next;
    this.refreshBranches();
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
    this.updateHint();
    this.renderOverlay();
  }

  /** Подсказка под панелью: у выделенной функции с инструментом «Выбрать» — о записи функции, иначе — инструмента. */
  private updateHint(): void {
    const plot = this.selectedPlot();

    if (this.tool === 'select' && plot && hasFunctionBlock(plot)) {
      this.hint.textContent = this.t('drawings_plots_fn_hint');

      return;
    }

    this.hint.textContent = this.t(`drawings_plots_hint_${this.tool}`);
  }

  /**
   * Смена выделения: незаконченная правка записи или жест ползунка прежнего
   * элемента сначала фиксируется (или отбрасывается, если правильной записи
   * не было) — в новый элемент она не попадёт и не повиснет без шага истории.
   */
  private select(id: string | null): void {
    if (id !== this.selectedId) this.functionPanel.finish();

    this.selectedId = id;
  }

  private selectedPlot(): Item | null {
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

  /** Свободный id: не совпадает ни с id, ни с `fn` в сцене — новая функция берёт его и как `fn`. */
  private nextId(): string {
    return this.freshId(new Set([...this.state.plots.map((item) => item.id), ...this.takenFns()]));
  }

  /**
   * Занятые `fn`: у функций (и загруженных из сцены) и у прочих графиков, что
   * несут его в чужих полях (ломаная с неразобранной записью). `except` — id
   * элемента, чей `fn` не в счёт.
   */
  private takenFns(except?: string): Set<string> {
    return new Set(
      this.state.plots.flatMap((item) => {
        if (item.id === except) return [];

        if (isFunctionItem(item)) return [item.fn];

        const fn = item.extra?.fn;

        return typeof fn === 'string' ? [fn] : [];
      }),
    );
  }

  /** `fn` новой функции: `preferred`, если он в сцене свободен, иначе свободный `plot_n`. */
  private uniqueFn(preferred: string, except?: string): string {
    const taken = this.takenFns(except);

    if (!taken.has(preferred)) return preferred;

    return this.freshId(new Set([...this.state.plots.map((item) => item.id), ...taken]));
  }

  /** График из нормализованной сцены: с уникальным id и без привязки центра к вершине — центр уже разрешён. */
  private adoptPlot(plot: Plot, used: Set<string>, extra: RawScene = {}): PlotItem {
    const id = plot.id && !used.has(plot.id) ? plot.id : this.freshId(used);

    used.add(id);

    const item: PlotItem = { ...plot, id, ...(Object.keys(extra).length > 0 ? { extra } : {}) };

    if (item.type === 'circle') delete item.centerVertex;

    return item;
  }

  /** `fn` для функции с id `id`: сам id, если такого `fn` ещё нет, иначе свободный `plot_n`. */
  private freeFn(id: string, functions: Map<string, FunctionItem>, used: Set<string>): string {
    const taken = new Set([...functions.values()].map((item) => item.fn));

    return taken.has(id) ? this.freshId(new Set([...used, ...taken])) : id;
  }

  /**
   * Ветвь набранной функции из сцены: ломаная с записью, которая разбирается.
   * Ветви с одинаковыми `fn` и записью собираются в одну функцию на месте
   * первой; тот же `fn` у другой записи — другая функция со своим `fn` (её
   * ветви пишутся заново). `false` — это не ветвь функции, а обычный график.
   */
  private adoptBranch(raw: unknown, plot: Plot | undefined, used: Set<string>, functions: Map<string, FunctionItem>, plots: Item[]): boolean {
    if (!isRecord(raw) || raw.type !== 'freehand' || typeof raw.expr !== 'string' || !parseFunction(raw.expr).ok) return false;

    const points = plot?.type === 'freehand' ? plot.points : [];
    const fn = typeof raw.fn === 'string' && raw.fn !== '' ? raw.fn : null;
    const key = fn === null ? null : `${fn}\u0000${raw.expr}`;
    const known = key === null ? undefined : functions.get(key);

    if (known) {
      known.loaded?.push(raw);

      if (points.length > 1) known.branches.push(points);

      if (typeof raw.id === 'string') used.add(raw.id);

      return true;
    }

    const id = typeof raw.id === 'string' && raw.id !== '' && !used.has(raw.id) ? raw.id : this.freshId(used);
    const clash = fn !== null && [...functions.values()].some((item) => item.fn === fn);
    const extra = extraOf(raw, new Set([...KNOWN_PLOT_KEYS, ...FUNCTION_KEYS]));
    const domain = readDomain(raw.domain);
    const item: FunctionItem = {
      id,
      type: 'function',
      expr: raw.expr,
      params: readParams(raw.params),
      fn: fn !== null && !clash ? fn : this.freeFn(id, functions, used),
      branches: points.length > 1 ? [points] : [],
      // Функция с чужим `fn` дословно не отдаётся: в сцене у неё будет свой.
      ...(clash ? {} : { loaded: [raw] }),
      ...(domain ? { domain } : {}),
      ...(plot?.color ? { color: plot.color } : {}),
      ...(plot?.style ? { style: plot.style } : {}),
      ...(plot?.label ? { label: plot.label } : {}),
      ...(Object.keys(extra).length > 0 ? { extra } : {}),
    };

    used.add(id);
    // Функция без `fn` тоже в списке — по ключу, которого не бывает у ветвей: её `fn` уже занят.
    functions.set(key ?? `\u0001${id}`, item);

    plots.push(item);

    return true;
  }

  private addPlot(plot: Item): void {
    this.select(plot.id);
    this.commit((state) => {
      state.plots.push(plot);
    });
  }

  /** Цвет новой функции: первый цвет палитры, которого ещё нет на чертеже, — графики не сливаются. */
  private freeColor(): string {
    const taken = new Set(this.state.plots.map((item) => item.color?.toLowerCase()));

    return DRAWING_COLORS.find((color) => !taken.has(color.value))?.value ?? DRAWING_COLOR_HEX.blue;
  }

  /** Фокус в поле записи выделенной функции: после «+ Функция» и шаблона сразу набирают. */
  private focusExpression(): void {
    this.functionPanel.field?.focus();
  }

  /** «+ Функция»: пустая запись, в сцену не попадает, пока её не набрали. */
  private addFunction(): void {
    const item = newFunction(this.nextId(), '', this.freeColor());

    this.select(item.id);
    this.state.plots.push(item);
    this.setTool('select');
    this.render();
    this.renderProperties();
    this.focusExpression();
  }

  private addTemplate(template: TemplateId): void {
    const id = this.nextId();
    const expr = TEMPLATE_EXPRESSIONS[template];
    const color = TEMPLATE_COLORS[template];

    if (expr === undefined) {
      this.addPlot({ id, type: 'circle', center: [0, 0], radius: 2, color });

      return;
    }

    this.addPlot(this.resampled(newFunction(id, expr, color)));
    this.focusExpression();
  }

  private snap(point: Vec2, info: PointerInfo): Vec2 {
    return info.shift ? roundPoint(point) : snapToGrid(point, GRID_STEP);
  }

  private plotAt(point: Vec2): Item | null {
    const radius = this.canvas.hitRadius;
    let best: { plot: Item; d: number; rank: number } | null = null;

    for (const plot of this.state.plots) {
      const d = plotDistance(plot, point);

      if (d > radius) continue;

      const rank = hitRank(plot);

      if (best === null || rank < best.rank || (rank === best.rank && d < best.d)) best = { plot, d, rank };
    }

    return best === null ? null : best.plot;
  }

  // ------------------------------------------------------------- указатель

  /** С пустого места протяжка двигает лист; карандаш рисует протяжкой, поэтому в нём — нет. */
  private readonly canPanFrom = (info: PointerInfo): boolean => this.tool !== 'pencil' && this.plotAt(info.world) === null;

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
          this.select(plot.id);
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

      if (last && distance(last, info.world) >= STROKE_MIN_STEP) this.stroke.push(info.world);

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

      const moved = this.followFormula(this.drag.snapshot, this.touched(translatePlot(this.drag.snapshot, delta)));

      this.state.plots[index] = moved;
      this.render();

      // Формула и параметры следуют за графиком на каждом движении.
      if (moved.id === this.selectedId) this.refreshFunction(moved);

      return;
    }

    if (this.draft.length > 0) this.renderOverlay();
  };

  private readonly onPointerUp = (info: PointerInfo): void => {
    if (this.stroke) {
      const points = this.stroke;

      this.stroke = null;

      // Отменённый штрих отбрасывается целиком, какой бы длины он ни был.
      if (isCancelled(info)) this.renderOverlay();
      else this.finishStroke(points, info);

      return;
    }

    if (isCancelled(info)) {
      this.cancelDrag();

      return;
    }

    this.finishDrag();
  };

  /**
   * Конец перетаскивания, как при отпускании кнопки: объект остаётся там, куда
   * дотащили, его шаг истории остаётся. Зовётся перед клавишей, пишущей свой шаг,
   * чтобы последующий Escape не снял чужой.
   */
  private finishDrag(): void {
    if (this.drag?.moved) this.afterChange();

    this.drag = null;
  }

  /** Отменённое перетаскивание: сцена — из снимка его начала, шаг истории снимается. */
  private cancelDrag(): void {
    const moved = this.drag?.moved === true;

    this.drag = null;

    if (!moved) return;

    const before = this.history.discard();

    if (before) this.state = before;

    this.afterChange();
  }

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
        this.finishDrag();
        this.paste();
      }

      return;
    }

    // Стрелки без выделения двигают лист на шаг сетки.
    // Посреди штриха или перетаскивания вид не двигаем: штрих порвался бы скачком.
    if (this.selectedId === null && !this.stroke && !this.drag && !ctrl && !event.altKey && this.canvas.panByKey(event.key, GRID_STEP)) {
      event.preventDefault();

      return;
    }

    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (this.selectedId !== null) {
        event.preventDefault();
        this.finishDrag();
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
      // Отмена сделана здесь: диалог по `defaultPrevented` её не повторяет.
      event.preventDefault();
      this.cancel();
    }
  };

  // ----------------------------------------------------------- инструменты

  private selectAt(info: PointerInfo): void {
    const plot = this.plotAt(info.world);

    this.select(plot?.id ?? null);
    // Набранную функцию не тащат: её положение задаёт запись.
    this.drag = plot && !isFunctionItem(plot) ? { id: plot.id, origin: info.world, snapshot: cloneScene(plot), moved: false } : null;
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

    this.select(plot.id);
    this.render();
    this.renderProperties();
    this.properties.querySelector<HTMLInputElement>('input[data-autofocus]')?.focus();
  }

  private copySelected(): void {
    const plot = this.selectedPlot();

    // Пустая функция — ещё не график: копировать нечего.
    if (plot && !(isFunctionItem(plot) && plot.expr === '')) this.clipboard = cloneScene(plot);
  }

  /** Вставка со сдвигом; буфер становится вставленной копией, чтобы повторная вставка шла лесенкой. */
  private paste(): void {
    if (!this.clipboard) return;

    const id = this.nextId();
    const copy = cloneScene(this.clipboard);
    // Копия функции — новая функция со своим `fn`; на месте оригинала, сдвинуть её может только запись.
    const plot = isFunctionItem(copy) ? this.resampled({ ...copy, id, fn: this.uniqueFn(id) }) : translatePlot({ ...copy, id }, PASTE_OFFSET);

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

  private updatePlot<T extends Item>(target: T, mutate: (draft: T) => void): void {
    this.commit((state) => {
      const index = state.plots.findIndex((plot) => plot.id === target.id);
      const draft = state.plots[index];

      if (!draft || draft.type !== target.type) return;

      const before = cloneScene(draft);

      mutate(draft as T);
      state.plots[index] = this.followFormula(before, this.touched(draft));
    });
  }

  /** Пустая функция, с которой ушло выделение, исчезает: в сцене её и не было. */
  private dropEmptyFunctions(): void {
    this.state.plots = this.state.plots.filter((item) => !isFunctionItem(item) || item.expr !== '' || item.id === this.selectedId);
  }

  private renderProperties(): void {
    const { t } = this;

    this.dropEmptyFunctions();
    this.properties.replaceChildren();
    this.labelInput = null;
    this.propsHeading = null;

    const plot = this.selectedPlot();
    const withBlock = plot !== null && hasFunctionBlock(plot);

    this.palette.classList.toggle('rte-plots__palette--compact', withBlock);
    this.updateHint();

    if (!plot) {
      this.renderAxesProperties();

      return;
    }

    this.propsHeading = propsTitle(t(`drawings_plots_selected_${plot.type}`));
    this.properties.appendChild(this.propsHeading);

    // Блок «Функция» — первым: карточка, запись, параметры.
    if (hasFunctionBlock(plot)) this.properties.appendChild(this.functionPanel.show(this.functionView(plot)));

    this.properties.appendChild(
      colorField({
        t,
        label: t('drawings_prop_color'),
        value: plot.color ?? '',
        // Как прежде с пустым hex: без цвета кривая рисуется цветом по умолчанию.
        allowDefault: true,
        onChange: (value) =>
          this.updatePlot(plot, (draft) => {
            draft.color = value || undefined;
          }),
      }),
    );

    if (plot.type !== 'point' && plot.type !== 'shading') {
      this.appendCheckbox(t('drawings_prop_dashed'), plot.style === 'dashed', (checked) =>
        this.updatePlot(plot, (draft) => {
          draft.style = checked ? 'dashed' : 'solid';
        }),
      );
    }

    const label = textField({
      label: t('drawings_prop_label'),
      value: plot.label ?? '',
      autofocus: true,
      onChange: (value) =>
        // Подпись, набранная руками, — уже не формула: признак снимается.
        this.commit((state) => {
          state.formulaLabels = state.formulaLabels.filter((id) => id !== plot.id);
          state.plots = state.plots.map((item) => (item.id === plot.id ? this.touched({ ...item, label: value || undefined }) : item));
        }),
    });

    this.labelInput = label.querySelector('input');
    this.properties.appendChild(label);

    switch (plot.type) {
      case 'circle':
        this.appendCircle(plot);
        break;
      case 'point':
        this.appendCheckbox(t('drawings_plots_prop_hollow'), plot.pointStyle === 'hollow', (checked) =>
          this.updatePlot(plot, (draft) => {
            draft.pointStyle = checked ? 'hollow' : 'solid';
          }),
        );
        break;
      case 'line':
        // Отрезок по двум точкам и вертикальная прямая — не функция: правятся точками.
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
      propsEmpty(t('drawings_nothing_selected')),
      propsTitle(t('drawings_plots_axes')),
      textField({
        label: t('drawings_plots_prop_x_label'),
        value: state.xLabel,
        onChange: (value) =>
          this.commit((draft) => {
            draft.xLabel = value;
          }),
      }),
      textField({
        label: t('drawings_plots_prop_y_label'),
        value: state.yLabel,
        onChange: (value) =>
          this.commit((draft) => {
            draft.yLabel = value;
          }),
      }),
    );
    this.appendCheckbox(t('drawings_plots_prop_ticks'), state.showAxesTicks, (checked) =>
      this.commit((draft) => {
        draft.showAxesTicks = checked;
      }),
    );
  }

  private appendCheckbox(label: string, checked: boolean, onChange: (checked: boolean) => void): void {
    this.properties.appendChild(checkField({ label, checked, onChange }));
  }

  /** Точка отрезка: оба числа обязательны; неполный ввод — панель заново с точкой из сцены. */
  private appendPoint(label: string, point: Vec2, apply: (point: Vec2) => void): void {
    this.properties.appendChild(
      pairField({
        label,
        values: point,
        step: GRID_STEP,
        onChange: ([x, y]: NumberPair) => {
          if (x === null || y === null) {
            this.renderProperties();

            return;
          }

          apply(roundPoint([x, y], FINE_DIGITS));
        },
      }),
    );
  }

  /** Окружность: центр и радиус числами (радиус не меньше `MIN_RADIUS`), заливка. */
  private appendCircle(plot: Extract<PlotItem, { type: 'circle' }>): void {
    const { t } = this;

    this.appendPoint(t('drawings_plots_prop_center'), plot.center, (center) =>
      this.updatePlot(plot, (draft) => {
        draft.center = roundPoint(center);
      }),
    );
    this.properties.appendChild(
      numberField({
        label: t('drawings_prop_radius'),
        value: plot.radius,
        step: GRID_STEP,
        min: MIN_RADIUS,
        prop: 'radius',
        onChange: (value) =>
          this.updatePlot(plot, (draft) => {
            draft.radius = Math.max(MIN_RADIUS, roundTo(value));
          }),
      }),
    );
    this.appendCheckbox(t('drawings_plots_prop_fill'), plot.fill === true, (checked) =>
      this.updatePlot(plot, (draft) => {
        draft.fill = checked;
      }),
    );
  }
}

export const plotsEditorFactory: SceneEditorFactory = {
  id: 'plots',
  kind: 'geometry',
  labelKey: 'drawings_tab_plots',
  icon: 'tabPlot',
  accepts: (scene) => normalizeGeometryScene(scene).type === 'plot_2d',
  create: (context) => new PlotsEditor(context),
};
