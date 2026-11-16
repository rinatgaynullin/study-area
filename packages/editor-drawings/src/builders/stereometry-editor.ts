import { createDisposer, el, on, type Translate, type Unsubscribe } from '@rich-editor/core';
import { project3dToPlane, projectOblique, rotatePoint3d, type SvgPoint, type Viewport } from '../render/coords';
import { renderGeometrySvg, resolveGeometryViewport } from '../render/geometry-svg';
import { fmt, pointsAttr } from '../render/svg-builder';
import { normalizeGeometryScene } from '../scene/normalize';
import type { AngleStyle, EdgeStyle, GeometryHighlight, GeometryScene, Point, Vec2, Vec3 } from '../scene/types';
import { angleBetween, distance, formatAngleMeasure, isAngleMeasureLabel, projectOnSegment, roundTo, snapToGrid } from './geometry-utils';
import { classifyEdges, supportPlanes, type SupportHull } from './hidden-lines';
import { HistoryStack } from './history';
import {
  STEREO_TEMPLATES,
  clampTemplateParams,
  roundBodyPoints,
  type StereoTemplate,
  type StereoTemplateId,
  type StereoTemplateParams,
} from './stereo-templates';
import { ChangeEmitter, HIT_RADIUS_PX, SketchCanvas, type PointerInfo } from './sketch-canvas';
import { ToolBar, actionButton, propertyField, selectControl, type ToolButton } from './tool-bar';
import type { RawScene, SceneEditor, SceneEditorContext, SceneEditorFactory } from './types';

type Tool = 'select' | 'point' | 'segment' | 'section' | 'angle' | 'delete';

const TOOLS: ToolButton<Tool>[] = [
  { id: 'select', labelKey: 'drawings_tool_select', glyph: '↖' },
  { id: 'point', labelKey: 'drawings_tool_point', glyph: '•' },
  { id: 'segment', labelKey: 'drawings_tool_segment', glyph: '╱' },
  { id: 'section', labelKey: 'drawings_tool_section', glyph: '◇' },
  { id: 'angle', labelKey: 'drawings_tool_angle', glyph: '∠' },
  { id: 'delete', labelKey: 'drawings_tool_delete', glyph: '✕' },
];

/** Ключи подсказок целиком, а не из префикса: проверка таблиц переводов ищет их в коде. */
const HINTS: Record<Tool, string> = {
  select: 'drawings_stereo_hint_select',
  point: 'drawings_stereo_hint_point',
  segment: 'drawings_stereo_hint_segment',
  section: 'drawings_stereo_hint_section',
  angle: 'drawings_stereo_hint_angle',
  delete: 'drawings_stereo_hint_delete',
};

/**
 * Полотно конструктора и его исходный масштаб. Экспортируется, чтобы тесты
 * считали координаты кликов той же проекцией, что и конструктор.
 */
export const STEREOMETRY_CANVAS = { width: 560, height: 420, scale: 40 } as const;

/** Вращение мышью: градусов на пиксель и предел наклона. */
const ROTATION_DEGREES_PER_PX = 0.8;
const MAX_TILT = 85;

/** Поворот вокруг вертикали — от −180° до 180°: так его показывает ползунок. */
const MAX_TURN = 180;

/** Сдвиг указателя в пикселях экрана, после которого нажатие — уже не клик, а перетаскивание. */
const DRAG_THRESHOLD_PX = 4;

/** Шаг поворота стрелками: обычный и с Shift. */
const KEY_TURN_STEP = 5;
const KEY_TURN_STEP_LARGE = 15;

/** Класс корня конструктора, пока сцену вращают или двигают полотно: курсор «схваченной руки». */
const ROTATING_CLASS = 'rte-stereo--rotating';

/** Вид по умолчанию у шаблонов и пустой сцены — как в оригинале. */
const DEFAULT_ANGLE_Y = 15;
const DEFAULT_ANGLE_Z = -30;

/** Прилипание точки на плоскости z = 0 к полуклеткам сетки. */
const GROUND_STEP = 0.5;

/** Доля ребра, ближе которой к концу точку не ставим: иначе она сольётся с вершиной. */
const EDGE_POINT_MIN_T = 0.1;
const EDGE_POINT_MAX_T = 0.9;

/** Определитель, при котором плоскость z = 0 считается видимой с ребра. */
const DEGENERATE_DET = 1e-6;

/**
 * Плоскость z = const видна почти с ребра (наклон около −19,5°): обратная
 * проекция уносит точку на десятки единиц, поэтому по горизонтали вершину не
 * двигаем и новую точку в пустоте не ставим.
 */
const SHALLOW_DET = 0.05;

/** Квадрат длины образа оси z, при котором она видна с торца и высоту мышью не поменять. */
const DEGENERATE_AXIS = 1e-6;

/** Положение подписи у новых точек: на ребре — над ним, на плоскости — у ног. */
const EDGE_POINT_LABEL = 'above';
const GROUND_POINT_LABEL = 'below right';

const DRAFT_COLOR = '#8b5cf6';
const SECTION_STROKE = '#10b981';
const RIGHT_ANGLE_TOLERANCE = 1.5;

const LABEL_POSITIONS = ['above', 'below', 'left', 'right', 'above left', 'above right', 'below left', 'below right'];
const ANGLE_STYLES: AngleStyle[] = ['single', 'double', 'triple', 'right'];

/** Инструменты, которые ставят новую точку в пустоте: им показывается высота новой точки. */
const HEIGHT_TOOLS: ReadonlySet<Tool> = new Set<Tool>(['point', 'segment']);

type ViewAngle = 'angleY' | 'angleZ';

/** Углы вида в начале жеста ползунка. */
type ViewAngles = Record<ViewAngle, number>;

/** Стрелки поворачивают вид: какой угол и в какую сторону. */
const VIEW_KEYS: Record<string, { angle: ViewAngle; sign: number }> = {
  ArrowLeft: { angle: 'angleZ', sign: -1 },
  ArrowRight: { angle: 'angleZ', sign: 1 },
  ArrowUp: { angle: 'angleY', sign: 1 },
  ArrowDown: { angle: 'angleY', sign: -1 },
};

interface SectionFill {
  value: string;
  labelKey: string;
}

/** Первая заливка — заливка по умолчанию, поэтому список непустой. */
const SECTION_FILLS: [SectionFill, ...SectionFill[]] = [
  { value: 'rgba(16, 185, 129, 0.25)', labelKey: 'drawings_stereo_fill_green' },
  { value: 'rgba(37, 99, 235, 0.25)', labelKey: 'drawings_stereo_fill_blue' },
  { value: 'rgba(249, 115, 22, 0.25)', labelKey: 'drawings_stereo_fill_orange' },
  { value: 'rgba(236, 72, 153, 0.25)', labelKey: 'drawings_stereo_fill_pink' },
  { value: 'rgba(100, 116, 139, 0.25)', labelKey: 'drawings_stereo_fill_gray' },
];

interface StereoEdge {
  from: string;
  to: string;
  style: EdgeStyle;
  color?: string;
  ticks?: number;
}

interface StereoSection {
  vertices: string[];
  fill?: string;
  stroke?: string;
}

/**
 * Тело вращения как оно пришло в сцену: исходная запись целиком, с чужими
 * полями, и правил ли пользователь радиус. `getScene` отдаёт запись обратно,
 * меняя только имена вершин и — после правки — радиус. Сам `radius` тела —
 * нормализованный: по нему рисуют и считают.
 */
interface BodySource {
  source: RawScene;
  radiusEdited: boolean;
}

interface StereoCylinder extends BodySource {
  base: string;
  top: string;
  radius: number;
}

interface StereoCone extends BodySource {
  base: string;
  apex: string;
  radius: number;
}

interface StereoSphere extends BodySource {
  center: string;
  radius: number;
}

/** Угол, как он пишется в сцену. */
interface SceneAngle {
  points: [string, string, string];
  style: AngleStyle;
  label?: string;
}

/**
 * Угол в состоянии: `measured` — подпись ведёт конструктор, это величина угла
 * в пространстве, и она пересчитывается при каждой правке геометрии. В сцену
 * признак не пишется, в снимках истории едет.
 */
interface StereoAngle extends SceneAngle {
  measured: boolean;
}

/**
 * Шаблон, которым построена фигура: его параметры и подпись построенной
 * геометрии. Пока геометрия сцены с подписью совпадает, фигуру можно
 * перестроить с другими параметрами.
 */
interface AppliedTemplate {
  id: StereoTemplateId;
  params: StereoTemplateParams;
  signature: string;
}

/** Живая сцена конструктора: 3D-подмножество `GeometryScene` плюс всё чужое как есть. */
interface StereometryState {
  vertices: Record<string, Vec3>;
  edges: StereoEdge[];
  sections: StereoSection[];
  cylinders: StereoCylinder[];
  cones: StereoCone[];
  spheres: StereoSphere[];
  angles: StereoAngle[];
  labels: Record<string, string>;
  angleY: number;
  angleZ: number;
  showGrid: boolean;
  showAxes: boolean;
  /**
   * Шаблон последнего построения. Не часть сцены (`getScene` его не пишет), но
   * едет в снимках истории: отмена смены параметра возвращает и прежние параметры.
   */
  template: AppliedTemplate | null;
  /**
   * Пунктир по невидимости расставляется сам при каждой правке и вращении. Не
   * часть сцены, но едет в снимках истории: отмена возвращает флаг вместе со
   * стилями. Ручная смена стиля ребра его выключает.
   */
  autoHidden: boolean;
  /** Поля сцены, которых конструктор не знает: уходят обратно нетронутыми. */
  extra: RawScene;
}

/** Поля сцены с телами вращения и имена их ссылок на вершины — как их отбирает нормализация. */
const BODY_FIELDS: Record<BodyKind, string[]> = { cylinders: ['base', 'top'], cones: ['base', 'apex'], spheres: ['center'] };

/** Ссылка тела вращения на вершину: центр основания, вершина конуса, центр шара. */
type BodyKind = 'cylinders' | 'cones' | 'spheres';

type BodyRef = { kind: BodyKind; index: number };

/** Углы вида и рёбра в начале жеста ползунка: вид до жеста вместе с его пунктиром. */
type SlideStart = ViewAngles & { edges: StereoEdge[] };

/** Что выбрано на полотне. */
type Selection =
  | { type: 'vertex'; id: string }
  | { type: 'edge'; index: number }
  | { type: 'section'; index: number }
  | { type: 'angle'; index: number }
  | null;

/**
 * Жест указателя от нажатия до отпускания. `x`, `y` — экранная точка: у
 * нажатия по пустому месту и у вершины — где нажали, у вращения — последняя.
 */
