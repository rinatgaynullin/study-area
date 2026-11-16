import { describe, expect, it } from 'vitest';
import {
  MAX_HULL_POINTS,
  classifyEdges,
  hiddenLineStyles,
  supportPlanes,
  type HiddenLinesInput,
} from '../src/builders/hidden-lines';
import type { Vec3 } from '../src/scene/types';

/** Вид по умолчанию в шаблонах конструктора. */
const ANGLE_Y = 15;
const ANGLE_Z = -30;

type Edge = { from: string; to: string };

/** Рёбра из записи вида 'AB BC SA': имена вершин — буква с необязательными цифрами. */
const edgesOf = (spec: string): Edge[] =>
  spec.split(' ').map((pair) => {
    const match = /^([A-Z]\d*)([A-Z]\d*)$/.exec(pair);

    if (!match) throw new Error(`Неверное ребро ${pair}`);

    return { from: match[1] ?? '', to: match[2] ?? '' };
  });

/** Имена пунктирных рёбер, по алфавиту. */
const dashedOf = (input: HiddenLinesInput): string[] | null => {
  const styles = hiddenLineStyles(input);

  if (!styles) return null;

  return input.edges
    .filter((_, index) => styles[index] === 'dashed')
    .map(({ from, to }) => `${from}${to}`)
    .sort();
};

const scene = (
  vertices: Record<string, Vec3>,
  edges: string,
  view: Partial<Pick<HiddenLinesInput, 'angleY' | 'angleZ' | 'extraPoints'>> = {},
): HiddenLinesInput => ({ vertices, edges: edgesOf(edges), angleY: ANGLE_Y, angleZ: ANGLE_Z, ...view });

const BASE_SQUARE: Record<string, Vec3> = {
  A: [-3, -3, 0],
  B: [3, -3, 0],
  C: [3, 3, 0],
  D: [-3, 3, 0],
};

const BASE_TRIANGLE: Record<string, Vec3> = {
  A: [-3, -2, 0],
  B: [3, -2, 0],
  C: [0, 3, 0],
};

/** Копия вершин, поднятая на высоту `z`, с цифрой 1 в именах. */
const lifted = (vertices: Record<string, Vec3>, z: number): Record<string, Vec3> =>
  Object.fromEntries(Object.entries(vertices).map(([name, [x, y]]) => [`${name}1`, [x, y, z]]));

const PRISM_EDGES = 'AB BC CD DA A1B1 B1C1 C1D1 D1A1 AA1 BB1 CC1 DD1';

const cube = (side: number): Record<string, Vec3> => {
  const half = side / 2;

  return {
    A: [-half, -half, 0],
    B: [half, -half, 0],
    C: [half, half, 0],
    D: [-half, half, 0],
    A1: [-half, -half, side],
    B1: [half, -half, side],
    C1: [half, half, side],
    D1: [-half, half, side],
  };
};

/** Точки окружности радиуса `radius` в плоскости `z`. */
const circlePoints = (radius: number, z: number, count: number): Vec3[] =>
  Array.from({ length: count }, (_, index): Vec3 => {
    const t = (2 * Math.PI * index) / count;

    return [radius * Math.cos(t), radius * Math.sin(t), z];
  });

/** Полюса и параллели сферы с центром в начале координат. */
const spherePoints = (radius: number, parallels: number, perParallel: number): Vec3[] => {
  const rings = Array.from({ length: parallels }, (_, index) => {
    const latitude = -Math.PI / 2 + (Math.PI * (index + 1)) / (parallels + 1);

    return circlePoints(radius * Math.cos(latitude), radius * Math.sin(latitude), perParallel);
  });

  const poles: Vec3[] = [
    [0, 0, radius],
    [0, 0, -radius],
  ];

  return [...poles, ...rings.flat()];
};

describe('невидимые линии шаблонов конструктора', () => {
  it('параллелепипед: пунктир у рёбер вершины A', () => {
    expect(dashedOf(scene({ ...BASE_SQUARE, ...lifted(BASE_SQUARE, 5) }, PRISM_EDGES))).toEqual(['AA1', 'AB', 'DA']);
  });

  it('четырёхугольная пирамида: пунктир у AB, DA, SA', () => {
    const vertices: Record<string, Vec3> = { ...BASE_SQUARE, S: [0, 0, 5.5] };

    expect(dashedOf(scene(vertices, 'AB BC CD DA SA SB SC SD'))).toEqual(['AB', 'DA', 'SA']);
  });

  it('треугольная пирамида: пунктир только у AB', () => {
    const vertices: Record<string, Vec3> = { ...BASE_TRIANGLE, S: [0, 0, 5.5] };

    expect(dashedOf(scene(vertices, 'AB BC CA SA SB SC'))).toEqual(['AB']);
  });

  it('треугольная призма: пунктир у AB, CA, AA1', () => {
    const vertices = { ...BASE_TRIANGLE, ...lifted(BASE_TRIANGLE, 5) };

    expect(dashedOf(scene(vertices, 'AB BC CA A1B1 B1C1 C1A1 AA1 BB1 CC1'))).toEqual(['AA1', 'AB', 'CA']);
  });

  it('цилиндр: ось и нижний диаметр — пунктир, видимые образующая и верхний диаметр — сплошные', () => {
    const vertices: Record<string, Vec3> = {
      O1: [0, 0, 0],
      O2: [0, 0, 5.5],
      A: [0, -3, 0],
      B: [0, 3, 0],
      A1: [0, -3, 5.5],
      B1: [0, 3, 5.5],
    };
    const extraPoints = [...circlePoints(3, 0, 24), ...circlePoints(3, 5.5, 24)];

    expect(dashedOf(scene(vertices, 'O1O2 AB A1B1 AA1 BB1', { extraPoints }))).toEqual(['AA1', 'AB', 'O1O2']);
  });
});

