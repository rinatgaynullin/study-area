import { viewDirection3d } from '../render/coords';
import type { EdgeStyle, Vec3 } from '../scene/types';

/**
 * Невидимые линии выпуклого тела: по вершинам, рёбрам и углам вида решает,
 * какие рёбра рисовать пунктиром. Школьные тела выпуклые, поэтому хватает
 * выпуклой оболочки точек тела и её опорных плоскостей.
 */

/** Опорная плоскость выпуклой оболочки: `normal · p = offset`, нормаль единичная и смотрит наружу. */
export interface SupportPlane {
  normal: Vec3;
  offset: number;
}

export interface HiddenLinesInput {
  vertices: Record<string, Vec3>;
  edges: Array<{ from: string; to: string }>;
  /** Точки тела, которых нет среди вершин: окружности оснований, сфера. Участвуют в оболочке. */
  extraPoints?: Vec3[];
  angleY: number;
  angleZ: number;
}

/** Перебор троек кубический: больше точек оболочку не считаем. */
export const MAX_HULL_POINTS = 160;

/** Точки, которые ближе этого по каждой координате, считаются одной. */
const SAME_POINT_TOLERANCE = 1e-6;
/** Допуск совпадения нормалей при отбрасывании повторов плоскостей. */
const SAME_NORMAL_TOLERANCE = 1e-6;
/** Плоскость, у которой проекция направления взгляда на нормаль меньше этого, видна с ребра. */
const EDGE_ON_TOLERANCE = 1e-6;

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

const scaleVector = (v: Vec3, factor: number): Vec3 => [v[0] * factor, v[1] * factor, v[2] * factor];

/** Наибольший размах координат точек по осям. */
const spanOf = (points: Vec3[]): number => {
  if (points.length === 0) return 0;

  const axes = [0, 1, 2].map((axis) => points.map((point) => point[axis] ?? 0));

  return Math.max(...axes.map((values) => Math.max(...values) - Math.min(...values)));
};

/** Допуск «точка на плоскости» в единицах сцены: одинаково строгий для маленьких и больших тел. */
const toleranceFor = (span: number): number => 1e-7 * (1 + span);

const isSamePoint = (a: Vec3, b: Vec3): boolean =>
  Math.abs(a[0] - b[0]) <= SAME_POINT_TOLERANCE &&
  Math.abs(a[1] - b[1]) <= SAME_POINT_TOLERANCE &&
  Math.abs(a[2] - b[2]) <= SAME_POINT_TOLERANCE;

const uniquePoints = (points: Vec3[]): Vec3[] =>
  points.reduce<Vec3[]>((unique, point) => {
    if (!unique.some((other) => isSamePoint(other, point))) unique.push(point);

    return unique;
  }, []);

/** Плоскость уже найдена — с любой ориентацией нормали. */
const isKnownPlane = (planes: SupportPlane[], normal: Vec3, offset: number, eps: number): boolean =>
  planes.some((plane) => {
    const cosine = dot(plane.normal, normal);

    if (cosine > 1 - SAME_NORMAL_TOLERANCE) return Math.abs(plane.offset - offset) <= eps;
    if (cosine < -1 + SAME_NORMAL_TOLERANCE) return Math.abs(plane.offset + offset) <= eps;

    return false;
  });

/**
 * С какой стороны плоскости лежат точки: 1 или −1; 0 — все на плоскости;
 * `null` — точки по обе стороны, плоскость не опорная.
 */
const sideOfPoints = (normal: Vec3, offset: number, points: Vec3[], eps: number): number | null => {
  let side = 0;

  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const distance = point ? dot(normal, point) - offset : 0;
    const sign = Math.abs(distance) > eps ? Math.sign(distance) : 0;

    if (sign !== 0 && side !== 0 && sign !== side) return null;
    if (sign !== 0) side = sign;
  }

  return side;
};