type Gesture =
  /** Нажатие по пустому месту: клик, пока указатель не ушёл дальше порога. */
  | { type: 'empty'; pointerId: number; x: number; y: number; info: PointerInfo }
  /** Панорама основной кнопкой: `x`, `y` и `cx`, `cy` — указатель и центр окна там, где пройден порог. */
  | { type: 'pan'; pointerId: number; x: number; y: number; cx: number; cy: number }
  /** Вращение сцены; `recorded` — снимок истории уже сделан. */
  | { type: 'rotate'; pointerId: number; x: number; y: number; recorded: boolean }
  /**
   * Перетаскивание вершины: где она была, где нажали (единицы мира) и на
   * сколько нажатие разошлось с её проекцией; `moving` — порог пройден.
   * `alt` — состояние Alt, при котором взяты `start`, `grab` и `offset`.
   */
  | { type: 'vertex'; pointerId: number; x: number; y: number; id: string; start: Vec3; grab: Vec2; offset: Vec2; moving: boolean; alt: boolean };

type VertexDrag = Extract<Gesture, { type: 'vertex' }>;

type EdgeSelection = Extract<Selection, { type: 'edge' }>;

/** Конец ребра: `from` или `to`. */
type EdgeEnd = 'from' | 'to';

const KNOWN_KEYS = new Set([
  'type',
  'vertices',
  'edges',
  'angles',
  'markings',
  'labels',
  'sections',
  'cylinders',
  'cones',
  'spheres',
  'angleY',
  'angleZ',
  'showGrid',
  'grid',
  'showAxes',
  'scale',
  'offsetX',
  'offsetY',
]);

const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));

/** Поворот вокруг вертикали — по кругу: 370° и 10° — один и тот же вид. */
const wrapDegrees = (value: number): number => ((((value + 180) % 360) + 360) % 360) - 180;

/** Угол вида в допустимых пределах: наклон упирается в ±85°, поворот идёт по кругу. */
const normalizeView = (angle: ViewAngle, value: number): number => (angle === 'angleY' ? clamp(value, -MAX_TILT, MAX_TILT) : wrapDegrees(value));

/** Высота с прилипанием к полуклеткам, как у точек на плоскости. */
const snapHeight = (z: number): number => Math.round(z / GROUND_STEP) * GROUND_STEP;

const toVec3 = (point: Point): Vec3 => [point[0], point[1], point[2] ?? 0];

const isRawRecord = (value: unknown): value is RawScene => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Исходные записи тел вида `kind` в том порядке, в каком их оставляет
 * нормализация: записи с именами всех вершин строками.
 */
const rawBodies = (raw: RawScene, kind: BodyKind): RawScene[] => {
  const list = raw[kind];

  if (!Array.isArray(list)) return [];

  return list.filter((item): item is RawScene => isRawRecord(item) && BODY_FIELDS[kind].every((name) => typeof item[name] === 'string'));
};

/** Тело с исходной записью: нормализованные поля плюс копия записи, радиус не правлен. */
const withSource = <T extends object>(body: T, source: RawScene): T & BodySource => ({ ...body, source: { ...source }, radiusEdited: false });

/** Запись тела для сцены: исходная, с текущими именами вершин и радиусом — исходным, пока его не правили. */
const bodyRecord = (body: BodySource & { radius: number }, names: RawScene): RawScene => ({
  ...body.source,
  ...names,
  ...(body.radiusEdited ? { radius: roundTo(body.radius) } : {}),
});

const roundVec3 = (point: Vec3): Vec3 => [roundTo(point[0]), roundTo(point[1]), roundTo(point[2])];

const toVec2 = (point: SvgPoint): Vec2 => [point.x, point.y];

const copyEdge = (edge: StereoEdge): StereoEdge => ({
  from: edge.from,
  to: edge.to,
  style: edge.style,
  ...(edge.color ? { color: edge.color } : {}),
  ...(edge.ticks ? { ticks: edge.ticks } : {}),
});

const copyAngle = (angle: SceneAngle): SceneAngle => ({
  points: [...angle.points] as [string, string, string],
  style: angle.style,
  ...(angle.label ? { label: angle.label } : {}),
});

const copySection = (section: StereoSection): StereoSection => ({
  vertices: [...section.vertices],
  ...(section.fill ? { fill: section.fill } : {}),
  ...(section.stroke ? { stroke: section.stroke } : {}),
});

/** Следующее свободное имя точки: A…Z, потом A1, B1… */
const nextVertexName = (used: Record<string, unknown>): string => {
  for (let round = 0; round < 10; round += 1) {
    for (let code = 65; code <= 90; code += 1) {
      const name = `${String.fromCharCode(code)}${round === 0 ? '' : round}`;

      if (!(name in used)) return name;
    }
  }

  return `P${Object.keys(used).length + 1}`;
};

/** Угол между лучами `vertex→a` и `vertex→b` в пространстве, градусы 0–180. */
const angle3d = (vertex: Vec3, a: Vec3, b: Vec3): number => {
  const u: Vec3 = [a[0] - vertex[0], a[1] - vertex[1], a[2] - vertex[2]];
  const w: Vec3 = [b[0] - vertex[0], b[1] - vertex[1], b[2] - vertex[2]];
  const length = Math.hypot(...u) * Math.hypot(...w);

  if (length === 0) return 0;

  const cos = (u[0] * w[0] + u[1] * w[1] + u[2] * w[2]) / length;

  return (Math.acos(clamp(cos, -1, 1)) * 180) / Math.PI;
};

/** Точка внутри многоугольника — лучом вправо, по чётности пересечений. */
const insidePolygon = (point: SvgPoint, polygon: SvgPoint[]): boolean => {
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];

    if (a && b) {
      const straddles = a.y > point.y !== b.y > point.y;

      if (straddles && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
  }

  return inside;
};

/**
 * Имена трёх вершин из текста «SOH»: буква с необязательным индексом
 * (`SA1B` → S, A1, B) либо три слова через пробел или запятую. Регистр не
 * важен; все три должны быть разными вершинами сцены.
 */
export const parseAngleVertices = (text: string, names: string[]): [string, string, string] | null => {
  const words = text.trim().split(/[\s,;]+/).filter(Boolean);
  const parts = words.length === 3 ? words : (text.match(/[A-Za-zА-Яа-яЁё][0-9]*/g) ?? []);

  if (parts.length !== 3) return null;

  const byUpper = new Map(names.map((name) => [name.toUpperCase(), name]));
  const found = parts.map((part) => byUpper.get(part.toUpperCase()));

  if (found.some((name) => name === undefined) || new Set(found).size < 3) return null;

  return found as [string, string, string];
};

/** Точка сцены на полотне: поворот и кабинетная проекция — ровно как в `renderGeometrySvg`. */
export const projectVertex = (point: Point, angleY: number, angleZ: number, viewport: Viewport): SvgPoint =>
  projectOblique(rotatePoint3d(point, angleY, angleZ), viewport.scale, viewport.cx, viewport.cy);

/**
 * Обратная проекция точки картинки (в единицах мира, как `SketchCanvas.toWorld`)
 * на плоскость z = 0. Проекция линейна по (x, y), поэтому её матрица 2×2 —
 * образы единичных векторов плоскости; система решается по Крамеру.
 */
export const unprojectToGround = (plane: Vec2, angleY: number, angleZ: number): Vec2 => {
  const [a, c] = project3dToPlane([1, 0, 0], angleY, angleZ);
  const [b, d] = project3dToPlane([0, 1, 0], angleY, angleZ);
  const det = a * d - b * c;
  const [px, py] = plane;

  if (Math.abs(det) > DEGENERATE_DET) {
    return [(px * d - b * py) / det, (a * py - c * px) / det];
  }

  // Плоскость видна с ребра (наклон ≈ −19,5°): обратной проекции нет, и точка
  // ложится на повёрнутую ось y туда, где курсор по горизонтали.
  const radians = (angleZ * Math.PI) / 180;

  return [px * Math.sin(radians), px * Math.cos(radians)];
};

/**
 * Обратная проекция точки картинки на плоскость z = `z`. Проекция линейна,
 * поэтому достаточно вычесть образ отрезка высоты `z * e3`, где `e3` — образ
 * оси z, и решить задачу для плоскости z = 0.
 */
export const unprojectToHeight = (plane: Vec2, z: number, angleY: number, angleZ: number): Vec2 => {
  const [ex, ey] = project3dToPlane([0, 0, 1], angleY, angleZ);

  return unprojectToGround([plane[0] - z * ex, plane[1] - z * ey], angleY, angleZ);
};

/** Плоскость z = const видна почти с ребра: определитель обратной проекции мал. */
const isShallowView = (angleY: number, angleZ: number): boolean => {
  const [a, c] = project3dToPlane([1, 0, 0], angleY, angleZ);
  const [b, d] = project3dToPlane([0, 1, 0], angleY, angleZ);

  return Math.abs(a * d - b * c) < SHALLOW_DET;
};

// ----------------------------------------------- невидимые линии и шаблоны

/** Подпись геометрии для оболочки: вершины и тела вращения. */
const hullSignature = (state: StereometryState): string => JSON.stringify([state.vertices, state.cylinders, state.cones, state.spheres]);

/** Подпись геометрии шаблона: вершины, рёбра без стилей и тела вращения. */
const templateSignature = (state: StereometryState): string =>
  JSON.stringify([state.vertices, state.edges.map((target) => [target.from, target.to]), state.cylinders, state.cones, state.spheres]);

/** Тела вращения, которые ссылаются на вершину: цилиндр — центрами оснований, конус — центром и вершиной, шар — центром. */
const bodyRefsOf = (state: StereometryState, id: string): BodyRef[] => [
  ...state.cylinders.flatMap((cylinder, index): BodyRef[] => (cylinder.base === id || cylinder.top === id ? [{ kind: 'cylinders', index }] : [])),
  ...state.cones.flatMap((cone, index): BodyRef[] => (cone.base === id || cone.apex === id ? [{ kind: 'cones', index }] : [])),
  ...state.spheres.flatMap((sphere, index): BodyRef[] => (sphere.center === id ? [{ kind: 'spheres', index }] : [])),
];

/** Величина угла в пространстве, градусы; `null`, если какой-то его вершины нет. */
const angleDegrees = (vertices: Record<string, Vec3>, angle: SceneAngle): number | null => {
  const [a, vertex, b] = angle.points.map((name) => vertices[name]);

  return a && vertex && b ? angle3d(vertex, a, b) : null;
};

/** Подписи углов, которые ведёт конструктор, — по текущей геометрии. Угол с битой ссылкой не трогаем. */
const updateAngleMeasures = (state: StereometryState): void => {
  state.angles.forEach((angle) => {
    const degrees = angle.measured ? angleDegrees(state.vertices, angle) : null;

    if (degrees !== null) angle.label = formatAngleMeasure(degrees);
  });
};

