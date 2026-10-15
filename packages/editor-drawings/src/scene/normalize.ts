import { splitEdgesThroughVertices } from './split-edges';
import type {
  AngleStyle,
  AxisTick,
  DrawingKind,
  GeometryAngle,
  GeometryEdge,
  GeometryScene,
  GeometrySceneType,
  PhysicsElement,
  PhysicsElementType,
  PhysicsScene,
  Plot,
  Point,
  Vec2,
} from './types';

/**
 * Нормализация «грязных» сцен от распознавания (README PinQueen §4.4).
 *
 * Нейросеть пишет рёбра массивами или объектами с разными ключами,
 * окружности кладёт в `circle`/`circles`, старые термографики — в
 * `graph`/`graph_pV`, стенам даёт тип `wall`. Здесь всё это приводится к
 * одному виду, а всё, что не похоже на данные, отбрасывается — без
 * исключений: сломанная сцена рисуется пустой, а не роняет редактор.
 */

type Raw = Record<string, unknown>;

const isRecord = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const asNumber = (value: unknown, fallback: number): number => (isFiniteNumber(value) ? value : fallback);

const asString = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);

const asBoolean = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);

const asVec2 = (value: unknown): Vec2 | undefined =>
  Array.isArray(value) && isFiniteNumber(value[0]) && isFiniteNumber(value[1]) ? [value[0], value[1]] : undefined;

const asPoint = (value: unknown): Point | undefined => {
  const vec = asVec2(value);

  if (!vec) return undefined;

  return Array.isArray(value) && isFiniteNumber(value[2]) ? [vec[0], vec[1], value[2]] : vec;
};

const asVec2List = (value: unknown): Vec2[] =>
  Array.isArray(value) ? value.map(asVec2).filter((point): point is Vec2 => point !== undefined) : [];

const asRange = (value: unknown): [number, number] | undefined => {
  if (!Array.isArray(value) || value.length < 2) return undefined;

  const low = value[0] === null || value[0] === -Infinity ? -Infinity : value[0];
  const high = value[1] === null || value[1] === Infinity ? Infinity : value[1];

  return typeof low === 'number' && typeof high === 'number' ? [low, high] : undefined;
};

// ----------------------------------------------------------------- геометрия

const EDGE_FROM_KEYS = ['from', 'start', 'source'];
const EDGE_TO_KEYS = ['to', 'end', 'target'];

const firstString = (raw: Raw, keys: string[]): string | undefined =>
  keys.map((key) => asString(raw[key])).find((value) => value !== undefined);

const normalizeEdge = (value: unknown): GeometryEdge | null => {
  if (Array.isArray(value)) {
    const [from, to] = value;

    return typeof from === 'string' && typeof to === 'string' ? { from, to, style: 'solid' } : null;
  }

  if (!isRecord(value)) return null;

  const from = firstString(value, EDGE_FROM_KEYS);
  const to = firstString(value, EDGE_TO_KEYS);

  if (!from || !to) return null;

  const style = value.style === 'dashed' || value.style === 'hidden' ? 'dashed' : 'solid';
  const ticks = isFiniteNumber(value.ticks) ? Math.max(0, Math.min(4, Math.round(value.ticks))) : undefined;

  return { from, to, style, color: asString(value.color), ...(ticks ? { ticks } : {}) };
};

const ANGLE_STYLES: AngleStyle[] = ['right', 'single', 'double', 'triple'];

/** Угол задаётся тройкой `points` — или, в «разметках», полями `vertex`/`p1`/`p2`. */
const normalizeAngle = (value: unknown): GeometryAngle | null => {
  if (!isRecord(value)) return null;

  let points: unknown[] | undefined;

  if (Array.isArray(value.points) && value.points.length === 3) {
    points = value.points;
  } else {
    const vertex = asString(value.vertex) ?? asString(value.at);
    const p1 = asString(value.p1) ?? asString(value.from);
    const p2 = asString(value.p2) ?? asString(value.to);

    if (vertex && p1 && p2) points = [p1, vertex, p2];
  }

  if (!points || !points.every((point) => typeof point === 'string')) return null;

  const isRight = value.style === 'right' || value.type === 'right' || value.type === 'right_angle' || value.right === true;
  const style = isRight ? 'right' : ANGLE_STYLES.find((candidate) => candidate === value.style) ?? 'single';

  return { points: points as [string, string, string], style, label: asString(value.label) };
};