/**
 * Проверяет плоскость тройки и, если она опорная и новая, добавляет её с
 * нормалью наружу. Возвращает `true`, когда все точки лежат в этой плоскости:
 * оболочки тогда нет.
 */
const addTriplePlane = (
  planes: SupportPlane[],
  triple: [Vec3, Vec3, Vec3],
  points: Vec3[],
  eps: number,
  areaEps: number,
): boolean => {
  const [a, b, c] = triple;
  const product = cross(subtract(b, a), subtract(c, a));
  const length = Math.hypot(...product);

  // Тройка на одной прямой плоскости не задаёт.
  if (length < areaEps) return false;

  const normal = scaleVector(product, 1 / length);
  const offset = dot(normal, a);

  if (isKnownPlane(planes, normal, offset, eps)) return false;

  const side = sideOfPoints(normal, offset, points, eps);

  if (side === 0) return true;
  if (side === -1) planes.push({ normal, offset });
  if (side === 1) planes.push({ normal: scaleVector(normal, -1), offset: -offset });

  return false;
};

/**
 * Опорные плоскости выпуклой оболочки точек, без повторов. Пустой массив, если точек меньше
 * четырёх, все они лежат в одной плоскости или их больше MAX_HULL_POINTS.
 */
export const supportPlanes = (points: Vec3[]): SupportPlane[] => {
  const unique = uniquePoints(points);
  const count = unique.length;

  if (count < 4 || count > MAX_HULL_POINTS) return [];

  const span = spanOf(unique);
  const eps = toleranceFor(span);
  // Векторное произведение — площадь, её допуск тоже масштабируем от размера сцены.
  const areaEps = eps * (1 + span);
  const planes: SupportPlane[] = [];
  let flat = false;

  for (let i = 0; i < count && !flat; i += 1) {
    for (let j = i + 1; j < count && !flat; j += 1) {
      for (let k = j + 1; k < count && !flat; k += 1) {
        const a = unique[i];
        const b = unique[j];
        const c = unique[k];

        if (a && b && c) flat = addTriplePlane(planes, [a, b, c], unique, eps, areaEps);
      }
    }
  }

  return flat ? [] : planes;
};

/** Те же стили по уже посчитанным плоскостям: чтобы при вращении не пересчитывать оболочку. */
export const classifyEdges = (
  planes: SupportPlane[],
  vertices: Record<string, Vec3>,
  edges: Array<{ from: string; to: string }>,
  angleY: number,
  angleZ: number,
): EdgeStyle[] => {
  const direction = viewDirection3d(angleY, angleZ);
  const view = scaleVector(direction, 1 / Math.hypot(...direction));
  const eps = toleranceFor(spanOf(Object.values(vertices)));
  const onPlane = (plane: SupportPlane, point: Vec3): boolean =>
    Math.abs(dot(plane.normal, point) - plane.offset) <= eps;

  return edges.map(({ from, to }): EdgeStyle => {
    const start = vertices[from];
    const end = vertices[to];

    if (!start || !end) return 'solid';

    const carriers = planes.filter((plane) => onPlane(plane, start) && onPlane(plane, end));

    // Ни одна грань не содержит отрезок целиком — он проходит внутри тела.
    if (carriers.length === 0) return 'dashed';

    return carriers.some((plane) => dot(plane.normal, view) > EDGE_ON_TOLERANCE) ? 'solid' : 'dashed';
  });
};

/**
 * Стиль каждого ребра для данного вида, в порядке `edges`. `null`, когда оболочки нет
 * (плоская фигура, меньше четырёх точек): стили тогда трогать не нужно.
 * Ребро с несуществующей вершиной получает 'solid'.
 */
export const hiddenLineStyles = (input: HiddenLinesInput): EdgeStyle[] | null => {
  const planes = supportPlanes([...Object.values(input.vertices), ...(input.extraPoints ?? [])]);

  if (planes.length === 0) return null;

  return classifyEdges(planes, input.vertices, input.edges, input.angleY, input.angleZ);
};