/** Угол со стилем «прямой», который в новой геометрии уже не прямой, — одной дугой. */
const keepRightAngle = (state: StereometryState, angle: StereoAngle): StereoAngle => {
  const [a, vertex, b] = angle.points.map((name) => state.vertices[name]);

  if (angle.style !== 'right' || !a || !vertex || !b) return angle;

  return Math.abs(angle3d(vertex, a, b) - 90) < RIGHT_ANGLE_TOLERANCE ? angle : { ...angle, style: 'single' };
};

const findTemplate = (id: string): StereoTemplate | undefined => STEREO_TEMPLATES.find((template) => template.id === id);

/**
 * Фигура шаблона в состояние: геометрия, подписи и запись о построении.
 * Рёбра через центр (диаметр основания) делятся сразу, как это сделал бы
 * `afterChange`: подпись снимается с той геометрии, что останется в сцене.
 */
const placeTemplate = (state: StereometryState, template: StereoTemplate, params: StereoTemplateParams): void => {
  const built = template.build(params);
  const edges = built.edges.map((target): StereoEdge => ({ from: target.from, to: target.to, style: 'solid' }));

  state.vertices = built.vertices;
  state.edges = normalizeGeometryScene({ type: '3d', vertices: built.vertices, edges }).edges.map(copyEdge);
  state.labels = built.labels;
  state.cylinders = built.cylinders.map((cylinder) => withSource(cylinder, { ...cylinder }));
  state.cones = built.cones.map((cone) => withSource(cone, { ...cone }));
  state.spheres = built.spheres.map((sphere) => withSource(sphere, { ...sphere }));
  state.template = { id: template.id, params, signature: templateSignature(state) };
};

/**
 * Невидимые рёбра с кэшем оболочки: опорные плоскости пересчитываются, только
 * когда меняется геометрия (вершины, тела вращения), а при вращении рёбра лишь
 * заново сверяются с уже найденными плоскостями.
 */
class HiddenLines {
  private signature: string | null = null;

  private hull: SupportHull = { planes: [], tolerance: 0 };

  /** Стили рёбер в порядке `state.edges` для текущего вида; `null` — оболочки нет, стили трогать не нужно. */
  styles(state: StereometryState): EdgeStyle[] | null {
    const signature = hullSignature(state);

    if (signature !== this.signature) {
      this.signature = signature;
      this.hull = supportPlanes([...Object.values(state.vertices), ...roundBodyPoints(state.vertices, state)]);
    }

    if (this.hull.planes.length === 0) return null;

    return classifyEdges(this.hull, state.vertices, state.edges, state.angleY, state.angleZ);
  }
}

/**
 * Конструктор стереометрии: вершины, рёбра, сечения, углы и тела вращения
 * в кабинетной проекции. Сцену вращают перетаскиванием пустого места (любой
 * кнопкой, кроме средней), стрелками и ползунками; вершины в «Выборе» тащатся мышью.
 *
 * Инструмент, черновик, выделение, жест указателя, высота новой точки, история
 * и сцена — общее состояние обработчиков указателя, клавиатуры и панели
 * свойств, поэтому класс.
 */
class StereometryEditor implements SceneEditor {
  readonly element: HTMLElement;

  private readonly t: Translate;

  private readonly disposer = createDisposer();

  private readonly changes = new ChangeEmitter();

  private readonly history = new HistoryStack<StereometryState>();

  private readonly canvas: SketchCanvas;

  private readonly tools: ToolBar<Tool>;

  private readonly hint: HTMLElement;

  private readonly properties: HTMLElement;

  private state: StereometryState = StereometryEditor.emptyState();

  private tool: Tool = 'select';

  private selection: Selection = null;

  /** Вершины, уже выбранные текущим инструментом: начало отрезка, стороны угла, контур сечения. */
  private draft: string[] = [];

  /** Курсор в координатах картинки — для черновика отрезка и сечения; `null` — указатель вне полотна. */
  private cursor: SvgPoint | null = null;

  /** Shift у последнего движения: подсказка высоты показывает точку без прилипания. */
  private cursorFree = false;

  /** Текущий жест указателя; `null`, когда кнопки отпущены. */
  private gesture: Gesture | null = null;

  /** Высота, на которую встают новые точки в пустоте. Не часть сцены и не часть истории. */
  private pointHeight = 0;

  /**
   * Углы вида и рёбра в начале жеста ползунка; `null` — ползунок не тянут.
   * Снимок в историю пишется по окончании жеста и только если вид изменился.
   */
  private slideFrom: SlideStart | null = null;

  private readonly hiddenLines = new HiddenLines();

  /**
   * Какой конец выбранного ребра двигает поле «Длина». Привязан к объекту
   * выделения: новое выделение — снова второй конец. Не часть сцены и истории.
   */
  private lengthEnd: { selection: EdgeSelection; end: EdgeEnd } | null = null;

  constructor(context: SceneEditorContext) {
    this.t = context.t;

    this.canvas = new SketchCanvas({
      width: STEREOMETRY_CANVAS.width,
      height: STEREOMETRY_CANVAS.height,
      scale: STEREOMETRY_CANVAS.scale,
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
        actionButton(this.t('drawings_grid'), '#', () => this.toggleGrid()),
        actionButton(this.t('drawings_stereo_axes'), 'xyz', () => this.toggleAxes()),
        actionButton(this.t('drawings_zoom_in'), '+', () => this.canvas.zoomBy(1.25)),
        actionButton(this.t('drawings_zoom_out'), '−', () => this.canvas.zoomBy(0.8)),
        actionButton(this.t('drawings_zoom_reset'), '⌂', () => this.fitView()),
      ],
    });

    const palette = el('div', {
      class: 'rte-builder__palette',
      attrs: { role: 'group', 'aria-label': this.t('drawings_stereo_templates') },
      children: STEREO_TEMPLATES.map((template) => {
        const label = this.t(template.labelKey);

        return el('button', {
          class: 'rte-builder__tool',
          attrs: { type: 'button', title: label, 'data-template': template.id },
          children: [el('span', { class: 'rte-builder__tool-glyph', text: template.glyph }), el('span', { class: 'rte-builder__tool-label', text: label })],
        });
      }),
    });