const normalizePlot = (value: unknown, vertices: Record<string, Point>): Plot | null => {
  if (!isRecord(value) || typeof value.type !== 'string') return null;

  const base = {
    id: asString(value.id),
    color: asString(value.color) ?? asString(value.stroke),
    label: asString(value.label),
    style: value.style === 'dashed' ? ('dashed' as const) : undefined,
  };

  switch (value.type) {
    case 'circle': {
      const centerVertex = asString(value.centerVertex);
      const fromVertex = centerVertex ? asVec2(vertices[centerVertex]) : undefined;
      const center = fromVertex ?? asVec2(value.center) ?? asVec2(value.coords);

      if (!center) return null;

      return {
        ...base,
        type: 'circle',
        center,
        centerVertex,
        radius: Math.abs(asNumber(value.radius, 1)) || 1,
        fill: value.fill === true || typeof value.fill === 'string',
      };
    }
    case 'parabola': {
      const vertex = asVec2(value.vertex) ?? [0, 0];
      // Разбор pgfplots писал `stretch`, рендер читал `stretchX`/`stretchY`: принимаем оба.
      const stretch = asNumber(value.stretch, 1);

      return {
        ...base,
        type: 'parabola',
        vertex,
        direction: value.direction === 'down' ? 'down' : 'up',
        stretchX: asNumber(value.stretchX, 1),
        stretchY: asNumber(value.stretchY, stretch),
        domain: asRange(value.domain),
      };
    }
    case 'sqrt':
      return {
        ...base,
        type: 'sqrt',
        vertex: asVec2(value.vertex) ?? [0, 0],
        directionX: value.directionX === 'left' ? 'left' : 'right',
        directionY: value.directionY === 'down' ? 'down' : 'up',
        stretch: asNumber(value.stretch, 1),
        domain: asRange(value.domain),
      };
    case 'hyperbola':
      return {
        ...base,
        type: 'hyperbola',
        center: asVec2(value.center) ?? [0, 0],
        k: asNumber(value.k, 1),
        domain: asRange(value.domain),
      };
    case 'line': {
      const p1 = asVec2(value.p1);
      const p2 = asVec2(value.p2);
      const k = isFiniteNumber(value.k) ? value.k : undefined;
      const b = isFiniteNumber(value.b) ? value.b : undefined;

      if (!(p1 && p2) && !(k !== undefined && b !== undefined)) return null;

      return { ...base, type: 'line', p1, p2, k, b, domain: asRange(value.domain) };
    }
    case 'point': {
      const coords = asVec2(value.coords) ?? asVec2(value.center);

      if (!coords) return null;

      return {
        ...base,
        type: 'point',
        coords,
        pointStyle: value.style === 'hollow' || value.style === 'void' ? 'hollow' : 'solid',
      };
    }
    case 'shading': {
      const points = asVec2List(value.points);
      const bounds = Array.isArray(value.bounds) && value.bounds.length >= 4 && value.bounds.slice(0, 4).every(isFiniteNumber)
        ? (value.bounds.slice(0, 4) as [number, number, number, number])
        : undefined;

      if (points.length === 0 && !bounds) return null;

      return { ...base, type: 'shading', points: points.length > 0 ? points : undefined, bounds };
    }
    case 'freehand':
    case 'polygon': {
      const points = asVec2List(value.points);

      return points.length > 1 ? { ...base, type: 'freehand', points } : null;
    }
    default:
      return null;
  }
};

