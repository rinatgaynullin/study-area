import type { Point, Vec3 } from '../scene/types';

/**
 * Контуры тел вращения — конуса и шара — в координатах сцены, без DOM и
 * проекции: SVG и TikZ проецируют точки сами. Тела выпуклые, проекция
 * параллельная, поэтому видимость точки поверхности решает знак скалярного
 * произведения внешней нормали и направления на зрителя.
 */

export interface RimPoint {
  point: Vec3;
  /** Видна ли точка обода зрителю. */
  visible: boolean;
}

export interface ConeOutline {
  /** Точки окружности основания по порядку обхода, с видимостью. */
  rim: RimPoint[];
  /** Точки основания, через которые идут силуэтные образующие: две или ни одной. */
  tangents: Vec3[];
}

export interface SphereOutline {
  /** Силуэт: большая окружность в плоскости, перпендикулярной `view`. */
  silhouette: Vec3[];
  /** Экватор (окружность в горизонтальной плоскости z = const) с видимостью точек. */
  equator: RimPoint[];
}

export interface VisibilityRun {
  visible: boolean;
  points: Vec3[];
}

/** Вершина сцены как точка пространства: у плоской z = 0. */
export const toVec3 = (point: Point): Vec3 => [point[0], point[1], point[2] ?? 0];

const DEFAULT_SEGMENTS = 64;
/** Допуск для единичных векторов: меньше — считаем нулём. */
const EPS = 1e-9;
const VERTICAL: Vec3 = [0, 0, 1];

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

const minus = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);

/** Единичный вектор; нулевой или нечисловой → `null`. */
const unit = (a: Vec3): Vec3 | null => {
  const size = length(a);

  return Number.isFinite(size) && size > EPS ? [a[0] / size, a[1] / size, a[2] / size] : null;
};

interface CircleFrame {
  center: Vec3;
  /** Два единичных взаимно перпендикулярных вектора плоскости окружности. */
  u: Vec3;
  v: Vec3;
  radius: number;
}

/**
 * Базис плоскости окружности, как у цилиндра в SVG: `u` лежит в плоскости xy
 * (или вдоль x у вертикальной оси), `v` — векторное произведение оси и `u`.
 * Для оси вверх обход идёт против часовой, если смотреть сверху.
 */
const circleFrame = (center: Vec3, axis: Vec3, radius: number): CircleFrame | null => {
  const normal = unit(axis);

  if (!normal) return null;

  const horizontal = Math.hypot(normal[0], normal[1]);
  const u: Vec3 = horizontal > 1e-3 ? [-normal[1] / horizontal, normal[0] / horizontal, 0] : [1, 0, 0];

  return { center, u, v: cross(normal, u), radius };
};

/** Радиальный единичный вектор окружности под углом `angle` (радианы). */
const radial = (frame: CircleFrame, angle: number): Vec3 => {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  return [frame.u[0] * cos + frame.v[0] * sin, frame.u[1] * cos + frame.v[1] * sin, frame.u[2] * cos + frame.v[2] * sin];
};

const pointAt = (frame: CircleFrame, angle: number): Vec3 => {
  const e = radial(frame, angle);

  return [frame.center[0] + e[0] * frame.radius, frame.center[1] + e[1] * frame.radius, frame.center[2] + e[2] * frame.radius];
};

const segmentCount = (segments: number): number => (Number.isFinite(segments) ? Math.max(0, Math.floor(segments)) : 0);

/** `segments` точек окружности в пространстве: центр, ось (нормаль её плоскости), радиус. Нулевая ось → []. */
export const circle3d = (center: Vec3, axis: Vec3, radius: number, segments: number): Vec3[] => {
  const frame = circleFrame(center, axis, radius);
  const count = segmentCount(segments);

  if (!frame) return [];

  return Array.from({ length: count }, (_, index) => pointAt(frame, (index * 2 * Math.PI) / count));
};

interface SampledRim {
  rim: RimPoint[];
  /** Точки, где `score` переходит через порог, — уже вставлены в `rim`. */
  crossings: Vec3[];
}

/**
 * Обход окружности с видимостью по оценке `score` радиального вектора.
 * Между соседними выборками, где `isPositive` меняется, точка смены
 * уточняется линейной интерполяцией угла и вставляется в обход с видимостью
 * следующей выборки: так она начинает новую серию и обе дуги кончаются ровно в ней.
 */
