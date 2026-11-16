import { describe, expect, it } from 'vitest';
import { hiddenLineStyles } from '../src/builders/hidden-lines';
import {
  STEREO_TEMPLATES,
  clampTemplateParams,
  roundBodyPoints,
  type StereoTemplate,
  type StereoTemplateId,
  type StereoTemplateParams,
  type StereoTemplateScene,
} from '../src/builders/stereo-templates';
import type { Vec3 } from '../src/scene/types';

const templateOf = (id: StereoTemplateId): StereoTemplate => {
  const template = STEREO_TEMPLATES.find((item) => item.id === id);

  if (!template) throw new Error(`Нет шаблона ${id}`);

  return template;
};

const build = (id: StereoTemplateId, params: Partial<StereoTemplateParams> = {}): StereoTemplateScene => {
  const template = templateOf(id);

  return template.build({ ...template.defaults, ...params });
};

const pointOf = (scene: StereoTemplateScene, name: string): Vec3 => {
  const point = scene.vertices[name];

  if (!point) throw new Error(`Нет вершины ${name}`);

  return point;
};

const lengthOf = (scene: StereoTemplateScene, from: string, to: string): number => {
  const a = pointOf(scene, from);
  const b = pointOf(scene, to);

  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
};

/** Пунктирные рёбра шаблона в виде по умолчанию (15°, −30°) — строками «AB». */
const dashedOf = (scene: StereoTemplateScene): string[] => {
  const styles = hiddenLineStyles({
    vertices: scene.vertices,
    edges: scene.edges,
    extraPoints: roundBodyPoints(scene.vertices, scene),
    angleY: 15,
    angleZ: -30,
  });

  if (!styles) throw new Error('Нет оболочки');

  return scene.edges.filter((_, index) => styles[index] === 'dashed').map((edge) => `${edge.from}${edge.to}`);
};