/** `circle`/`circles` на верхнем уровне сцены — те же окружности, что в `plots`. */
const collectLooseCircles = (raw: Raw): Plot[] => {
  const items = [raw.circle, raw.circles].flatMap((value) => (Array.isArray(value) ? value : value ? [value] : []));

  return items.flatMap((item) => {
    if (!isRecord(item)) return [];

    const center = asVec2(item.center) ?? asVec2(item.coords);

    if (!center) return [];

    return [
      {
        type: 'circle' as const,
        center,
        radius: Math.abs(asNumber(item.radius, 1)) || 1,
        color: asString(item.color) ?? asString(item.stroke),
        fill: item.fill === true || typeof item.fill === 'string',
        label: asString(item.label),
      },
    ];
  });
};

const detectGeometryType = (raw: Raw, vertices: Record<string, Point>, plots: Plot[]): GeometrySceneType => {
  if (raw.type === 'plot_2d') return 'plot_2d';

  if (raw.type === '2d') return '2d';

  const names = Object.keys(vertices);

  if (names.length > 0) {
    // 3D, в которой все z ≈ 0, — это 2D: кабинетная проекция только исказила бы её.
    const hasDepth = names.some((name) => {
      const point = vertices[name];

      return point.length === 3 && Math.abs(point[2]) > 0.001;
    });

    return hasDepth ? '3d' : '2d';
  }

  return plots.length > 0 ? 'plot_2d' : '2d';
};

export const EMPTY_GEOMETRY_SCENE: GeometryScene = {
  type: '2d',
  vertices: {},
  edges: [],
  angles: [],
  labels: {},
  textLabels: [],
  sections: [],
  cylinders: [],
  plots: [],
  angleY: 0,
  angleZ: 0,
  offsetX: 0,
  offsetY: 0,
  showGrid: true,
  showAxes: false,
  showAxesTicks: true,
  axes: { xLabel: 'x', yLabel: 'y' },
};

/** Приводит сырую геометрическую сцену к модели; что угодно на входе — сцена на выходе. */
export const normalizeGeometryScene = (raw: unknown): GeometryScene => {
  if (!isRecord(raw)) return { ...EMPTY_GEOMETRY_SCENE, vertices: {}, edges: [], plots: [] };

  const vertices: Record<string, Point> = {};

  if (isRecord(raw.vertices)) {
    Object.entries(raw.vertices).forEach(([name, value]) => {
      const point = asPoint(value);

      if (point) vertices[name] = point;
    });
  }

  const plots = [
    ...(Array.isArray(raw.plots) ? raw.plots : []).map((plot) => normalizePlot(plot, vertices)),
    ...collectLooseCircles(raw),
  ].filter((plot): plot is Plot => plot !== null);

  const edges = (Array.isArray(raw.edges) ? raw.edges : [])
    .map(normalizeEdge)
    .filter((edge): edge is GeometryEdge => edge !== null && edge.from in vertices && edge.to in vertices);

  // «Разметки» — тот же список углов в другой записи; без точек они просто пропускаются.
  const angles = [...(Array.isArray(raw.angles) ? raw.angles : []), ...(Array.isArray(raw.markings) ? raw.markings : [])]
    .map(normalizeAngle)
    .filter((angle): angle is GeometryAngle => angle !== null && angle.points.every((name) => name in vertices));

  const labels: Record<string, string> = {};

  if (isRecord(raw.labels)) {
    Object.entries(raw.labels).forEach(([name, value]) => {
      if (typeof value === 'string') labels[name] = value;
    });
  }

  const textLabels = (Array.isArray(raw.text_labels) ? raw.text_labels : [])
    .map((value) => {
      if (!isRecord(value) || typeof value.text !== 'string') return null;

      const position = Array.isArray(value.position) && value.position.length === 2 && value.position.every((name) => typeof name === 'string')
        ? (value.position as [string, string])
        : undefined;

      return {
        text: value.text,
        position,
        offset: value.offset === 'left' ? ('left' as const) : value.offset === 'right' ? ('right' as const) : undefined,
        coords: asVec2(value.coords),
      };
    })
    .filter((label): label is NonNullable<typeof label> => label !== null);

  const sections = (Array.isArray(raw.sections) ? raw.sections : [])
    .map((value) =>
      isRecord(value) && Array.isArray(value.vertices) && value.vertices.every((name) => typeof name === 'string')
        ? { vertices: value.vertices as string[], fill: asString(value.fill), stroke: asString(value.stroke) }
        : null,
    )
    .filter((section): section is NonNullable<typeof section> => section !== null && section.vertices.length >= 3);

  const cylinders = (Array.isArray(raw.cylinders) ? raw.cylinders : [])
    .map((value) =>
      isRecord(value) && typeof value.base === 'string' && typeof value.top === 'string'
        ? { base: value.base, top: value.top, radius: Math.abs(asNumber(value.radius, 1)) || 1 }
        : null,
    )
    .filter((cylinder): cylinder is NonNullable<typeof cylinder> => cylinder !== null);

  const axes = isRecord(raw.axes) ? raw.axes : {};

  const scene: GeometryScene = {
    type: detectGeometryType(raw, vertices, plots),
    vertices,
    edges,
    angles,
    labels,
    textLabels,
    sections,
    cylinders,
    plots,
    angleY: asNumber(raw.angleY, 0),
    angleZ: asNumber(raw.angleZ, 0),
    scale: isFiniteNumber(raw.scale) && raw.scale > 0 ? raw.scale : undefined,
    offsetX: asNumber(raw.offsetX, 0),
    offsetY: asNumber(raw.offsetY, 0),
    showGrid: asBoolean(raw.showGrid, raw.grid !== false),
    showAxes: asBoolean(raw.showAxes, false),
    showAxesTicks: asBoolean(raw.showAxesTicks, true),
    axes: {
      xLabel: asString(axes.x_label) ?? asString(axes.xLabel) ?? 'x',
      yLabel: asString(axes.y_label) ?? asString(axes.yLabel) ?? 'y',
    },
  };

  splitEdgesThroughVertices(scene);

  return scene;
};