    this.disposer.add(
      on(palette, 'click', (event) => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-template]');

        if (button) this.applyTemplate(button.dataset.template ?? '');
      }),
    );

    this.disposer.add(
      on(this.canvas.element, 'pointerleave', () => {
        this.cursor = null;
        this.renderOverlay();
      }),
    );
    // Захват отняли без отпускания кнопки: жест обрывается, отложенный клик не выполняется.
    this.disposer.add(
      on(this.canvas.element, 'lostpointercapture', (event) => {
        if (this.gesture?.pointerId === event.pointerId) this.finishGesture(false);
      }),
    );

    this.hint = el('p', { class: 'rte-builder__hint', attrs: { role: 'status' } });
    this.properties = el('div', { class: 'rte-builder__props', attrs: { 'aria-live': 'polite' } });

    this.element = el('div', {
      class: 'rte-builder rte-builder--stereometry',
      children: [
        el('div', { class: 'rte-builder__bar', children: [this.tools.element, actions] }),
        palette,
        el('div', { class: 'rte-builder__body', children: [this.canvas.element, this.properties] }),
        this.hint,
      ],
    });

    this.setTool('select');
  }

  static emptyState(): StereometryState {
    return {
      vertices: {},
      edges: [],
      sections: [],
      cylinders: [],
      cones: [],
      spheres: [],
      angles: [],
      labels: {},
      angleY: DEFAULT_ANGLE_Y,
      angleZ: DEFAULT_ANGLE_Z,
      showGrid: true,
      showAxes: false,
      template: null,
      autoHidden: true,
      extra: {},
    };
  }

  // ----------------------------------------------------------- SceneEditor

  load(raw: RawScene): void {
    const scene = normalizeGeometryScene(raw);
    const vertices: Record<string, Vec3> = {};

    Object.entries(scene.vertices).forEach(([name, point]) => {
      vertices[name] = toVec3(point);
    });

    const extra: RawScene = {};

    Object.entries(raw).forEach(([key, value]) => {
      // Тела не массивом конструктор не разбирает: они уходят обратно как есть.
      if (!KNOWN_KEYS.has(key) || (key in BODY_FIELDS && !Array.isArray(value))) extra[key] = value;
    });

    // Исходные записи тел: в сцену они вернутся целиком, с чужими полями.
    const sources = { cylinders: rawBodies(raw, 'cylinders'), cones: rawBodies(raw, 'cones'), spheres: rawBodies(raw, 'spheres') };

    this.state = {
      vertices,
      edges: scene.edges.map(copyEdge),
      sections: scene.sections.map(copySection),
      cylinders: scene.cylinders.map((cylinder, index) => withSource(cylinder, sources.cylinders[index] ?? { ...cylinder })),
      cones: scene.cones.map((cone, index) => withSource(cone, sources.cones[index] ?? { ...cone })),
      spheres: scene.spheres.map((sphere, index) => withSource(sphere, sources.spheres[index] ?? { ...sphere })),
      // Подпись, равная величине угла, ведётся дальше сама; чужую («α», «45°» не в масштабе) не трогаем.
      angles: scene.angles.map((angle) => {
        const degrees = angleDegrees(vertices, angle);

        return { ...copyAngle(angle), measured: degrees !== null && isAngleMeasureLabel(angle.label, degrees) };
      }),
      labels: { ...scene.labels },
      angleY: clamp(scene.angleY, -MAX_TILT, MAX_TILT),
      angleZ: wrapDegrees(scene.angleZ),
      showGrid: scene.showGrid,
      showAxes: scene.showAxes,
      template: null,
      autoHidden: true,
      extra,
    };

    // Сцену размечали вручную или нейросеть: пунктир сам ставится, только если
    // расчёт совпал с сохранённым, иначе разметку молча не переписываем. Без
    // оболочки сверять не с чем — ручной пунктир плоской заготовки бережём.
    const styles = this.hiddenLines.styles(this.state);

    this.state.autoHidden =
      styles === null
        ? this.state.edges.every((target) => target.style !== 'dashed')
        : styles.every((style, index) => this.state.edges[index]?.style === style);
    this.history.clear();
    this.selection = null;
    this.draft = [];
    this.gesture = null;
    this.slideFrom = null;
    this.pointHeight = 0;
    this.element.classList.remove(ROTATING_CLASS);
    this.fitView();
    this.renderProperties();
  }

  getScene(): RawScene {
    const { state } = this;
    const scene: RawScene = {
      ...state.extra,
      type: '3d',
      vertices: Object.fromEntries(Object.entries(state.vertices).map(([name, point]) => [name, roundVec3(point)])),
      edges: state.edges.map(copyEdge),
      angleY: roundTo(state.angleY),
      angleZ: roundTo(state.angleZ),
    };

    if (state.angles.length > 0) scene.angles = state.angles.map(copyAngle);

    if (Object.keys(state.labels).length > 0) scene.labels = { ...state.labels };

    if (state.sections.length > 0) scene.sections = state.sections.map(copySection);

    if (state.cylinders.length > 0) {
      scene.cylinders = state.cylinders.map((cylinder) => bodyRecord(cylinder, { base: cylinder.base, top: cylinder.top }));
    }

    if (state.cones.length > 0) {
      scene.cones = state.cones.map((cone) => bodyRecord(cone, { base: cone.base, apex: cone.apex }));
    }

    if (state.spheres.length > 0) {
      scene.spheres = state.spheres.map((sphere) => bodyRecord(sphere, { center: sphere.center }));
    }

    if (!state.showGrid) scene.showGrid = false;

    if (state.showAxes) scene.showAxes = true;

    return scene;
  }

  onChange(listener: () => void): Unsubscribe {
    return this.changes.on(listener);
  }

  focus(): void {
    this.canvas.focus();
  }

  destroy(): void {
    this.disposer.dispose();
    this.changes.clear();
    this.tools.destroy();
    this.canvas.destroy();
    this.element.remove();
  }

  // --------------------------------------------------------------- рендер

  /**
   * Сцена для рендера: окно просмотра полотна вместо autoFit. Тип всегда
   * `3d` — иначе фигуру, у которой все точки легли на z = 0, нормализация
   * понизила бы до плоской, и клики перестали бы совпадать с картинкой.
   */
  private renderScene(): GeometryScene {
    const { viewport } = this.canvas;

    return {
      ...normalizeGeometryScene(this.getScene()),
      type: '3d',
      scale: viewport.scale,
      offsetX: viewport.cx - STEREOMETRY_CANVAS.width / 2,
      offsetY: viewport.cy - STEREOMETRY_CANVAS.height / 2,
      showGrid: this.state.showGrid,
      showAxes: this.state.showAxes,
    };
  }

  private highlight(): GeometryHighlight | null {
    const { selection, state } = this;

    // Черновик угла рисует общий рендер: он знает, где лежат вершины в проекции.
    if (this.tool === 'angle' && this.draft.length > 0) return { type: 'angle_draft', points: [...this.draft] };

    if (!selection) return null;

    switch (selection.type) {
      case 'vertex':
        return { type: 'vertex', id: selection.id };
      case 'edge': {
        const target = state.edges[selection.index];

        return target ? { type: 'edge', from: target.from, to: target.to } : null;
      }
      case 'section': {
        const section = state.sections[selection.index];

        return section ? { type: 'section', vertices: section.vertices } : null;
      }
      case 'angle': {
        const angle = state.angles[selection.index];

        return angle ? { type: 'angle', id: `angle_${angle.points.join('')}` } : null;
      }
      default:
        return null;
    }
  }

  private render(): void {
    this.canvas.setScene(
      renderGeometrySvg(this.renderScene(), { width: STEREOMETRY_CANVAS.width, height: STEREOMETRY_CANVAS.height, highlight: this.highlight() }),
    );
    this.renderOverlay();
  }

  /** Черновик отрезка или сечения: кружки выбранных вершин, линия к курсору, контур. */
  private renderOverlay(): void {
    if (this.tool === 'angle') {
      this.canvas.setOverlay('');

      return;
    }

    const placed = this.draft.map((name) => this.project(name)).filter((point): point is SvgPoint => point !== null);
    const parts = placed.map(
      (at) => `<circle cx="${fmt(at.x)}" cy="${fmt(at.y)}" r="9" fill="none" stroke="${DRAFT_COLOR}" stroke-width="2" stroke-dasharray="3 3" />`,
    );

    const [from] = placed;

    if (this.tool === 'segment' && from && placed.length === 1 && this.cursor) {
      parts.push(
        `<line x1="${fmt(from.x)}" y1="${fmt(from.y)}" x2="${fmt(this.cursor.x)}" y2="${fmt(this.cursor.y)}" stroke="${DRAFT_COLOR}" stroke-width="1.5" stroke-dasharray="4 3" />`,
      );
    }

    if (this.tool === 'section' && placed.length >= 2) {
      const outline = this.cursor ? [...placed, this.cursor] : placed;

      parts.push(
        `<polygon points="${pointsAttr(outline)}" fill="rgba(16, 185, 129, 0.12)" stroke="${DRAFT_COLOR}" stroke-width="1.5" stroke-dasharray="4 3" />`,
      );
    }

    parts.push(this.heightHint());
    this.canvas.setOverlay(parts.join(''));
  }

  /**
   * Подсказка высоты новой точки: призрачная точка там, где она встанет, и
   * пунктирный отвес до её тени на z = 0. Только у инструментов, ставящих
   * точки, над пустым местом полотна и вне жеста.
   */
  private heightHint(): string {
    const { cursor, state } = this;

    if (!cursor || this.pointHeight === 0 || !HEIGHT_TOOLS.has(this.tool) || this.gesture) return '';

    if (this.vertexAt(cursor) !== null || this.edgeAt(cursor) !== null) return '';

    const point = this.placeAtHeight(this.canvas.toWorld(cursor), this.cursorFree);

    if (!point) return '';

    const top = projectVertex(point, state.angleY, state.angleZ, this.canvas.viewport);
    const foot = projectVertex([point[0], point[1], 0], state.angleY, state.angleZ, this.canvas.viewport);

    return (
      `<line x1="${fmt(top.x)}" y1="${fmt(top.y)}" x2="${fmt(foot.x)}" y2="${fmt(foot.y)}" stroke="${DRAFT_COLOR}" stroke-width="1.5" stroke-dasharray="4 3" />` +
      `<circle cx="${fmt(foot.x)}" cy="${fmt(foot.y)}" r="2.5" fill="${DRAFT_COLOR}" opacity="0.5" />` +
      `<circle cx="${fmt(top.x)}" cy="${fmt(top.y)}" r="5" fill="${DRAFT_COLOR}" opacity="0.6" />`
    );
  }

  /**
   * Новая точка под курсором на плоскости z = высота новой точки; `free`
   * отключает прилипание. `null`, если плоскость видна почти с ребра.
   */
  private placeAtHeight(world: Vec2, free: boolean): Vec3 | null {
    const { angleY, angleZ } = this.state;

    if (isShallowView(angleY, angleZ)) return null;

    const height = roundTo(this.pointHeight);
    const plane = unprojectToHeight(world, height, angleY, angleZ);
    const [x, y] = free ? plane : snapToGrid(plane, GROUND_STEP);

    return [roundTo(x), roundTo(y), height];
  }

  /** Вершина на полотне в координатах картинки; `null`, если такой нет. */
  private project(name: string): SvgPoint | null {
    const point = this.state.vertices[name];

    return point ? projectVertex(point, this.state.angleY, this.state.angleZ, this.canvas.viewport) : null;
  }

  private fitView(): void {
    const scene: GeometryScene = { ...normalizeGeometryScene(this.getScene()), type: '3d' };
    const { width, height, scale } = STEREOMETRY_CANVAS;

    this.canvas.setViewport(
      Object.keys(scene.vertices).length > 0
        ? resolveGeometryViewport(scene, { width, height, autoFit: true })
        : { scale, cx: width / 2, cy: height / 2 },
    );
  }

  // ------------------------------------------------------------ изменения

  private commit(mutate: (state: StereometryState) => void): void {
    // Незакрытый жест ползунка получает свой шаг истории раньше этой правки.
    this.closeSlide();
    this.history.record(this.state);
    mutate(this.state);
    this.afterChange();
  }

  /**
   * После правки: деление рёбер, величины углов, пунктир по невидимости, рисунок, панель.
   * `autoHidden: false` — у отмены и повтора: стили возвращаются из снимка как есть.
   */
  private afterChange(autoHidden = true): void {
    this.splitEdgesInState();
    updateAngleMeasures(this.state);

    if (autoHidden) this.applyAutoHidden();

    this.render();
    this.renderProperties();
    this.changes.emit();
  }

  /** Флажок включён и у фигуры есть оболочка — каждое ребро получает стиль по невидимости. */
  private applyAutoHidden(): void {
    if (!this.state.autoHidden) return;

    const styles = this.hiddenLines.styles(this.state);

    if (!styles) return;

    this.state.edges.forEach((target, index) => {
      target.style = styles[index] ?? target.style;
    });
  }

  /** Флажок автоматического пунктира — шаг истории; включение сразу расставляет пунктир. */
  private toggleAutoHidden(): void {
    this.commit((state) => {
      state.autoHidden = !state.autoHidden;
    });
  }

  /** Точка, попавшая на ребро (в том числе координатами из панели), делит его сразу. */
  private splitEdgesInState(): void {
    const normalized = normalizeGeometryScene({ type: '3d', vertices: this.state.vertices, edges: this.state.edges });

    if (normalized.edges.length !== this.state.edges.length) this.state.edges = normalized.edges.map(copyEdge);
  }

  /** Идёт жест, который меняет сцену или вид по ходу: вращение, панорама, перетаскивание вершины, ползунок. */
  private changing(): boolean {
    const type = this.gesture?.type;

    return type === 'rotate' || type === 'vertex' || type === 'pan' || this.slideFrom !== null;
  }

  private undo(): void {
    // Посреди жеста отмена подменила бы сцену под ним: ждём его окончания.
    if (this.changing()) return;

    const previous = this.history.undo(this.state);

    if (!previous) return;

    this.state = previous;
    this.selection = null;
    this.draft = [];
    this.afterChange(false);
  }

  private redo(): void {
    if (this.changing()) return;

    const next = this.history.redo(this.state);

    if (!next) return;

    this.state = next;
    this.selection = null;
    this.draft = [];
    this.afterChange(false);
  }

  private toggleGrid(): void {
    this.commit((state) => {
      state.showGrid = !state.showGrid;
    });
  }

  private toggleAxes(): void {
    this.commit((state) => {
      state.showAxes = !state.showAxes;
    });
  }

  private setTool(tool: Tool): void {
    this.tool = tool;
    this.draft = [];
    this.tools.setActive(tool);
    this.hint.textContent = `${this.t(HINTS[tool])}. ${this.t('drawings_stereo_hint_rotate')}`;
    this.render();
    this.renderProperties();
  }

  /**
   * Шаблон заменяет сцену целиком, возвращает вид по умолчанию и вписывает
   * фигуру в полотно; пунктир дальше расставляется сам.
   */
  private applyTemplate(id: string): void {
    const template = findTemplate(id);

    if (!template) return;

    this.draft = [];
    this.selection = null;
    this.pointHeight = 0;
    this.commit((state) => {
      placeTemplate(state, template, template.defaults);
      state.autoHidden = true;
      state.sections = [];
      state.angles = [];
      state.angleY = DEFAULT_ANGLE_Y;
      state.angleZ = DEFAULT_ANGLE_Z;
      state.extra = {};
    });
    this.fitView();
  }

  /**
   * Та же фигура с новыми параметрами одним шагом истории: вид, сетка и оси
   * остаются, сечения и углы — если все их вершины есть в новой фигуре;
   * прямой угол, переставший быть прямым, рисуется одной дугой.
   */
  private rebuildTemplate(applied: AppliedTemplate, params: StereoTemplateParams): void {
    const template = findTemplate(applied.id);

    if (!template) return;

    const next = clampTemplateParams(template, params);

    // Значение упёрлось в предел и ничего не поменяло: поле просто показывает прежнее.
    if (JSON.stringify(next) === JSON.stringify(applied.params)) {
      this.renderProperties();

      return;
    }

    // Черновик и выделение могли ссылаться на вершины, которых в новой фигуре нет.
    this.draft = [];
    this.selection = null;
    this.cursor = null;
    this.commit((state) => {
      placeTemplate(state, template, next);
      state.autoHidden = true;

      const exists = (name: string): boolean => Object.hasOwn(state.vertices, name);

      state.sections = state.sections.filter((section) => section.vertices.every(exists));
      state.angles = state.angles.filter((angle) => angle.points.every(exists)).map((angle) => keepRightAngle(state, angle));
    });
    this.fitView();
  }

  /** Шаблон, которым построена фигура, пока её геометрию не правили иначе; `null` — правили или шаблона не было. */
  private activeTemplate(): { template: StereoTemplate; applied: AppliedTemplate } | null {
    const applied = this.state.template;

    if (!applied || applied.signature !== templateSignature(this.state)) return null;

    const template = findTemplate(applied.id);

    return template ? { template, applied } : null;
  }

  /** «Сбросить вид»: углы по умолчанию одним шагом истории и фигура целиком на полотне. */
  private resetView(): void {
    this.commit((state) => {
      state.angleY = DEFAULT_ANGLE_Y;
      state.angleZ = DEFAULT_ANGLE_Z;
    });
    this.fitView();
  }

  // ------------------------------------------------------------- хит-тест

  private vertexAt(at: SvgPoint): string | null {
    let best: { name: string; d: number } | null = null;

    for (const name of Object.keys(this.state.vertices)) {
      const placed = this.project(name);

      if (!placed) continue;

      const d = distance(toVec2(at), toVec2(placed));

      if (d <= HIT_RADIUS_PX && (best === null || d < best.d)) best = { name, d };
    }

    return best === null ? null : best.name;
  }

  private edgeAt(at: SvgPoint): number | null {
    let best: { index: number; d: number } | null = null;

    for (const [index, target] of this.state.edges.entries()) {
      const a = this.project(target.from);
      const b = this.project(target.to);

      if (!a || !b) continue;

      const d = distance(toVec2(at), projectOnSegment(toVec2(at), toVec2(a), toVec2(b)).point);

      if (d <= HIT_RADIUS_PX && (best === null || d < best.d)) best = { index, d };
    }

    return best === null ? null : best.index;
  }

  /** Угол выбирается кликом у его дуги: внутри сектора, недалеко от вершины. */
  private angleAt(at: SvgPoint): number | null {
    const near = HIT_RADIUS_PX * 2.5;
    let best: { index: number; d: number } | null = null;

    for (const [index, angle] of this.state.angles.entries()) {
      const [a, vertex, b] = angle.points.map((name) => this.project(name));

      if (!a || !vertex || !b) continue;

      const d = distance(toVec2(at), toVec2(vertex));

      if (d > near || d < HIT_RADIUS_PX * 0.3) continue;

      const inside = angleBetween(toVec2(vertex), toVec2(a), toVec2(at)) + angleBetween(toVec2(vertex), toVec2(at), toVec2(b))
        <= angleBetween(toVec2(vertex), toVec2(a), toVec2(b)) + 1;

      if (inside && (best === null || d < best.d)) best = { index, d };
    }

    return best === null ? null : best.index;
  }

  /** Сечение выбирается кликом внутри его контура; из нескольких берётся последнее — оно сверху. */
  private sectionAt(at: SvgPoint): number | null {
    for (let index = this.state.sections.length - 1; index >= 0; index -= 1) {
      const section = this.state.sections[index];

      if (section) {
        const polygon = section.vertices.map((name) => this.project(name)).filter((point): point is SvgPoint => point !== null);

        if (polygon.length >= 3 && insidePolygon(at, polygon)) return index;
      }
    }

    return null;
  }

  /** Что под курсором, в порядке приоритета: вершина, угол, ребро, сечение. */
  private hitAt(at: SvgPoint): Selection {
    const vertex = this.vertexAt(at);

    if (vertex) return { type: 'vertex', id: vertex };

    const angle = this.angleAt(at);

    if (angle !== null) return { type: 'angle', index: angle };

    const index = this.edgeAt(at);

    if (index !== null) return { type: 'edge', index };

    const section = this.sectionAt(at);

    return section === null ? null : { type: 'section', index: section };
  }

  // ------------------------------------------------------------- указатель

  private readonly onPointerDown = (info: PointerInfo): void => {
    // Новое нажатие обрывает недоделанный жест: второй палец или потерянное отпускание.
    this.finishGesture(false);
    this.endSlide();

    const { pointerId, clientX: x, clientY: y } = info.event;

    if (info.button === 2) {
      this.gesture = { type: 'rotate', pointerId, x, y, recorded: false };

      return;
    }

    if (info.button !== 0) return;

    const hit = this.hitAt(info.svg);

    // Пустое место: клик это или вращение, станет ясно по движению или отпусканию.
    if (hit === null) {
      this.gesture = { type: 'empty', pointerId, x, y, info };

      return;
    }

    this.applyTool(info);

    if (this.tool !== 'select' || hit.type !== 'vertex') return;

    const point = this.state.vertices[hit.id];

    if (!point) return;

    const [px, py] = project3dToPlane(point, this.state.angleY, this.state.angleZ);

    this.gesture = {
      type: 'vertex',
      pointerId,
      x,
      y,
      id: hit.id,
      start: [point[0], point[1], point[2]],
      grab: info.world,
      offset: [info.world[0] - px, info.world[1] - py],
      moving: false,
      alt: info.alt,
    };
  };

  /** Действие инструмента по клику: по вершине, ребру и прочему — на нажатии, по пустому месту — на отпускании. */
  private applyTool(info: PointerInfo): void {
    switch (this.tool) {
      case 'select':
        this.selection = this.hitAt(info.svg);
        this.render();
        this.renderProperties();
        break;
      case 'point':
        this.addPoint(info);
        break;
      case 'segment':
        this.drawSegment(info);
        break;
      case 'section':
        this.drawSection(info);
        break;
      case 'angle':
        this.drawAngle(info);
        break;
      case 'delete':
        this.selection = this.hitAt(info.svg);
        this.deleteSelection();
        break;
      default:
        break;
    }
  }

  private readonly onPointerMove = (info: PointerInfo): void => {
    const { gesture } = this;

    if (gesture && gesture.pointerId === info.event.pointerId) {
      this.continueGesture(gesture, info);

      return;
    }

    this.cursor = info.svg;
    this.cursorFree = info.shift;

    if (this.draft.length > 0 || (this.pointHeight !== 0 && HEIGHT_TOOLS.has(this.tool))) this.renderOverlay();
  };

  private readonly onPointerUp = (info: PointerInfo): void => {
    if (this.gesture?.pointerId !== info.event.pointerId) return;

    // SketchCanvas присылает сюда и pointercancel: отменённое нажатие — не клик.
    this.finishGesture(info.event.type !== 'pointercancel');
  };

  /** Указатель ушёл от точки нажатия дальше порога? Считается в пикселях экрана. */
  private static pastThreshold(gesture: Gesture, event: PointerEvent): boolean {
    return Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > DRAG_THRESHOLD_PX;
  }

  private continueGesture(gesture: Gesture, info: PointerInfo): void {
    const { event } = info;

    switch (gesture.type) {
      case 'empty':
        // Порог пройден — это панорама; сдвиг считается отсюда, чтобы полотно не дёрнулось.
        if (StereometryEditor.pastThreshold(gesture, event)) {
          const { cx, cy } = this.canvas.viewport;

          this.gesture = { type: 'pan', pointerId: gesture.pointerId, x: event.clientX, y: event.clientY, cx, cy };
          this.element.classList.add(ROTATING_CLASS);
        }

        break;
      case 'pan':
        this.pan(gesture, event);
        break;
      case 'rotate':
        this.rotate(gesture, event);
        break;
      case 'vertex':
        this.dragVertex(gesture, info);
        break;
      default:
        break;
    }
  }

  /**
   * Окно просмотра едет за указателем, как у панорамы средней кнопкой: смещение
   * в единицах полотна с учётом масштаба CSS. Ни сцена, ни история не меняются.
   */
  private pan(gesture: Extract<Gesture, { type: 'pan' }>, event: PointerEvent): void {
    const from = this.canvas.clientToSvg(gesture.x, gesture.y);
    const to = this.canvas.clientToSvg(event.clientX, event.clientY);

    this.canvas.setViewport({ cx: gesture.cx + to.x - from.x, cy: gesture.cy + to.y - from.y });
  }

  private rotate(gesture: Extract<Gesture, { type: 'rotate' }>, event: PointerEvent): void {
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;

    if (dx === 0 && dy === 0) return;

    // Один снимок на жест: отмена возвращает вид до начала вращения.
    if (!gesture.recorded) {
      this.history.record(this.state);
      gesture.recorded = true;
      this.element.classList.add(ROTATING_CLASS);
    }

    gesture.x = event.clientX;
    gesture.y = event.clientY;
    // Фигура следует за курсором: вправо — поворот вправо, вниз — наклон к зрителю.
    this.state.angleZ = normalizeView('angleZ', this.state.angleZ + dx * ROTATION_DEGREES_PER_PX);
    this.state.angleY = normalizeView('angleY', this.state.angleY + dy * ROTATION_DEGREES_PER_PX);
    this.applyAutoHidden();
    this.render();
    this.syncFields();
  }

  /**
   * Вершина едет за указателем: по умолчанию в горизонтальной плоскости на
   * своей высоте, с Alt — по вертикали. Рёбра делятся только на отпускании.
   */
  private dragVertex(gesture: VertexDrag, info: PointerInfo): void {
    // Alt нажали или отпустили посреди жеста: отсчёт заново от текущих указателя
    // и вершины, иначе вторая координата прыгнула бы к началу жеста.
    if (info.alt !== gesture.alt) this.rebaseVertexDrag(gesture, info);

    if (!gesture.moving && !StereometryEditor.pastThreshold(gesture, info.event)) return;

    const point = info.alt ? this.liftedVertex(gesture, info) : this.slidVertex(gesture, info);

    if (!point) return;

    // Один снимок на жест: отмена возвращает вершину туда, где её взяли.
    if (!gesture.moving) {
      this.history.record(this.state);
      gesture.moving = true;
    }

    this.state.vertices[gesture.id] = point;
    updateAngleMeasures(this.state);
    this.render();
    this.syncFields();
  }

  /** Точка отсчёта жеста — текущие положения указателя и вершины, при текущем Alt. */
  private rebaseVertexDrag(gesture: VertexDrag, info: PointerInfo): void {
    const point = this.state.vertices[gesture.id];

    gesture.alt = info.alt;

    if (!point) return;

    const [px, py] = project3dToPlane(point, this.state.angleY, this.state.angleZ);

    gesture.start = [point[0], point[1], point[2]];
    gesture.grab = [info.world[0], info.world[1]];
    gesture.offset = [info.world[0] - px, info.world[1] - py];
  }

  /**
   * Сдвиг по горизонтали: точка картинки без смещения захвата — на плоскость
   * z = z0. `null`, если плоскость видна почти с ребра: вершина стоит на месте.
   */
  private slidVertex(gesture: VertexDrag, info: PointerInfo): Vec3 | null {
    if (isShallowView(this.state.angleY, this.state.angleZ)) return null;

    const [, , z] = gesture.start;
    const plane: Vec2 = [info.world[0] - gesture.offset[0], info.world[1] - gesture.offset[1]];
    const ground = unprojectToHeight(plane, z, this.state.angleY, this.state.angleZ);
    const [x, y] = info.shift ? ground : snapToGrid(ground, GROUND_STEP);

    return [roundTo(x), roundTo(y), z];
  }

  /**
   * Сдвиг по вертикали: смещение указателя проецируется на образ оси z.
   * `null`, если ось z видна с торца — тогда высоту мышью не поменять.
   */
  private liftedVertex(gesture: VertexDrag, info: PointerInfo): Vec3 | null {
    const [ex, ey] = project3dToPlane([0, 0, 1], this.state.angleY, this.state.angleZ);
    const length = ex * ex + ey * ey;

    if (length < DEGENERATE_AXIS) return null;

    const [x, y, z] = gesture.start;
    const dz = ((info.world[0] - gesture.grab[0]) * ex + (info.world[1] - gesture.grab[1]) * ey) / length;

    return [x, y, roundTo(info.shift ? z + dz : snapHeight(z + dz))];
  }

  /**
   * Конец жеста. `click` — обычное отпускание: только тогда нажатие по
   * пустому месту выполняет действие инструмента. Вращение и перетаскивание
   * доводятся до конца в любом случае.
   */
  private finishGesture(click: boolean): void {
    const { gesture } = this;

    this.gesture = null;
    this.element.classList.remove(ROTATING_CLASS);

    if (!gesture) return;

    switch (gesture.type) {
      case 'empty':
        if (click) this.applyTool(gesture.info);

        break;
      case 'rotate':
        if (gesture.recorded) this.afterChange();

        break;
      case 'vertex':
        if (gesture.moving) this.afterChange();

        break;
      default:
        break;
    }
  }

  /**
   * Поля панели во время жеста: значения меняются на месте, без пересборки
   * панели. Поле в фокусе не трогаем — его сейчас правят или тянут.
   */
  private syncFields(): void {
    const { selection, state } = this;
    const values: Record<string, number> = {
      angleY: state.angleY,
      angleYRange: state.angleY,
      angleZ: state.angleZ,
      angleZRange: state.angleZ,
    };
    const point = selection?.type === 'vertex' ? state.vertices[selection.id] : undefined;
    const fields = this.properties.querySelectorAll<HTMLInputElement>('input[data-prop], input[data-axis]');

    fields.forEach((input) => {
      const axis = ['x', 'y', 'z'].indexOf(input.dataset.axis ?? '');
      const value = axis === -1 ? values[input.dataset.prop ?? ''] : point?.[axis];

      if (value !== undefined && input !== document.activeElement) input.value = String(roundTo(value));
    });
  }

  private readonly onDoubleClick = (info: PointerInfo): void => {
    if (this.tool === 'section') {
      this.closeSection();

      return;
    }

    const vertex = this.vertexAt(info.svg);

    if (!vertex) return;

    this.selection = { type: 'vertex', id: vertex };
    this.render();
    this.renderProperties();
    // Поле имени: над ним может стоять высота новой точки.
    this.properties.querySelector<HTMLInputElement>('input[type="text"]')?.focus();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();

      if (event.shiftKey) this.redo();
      else this.undo();

      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      this.redo();

      return;
    }

    if (event.key === 'Enter' && this.tool === 'section') {
      event.preventDefault();
      this.closeSection();

      return;
    }

    const turn = VIEW_KEYS[event.key];

    // Стрелки крутят вид, пока ничего не выбрано: шаг истории на каждое нажатие.
    if (turn && !this.selection && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();

      const step = (event.shiftKey ? KEY_TURN_STEP_LARGE : KEY_TURN_STEP) * turn.sign;

      this.commit((state) => {
        state[turn.angle] = normalizeView(turn.angle, state[turn.angle] + step);
      });

      return;
    }

    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (this.selection) {
        event.preventDefault();
        this.deleteSelection();
      }

      return;
    }

    if (event.key === 'Escape') {
      this.draft = [];
      this.selection = null;
      this.render();
      this.renderProperties();
    }
  };

  // ----------------------------------------------------------- инструменты

  /**
   * Точка на ребре в доле `t` его проекции под курсором; ребро делится на два.
   * `null`, если ребра или его концов в сцене нет.
   */
  private addPointOnEdge(index: number, at: SvgPoint): string | null {
    const target = this.state.edges[index];

    if (!target) return null;

    const a = this.project(target.from);
    const b = this.project(target.to);
    const from = this.state.vertices[target.from];
    const to = this.state.vertices[target.to];

    if (!from || !to) return null;

    const t = a && b ? clamp(projectOnSegment(toVec2(at), toVec2(a), toVec2(b)).t, EDGE_POINT_MIN_T, EDGE_POINT_MAX_T) : 0.5;
    const lerp = (axis: 0 | 1 | 2): number => roundTo(from[axis] + t * (to[axis] - from[axis]));
    const point: Vec3 = [lerp(0), lerp(1), lerp(2)];
    const name = nextVertexName(this.state.vertices);

    this.commit((state) => {
      state.vertices[name] = point;
      state.labels[name] = EDGE_POINT_LABEL;
      state.edges.splice(index, 1, { ...target, to: name }, { ...target, from: name });
    });

    return name;
  }

  /**
   * Точка в пустоте: обратная проекция курсора на плоскость z = высота новой
   * точки (по умолчанию 0) с прилипанием к полуклеткам; Shift его отключает.
   * `null`, если плоскость видна почти с ребра: точку не ставим.
   */
  private addGroundPoint(info: PointerInfo): string | null {
    const point = this.placeAtHeight(info.world, info.shift);

    if (!point) return null;

    const name = nextVertexName(this.state.vertices);

    this.commit((state) => {
      state.vertices[name] = point;
      state.labels[name] = GROUND_POINT_LABEL;
    });

    return name;
  }

  /**
   * Вершина под курсором, иначе новая: на ребре или на плоскости z = высота
   * новой точки. `null`, если в пустоте точку при этом виде не поставить.
   */
  private pickOrCreateVertex(info: PointerInfo): string | null {
    const existing = this.vertexAt(info.svg);

    if (existing) return existing;

    const index = this.edgeAt(info.svg);
    const onEdge = index === null ? null : this.addPointOnEdge(index, info.svg);

    return onEdge ?? this.addGroundPoint(info);
  }

  private addPoint(info: PointerInfo): void {
    const existing = this.vertexAt(info.svg);

    if (existing) {
      this.selection = { type: 'vertex', id: existing };
      this.render();
      this.renderProperties();

      return;
    }

    const name = this.pickOrCreateVertex(info);

    if (name === null) return;

    this.selection = { type: 'vertex', id: name };
    this.render();
    this.renderProperties();
  }

  private drawSegment(info: PointerInfo): void {
    const name = this.pickOrCreateVertex(info);

    // Точку в пустоте не поставить: начатый отрезок ждёт следующего клика.
    if (name === null) return;

    if (this.draft.length === 0) {
      this.draft = [name];
      this.renderOverlay();

      return;
    }

    const [from] = this.draft;

    this.draft = [];

    if (from === undefined || from === name) {
      this.renderOverlay();

      return;
    }

    this.commit((state) => {
      const existing = state.edges.findIndex((target) => (target.from === from && target.to === name) || (target.from === name && target.to === from));

      if (existing === -1) state.edges.push({ from, to: name, style: 'solid' });

      this.selection = { type: 'edge', index: existing === -1 ? state.edges.length - 1 : existing };
    });
  }

  private drawSection(info: PointerInfo): void {
    const vertex = this.vertexAt(info.svg);

    if (!vertex) return;

    // Повторный клик по выбранной вершине замыкает контур, как двойной клик или Enter.
    if (this.draft.includes(vertex)) {
      if (this.draft.length >= 3) this.closeSection();

      return;
    }

    this.draft.push(vertex);
    this.renderOverlay();
  }

  /** Замыкает контур сечения; с двумя и менее вершинами черновик остаётся — набирать дальше. */
  private closeSection(): void {
    if (this.draft.length < 3) return;

    const vertices = [...this.draft];

    this.draft = [];
    this.commit((state) => {
      state.sections.push({ vertices, fill: SECTION_FILLS[0].value, stroke: SECTION_STROKE });
      this.selection = { type: 'section', index: state.sections.length - 1 };
    });
  }

  private drawAngle(info: PointerInfo): void {
    const vertex = this.vertexAt(info.svg);

    if (!vertex || this.draft.includes(vertex)) return;

    this.draft.push(vertex);

    if (this.draft.length < 3) {
      this.render();

      return;
    }

    const points = [...this.draft] as [string, string, string];

    this.draft = [];
    this.addAngle(points);
  }

  /**
   * Прямой угол — сразу уголком и без подписи: его в стереометрии отмечают
   * чаще всего. У остальных подпись — величина, её ведёт конструктор.
   */
  private addAngle(points: [string, string, string]): void {
    this.commit((state) => {
      const degrees = angleDegrees(state.vertices, { points, style: 'single' });

      if (degrees === null) return;

      const right = Math.abs(degrees - 90) < RIGHT_ANGLE_TOLERANCE;

      state.angles.push(right ? { points, style: 'right', measured: false } : { points, style: 'single', label: formatAngleMeasure(degrees), measured: true });
      this.selection = { type: 'angle', index: state.angles.length - 1 };
    });
  }

  private deleteSelection(): void {
    const { selection } = this;

    if (!selection) return;

    this.commit((state) => {
      switch (selection.type) {
        case 'vertex': {
          const { id } = selection;

          delete state.vertices[id];
          delete state.labels[id];
          state.edges = state.edges.filter((target) => target.from !== id && target.to !== id);
          state.angles = state.angles.filter((angle) => !angle.points.includes(id));
          state.cylinders = state.cylinders.filter((cylinder) => cylinder.base !== id && cylinder.top !== id);
          state.cones = state.cones.filter((cone) => cone.base !== id && cone.apex !== id);
          state.spheres = state.spheres.filter((sphere) => sphere.center !== id);
          // Сечение без одной вершины остаётся, пока в нём есть хотя бы треугольник.
          state.sections = state.sections
            .map((section) => ({ ...section, vertices: section.vertices.filter((name) => name !== id) }))
            .filter((section) => section.vertices.length >= 3);
          break;
        }
        case 'edge':
          state.edges.splice(selection.index, 1);
          break;
        case 'section':
          state.sections.splice(selection.index, 1);
          break;
        case 'angle':
          state.angles.splice(selection.index, 1);
          break;
        default:
          break;
      }
    });
    this.selection = null;
    this.render();
    this.renderProperties();
  }

  // --------------------------------------------------------- панель свойств

  private renderProperties(): void {
    const { selection, state, t } = this;

    this.properties.replaceChildren();
    // Высота новой точки — первым блоком при любом выделении: точки ставят подряд.
    this.renderPointHeight();

    if (!selection) {
      this.renderViewProperties();

      return;
    }

    const titleKey = selection.type === 'section' ? 'drawings_stereo_selected_section' : `drawings_selected_${selection.type}`;

    this.properties.appendChild(el('h4', { class: 'rte-builder__props-title', text: t(titleKey) }));

    if (selection.type === 'vertex') {
      this.renderVertexProperties(selection.id);
    } else if (selection.type === 'edge') {
      const target = state.edges[selection.index];

      if (!target) return;

      const style = selectControl(
        [
          { value: 'solid', label: t('drawings_style_solid') },
          { value: 'dashed', label: t('drawings_style_dashed') },
        ],
        target.style,
      );

      this.properties.appendChild(propertyField(t('drawings_prop_style'), style));
      on(style, 'change', () => {
        this.commit((draft) => {
          const draftEdge = draft.edges[selection.index];

          // Стиль, выбранный руками, автоматический пунктир больше не трогает.
          draft.autoHidden = false;

          if (draftEdge) draftEdge.style = style.value === 'dashed' ? 'dashed' : 'solid';
        });
      });
      this.renderEdgeLength(selection, target);
    } else if (selection.type === 'section') {
      const section = state.sections[selection.index];

      if (!section) return;

      const current = section.fill ?? SECTION_FILLS[0].value;
      const options = SECTION_FILLS.map((fill) => ({ value: fill.value, label: t(fill.labelKey) }));

      if (!SECTION_FILLS.some((fill) => fill.value === current)) options.push({ value: current, label: t('drawings_stereo_fill_custom') });

      const fill = selectControl(options, current);

      this.properties.appendChild(propertyField(t('drawings_stereo_prop_fill'), fill));
      on(fill, 'change', () => {
        this.commit((draft) => {
          const draftSection = draft.sections[selection.index];

          if (draftSection) draftSection.fill = fill.value;
        });
      });
    } else if (selection.type === 'angle') {
      const angle = state.angles[selection.index];

      if (!angle) return;

      const style = selectControl(ANGLE_STYLES.map((value) => ({ value, label: t(`drawings_angle_${value}`) })), angle.style);
      const label = el('input', { class: 'rte-input', attrs: { type: 'text', value: angle.label ?? '', placeholder: '30°' } });
      const degrees = angleDegrees(state.vertices, angle);

      // Подпись-величину ведёт конструктор: руками её правят, только выключив флажок.
      label.disabled = angle.measured;
      this.properties.append(
        propertyField(t('drawings_prop_style'), style),
        ...this.angleMeasureFields(selection.index, angle, degrees),
        propertyField(t('drawings_prop_label'), label),
      );
      on(style, 'change', () => {
        this.commit((draft) => {
          const draftAngle = draft.angles[selection.index];

          if (draftAngle) draftAngle.style = style.value as AngleStyle;
        });
      });
      on(label, 'change', () => {
        if (angle.measured) return;

        this.commit((draft) => {
          const text = label.value.trim();
          const draftAngle = draft.angles[selection.index];

          if (!draftAngle) return;

          if (text) draftAngle.label = text;
          else delete draftAngle.label;
        });
      });
    }

    const remove = el('button', { class: 'rte-button rte-button--danger rte-builder__remove', attrs: { type: 'button' }, text: t('drawings_remove_selected') });

    on(remove, 'click', () => this.deleteSelection());
    this.properties.appendChild(remove);
  }

  /**
   * Величина выделенного угла (только для чтения) и флажок «Показывать
   * величину на чертеже»: включение пишет величину в подпись, выключение
   * оставляет подпись текстом как есть — по шагу истории.
   */
  private angleMeasureFields(index: number, angle: StereoAngle, degrees: number | null): HTMLElement[] {
    const { t } = this;
    const value = el('input', {
      class: 'rte-input',
      attrs: { type: 'text', readonly: 'true', value: degrees === null ? '' : formatAngleMeasure(degrees), 'data-prop': 'angleValue' },
    });
    const toggle = el('input', { attrs: { type: 'checkbox', 'data-prop': 'angleMeasure' } });

    toggle.checked = angle.measured;
    // Без вершины величины нет — и вести нечего.
    toggle.disabled = degrees === null;
    on(toggle, 'change', () => {
      this.commit((draft) => {
        const target = draft.angles[index];

        if (!target) return;

        target.measured = toggle.checked;

        if (target.measured && degrees !== null) target.label = formatAngleMeasure(degrees);
      });
    });

    return [
      propertyField(t('drawings_stereo_prop_angle_value'), value),
      el('label', { class: 'rte-stereo__check', children: [toggle, el('span', { text: t('drawings_stereo_angle_measure') })] }),
    ];
  }

  /** Длина выбранного ребра в пространстве и конец, который едет при её смене. */
  private renderEdgeLength(selection: EdgeSelection, target: StereoEdge): void {
    const { t } = this;
    const current = this.edgeLength(target);
    const end = this.lengthEnd?.selection === selection ? this.lengthEnd.end : 'to';
    const length = el('input', {
      class: 'rte-input',
      attrs: { type: 'number', step: '0.5', min: '0.01', value: String(roundTo(current)), 'data-prop': 'length' },
    });
    const moving = selectControl(
      [
        { value: 'from', label: target.from },
        { value: 'to', label: target.to },
      ],
      end,
    );

    moving.dataset.prop = 'lengthEnd';
    this.properties.append(propertyField(t('drawings_stereo_prop_length'), length), propertyField(t('drawings_stereo_prop_length_end'), moving));
    on(moving, 'change', () => {
      this.lengthEnd = { selection, end: moving.value === 'from' ? 'from' : 'to' };
    });
    on(length, 'change', () => {
      const value = Number(length.value);

      // Нулевое ребро не задаёт направления, длина — только положительная.
      if (length.value.trim() === '' || !Number.isFinite(value) || value <= 0 || current === 0) {
        length.value = String(roundTo(current));

        return;
      }

      // Подвижный конец после округления совпал с неподвижным: такой длины не задать.
      if (!this.setEdgeLength(selection, moving.value === 'from' ? 'from' : 'to', value)) length.value = String(roundTo(current));
    });
  }

  /** Длина ребра в пространстве; 0, если конца нет в сцене. */
  private edgeLength(target: StereoEdge): number {
    const from = this.state.vertices[target.from];
    const to = this.state.vertices[target.to];

    return from && to ? Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]) : 0;
  }

  /**
   * Новая длина ребра: подвижный конец M едет по прямой ребра, неподвижный F
   * стоит, M' = F + (M − F) · L / |M − F|. Выделение остаётся на ребре F–M,
   * а если правка его разделила — снимается. `false` — сцена не изменилась:
   * ребра нет, оно нулевое или конец после округления лёг на неподвижный.
   */
  private setEdgeLength(selection: EdgeSelection, end: EdgeEnd, value: number): boolean {
    const target = this.state.edges[selection.index];

    if (!target) return false;

    const { from, to } = target;
    const movingName = end === 'from' ? from : to;
    const fixed = this.state.vertices[end === 'from' ? to : from];
    const moving = this.state.vertices[movingName];
    const current = this.edgeLength(target);

    if (!fixed || !moving || current === 0) return false;

    const factor = value / current;
    const point = roundVec3([
      fixed[0] + (moving[0] - fixed[0]) * factor,
      fixed[1] + (moving[1] - fixed[1]) * factor,
      fixed[2] + (moving[2] - fixed[2]) * factor,
    ]);

    if (point.every((value, axis) => value === fixed[axis])) return false;

    this.commit((state) => {
      state.vertices[movingName] = point;
    });

    const index = this.state.edges.findIndex((other) => other.from === from && other.to === to);

    if (index === selection.index) return true;

    // Рёбра поделились, и индексы сдвинулись: выделение — на то же ребро или никуда.
    const next: EdgeSelection | null = index === -1 ? null : { type: 'edge', index };

    this.selection = next;
    this.lengthEnd = next && this.lengthEnd?.selection === selection ? { selection: next, end: this.lengthEnd.end } : null;
    this.render();
    this.renderProperties();

    return true;
  }

  /** У «Точки» и «Отрезка» — высота, на которую встанет новая точка в пустоте. */
  private renderPointHeight(): void {
    if (!HEIGHT_TOOLS.has(this.tool)) return;

    const height = el('input', { class: 'rte-input', attrs: { type: 'number', step: '0.5', value: String(roundTo(this.pointHeight)), 'data-prop': 'pointHeight' } });

    this.properties.appendChild(propertyField(this.t('drawings_stereo_prop_point_height'), height));
    // Высота — настройка инструмента, а не правка сцены: в историю не пишется.
    on(height, 'change', () => {
      const value = Number(height.value);

      if (!Number.isFinite(value) || height.value.trim() === '') return;

      this.pointHeight = roundTo(value);
      this.renderOverlay();
    });
  }

  /**
   * Ничего не выбрано: повороты числом и ползунком, сброс вида, сетка и оси;
   * у угла — ввод вершин текстом.
   */
  private renderViewProperties(): void {
    const { state, t } = this;

    this.renderTemplateParams();
    this.properties.appendChild(el('h4', { class: 'rte-builder__props-title', text: t('drawings_stereo_view') }));

    const tilt = el('input', {
      class: 'rte-input',
      attrs: { type: 'number', step: '5', min: String(-MAX_TILT), max: String(MAX_TILT), value: String(roundTo(state.angleY)), 'data-prop': 'angleY' },
    });
    const turn = el('input', { class: 'rte-input', attrs: { type: 'number', step: '5', value: String(roundTo(state.angleZ)), 'data-prop': 'angleZ' } });

    this.properties.append(
      propertyField(t('drawings_stereo_prop_angle_y'), tilt),
      this.viewSlider('angleY', 'angleYRange', MAX_TILT, t('drawings_stereo_prop_angle_y')),
      propertyField(t('drawings_stereo_prop_angle_z'), turn),
      this.viewSlider('angleZ', 'angleZRange', MAX_TURN, t('drawings_stereo_prop_angle_z')),
    );
    on(tilt, 'change', () => {
      const value = Number(tilt.value);

      if (!Number.isFinite(value)) return;

      this.commit((draft) => {
        draft.angleY = normalizeView('angleY', value);
      });
    });
    on(turn, 'change', () => {
      const value = Number(turn.value);

      if (!Number.isFinite(value)) return;

      this.commit((draft) => {
        draft.angleZ = normalizeView('angleZ', value);
      });
    });

    const reset = el('button', { class: 'rte-button rte-stereo__reset', attrs: { type: 'button' }, text: t('drawings_stereo_reset_view') });

    on(reset, 'click', () => this.resetView());
    this.properties.appendChild(reset);

    const checkbox = (label: string, checked: boolean, toggle: () => void, prop?: string): HTMLElement => {
      const input = el('input', { attrs: { type: 'checkbox', ...(prop ? { 'data-prop': prop } : {}) } });

      input.checked = checked;
      on(input, 'change', toggle);

      return el('label', { class: 'rte-stereo__check', children: [input, el('span', { text: label })] });
    };

    this.properties.append(
      checkbox(t('drawings_grid'), state.showGrid, () => this.toggleGrid()),
      checkbox(t('drawings_stereo_axes'), state.showAxes, () => this.toggleAxes()),
      checkbox(t('drawings_stereo_auto_hidden'), state.autoHidden, () => this.toggleAutoHidden(), 'autoHidden'),
    );

    if (this.tool !== 'angle') return;

    const input = el('input', {
      class: 'rte-input rte-stereo__angle-input',
      attrs: { type: 'text', placeholder: 'SOH', maxlength: 12, autocomplete: 'off', spellcheck: 'false' },
    });
    const note = el('p', { class: 'rte-stereo__note', text: t('drawings_stereo_angle_input_hint') });

    this.properties.append(propertyField(t('drawings_stereo_prop_angle_input'), input), note);
    on(input, 'change', () => {
      const points = parseAngleVertices(input.value, Object.keys(this.state.vertices));

      if (!points) {
        input.setAttribute('aria-invalid', 'true');
        note.textContent = t('drawings_stereo_angle_input_invalid');
        note.classList.add('rte-stereo__note--error');

        return;
      }

      this.draft = [];
      this.addAngle(points);
    });
  }

  /**
   * Пока фигура такая, какой её построил шаблон, — поля его параметров над
   * блоком «Вид»; смена поля перестраивает фигуру.
   */
  private renderTemplateParams(): void {
    const active = this.activeTemplate();

    if (!active) return;

    const { template, applied } = active;

    this.properties.appendChild(el('h4', { class: 'rte-builder__props-title', text: this.t('drawings_stereo_template_params') }));
    template.fields.forEach((field) => {
      const input = el('input', {
        class: 'rte-input',
        attrs: {
          type: 'number',
          min: String(field.min),
          max: String(field.max),
          step: String(field.step),
          value: String(applied.params[field.key]),
          'data-prop': `template-${field.key}`,
        },
      });

      this.properties.appendChild(propertyField(this.t(field.labelKey), input));
      on(input, 'change', () => {
        const value = Number(input.value);

        if (!Number.isFinite(value) || input.value.trim() === '') {
          input.value = String(applied.params[field.key]);

          return;
        }

        this.rebuildTemplate(applied, { ...applied.params, [field.key]: value });
      });
    });
  }

  /**
   * Ползунок угла вида от −`limit` до `limit`. Пока его тянут (`input`), сцена
   * поворачивается сразу; жест закрывается по `change`, по отпусканию
   * указателя или клавиши на ползунке, по потере фокуса и перед любой правкой
   * сцены — тогда история получает один снимок на жест.
   */
  private viewSlider(angle: ViewAngle, prop: string, limit: number, label: string): HTMLInputElement {
    const slider = el('input', {
      class: 'rte-stereo__range',
      attrs: { type: 'range', min: String(-limit), max: String(limit), step: '1', value: String(roundTo(this.state[angle])), 'data-prop': prop, 'aria-label': label },
    });

    on(slider, 'input', () => this.slideView(angle, slider));
    on(slider, 'change', () => {
      this.slideView(angle, slider);
      this.endSlide();
    });
    // Ползунок увели и вернули на место — `change` не придёт, жест закрывают эти события.
    on(slider, 'pointerup', () => this.endSlide());
    on(slider, 'keyup', () => this.endSlide());
    on(slider, 'blur', () => this.endSlide());

    return slider;
  }

  private slideView(angle: ViewAngle, slider: HTMLInputElement): void {
    const raw = Number(slider.value);

    if (!Number.isFinite(raw)) return;

    const value = normalizeView(angle, raw);

    if (!this.slideFrom) {
      // Событие без движения ползунка — не начало жеста.
      if (value === this.state[angle]) return;

      this.slideFrom = { angleY: this.state.angleY, angleZ: this.state.angleZ, edges: this.state.edges.map(copyEdge) };
    }

    this.state[angle] = value;
    this.applyAutoHidden();
    this.render();
    this.syncFields();
  }

  /**
   * Закрывает жест ползунка: если вид изменился, в историю уходит вид до
   * жеста вместе с его пунктиром. `true` — шаг истории записан.
   */
  private closeSlide(): boolean {
    const from = this.slideFrom;

    this.slideFrom = null;

    if (!from || (from.angleY === this.state.angleY && from.angleZ === this.state.angleZ)) return false;

    this.history.record({ ...this.state, angleY: from.angleY, angleZ: from.angleZ, edges: from.edges });

    return true;
  }

  /** Конец жеста ползунка от его собственных событий: о правке узнают слушатели. */
  private endSlide(): void {
    if (this.closeSlide()) this.changes.emit();
  }

  private renderVertexProperties(id: string): void {
    const { state, t } = this;
    const point = state.vertices[id];

    if (!point) return;

    const nameInput = el('input', { class: 'rte-input', attrs: { type: 'text', value: id, maxlength: 4 } });
    const position = selectControl(
      LABEL_POSITIONS.map((value) => ({ value, label: t(`drawings_position_${value.replace(' ', '_')}`) })),
      state.labels[id] ?? 'above',
    );

    this.properties.append(propertyField(t('drawings_prop_name'), nameInput), propertyField(t('drawings_prop_position'), position));
    on(nameInput, 'change', () => this.renameVertex(id, nameInput.value.trim()));
    on(position, 'change', () => {
      this.commit((draft) => {
        draft.labels[id] = position.value;
      });
    });

    const axisKeys = ['drawings_stereo_prop_x', 'drawings_stereo_prop_y', 'drawings_stereo_prop_z'];
    const coords = el('div', {
      class: 'rte-stereo__coords',
      children: axisKeys.map((key, axis) => {
        // axis — индекс одного из трёх ключей осей: у Vec3 координата по нему есть всегда.
        const input = el('input', {
          class: 'rte-input',
          attrs: { type: 'number', step: '0.5', value: String(roundTo(point[axis] ?? 0)), 'data-axis': ['x', 'y', 'z'][axis] },
        });

        on(input, 'change', () => {
          const value = Number(input.value);

          if (!Number.isFinite(value)) return;

          this.commit((draft) => {
            const target = draft.vertices[id];

            if (target) target[axis] = roundTo(value);
          });
        });

        return propertyField(t(key), input);
      }),
    });

    this.properties.appendChild(coords);
    this.renderBodyRadii(id);
  }

  /** Вершина — центр или вершина тела вращения: поле радиуса на каждое такое тело. */
  private renderBodyRadii(id: string): void {
    bodyRefsOf(this.state, id).forEach((ref) => {
      const body = this.state[ref.kind][ref.index];

      if (!body) return;

      const input = el('input', {
        class: 'rte-input',
        attrs: { type: 'number', step: '0.5', min: '0', value: String(roundTo(body.radius)), 'data-prop': 'radius' },
      });

      this.properties.appendChild(propertyField(this.t('drawings_stereo_param_radius'), input));
      on(input, 'change', () => {
        const value = Number(input.value);
        const radius = Number.isFinite(value) && input.value.trim() !== '' ? roundTo(value) : 0;

        // Радиус проверяется после округления: 0,004 стал бы нулём.
        if (radius <= 0) {
          input.value = String(roundTo(body.radius));

          return;
        }

        this.commit((draft) => {
          const target = draft[ref.kind][ref.index];

          if (!target) return;

          target.radius = radius;
          target.radiusEdited = true;
        });
      });
    });
  }

  /** Переименование точки тянет за собой рёбра, углы, сечения, тела вращения и подпись. */
  private renameVertex(from: string, to: string): void {
    if (!to || to === from || to in this.state.vertices) {
      this.renderProperties();

      return;
    }

    this.commit((state) => {
      const vertex = state.vertices[from];

      if (!vertex) return;

      state.vertices[to] = vertex;
      delete state.vertices[from];

      if (state.labels[from]) {
        state.labels[to] = state.labels[from];
        delete state.labels[from];
      }

      const rename = (name: string): string => (name === from ? to : name);

      state.edges.forEach((target) => {
        target.from = rename(target.from);
        target.to = rename(target.to);
      });
      state.angles.forEach((angle) => {
        angle.points = angle.points.map(rename) as [string, string, string];
      });
      state.sections.forEach((section) => {
        section.vertices = section.vertices.map(rename);
      });
      state.cylinders.forEach((cylinder) => {
        cylinder.base = rename(cylinder.base);
        cylinder.top = rename(cylinder.top);
      });
      state.cones.forEach((cone) => {
        cone.base = rename(cone.base);
        cone.apex = rename(cone.apex);
      });
      state.spheres.forEach((sphere) => {
        sphere.center = rename(sphere.center);
      });
      this.selection = { type: 'vertex', id: to };
    });
  }
}

export const stereometryEditorFactory: SceneEditorFactory = {
  id: 'stereometry',
  kind: 'geometry',
  labelKey: 'drawings_tab_stereometry',
  accepts: (scene) => normalizeGeometryScene(scene).type === '3d',
  create: (context) => new StereometryEditor(context),
};
