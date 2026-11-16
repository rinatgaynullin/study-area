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

/**
 * Опорные плоскости оболочки вместе с допуском «точка на плоскости», с которым
 * они найдены: `classifyEdges` проверяет концы рёбер с тем же допуском.
 */
export interface SupportHull {
  planes: SupportPlane[];
  tolerance: number;
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
/** Шаг округления компонент нормали в ключе плоскости. */
const NORMAL_KEY_STEP = 1e-6;
/** Шаг округления смещения в ключе плоскости — доля размаха сцены. */
const OFFSET_KEY_STEP = 1e-6;
/**
 * Сколько точек (вразброс) проверить до поиска плоскости среди найденных:
 * секущие плоскости почти всегда отсеиваются уже на них.
 */
const QUICK_SCAN_POINTS = 8;
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

/** Строгий допуск для повторов точек и троек на одной прямой: одинаковый для маленьких и больших тел. */
const strictTolerance = (span: number): number => 1e-7 * (1 + span);

/**
 * Допуск «точка на плоскости». Конструктор округляет координаты до 0,01, и точка
 * на наклонной грани отходит от её плоскости почти на столько же; у мелких тел
 * допуск сжимается вместе с размахом.
 */
const planeTolerance = (span: number): number => Math.min(0.02, 0.02 * span);

const isSamePoint = (a: Vec3, b: Vec3): boolean =>
  Math.abs(a[0] - b[0]) <= SAME_POINT_TOLERANCE &&
  Math.abs(a[1] - b[1]) <= SAME_POINT_TOLERANCE &&
  Math.abs(a[2] - b[2]) <= SAME_POINT_TOLERANCE;

const uniquePoints = (points: Vec3[]): Vec3[] =>
  points.reduce<Vec3[]>((unique, point) => {
    if (!unique.some((other) => isSamePoint(other, point))) unique.push(point);

    return unique;
  }, []);

/** Округлённые нормаль и смещение плоскости: по ним опознаются повторы. */
type PlaneKey = [number, number, number, number];

/** Совпадает ли `a` с ключом `b`, взятым со знаком `sign` (−1 — та же плоскость с обратной нормалью). */
const sameKey = (a: PlaneKey, b: PlaneKey, sign: number): boolean =>
  a[0] === sign * b[0] && a[1] === sign * b[1] && a[2] === sign * b[2] && a[3] === sign * b[3];

/** Числовой хэш ключа со знаком `sign` для корзины: совпадение хэша ещё не значит совпадения ключа. */
const hashOf = (key: PlaneKey, sign: number): number =>
  (sign * key[0] * 73856093) ^ (sign * key[1] * 19349663) ^ (sign * key[2] * 83492791) ^ (sign * key[3] * 50331653);

/**
 * Найденные опорные плоскости с поиском повторов за постоянное время: одна грань,
 * найденная по разным тройкам, даёт тот же округлённый ключ. Ключи разложены по
 * корзинам числового хэша, чтобы не строить строку на каждую тройку.
 */
class PlaneIndex {
  readonly planes: SupportPlane[] = [];

  private readonly buckets = new Map<number, PlaneKey[]>();

  constructor(private readonly offsetStep: number) {}

  /**
   * Плоскость уже найдена — с любой ориентацией нормали. Быстрая предпроверка:
   * округление обратной нормали может разойтись с её ключом на половинке шага,
   * тогда повтор отсеет `add`.
   */
  has(normal: Vec3, offset: number): boolean {
    const key = this.keyOf(normal, offset);

    return this.includes(key, 1) || this.includes(key, -1);
  }

  /** Запоминает опорную плоскость с нормалью наружу, если её ещё нет. */
  add(plane: SupportPlane): void {
    const key = this.keyOf(plane.normal, plane.offset);

    if (this.includes(key, 1)) return;

    const hash = hashOf(key, 1);
    const bucket = this.buckets.get(hash);

    if (bucket) bucket.push(key);
    else this.buckets.set(hash, [key]);

    this.planes.push(plane);
  }

  private keyOf(normal: Vec3, offset: number): PlaneKey {
    return [
      Math.round(normal[0] / NORMAL_KEY_STEP),
      Math.round(normal[1] / NORMAL_KEY_STEP),
      Math.round(normal[2] / NORMAL_KEY_STEP),
      Math.round(offset / this.offsetStep),
    ];
  }

