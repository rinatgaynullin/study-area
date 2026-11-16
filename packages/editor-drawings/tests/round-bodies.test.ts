import { describe, expect, it } from 'vitest';
import { viewDirection3d } from '../src/render/coords';
import { circle3d, coneOutline, sphereOutline, visibilityRuns, type RimPoint } from '../src/render/round-bodies';
import type { Vec3 } from '../src/scene/types';

const DEFAULT_VIEW = viewDirection3d(15, -30);

const VIEWS: Array<[number, number]> = [
  [0, 0],
  [15, -30],
  [-40, 120],
  [85, 170],
];

const minus = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const distance = (a: Vec3, b: Vec3): number => Math.hypot(...minus(a, b));

describe('circle3d', () => {
  it('точки на расстоянии радиуса от центра и в плоскости, перпендикулярной оси', () => {
    const center: Vec3 = [1, -2, 3];
    const axes: Vec3[] = [[0, 0, 1], [1, 2, -0.5], [0, 0, -3], [4, 0, 0]];

    axes.forEach((axis) => {
      const points = circle3d(center, axis, 2.5, 48);

      expect(points).toHaveLength(48);
      points.forEach((point) => {
        expect(distance(point, center)).toBeCloseTo(2.5, 9);
        expect(dot(minus(point, center), axis)).toBeCloseTo(0, 9);
      });
    });
  });

  it('нулевая ось — пустой список', () => {
    expect(circle3d([0, 0, 0], [0, 0, 0], 1, 16)).toEqual([]);
  });
});

describe('coneOutline', () => {
  const base: Vec3 = [0, 0, 0];
  const apex: Vec3 = [0, 0, 4];

  it('вид по умолчанию: две точки касания на окружности основания, обод частично скрыт', () => {
    const outline = coneOutline(base, apex, 2, DEFAULT_VIEW);

    expect(outline).not.toBeNull();
    expect(outline?.tangents).toHaveLength(2);
    outline?.tangents.forEach((tangent) => {
      expect(distance(tangent, base)).toBeCloseTo(2, 9);
      expect(tangent[2]).toBeCloseTo(0, 9);
    });
    expect(outline?.rim.some((item) => item.visible)).toBe(true);
    expect(outline?.rim.some((item) => !item.visible)).toBe(true);
    outline?.rim.forEach((item) => expect(distance(item.point, base)).toBeCloseTo(2, 9));
  });

  it('образующие через точки касания — силуэт: боковая нормаль там перпендикулярна взгляду', () => {
    VIEWS.forEach(([angleY, angleZ]) => {
      const view = viewDirection3d(angleY, angleZ);
      const outline = coneOutline(base, apex, 2, view);

      outline?.tangents.forEach((tangent) => {
        // Нормаль e·h + a·r при h = 4, r = 2 и радиальном e = (t − base) / r.
        const [ex, ey, ez] = minus(tangent, base);
        const normal: Vec3 = [ex * 2, ey * 2, ez * 2 + 2];

        expect(dot(normal, view)).toBeCloseTo(0, 2);
      });
    });
  });

  it('вид вдоль оси со стороны вершины: касаний нет, обод виден целиком', () => {
    const outline = coneOutline(base, apex, 2, [0, 0, 1]);

    expect(outline?.tangents).toEqual([]);
    expect(outline?.rim.every((item) => item.visible)).toBe(true);
  });

  it('перевёрнутый конус в виде по умолчанию виден по всему ободу', () => {
    const outline = coneOutline([0, 0, 4], [0, 0, 0], 2, DEFAULT_VIEW);

    expect(outline).not.toBeNull();
    expect(outline?.rim.every((item) => item.visible)).toBe(true);
  });

  it('вырожденные конусы — null', () => {
    expect(coneOutline(base, apex, 0, DEFAULT_VIEW)).toBeNull();
    expect(coneOutline(base, apex, -1, DEFAULT_VIEW)).toBeNull();
    expect(coneOutline(base, base, 2, DEFAULT_VIEW)).toBeNull();
    expect(coneOutline(base, apex, 2, [0, 0, 0])).toBeNull();
  });
});

describe('sphereOutline', () => {
  const center: Vec3 = [1, 2, 3];

  it('силуэт — большая окружность поперёк взгляда, экватор горизонтален и частично скрыт', () => {
    const outline = sphereOutline(center, 1.5, DEFAULT_VIEW);

    expect(outline).not.toBeNull();
    outline?.silhouette.forEach((point) => {
      expect(distance(point, center)).toBeCloseTo(1.5, 9);
      expect(dot(minus(point, center), DEFAULT_VIEW)).toBeCloseTo(0, 9);
    });
    expect(outline?.equator.some((item) => item.visible)).toBe(true);
    expect(outline?.equator.some((item) => !item.visible)).toBe(true);
    outline?.equator.forEach((item) => {
      expect(item.point[2]).toBe(center[2]);
      expect(distance(item.point, center)).toBeCloseTo(1.5, 9);
    });
  });

  it('вырожденные шары — null', () => {
    expect(sphereOutline(center, 0, DEFAULT_VIEW)).toBeNull();
    expect(sphereOutline(center, -2, DEFAULT_VIEW)).toBeNull();
    expect(sphereOutline(center, 1, [0, 0, 0])).toBeNull();
  });
});

describe('visibilityRuns', () => {
  const point = (index: number): Vec3 => [index, 0, 0];
  const rim = (flags: boolean[]): RimPoint[] => flags.map((visible, index) => ({ point: point(index), visible }));

  it('серия через начало обхода не рвётся, граничные точки общие', () => {
    const runs = visibilityRuns(rim([true, true, false, false, false, true]));

    expect(runs).toEqual([
      { visible: false, points: [point(2), point(3), point(4), point(5)] },
      { visible: true, points: [point(5), point(0), point(1), point(2)] },
    ]);
  });

  it('одна видимость — одна замкнутая серия', () => {
    expect(visibilityRuns(rim([true, true, true]))).toEqual([{ visible: true, points: [point(0), point(1), point(2), point(0)] }]);
    expect(visibilityRuns([])).toEqual([]);
  });

  it('обод конуса делится на сплошную и пунктирную дуги, которые смыкаются в точках касания', () => {
    const split = VIEWS.filter(([angleY, angleZ]) => {
      const outline = coneOutline([0, 0, 0], [0, 0, 4], 2, viewDirection3d(angleY, angleZ));
      const runs = visibilityRuns(outline?.rim ?? []);

      if (runs.length < 2) return false;

      expect(runs).toHaveLength(2);
      runs.forEach((run) => {
        const ends = [run.points[0], run.points[run.points.length - 1]];

        expect(outline?.tangents).toEqual(expect.arrayContaining(ends));
      });

      return true;
    });

    expect(split.length).toBeGreaterThan(0);
  });
});
