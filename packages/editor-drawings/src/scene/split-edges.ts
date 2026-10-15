import type { GeometryEdge, GeometryScene, Point } from './types';

/** Порог попадания вершины на ребро в единицах мира и число проходов. */
const ON_EDGE_DISTANCE = 0.08;
const MAX_PASSES = 5;
const MIN_EDGE_LENGTH_SQUARED = 0.0025;

const coordinate = (point: Point, axis: number): number => point[axis] ?? 0;

/** Вершина, лежащая на ребре между его концами; `null`, если такой нет. */
const findVertexOnEdge = (scene: GeometryScene, edge: GeometryEdge): string | null => {
  const from = scene.vertices[edge.from];
  const to = scene.vertices[edge.to];

  if (!from || !to) return null;

  const direction = [0, 1, 2].map((axis) => coordinate(to, axis) - coordinate(from, axis));
  const lengthSquared = direction.reduce((sum, value) => sum + value * value, 0);

  if (lengthSquared < MIN_EDGE_LENGTH_SQUARED) return null;

  const found = Object.entries(scene.vertices).find(([name, point]) => {
    if (name === edge.from || name === edge.to) return false;

    const offset = [0, 1, 2].map((axis) => coordinate(point, axis) - coordinate(from, axis));
    const t = offset.reduce((sum, value, axis) => sum + value * direction[axis], 0) / lengthSquared;

    if (t < 0.01 || t > 0.99) return false;

    const distanceSquared = offset.reduce((sum, value, axis) => {
      const delta = value - t * direction[axis];

      return sum + delta * delta;
    }, 0);

    return distanceSquared < ON_EDGE_DISTANCE * ON_EDGE_DISTANCE;
  });

  return found ? found[0] : null;
};

/**
 * Разрезает рёбра, на которых лежит вершина: `A—C` с точкой `B` посередине
 * становится `A—B` и `B—C`. Нейросеть часто ставит точку на сторону, не
 * деля её, а конструктору и TikZ нужны отдельные отрезки. Меняет сцену на
 * месте; возвращает, было ли что резать.
 */
export const splitEdgesThroughVertices = (scene: GeometryScene): boolean => {
  let changed = false;

  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    let splitInPass = false;

    scene.edges = scene.edges.flatMap((edge) => {
      const middle = findVertexOnEdge(scene, edge);

      if (!middle) return [edge];

      splitInPass = true;

      return [
        { ...edge, to: middle },
        { ...edge, from: middle },
      ];
    });

    if (!splitInPass) break;

    changed = true;
  }

  return changed;
};