// -------------------------------------------------------------------- физика

const PHYSICS_TYPES: ReadonlySet<string> = new Set<PhysicsElementType>([
  'surface',
  'arc_surface',
  'block',
  'rope',
  'spring',
  'vector',
  'angle',
  'stickman',
  'balloon',
  'ellipse_platform',
  'dimension_line',
  'thermo_axes',
  'thermo_point',
  'thermo_process',
  'piston_vessel',
  'circuit_component',
  'wire',
  'charge',
  'field_line',
  'capacitor_plate',
  'current_conductor',
  'circle_shape',
  'lens',
  'mirror',
  'ray',
  'optics_arrow',
  'prism',
  'glass_slab',
  'text_label',
]);

/** Синонимы типов от нейросети → тип рендера. */
const TYPE_ALIASES: Record<string, PhysicsElementType> = {
  wall: 'surface',
  lever: 'wire',
  curve: 'wire',
  weight: 'block',
  box: 'block',
  container: 'block',
  cylinder: 'piston_vessel',
  cylinder_piston: 'piston_vessel',
  container_with_piston: 'piston_vessel',
  piston: 'piston_vessel',
  point: 'charge',
  axis: 'vector',
  label: 'text_label',
  text: 'text_label',
};

let generatedIds = 0;

const nextId = (type: string): string => {
  generatedIds += 1;

  return `${type}_${generatedIds}`;
};

const asTicks = (value: unknown): AxisTick[] | undefined => {
  if (!Array.isArray(value)) return undefined;

  const ticks = value
    .map((tick) => {
      if (isFiniteNumber(tick)) return { val: tick };

      if (!isRecord(tick)) return null;

      const val = isFiniteNumber(tick.val) ? tick.val : Number(tick.val);

      return Number.isFinite(val) ? { val, label: asString(tick.label) } : null;
    })
    .filter((tick): tick is AxisTick => tick !== null);

  return ticks.length > 0 ? ticks : undefined;
};