describe('шаблоны стереометрии', () => {
  it('шестиугольная призма: 12 вершин, 18 рёбер, рёбра основания равны edge, высота — height', () => {
    const scene = build('prism', { sides: 6, edge: 4, height: 7 });
    const bottom = ['A', 'B', 'C', 'D', 'E', 'F'];

    expect(Object.keys(scene.vertices)).toHaveLength(12);
    expect(scene.edges).toHaveLength(18);
    bottom.forEach((name, index) => {
      const next = bottom[(index + 1) % bottom.length] ?? 'A';

      expect(lengthOf(scene, name, next)).toBeCloseTo(4, 1);
      expect(lengthOf(scene, `${name}1`, `${next}1`)).toBeCloseTo(4, 1);
      expect(pointOf(scene, name)[2]).toBe(0);
      expect(pointOf(scene, `${name}1`)[2]).toBe(7);
      expect(scene.edges).toContainEqual({ from: name, to: `${name}1` });
    });
  });

  it('пирамида n = 3…8: n + 1 вершина, 2n рёбер, S над центром основания', () => {
    [3, 4, 5, 6, 7, 8].forEach((sides) => {
      const scene = build('pyramid', { sides });
      const base = Object.entries(scene.vertices).filter(([name]) => name !== 'S');
      const center = [0, 1].map((axis) => base.reduce((sum, [, point]) => sum + (point[axis] ?? 0), 0) / base.length);

      expect(Object.keys(scene.vertices)).toHaveLength(sides + 1);
      expect(scene.edges).toHaveLength(2 * sides);
      expect(scene.vertices.S).toEqual([0, 0, 5.5]);
      expect(center[0]).toBeCloseTo(0, 1);
      expect(center[1]).toBeCloseTo(0, 1);
      base.forEach(([name]) => expect(lengthOf(scene, 'S', name)).toBeCloseTo(lengthOf(scene, 'S', 'A'), 1));
    });
  });

  it('усечённая пирамида: верхнее основание подобно нижнему, рёбра равны topEdge', () => {
    const scene = build('frustum', { sides: 5, edge: 6, topEdge: 2, height: 4 });
    const names = ['A', 'B', 'C', 'D', 'E'];

    expect(Object.keys(scene.vertices)).toHaveLength(10);
    expect(scene.edges).toHaveLength(15);
    names.forEach((name, index) => {
      const next = names[(index + 1) % names.length] ?? 'A';
      const bottom = pointOf(scene, name);
      const top = pointOf(scene, `${name}1`);

      expect(lengthOf(scene, name, next)).toBeCloseTo(6, 1);
      expect(lengthOf(scene, `${name}1`, `${next}1`)).toBeCloseTo(2, 1);
      // Подобие с центром на оси: верхняя вершина — нижняя, сжатая в edge / topEdge раз.
      expect(top[0]).toBeCloseTo(bottom[0] / 3, 1);
      expect(top[1]).toBeCloseTo(bottom[1] / 3, 1);
      expect(top[2]).toBe(4);
    });
  });

  it('квадратное основание совпадает с параллелепипедом: A(−, −), B(+, −)', () => {
    const pyramid = build('pyramid');
    const box = build('parallelepiped');
    const cube = build('cube', { edge: 6 });

    expect(pyramid.vertices).toMatchObject({ A: [-3, -3, 0], B: [3, -3, 0], C: [3, 3, 0], D: [-3, 3, 0] });
    expect(box.vertices).toMatchObject({ A: [-3, -3, 0], B: [3, -3, 0], C: [3, 3, 0], D: [-3, 3, 0], A1: [-3, -3, 5], C1: [3, 3, 5] });
    expect(cube.vertices).toMatchObject({ A: [-3, -3, 0], B: [3, -3, 0], C1: [3, 3, 6] });
    expect(build('parallelepiped', { depth: 4, width: 8 }).vertices).toMatchObject({ A: [-2, -4, 0], C: [2, 4, 0] });
  });

  it('конус и шар ссылаются на существующие вершины', () => {
    const cone = build('cone', { radius: 2, height: 4 });
    const sphere = build('sphere', { radius: 2.5 });

    expect(cone.cones).toEqual([{ base: 'O', apex: 'S', radius: 2 }]);
    expect(cone.vertices).toEqual({ O: [0, 0, 0], S: [0, 0, 4], A: [0, -2, 0], B: [0, 2, 0] });
    expect(cone.edges).toEqual([
      { from: 'S', to: 'O' },
      { from: 'A', to: 'B' },
      { from: 'S', to: 'A' },
      { from: 'S', to: 'B' },
    ]);
    expect(sphere.spheres).toEqual([{ center: 'O', radius: 2.5 }]);
    expect(sphere.vertices).toEqual({ O: [0, 0, 0], A: [0, 2.5, 0] });
    expect(sphere.edges).toEqual([{ from: 'O', to: 'A' }]);
    STEREO_TEMPLATES.forEach((template) => {
      const scene = template.build(template.defaults);
      const names = [
        ...scene.cylinders.flatMap((body) => [body.base, body.top]),
        ...scene.cones.flatMap((body) => [body.base, body.apex]),
        ...scene.spheres.map((body) => body.center),
        ...scene.edges.flatMap((edge) => [edge.from, edge.to]),
        ...Object.keys(scene.labels),
      ];

      names.forEach((name) => expect(scene.vertices).toHaveProperty(name));
    });
  });

  it('clampTemplateParams: sides целое в 3…8, размеры — в 0,5…20', () => {
    const prism = templateOf('prism');

    expect(clampTemplateParams(prism, { ...prism.defaults, sides: 2.6 }).sides).toBe(3);
    expect(clampTemplateParams(prism, { ...prism.defaults, sides: 99 }).sides).toBe(8);
    expect(clampTemplateParams(prism, { ...prism.defaults, sides: 5.4 }).sides).toBe(5);
    expect(clampTemplateParams(prism, { ...prism.defaults, edge: 0.1, height: 500 })).toMatchObject({ edge: 0.5, height: 20 });
    expect(clampTemplateParams(prism, { ...prism.defaults, edge: Number.NaN }).edge).toBe(prism.defaults.edge);
    // Поля, которых у шаблона нет, не трогаются.
    expect(clampTemplateParams(templateOf('sphere'), { ...prism.defaults, radius: 40, sides: 99 })).toMatchObject({ radius: 20, sides: 99 });
    STEREO_TEMPLATES.forEach((template) => {
      expect(clampTemplateParams(template, template.defaults)).toEqual(template.defaults);
      template.fields.forEach((field) => {
        expect(field.labelKey.startsWith('drawings_stereo_param_')).toBe(true);
        expect([field.min, field.max, field.step]).toEqual(field.key === 'sides' ? [3, 8, 1] : [0.5, 20, 0.5]);
      });
    });
  });

  it('у каждого шаблона в виде по умолчанию есть оболочка и пунктир; у шара — радиус OA', () => {
    STEREO_TEMPLATES.forEach((template) => {
      expect(dashedOf(template.build(template.defaults)).length).toBeGreaterThan(0);
    });
    expect(dashedOf(build('sphere'))).toEqual(['OA']);
    expect(dashedOf(build('cone'))).toEqual(expect.arrayContaining(['SO', 'AB']));
    expect(dashedOf(build('cylinder'))).toEqual(expect.arrayContaining(['O1O2', 'AB']));
  });

  it('прежние шаблоны: пунктиром идут рёбра дальней вершины A, как расставляли вручную', () => {
    expect(dashedOf(build('cube'))).toEqual(['AB', 'DA', 'AA1']);
    expect(dashedOf(build('parallelepiped'))).toEqual(['AB', 'DA', 'AA1']);
    expect(dashedOf(build('pyramid'))).toEqual(['AB', 'DA', 'SA']);
    expect(dashedOf(build('prism'))).toEqual(['AB', 'CA', 'AA1']);
  });

  it('точки тел вращения для оболочки: окружности по 24 точки, шар — полюса и 5 параллелей по 12', () => {
    const vertices: Record<string, Vec3> = { O: [0, 0, 0], T: [0, 0, 4], C: [1, 1, 1] };

    expect(roundBodyPoints(vertices, { cylinders: [{ base: 'O', top: 'T', radius: 2 }], cones: [], spheres: [] })).toHaveLength(48);
    expect(roundBodyPoints(vertices, { cylinders: [], cones: [{ base: 'O', apex: 'T', radius: 2 }], spheres: [] })).toHaveLength(24);

    const sphere = roundBodyPoints(vertices, { cylinders: [], cones: [], spheres: [{ center: 'C', radius: 2 }] });

    expect(sphere).toHaveLength(62);
    expect(sphere.slice(0, 2)).toEqual([
      [1, 1, 3],
      [1, 1, -1],
    ]);
    sphere.forEach((point) => expect(Math.hypot(point[0] - 1, point[1] - 1, point[2] - 1)).toBeCloseTo(2, 6));
    // Точки основания конуса — в плоскости основания на расстоянии радиуса от центра.
    roundBodyPoints(vertices, { cylinders: [], cones: [{ base: 'O', apex: 'T', radius: 2 }], spheres: [] }).forEach((point) => {
      expect(point[2]).toBeCloseTo(0, 9);
      expect(Math.hypot(point[0], point[1])).toBeCloseTo(2, 9);
    });
    // Тело со ссылкой на несуществующую вершину пропускается.
    expect(roundBodyPoints(vertices, { cylinders: [{ base: 'O', top: 'X', radius: 2 }], cones: [], spheres: [{ center: 'Y', radius: 1 }] })).toEqual([]);
  });
});