const sampleRim = (
  frame: CircleFrame,
  segments: number,
  score: (e: Vec3) => number,
  isPositive: (value: number) => boolean,
  isVisible: (value: number) => boolean,
): SampledRim => {
  const count = segmentCount(segments);
  const step = (2 * Math.PI) / count;
  const scores = Array.from({ length: count }, (_, index) => score(radial(frame, index * step)));
  const rim: RimPoint[] = [];
  const crossings: Vec3[] = [];

  scores.forEach((current, index) => {
    rim.push({ point: pointAt(frame, index * step), visible: isVisible(current) });

    const next = scores[(index + 1) % count];

    if (next === undefined || isPositive(current) === isPositive(next)) return;

    const share = current === next ? 0.5 : Math.min(1, Math.max(0, current / (current - next)));
    const point = pointAt(frame, (index + share) * step);

    crossings.push(point);
    rim.push({ point, visible: isVisible(next) });
  });

  return { rim, crossings };
};

/** Контур конуса для направления на зрителя `view` (см. `viewDirection3d`). `null` для вырожденного конуса. */
export const coneOutline = (
  base: Vec3,
  apex: Vec3,
  radius: number,
  view: Vec3,
  segments: number = DEFAULT_SEGMENTS,
): ConeOutline | null => {
  const height = length(minus(apex, base));
  const axis = unit(minus(apex, base));
  const toViewer = unit(view);

  if (!(radius > 0) || !axis || !toViewer || segmentCount(segments) < 3) return null;

  const frame = circleFrame(base, axis, radius);

  if (!frame) return null;

  // Внешняя нормаль боковой поверхности на ободе: e·h + a·r (нормирована, чтобы
  // порог не зависел от размеров); у основания нормаль −a.
  const slant = Math.hypot(height, radius);
  const axial = (dot(axis, toViewer) * radius) / slant;
  const baseVisible = -dot(axis, toViewer) > EPS;
  const lateral = (e: Vec3): number => (dot(e, toViewer) * height) / slant + axial;
  const isPositive = (value: number): boolean => value > EPS;
  const { rim, crossings } = sampleRim(frame, segments, lateral, isPositive, (value) => isPositive(value) || baseVisible);

  return { rim, tangents: crossings.length === 2 ? crossings : [] };
};

/** Силуэт и экватор шара для направления на зрителя `view`. `null` для вырожденного шара. */
export const sphereOutline = (
  center: Vec3,
  radius: number,
  view: Vec3,
  segments: number = DEFAULT_SEGMENTS,
): SphereOutline | null => {
  const toViewer = unit(view);
  const frame = circleFrame(center, VERTICAL, radius);

  if (!(radius > 0) || !toViewer || !frame || segmentCount(segments) < 3) return null;

  const isVisible = (value: number): boolean => value >= -EPS;
  const { rim } = sampleRim(frame, segments, (e) => dot(e, toViewer), isVisible, isVisible);

  return { silhouette: circle3d(center, toViewer, radius, segments), equator: rim };
};

/**
 * Разбивает замкнутый обход на серии подряд идущих точек одной видимости
 * (для сплошных и пунктирных дуг). Обход замкнут: серия через начало обхода
 * не рвётся, первая точка каждой серии ещё и замыкает предыдущую.
 */
export const visibilityRuns = (rim: RimPoint[]): VisibilityRun[] => {
  const first = rim[0];

  if (!first) return [];

  const start = rim.findIndex((item, index) => {
    const previous = rim[(index + rim.length - 1) % rim.length];

    return previous !== undefined && previous.visible !== item.visible;
  });

  if (start < 0) return [{ visible: first.visible, points: [...rim.map((item) => item.point), first.point] }];

  const ordered = [...rim.slice(start), ...rim.slice(0, start)];
  const runs: VisibilityRun[] = [];

  ordered.forEach((item) => {
    const current = runs[runs.length - 1];

    if (current && current.visible === item.visible) {
      current.points.push(item.point);

      return;
    }

    if (current) current.points.push(item.point);

    runs.push({ visible: item.visible, points: [item.point] });
  });

  const last = runs[runs.length - 1];
  const head = ordered[0];

  if (last && head) last.points.push(head.point);

  return runs;
};