/** Один элемент в модель; `null`, если тип неизвестен. */
const normalizePhysicsElement = (raw: Raw): PhysicsElement | null => {
  const rawType = asString(raw.type) ?? '';
  const type = (TYPE_ALIASES[rawType] ?? rawType) as PhysicsElementType;

  if (!PHYSICS_TYPES.has(type)) return null;

  const element: PhysicsElement = {
    id: asString(raw.id) ?? nextId(type),
    type,
    label: asString(raw.label) ?? asString(raw.name),
    color: asString(raw.color),
    dashed: raw.dashed === true,
    strokeWidth: isFiniteNumber(raw.strokeWidth) ? raw.strokeWidth : undefined,
    points: asVec2List(raw.points),
    center: asVec2(raw.center) ?? asVec2(raw.position),
    coords: asVec2(raw.coords),
    subtype: asString(raw.subtype),
    hatching: ['top', 'bottom', 'left', 'right', 'inner', 'outer'].includes(raw.hatching as string)
      ? (raw.hatching as PhysicsElement['hatching'])
      : undefined,
    width: isFiniteNumber(raw.width) ? raw.width : undefined,
    height: isFiniteNumber(raw.height) ? raw.height : undefined,
    radius: isFiniteNumber(raw.radius) ? raw.radius : undefined,
    angle: isFiniteNumber(raw.angle) ? raw.angle : undefined,
    vectorType: asString(raw.vectorType),
    angleType: raw.angleType === 'outer' ? 'outer' : raw.angleType === 'inner' ? 'inner' : undefined,
    arcRadius: isFiniteNumber(raw.arcRadius) ? raw.arcRadius : undefined,
    rx: isFiniteNumber(raw.rx) ? raw.rx : undefined,
    ry: isFiniteNumber(raw.ry) ? raw.ry : undefined,
    xLabel: asString(raw.xLabel),
    yLabel: asString(raw.yLabel),
    originLabel: asString(raw.originLabel),
    xLength: isFiniteNumber(raw.xLength) ? raw.xLength : undefined,
    yLength: isFiniteNumber(raw.yLength) ? raw.yLength : undefined,
    offset: asVec2(raw.offset),
    xTicks: asTicks(raw.xTicks),
    yTicks: asTicks(raw.yTicks),
    pistonHeight: isFiniteNumber(raw.pistonHeight) ? raw.pistonHeight : undefined,
    pistonThickness: isFiniteNumber(raw.pistonThickness) ? raw.pistonThickness : undefined,
    weight: raw.weight === true,
    focalLength: isFiniteNumber(raw.focalLength) ? raw.focalLength : undefined,
    wavy: raw.wavy === true,
    text: asString(raw.text),
    charge: asString(raw.charge),
    plateType: ['positive', 'negative', 'neutral'].includes(raw.plateType as string)
      ? (raw.plateType as PhysicsElement['plateType'])
      : undefined,
  };

  // Частные случаи синонимов: у «груза» и «ящика» есть размеры по умолчанию,
  // у ящика — прямоугольник `rect`; у «точки» центр становится координатами.
  if (rawType === 'weight' || rawType === 'box' || rawType === 'container') {
    element.subtype = 'rectangle';
    element.width = element.width ?? 0.8;
    element.height = element.height ?? 0.6;

    if (Array.isArray(raw.rect) && raw.rect.length >= 4 && raw.rect.every(isFiniteNumber)) {
      const [x1, y1, x2, y2] = raw.rect as number[];

      element.center = [(x1 + x2) / 2, (y1 + y2) / 2];
      element.width = Math.abs(x2 - x1);
      element.height = Math.abs(y2 - y1);
    }
  }

  if (type === 'block' && !element.subtype) element.subtype = element.radius ? 'circle' : 'rectangle';

  if (type === 'piston_vessel') {
    element.width = element.width ?? 2;
    element.height = element.height ?? 3.5;
  }

  if (type === 'charge' && !element.coords && element.center) element.coords = element.center;

  if (type === 'text_label' && !element.coords && element.center) element.coords = element.center;

  if (type === 'text_label' && !element.text) element.text = element.label;

  // Ось как вектор: `axis` с ориентацией и именем.
  if (rawType === 'axis') {
    const vertical = raw.orientation === 'vertical';

    element.points = vertical ? [[0, -2], [0, 4]] : [[-2, 0], [4, 0]];
    element.label = asString(raw.name) ?? 'x';
  }

  // Резистор с «L» в подписи — катушка: так рисовал оригинал, так пишут в заданиях.
  if (type === 'circuit_component' && element.subtype === 'resistor' && element.label && /L/.test(element.label)) {
    element.subtype = 'inductor';
  }

  return element;
};

