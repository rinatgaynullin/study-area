import type { Vec2 } from '../scene/types';

/** Геометрия на плоскости для конструкторов: расстояния, проекции, подбор кривых. */

export const distance = (a: Vec2, b: Vec2): number => Math.hypot(b[0] - a[0], b[1] - a[1]);

export const midpoint = (a: Vec2, b: Vec2): Vec2 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

/** Ближайшая точка отрезка `ab` к `p` и доля `t` вдоль отрезка. */
export const projectOnSegment = (p: Vec2, a: Vec2, b: Vec2): { point: Vec2; t: number } => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) return { point: [a[0], a[1]], t: 0 };

  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSquared));

  return { point: [a[0] + t * dx, a[1] + t * dy], t };
};

export const distanceToSegment = (p: Vec2, a: Vec2, b: Vec2): number => distance(p, projectOnSegment(p, a, b).point);

/** Ближайшая точка окружности к `p`; в центре — точка справа. */
export const nearestOnCircle = (p: Vec2, center: Vec2, radius: number): Vec2 => {
  const dx = p[0] - center[0];
  const dy = p[1] - center[1];
  const length = Math.hypot(dx, dy);

  if (length === 0) return [center[0] + radius, center[1]];

  return [center[0] + (dx / length) * radius, center[1] + (dy / length) * radius];
};

/** Округление к сетке; шаг 0 — без округления. */
export const snapToGrid = (p: Vec2, step: number): Vec2 =>
  step > 0 ? [Math.round(p[0] / step) * step, Math.round(p[1] / step) * step] : [p[0], p[1]];