describe('рёбра внутри тела и на гранях', () => {
  it('куб: пространственная диагональ и диагональ нижней грани — пунктир, верхней — сплошная', () => {
    const vertices = cube(6);
    const edges = edgesOf('AC1 A1C1 AC');

    expect(hiddenLineStyles({ vertices, edges, angleY: ANGLE_Y, angleZ: ANGLE_Z })).toEqual([
      'dashed',
      'solid',
      'dashed',
    ]);
  });

  it('высота пирамиды — пунктир, отрезок основания виден только снизу', () => {
    const vertices: Record<string, Vec3> = { ...BASE_SQUARE, S: [0, 0, 5.5], O: [0, 0, 0] };
    const edges = 'AB BC CD DA SA SB SC SD SO OA';

    expect(dashedOf(scene(vertices, edges))).toEqual(['AB', 'DA', 'OA', 'SA', 'SO']);
    expect(dashedOf(scene(vertices, edges, { angleY: -40 }))).toContain('SO');
    expect(dashedOf(scene(vertices, edges, { angleY: -40 }))).not.toContain('OA');
  });

  it('поворот куба на 180° вокруг вертикали переносит пунктир к вершине C', () => {
    expect(dashedOf(scene(cube(6), PRISM_EDGES, { angleZ: 150 }))).toEqual(['BC', 'CC1', 'CD']);
  });

  it('сфера: радиус к точке поверхности — пунктир', () => {
    const vertices: Record<string, Vec3> = { O: [0, 0, 0], M: [0, 3, 0] };
    const extraPoints = spherePoints(3, 5, 12);

    expect(extraPoints).toHaveLength(62);
    expect(hiddenLineStyles(scene(vertices, 'OM', { extraPoints }))).toEqual(['dashed']);
  });

  it('ребро с несуществующей вершиной — сплошное, остальные считаются как обычно', () => {
    const vertices = { ...BASE_SQUARE, ...lifted(BASE_SQUARE, 5) };
    const edges = [...edgesOf('AB BC'), { from: 'A', to: 'X' }, ...edgesOf('AA1')];

    expect(hiddenLineStyles({ vertices, edges, angleY: ANGLE_Y, angleZ: ANGLE_Z })).toEqual([
      'dashed',
      'solid',
      'solid',
      'dashed',
    ]);
  });
});

describe('вырожденные сцены', () => {
  it('плоская фигура и три точки — стили не трогаем', () => {
    expect(hiddenLineStyles(scene(BASE_SQUARE, 'AB BC CD DA AC'))).toBeNull();
    expect(hiddenLineStyles(scene(BASE_TRIANGLE, 'AB BC CA'))).toBeNull();
  });

  it('больше MAX_HULL_POINTS точек — расчёт не делаем', () => {
    const extraPoints = spherePoints(3, 1, MAX_HULL_POINTS);

    expect(extraPoints.length).toBeGreaterThan(MAX_HULL_POINTS);
    expect(supportPlanes(extraPoints)).toEqual([]);
    expect(hiddenLineStyles(scene({ O: [0, 0, 0], M: [0, 0, 3] }, 'OM', { extraPoints }))).toBeNull();
  });

  it('повторы точек не мешают расчёту', () => {
    const vertices = cube(6);

    expect(supportPlanes([...Object.values(vertices), ...Object.values(vertices)])).toHaveLength(6);
  });
});

describe('опорные плоскости', () => {
  it('у куба ровно 6 плоскостей, у пирамиды с квадратным основанием — 5', () => {
    expect(supportPlanes(Object.values(cube(6)))).toHaveLength(6);
    expect(supportPlanes([...Object.values(BASE_SQUARE), [0, 0, 5.5]])).toHaveLength(5);
  });

  it('нормали единичные и смотрят наружу', () => {
    const points = Object.values(cube(6));

    supportPlanes(points).forEach(({ normal, offset }) => {
      expect(Math.hypot(...normal)).toBeCloseTo(1, 9);
      points.forEach((point) => {
        expect(normal[0] * point[0] + normal[1] * point[1] + normal[2] * point[2]).toBeLessThanOrEqual(offset + 1e-9);
      });
    });
  });

  it('hiddenLineStyles совпадает с supportPlanes + classifyEdges', () => {
    const vertices: Record<string, Vec3> = { ...BASE_SQUARE, S: [0, 0, 5.5], O: [0, 0, 0] };
    const edges = edgesOf('AB BC CD DA SA SB SC SD SO OA');
    const planes = supportPlanes(Object.values(vertices));
    const views: Array<[number, number]> = [
      [ANGLE_Y, ANGLE_Z],
      [-40, 120],
      [60, 200],
    ];

    views.forEach(([angleY, angleZ]) => {
      expect(classifyEdges(planes, vertices, edges, angleY, angleZ)).toEqual(
        hiddenLineStyles({ vertices, edges, angleY, angleZ }),
      );
    });
  });

  it('куб со стороной 0.01 и 1000 даёт тот же пунктир, что и обычный', () => {
    const views: Array<[number, number]> = [
      [ANGLE_Y, ANGLE_Z],
      [-40, 120],
      [70, 45],
    ];

    views.forEach(([angleY, angleZ]) => {
      const expected = dashedOf(scene(cube(6), PRISM_EDGES, { angleY, angleZ }));

      expect(expected).not.toBeNull();
      expect(dashedOf(scene(cube(0.01), PRISM_EDGES, { angleY, angleZ }))).toEqual(expected);
      expect(dashedOf(scene(cube(1000), PRISM_EDGES, { angleY, angleZ }))).toEqual(expected);
    });
  });
});