/** Группы `vessels`, `charges`, `vectors`, `elements` внутри элемента разворачиваются в плоский список. */
const expandGroup = (raw: Raw): Raw[] => {
  const expanded: Raw[] = [];

  if (Array.isArray(raw.vessels)) {
    const count = raw.vessels.length;
    const step = 3.6;
    const start = -((count - 1) * step) / 2;

    raw.vessels.forEach((vessel, index) => {
      if (!isRecord(vessel)) return;

      const position = asVec2(vessel.position);
      const size = asVec2(vessel.size);
      const x = position ? position[0] : start + index * step;
      const y = position ? position[1] : 0;

      expanded.push({
        type: 'piston_vessel',
        center: [x, y],
        width: size ? size[0] : 2,
        height: size ? size[1] : 3.2,
        label: `Сосуд ${asString(vessel.id) ?? index + 1}`,
      });

      if (Array.isArray(vessel.labels)) {
        vessel.labels.forEach((text, line) => {
          if (typeof text === 'string') expanded.push({ type: 'text_label', coords: [x, y - 0.5 + line * 0.6], text });
        });
      }
    });

    return expanded;
  }

  if (Array.isArray(raw.charges) || Array.isArray(raw.vectors) || Array.isArray(raw.elements)) {
    (Array.isArray(raw.charges) ? raw.charges : []).forEach((charge) => {
      if (isRecord(charge)) expanded.push({ type: 'charge', ...charge });
    });

    (Array.isArray(raw.vectors) ? raw.vectors : []).forEach((vector) => {
      if (isRecord(vector)) expanded.push({ type: 'vector', ...vector });
    });

    const elements = Array.isArray(raw.elements) ? raw.elements : [];
    const step = 3.4;
    const start = -((elements.length - 1) * step) / 2;

    elements.forEach((item, index) => {
      if (!isRecord(item)) return;

      const center = asVec2(item.center) ?? [start + index * step, 0];
      const [x, y] = center;

      expanded.push({ ...item, center });

      const params = isRecord(item.params) ? item.params : null;

      if (!params) return;

      const length = asString(params.L) ?? asString(params.H) ?? asString(params.h);

      if (length) {
        expanded.push({ type: 'dimension_line', points: [[x - 1.2, y - 1.5], [x - 1.2, y + 1.5]], label: length });
      }

      if (asString(params.p)) expanded.push({ type: 'text_label', coords: [x, y - 0.5], text: params.p });

      if (asString(params.T)) expanded.push({ type: 'text_label', coords: [x, y - 1.2], text: params.T });

      if (Array.isArray(params.forces)) {
        params.forces.forEach((force, position) => {
          if (typeof force !== 'string') return;

          const direction = position % 2 === 0 ? 1 : -1;

          expanded.push({
            type: 'vector',
            vectorType: 'force',
            points: [[x, y + 0.8], [x, y + 0.8 + direction * 1.2]],
            label: force,
          });
        });
      }
    });

    return expanded;
  }

  return [raw];
};

interface ThermoPoint {
  label: string;
  x: number;
  y: number;
}

/**
 * Старые термографики (`graph_pV`, верхнеуровневые `thermo_*`) — в элементы:
 * оси, точки и процессы. Координаты нормируются в окно 2..6 × 1.5..5.5, если
 * они не в «единицах чертежа».
 */