  private includes(key: PlaneKey, sign: number): boolean {
    const bucket = this.buckets.get(hashOf(key, sign));

    return bucket ? bucket.some((other) => sameKey(other, key, sign)) : false;
  }
}

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

/** Общая сторона двух групп точек; `null`, если группы по разные стороны или одна из них не опорная. */
const joinSides = (first: number | null, second: number | null): number | null => {
  if (first === null || second === null) return null;
  if (first !== 0 && second !== 0 && first !== second) return null;

  return first === 0 ? second : first;
};

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/**
 * Те же точки вразброс. Выборки окружностей и сфер идут подряд по контуру, и
 * плоскость, срезающая край тела, видит сначала длинную серию точек с одной
 * стороны; вразброс точки с другой стороны попадаются раньше, и проверка
 * сторон выходит быстрее. На результат порядок не влияет.
 */
const scattered = (points: Vec3[]): Vec3[] => {
  const count = points.length;
  // Шаг около золотого сечения, взаимно простой с числом точек: обходит все точки по разу.
  let stride = Math.max(1, Math.round(count * 0.618));

  while (gcd(stride, count) !== 1) stride += 1;

  return points.map((_, index) => points[(index * stride) % count] ?? [0, 0, 0]);
};

/** Точки для проверки сторон: сначала несколько вразброс, затем остальные. */
interface ScanPoints {
  quick: Vec3[];
  rest: Vec3[];
}

/** Допуски перебора троек. */
interface HullTolerances {
  /** Точка на плоскости. */
  plane: number;
  /** Тройка на одной прямой: площадь параллелограмма меньше этого. */
  area: number;
}

/**
 * Проверяет плоскость тройки и, если она опорная и новая, добавляет её с
 * нормалью наружу. Возвращает `true`, когда все точки лежат в этой плоскости:
 * оболочки тогда нет.
 */
const addTriplePlane = (
  index: PlaneIndex,
  triple: [Vec3, Vec3, Vec3],
  points: ScanPoints,
  tolerances: HullTolerances,
): boolean => {
  const [a, b, c] = triple;
  const product = cross(subtract(b, a), subtract(c, a));
  const length = Math.sqrt(dot(product, product));

  // Тройка на одной прямой плоскости не задаёт.
  if (length < tolerances.area) return false;

  const normal = scaleVector(product, 1 / length);
  const offset = dot(normal, a);
  const quickSide = sideOfPoints(normal, offset, points.quick, tolerances.plane);

  // Секущая плоскость или грань, уже найденная по другой тройке: полный обход не нужен.
  if (quickSide === null || index.has(normal, offset)) return false;

  const side = joinSides(quickSide, sideOfPoints(normal, offset, points.rest, tolerances.plane));

  if (side === 0) return true;
  if (side === -1) index.add({ normal, offset });
  if (side === 1) index.add({ normal: scaleVector(normal, -1), offset: -offset });

  return false;
};

/**
 * Опорные плоскости выпуклой оболочки точек, без повторов, и допуск «точка на плоскости»
 * по размаху всех точек. Плоскостей нет, если точек меньше четырёх, все они лежат в одной
 * плоскости или их больше MAX_HULL_POINTS.
 */
export const supportPlanes = (points: Vec3[]): SupportHull => {
  const unique = uniquePoints(points);
  const count = unique.length;
  const span = spanOf(unique);
  const tolerance = planeTolerance(span);

  if (count < 4 || count > MAX_HULL_POINTS) return { planes: [], tolerance };

  const tolerances: HullTolerances = {
    plane: tolerance,
    // Векторное произведение — площадь, её допуск тоже масштабируем от размера сцены.
    area: strictTolerance(span) * (1 + span),
  };
  const index = new PlaneIndex(OFFSET_KEY_STEP * span);
  const order = scattered(unique);
  const scan: ScanPoints = { quick: order.slice(0, QUICK_SCAN_POINTS), rest: order.slice(QUICK_SCAN_POINTS) };
  let flat = false;

  for (let i = 0; i < count && !flat; i += 1) {
    for (let j = i + 1; j < count && !flat; j += 1) {
      for (let k = j + 1; k < count && !flat; k += 1) {
        const a = unique[i];
        const b = unique[j];
        const c = unique[k];

        if (a && b && c) flat = addTriplePlane(index, [a, b, c], scan, tolerances);
      }
    }
  }

  return { planes: flat ? [] : index.planes, tolerance };
};

/** Те же стили по уже посчитанным плоскостям: чтобы при вращении не пересчитывать оболочку. */
export const classifyEdges = (
  hull: SupportHull,
  vertices: Record<string, Vec3>,
  edges: Array<{ from: string; to: string }>,
  angleY: number,
  angleZ: number,
): EdgeStyle[] => {
  const direction = viewDirection3d(angleY, angleZ);
  const view = scaleVector(direction, 1 / Math.hypot(...direction));
  const onPlane = (plane: SupportPlane, point: Vec3): boolean =>
    Math.abs(dot(plane.normal, point) - plane.offset) <= hull.tolerance;

  return edges.map(({ from, to }): EdgeStyle => {
    const start = vertices[from];
    const end = vertices[to];

    if (!start || !end) return 'solid';

    const carriers = hull.planes.filter((plane) => onPlane(plane, start) && onPlane(plane, end));

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
  const hull = supportPlanes([...Object.values(input.vertices), ...(input.extraPoints ?? [])]);

  if (hull.planes.length === 0) return null;

  return classifyEdges(hull, input.vertices, input.edges, input.angleY, input.angleZ);
};
