import type { Point, Vec2, Vec3 } from '../scene/types';

export interface SvgPoint {
  x: number;
  y: number;
}

/** Умолчания рендера: пикселей на единицу мира. */
export const DEFAULT_GEOMETRY_SCALE = 25;
export const DEFAULT_PLOT_SCALE = 20;
export const DEFAULT_PHYSICS_SCALE = 25;

/** Кабинетная проекция: ось глубины под 45° с коэффициентом 0.5. */
const OBLIQUE_ANGLE = (45 * Math.PI) / 180;
const OBLIQUE_FACTOR = 0.5;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/** Мир → SVG: ось y вверх, начало координат сцены в точке (cx, cy). */
export const worldToSvg = (point: Point, scale: number, cx: number, cy: number): SvgPoint => ({
  x: cx + point[0] * scale,
  y: cy - point[1] * scale,
});

/** SVG → мир, обратно к `worldToSvg`: нужно конструкторам. */
export const svgToWorld = (point: SvgPoint, scale: number, cx: number, cy: number): Vec2 => [
  (point.x - cx) / scale,
  (cy - point.y) / scale,
];

/**
 * Поворот точки 3D-сцены: сначала вокруг оси z на `angleZ`, потом вокруг
 * оси y на `angleY` — так крутит сцену конструктор стереометрии.
 */
export const rotatePoint3d = (point: Point, angleY: number, angleZ: number): Vec3 => {
  let [x, y, z = 0] = point;

  if (angleZ) {
    const cos = Math.cos(toRadians(angleZ));
    const sin = Math.sin(toRadians(angleZ));

    [x, y] = [x * cos - y * sin, x * sin + y * cos];
  }

  if (angleY) {
    const cos = Math.cos(toRadians(angleY));
    const sin = Math.sin(toRadians(angleY));

    [x, z] = [x * cos + z * sin, -x * sin + z * cos];
  }

  return [x, y, z];
};

/**
 * Кабинетная проекция уже повёрнутой точки: ось x уходит в глубину под 45°
 * вдвое короче, y идёт вправо, z — вверх.
 */
export const projectOblique = (point: Vec3, scale: number, cx: number, cy: number): SvgPoint => {
  const [depth, right, up] = point;

  return {
    x: cx + (right - depth * Math.cos(OBLIQUE_ANGLE) * OBLIQUE_FACTOR) * scale,
    y: cy - (up - depth * Math.sin(OBLIQUE_ANGLE) * OBLIQUE_FACTOR) * scale,
  };
};

/** Плоские координаты 3D-точки после поворота и проекции, в единицах мира. */
export const project3dToPlane = (point: Point, angleY: number, angleZ: number): Vec2 => {
  const [depth, right, up] = rotatePoint3d(point, angleY, angleZ);

  return [
    right - depth * Math.cos(OBLIQUE_ANGLE) * OBLIQUE_FACTOR,
    up - depth * Math.sin(OBLIQUE_ANGLE) * OBLIQUE_FACTOR,
  ];
};

export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Охватывающий прямоугольник точек мира; `null`, если точек нет. */
export const boundsOf = (points: Vec2[]): Bounds | null => {
  if (points.length === 0) return null;

  return points.reduce<Bounds>(
    (bounds, [x, y]) => ({
      minX: Math.min(bounds.minX, x),
      maxX: Math.max(bounds.maxX, x),
      minY: Math.min(bounds.minY, y),
      maxY: Math.max(bounds.maxY, y),
    }),
    { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
  );
};

export interface Viewport {
  scale: number;
  cx: number;
  cy: number;
}

export interface FitOptions {
  width: number;
  height: number;
  /** Отступ от края картинки в пикселях. */
  padding: number;
  minScale: number;
  maxScale: number;
  /** Масштаб, когда вписывать нечего. */
  fallbackScale: number;
}

/**
 * Подбирает масштаб и центр так, чтобы точки поместились в картинку: сцена
 * от нейросети не знает, какого она размера.
 */
export const fitViewport = (points: Vec2[], options: FitOptions): Viewport => {
  const bounds = boundsOf(points);

  if (!bounds) {
    return { scale: options.fallbackScale, cx: options.width / 2, cy: options.height / 2 };
  }

  const spanX = bounds.maxX - bounds.minX;
  const spanY = bounds.maxY - bounds.minY;
  const innerWidth = options.width - options.padding * 2;
  const innerHeight = options.height - options.padding * 2;
  const fitted = Math.min(innerWidth / (spanX > 0.1 ? spanX : 1), innerHeight / (spanY > 0.1 ? spanY : 1));
  const scale = Math.max(options.minScale, Math.min(fitted, options.maxScale));

  return {
    scale,
    cx: options.width / 2 - ((bounds.minX + bounds.maxX) / 2) * scale,
    cy: options.height / 2 + ((bounds.minY + bounds.maxY) / 2) * scale,
  };
};