const thermoToElements = (raw: Raw): Raw[] | null => {
  const isGraph = ['graph_pv', 'graph_pV', 'pv_diagram', 'graph'].includes(asString(raw.type) ?? '');
  const hasThermo = raw.thermo_axes !== undefined || raw.thermo_point !== undefined || raw.thermo_process !== undefined;

  if (!isGraph && !hasThermo) return null;

  const axesRaw = isRecord(raw.thermo_axes) ? raw.thermo_axes : isRecord(raw.axes) ? raw.axes : {};
  const xLabel = asString(axesRaw.x) ?? asString(axesRaw.x_label) ?? 'V';
  const yLabel = asString(axesRaw.y) ?? asString(axesRaw.y_label) ?? 'p';

  const pointsRaw = Array.isArray(raw.thermo_point) ? raw.thermo_point : Array.isArray(raw.points) ? raw.points : [];

  const points: ThermoPoint[] = pointsRaw.flatMap((point, index) => {
    if (!isRecord(point)) return [];

    const x = isFiniteNumber(point.x) ? point.x : isFiniteNumber(point.v) ? point.v : index + 1;
    const y = isFiniteNumber(point.y) ? point.y : isFiniteNumber(point.p) ? point.p : index + 1;

    return [{ label: String(point.label ?? index + 1), x, y }];
  });

  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const [minX, maxX] = [Math.min(...xs), Math.max(...xs)];
  const [minY, maxY] = [Math.min(...ys), Math.max(...ys)];
  const squashX = points.length > 0 && (maxX > 10 || minX < 0 || maxX - minX < 0.1);
  const squashY = points.length > 0 && (maxY > 10 || minY < 0 || maxY - minY < 0.1);

  const placed = points.map((point) => ({
    label: point.label,
    x: squashX ? (maxX === minX ? 4 : 2 + ((point.x - minX) / (maxX - minX)) * 4) : point.x,
    y: squashY ? (maxY === minY ? 3.5 : 1.5 + ((point.y - minY) / (maxY - minY)) * 4) : point.y,
  }));

  const elements: Raw[] = [
    {
      type: 'thermo_axes',
      xLabel,
      yLabel,
      originLabel: asString(axesRaw.origin_label) ?? '0',
      xLength: asNumber(axesRaw.x_length, 8),
      yLength: asNumber(axesRaw.y_length, 8),
    },
    ...placed.map((point) => ({ type: 'thermo_point', coords: [point.x, point.y], label: point.label })),
  ];

  const byLabel = new Map(placed.map((point) => [point.label, [point.x, point.y] as Vec2]));
  const byIndex = placed.map((point) => [point.x, point.y] as Vec2);

  const processesRaw = Array.isArray(raw.thermo_process) ? raw.thermo_process : Array.isArray(raw.path) ? raw.path : [];

  const explicit = processesRaw.flatMap((process) => {
    if (!isRecord(process)) return [];

    const from = process.from ?? process.start;
    const to = process.to ?? process.end;
    // Ссылки по номеру (0-based) или по метке точки.
    const resolve = (ref: unknown): Vec2 | undefined =>
      typeof ref === 'number' ? byIndex[ref] : typeof ref === 'string' ? (byLabel.get(ref) ?? byIndex[Number(ref)]) : undefined;
    const a = resolve(from);
    const b = resolve(to);

    if (!a || !b) return [];

    const kind = process.type === 'isotherm' || process.type === 'curve' ? 'isotherm' : process.type === 'isochor' ? 'isochor' : 'line';

    return [{ type: 'thermo_process', subtype: kind, points: [a, b] }];
  });

  if (explicit.length > 0) {
    elements.push(...explicit);
  } else {
    byIndex.slice(1).forEach((point, index) => {
      elements.push({ type: 'thermo_process', subtype: 'line', points: [byIndex[index], point] });
    });
  }

  return elements;
};