/** Угол от `a` к `b` в градусах, против часовой. */
export const angleDegrees = (a: Vec2, b: Vec2): number => (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;

/** Угол между лучами `vertex→a` и `vertex→b`, 0–180. */
export const angleBetween = (vertex: Vec2, a: Vec2, b: Vec2): number => {
  const first = Math.atan2(a[1] - vertex[1], a[0] - vertex[0]);
  const second = Math.atan2(b[1] - vertex[1], b[0] - vertex[0]);
  const delta = Math.abs(((second - first) * 180) / Math.PI) % 360;

  return delta > 180 ? 360 - delta : delta;
};

export const roundTo = (value: number, digits = 2): number => Number(value.toFixed(digits));

export const roundPoint = (p: Vec2, digits = 2): Vec2 => [roundTo(p[0], digits), roundTo(p[1], digits)];

// ---------------------------------------------------------- подбор фигур

export interface LineFit {
  k: number;
  b: number;
  /** Отклонение точек от прямой в единицах мира (среднеквадратичное). */
  error: number;
  /** Прямая почти вертикальная: `k` не годится, лучше две точки. */
  vertical: boolean;
}

/** Прямая `y = kx + b` по методу наименьших квадратов. */
export const fitLine = (points: Vec2[]): LineFit | null => {
  if (points.length < 2) return null;

  const n = points.length;
  const sumX = points.reduce((sum, [x]) => sum + x, 0);
  const sumY = points.reduce((sum, [, y]) => sum + y, 0);
  const meanX = sumX / n;
  const meanY = sumY / n;
  const varX = points.reduce((sum, [x]) => sum + (x - meanX) ** 2, 0);
  const varY = points.reduce((sum, [, y]) => sum + (y - meanY) ** 2, 0);

  if (varX < 1e-9 && varY < 1e-9) return null;

  if (varX < varY * 0.05) return { k: Infinity, b: meanX, error: Math.sqrt(varX / n), vertical: true };

  const cov = points.reduce((sum, [x, y]) => sum + (x - meanX) * (y - meanY), 0);
  const k = cov / varX;
  const b = meanY - k * meanX;
  const error = Math.sqrt(points.reduce((sum, [x, y]) => sum + (y - (k * x + b)) ** 2, 0) / n);

  return { k, b, error, vertical: false };
};

export interface CircleFit {
  center: Vec2;
  radius: number;
  error: number;
}

/** Окружность по точкам: алгебраический метод Касы (линейная система 3×3). */
export const fitCircle = (points: Vec2[]): CircleFit | null => {
  if (points.length < 3) return null;

  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  let sx = 0;
  let sy = 0;
  let sxz = 0;
  let syz = 0;
  let sz = 0;
  const n = points.length;

  points.forEach(([x, y]) => {
    const z = x * x + y * y;

    sxx += x * x;
    syy += y * y;
    sxy += x * y;
    sx += x;
    sy += y;
    sxz += x * z;
    syz += y * z;
    sz += z;
  });

  // Решаем A·[a b c]ᵀ = rhs для x² + y² + a·x + b·y + c = 0 методом Крамера.
  const matrix = [
    [sxx, sxy, sx],
    [sxy, syy, sy],
    [sx, sy, n],
  ];
  const rhs = [-sxz, -syz, -sz];
  const det = (m: number[][]): number =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
    - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
    + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const main = det(matrix);

  if (Math.abs(main) < 1e-9) return null;

  const replace = (column: number): number[][] => matrix.map((row, i) => row.map((value, j) => (j === column ? rhs[i] : value)));
  const a = det(replace(0)) / main;
  const b = det(replace(1)) / main;
  const c = det(replace(2)) / main;
  const center: Vec2 = [-a / 2, -b / 2];
  const radiusSquared = center[0] ** 2 + center[1] ** 2 - c;

  if (radiusSquared <= 0) return null;

  const radius = Math.sqrt(radiusSquared);
  const error = Math.sqrt(points.reduce((sum, p) => sum + (distance(p, center) - radius) ** 2, 0) / n);

  return { center, radius, error };
};

export interface ParabolaFit {
  a: number;
  b: number;
  c: number;
  vertex: Vec2;
  error: number;
}

/** Парабола `y = ax² + bx + c` по методу наименьших квадратов. */
export const fitParabola = (points: Vec2[]): ParabolaFit | null => {
  if (points.length < 3) return null;

  const n = points.length;
  const s = (fx: (p: Vec2) => number): number => points.reduce((sum, p) => sum + fx(p), 0);
  const matrix = [
    [s(([x]) => x ** 4), s(([x]) => x ** 3), s(([x]) => x ** 2)],
    [s(([x]) => x ** 3), s(([x]) => x ** 2), s(([x]) => x)],
    [s(([x]) => x ** 2), s(([x]) => x), n],
  ];
  const rhs = [s(([x, y]) => x * x * y), s(([x, y]) => x * y), s(([, y]) => y)];
  const det = (m: number[][]): number =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
    - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
    + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const main = det(matrix);

  if (Math.abs(main) < 1e-9) return null;

  const replace = (column: number): number[][] => matrix.map((row, i) => row.map((value, j) => (j === column ? rhs[i] : value)));
  const a = det(replace(0)) / main;
  const b = det(replace(1)) / main;
  const c = det(replace(2)) / main;

  if (Math.abs(a) < 1e-6) return null;

  const vx = -b / (2 * a);
  const error = Math.sqrt(s(([x, y]) => (y - (a * x * x + b * x + c)) ** 2) / n);

  return { a, b, c, vertex: [vx, a * vx * vx + b * vx + c], error };
};

export type RecognizedShape =
  | { type: 'line'; p1: Vec2; p2: Vec2 }
  | { type: 'circle'; center: Vec2; radius: number }
  | { type: 'parabola'; vertex: Vec2; direction: 'up' | 'down'; stretchY: number }
  | { type: 'freehand'; points: Vec2[] };

/**
 * Распознаёт штрих карандаша: прямая, окружность, парабола — иначе остаётся
 * ломаной. Порог — доля размаха штриха, чтобы не зависеть от масштаба.
 */
export const recognizeStroke = (points: Vec2[]): RecognizedShape => {
  if (points.length < 3) return { type: 'freehand', points };

  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 0.1);
  const tolerance = span * 0.06;
  const first = points[0];
  const last = points[points.length - 1];

  const line = fitLine(points);

  if (line && line.error < tolerance) {
    if (line.vertical) return { type: 'line', p1: [line.b, Math.min(...ys)], p2: [line.b, Math.max(...ys)] };

    return { type: 'line', p1: [first[0], line.k * first[0] + line.b], p2: [last[0], line.k * last[0] + line.b] };
  }

  // Замкнутый штрих — скорее окружность.
  const circle = fitCircle(points);

  if (circle && circle.error < tolerance && distance(first, last) < span * 0.35) {
    return { type: 'circle', center: circle.center, radius: circle.radius };
  }

  const parabola = fitParabola(points);

  if (parabola && parabola.error < tolerance) {
    return {
      type: 'parabola',
      vertex: parabola.vertex,
      direction: parabola.a < 0 ? 'down' : 'up',
      stretchY: Math.abs(parabola.a),
    };
  }

  return { type: 'freehand', points };
};
