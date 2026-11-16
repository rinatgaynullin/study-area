import { describe, expect, it } from 'vitest';
import { project3dToPlane, rotatePoint3d, unrotatePoint3d, viewDirection3d } from '../src/render/coords';
import type { Vec3 } from '../src/scene/types';

const VIEWS: Array<[number, number]> = [
  [0, 0],
  [15, -30],
  [-40, 120],
  [85, 179],
];

describe('обратный поворот 3D-сцены', () => {
  it('возвращает точку после rotatePoint3d на место', () => {
    const point: Vec3 = [1.5, -2, 3.25];

    VIEWS.forEach(([angleY, angleZ]) => {
      const back = unrotatePoint3d(rotatePoint3d(point, angleY, angleZ), angleY, angleZ);

      back.forEach((value, index) => expect(value).toBeCloseTo(point[index] ?? 0, 9));
    });
  });
});

describe('направление на зрителя', () => {
  it('точки вдоль него сливаются на картинке', () => {
    const point: Vec3 = [0.5, 1, -2];

    VIEWS.forEach(([angleY, angleZ]) => {
      const [dx, dy, dz] = viewDirection3d(angleY, angleZ);
      const here = project3dToPlane(point, angleY, angleZ);
      const there = project3dToPlane([point[0] + dx, point[1] + dy, point[2] + dz], angleY, angleZ);

      expect(there[0]).toBeCloseTo(here[0], 9);
      expect(there[1]).toBeCloseTo(here[1], 9);
    });
  });

  it('без поворота смотрит вдоль оси x: она идёт к зрителю', () => {
    const [x, y, z] = viewDirection3d(0, 0);

    expect(x).toBe(1);
    expect(y).toBeGreaterThan(0);
    expect(z).toBeGreaterThan(0);
  });

  it('в виде по умолчанию видны верх и передние грани, дно скрыто', () => {
    const [x, y, z] = viewDirection3d(15, -30);
    const dot = (normal: Vec3): number => normal[0] * x + normal[1] * y + normal[2] * z;

    // Шаблон параллелепипеда: пунктиром идут рёбра дальней вершины A(−3, −3, 0).
    expect(dot([0, 0, 1])).toBeGreaterThan(0);
    expect(dot([0, 0, -1])).toBeLessThan(0);
    expect(dot([1, 0, 0])).toBeGreaterThan(0);
    expect(dot([0, 1, 0])).toBeGreaterThan(0);
    expect(dot([-1, 0, 0])).toBeLessThan(0);
    expect(dot([0, -1, 0])).toBeLessThan(0);
  });
});