/** Элемент `graph` внутри физической сцены — график p(V) со своими осями. */
const graphElementToElements = (graph: Raw, index: number, total: number): Raw[] => {
  const originX = total === 1 ? -2.2 : -4.5 + index * 5.2;
  const originY = -2.2;
  const unit = 1.4;
  const axes = Array.isArray(graph.axes) ? graph.axes : [];
  const xLabel = asString(axes[1]) ?? 'V';
  const yLabel = asString(axes[0]) ?? 'p';
  const elements: Raw[] = [
    { type: 'thermo_axes', xLabel, yLabel, originLabel: '0', xLength: 4.2, yLength: 4.2, offset: [originX, originY] },
  ];
  const placed: Vec2[] = asVec2List(graph.points).map(([x, y]) => [originX + (x || 1) * unit, originY + (y || 1) * unit]);

  placed.forEach((point, position) => {
    elements.push({ type: 'thermo_point', coords: point, label: String(position + 1) });
  });

  placed.slice(1).forEach((point, position) => {
    elements.push({
      type: 'thermo_process',
      subtype: graph.curve === 'hyperbola' ? 'isotherm' : graph.curve === 'isochor' ? 'isochor' : 'line',
      points: [placed[position], point],
    });
  });

  if (asString(graph.title)) elements.push({ type: 'text_label', coords: [originX + 2, originY + 4.6], text: graph.title });

  return elements;
};

export const EMPTY_PHYSICS_SCENE: PhysicsScene = {
  type: 'physics',
  offsetX: 0,
  offsetY: 0,
  showGrid: true,
  elements: [],
};

/** Приводит сырую физическую сцену к модели; что угодно на входе — сцена на выходе. */
export const normalizePhysicsScene = (raw: unknown): PhysicsScene => {
  if (!isRecord(raw)) return { ...EMPTY_PHYSICS_SCENE, elements: [] };

  const thermo = thermoToElements(raw);
  const source = thermo ?? (Array.isArray(raw.elements) ? raw.elements : []);
  const graphs = source.filter((item): item is Raw => isRecord(item) && item.type === 'graph');
  const rest = source.filter((item): item is Raw => isRecord(item) && item.type !== 'graph');

  const flat = [
    ...rest.flatMap(expandGroup),
    ...graphs.flatMap((graph, index) => graphElementToElements(graph, index, graphs.length)),
  ];

  return {
    type: 'physics',
    scale: isFiniteNumber(raw.scale) && raw.scale > 0 ? raw.scale : undefined,
    offsetX: asNumber(raw.offsetX, 0),
    offsetY: asNumber(raw.offsetY, 0),
    showGrid: asBoolean(raw.showGrid, true),
    elements: flat.map(normalizePhysicsElement).filter((element): element is PhysicsElement => element !== null),
  };
};

// ------------------------------------------------------------------- общее

const PHYSICS_MARKERS = ['spring', 'pulley', 'lens', 'circuit_component', 'surface', 'wire', 'charge', 'piston_vessel', 'thermo_axes'];

/**
 * Чертёж это физика или геометрия? По явному типу, по термо-полям и по
 * элементам; подсказка предмета — последняя, когда в самой сцене ответа нет.
 */
export const detectDrawingKind = (raw: unknown, subjectHint?: DrawingKind): DrawingKind => {
  if (!isRecord(raw)) return subjectHint ?? 'geometry';

  const type = asString(raw.type) ?? '';

  if (type === 'physics' || type === 'mechanics_scene' || ['graph_pv', 'graph_pV', 'pv_diagram'].includes(type)) return 'physics';

  if (['2d', '3d', 'plot_2d'].includes(type)) return 'geometry';

  if (Object.keys(raw).some((key) => key.startsWith('thermo_'))) return 'physics';

  if (Array.isArray(raw.elements)) {
    const hasPhysics = raw.elements.some(
      (element) => isRecord(element) && (PHYSICS_MARKERS.includes(asString(element.type) ?? '') || asString(element.type) === 'graph'),
    );

    if (hasPhysics || raw.vertices === undefined) return 'physics';
  }

  if (raw.vertices !== undefined || raw.plots !== undefined || raw.edges !== undefined) return 'geometry';

  return subjectHint ?? 'geometry';
};

/** Есть ли в сцене что рисовать: пустые узлы показывают плейсхолдер. */
export const hasDrawableContent = (scene: GeometryScene | PhysicsScene): boolean =>
  scene.type === 'physics'
    ? scene.elements.length > 0
    : Object.keys(scene.vertices).length > 0 || scene.plots.length > 0;
