import { project3dToPlane } from '../render/coords';
import { circle3d } from '../render/round-bodies';
import type { Vec3 } from '../scene/types';
import { roundTo } from './geometry-utils';

/**
 * Шаблоны фигур конструктора стереометрии с параметрами — чистые построители
 * без DOM. Ось x идёт к зрителю, y — вправо, z — вверх; основание лежит в
 * плоскости z = 0 с центром в начале координат. Рёбра шаблонов без стиля:
 * пунктир расставляет конструктор по невидимости.
 */

export type StereoTemplateId = 'cube' | 'parallelepiped' | 'prism' | 'pyramid' | 'frustum' | 'cylinder' | 'cone' | 'sphere';

export interface StereoTemplateParams {
  /** Число сторон основания: призма, пирамида, усечённая пирамида. */
  sides: number;
  /** Ребро основания: куб, призма, пирамида, нижнее основание усечённой пирамиды. */
  edge: number;
  /** Ребро верхнего основания усечённой пирамиды. */
  topEdge: number;
  /** Размеры параллелепипеда вдоль x (к зрителю) и вдоль y (вправо). */
  depth: number;
  width: number;
  height: number;
  radius: number;
}

export interface StereoParamField {
  key: keyof StereoTemplateParams;
  labelKey: string;
  min: number;
  max: number;
  step: number;
}

export interface StereoTemplateScene {
  vertices: Record<string, Vec3>;
  edges: Array<{ from: string; to: string }>;
  labels: Record<string, string>;
  cylinders: Array<{ base: string; top: string; radius: number }>;
  cones: Array<{ base: string; apex: string; radius: number }>;
  spheres: Array<{ center: string; radius: number }>;
}

export interface StereoTemplate {
  id: StereoTemplateId;
  labelKey: string;
  glyph: string;
  /** Какие параметры показывать в панели; порядок — порядок полей. */
  fields: StereoParamField[];
  defaults: StereoTemplateParams;
  build(params: StereoTemplateParams): StereoTemplateScene;
}

/** Тела вращения сцены, по которым строятся их точки для оболочки. */
export interface RoundBodies {
  cylinders: Array<{ base: string; top: string; radius: number }>;
  cones: Array<{ base: string; apex: string; radius: number }>;
  spheres: Array<{ center: string; radius: number }>;
}

/** Вид, в котором открывается шаблон: по нему выбираются положения подписей. */
const DEFAULT_ANGLE_Y = 15;
const DEFAULT_ANGLE_Z = -30;

/** Первая вершина основания — под этим углом: в виде по умолчанию она дальняя. */
const FIRST_VERTEX_DEGREES = 225;

/** Точек на окружность основания и на параллель шара, число параллелей шара. */
const RIM_POINTS = 24;
const PARALLEL_POINTS = 12;
const SPHERE_PARALLELS = 5;

const MIN_SIZE = 0.5;
const MAX_SIZE = 20;
const SIZE_STEP = 0.5;
const MIN_SIDES = 3;
const MAX_SIDES = 8;

const UP: Vec3 = [0, 0, 1];

/** Положения подписи и их направления на картинке, градусы против часовой от «вправо». */
const LABEL_DIRECTIONS: Array<{ position: string; degrees: number }> = [
  { position: 'right', degrees: 0 },
  { position: 'above right', degrees: 45 },
  { position: 'above', degrees: 90 },
  { position: 'above left', degrees: 135 },
  { position: 'left', degrees: 180 },
  { position: 'below left', degrees: 225 },
  { position: 'below', degrees: 270 },
  { position: 'below right', degrees: 315 },
];

/**
 * Варианты для вершин верхнего основания — без нижних: под такой вершиной
 * боковая грань, и подпись легла бы на неё.
 */
const UPPER_DIRECTIONS = LABEL_DIRECTIONS.filter((direction) => !direction.position.startsWith('below'));

const sizeField = (key: keyof StereoTemplateParams, labelKey: string): StereoParamField => ({
  key,
  labelKey,
  min: MIN_SIZE,
  max: MAX_SIZE,
  step: SIZE_STEP,
});

const SIDES_FIELD: StereoParamField = { key: 'sides', labelKey: 'drawings_stereo_param_sides', min: MIN_SIDES, max: MAX_SIDES, step: 1 };
const EDGE_FIELD = sizeField('edge', 'drawings_stereo_param_edge');
const TOP_EDGE_FIELD = sizeField('topEdge', 'drawings_stereo_param_top_edge');
const DEPTH_FIELD = sizeField('depth', 'drawings_stereo_param_depth');
const WIDTH_FIELD = sizeField('width', 'drawings_stereo_param_width');
const HEIGHT_FIELD = sizeField('height', 'drawings_stereo_param_height');
const RADIUS_FIELD = sizeField('radius', 'drawings_stereo_param_radius');

/** Общие умолчания: у каждого шаблона переопределяются только его поля. */
const BASE_PARAMS: StereoTemplateParams = { sides: 4, edge: 5, topEdge: 3, depth: 6, width: 6, height: 5, radius: 3 };

const roundVec3 = (point: Vec3): Vec3 => [roundTo(point[0]), roundTo(point[1]), roundTo(point[2])];

const angleDistance = (a: number, b: number): number => {
  const difference = Math.abs(a - b) % 360;

  return Math.min(difference, 360 - difference);
};

/**
 * Положение подписи по направлению от центра наружу: ближайшее из вариантов к
 * проекции направления в виде по умолчанию. Нулевое направление → `fallback`.
 */
const labelToward = (radial: Vec3, upper: boolean, fallback: string): string => {
  const [x, y] = project3dToPlane(radial, DEFAULT_ANGLE_Y, DEFAULT_ANGLE_Z);

  if (Math.hypot(x, y) < 1e-9) return fallback;

  const degrees = (Math.atan2(y, x) * 180) / Math.PI;
  const choices = upper ? UPPER_DIRECTIONS : LABEL_DIRECTIONS;
  const best = choices.reduce((found, choice) =>
    angleDistance(choice.degrees, degrees) < angleDistance(found.degrees, degrees) ? choice : found,
  );

  return best.position;
};

/** Имя вершины основания: A, B, C… и с суффиксом верхнего основания — A1, B1… */
const baseName = (index: number, suffix: string): string => `${String.fromCharCode(65 + index)}${suffix}`;

/**
 * Многоугольник основания на высоте `z`: центр в начале координат, вершины
 * против часовой стрелки от угла 225°. `circumradius` — радиус описанной окружности.
 */
const ringPoints = (sides: number, circumradius: number, z: number): Vec3[] =>
  Array.from({ length: sides }, (_, index) => {
    const radians = ((FIRST_VERTEX_DEGREES + (index * 360) / sides) * Math.PI) / 180;

    return roundVec3([circumradius * Math.cos(radians), circumradius * Math.sin(radians), z]);
  });

/** Радиус описанной окружности правильного n-угольника с ребром `edge`. */
const circumradiusOf = (sides: number, edge: number): number => edge / (2 * Math.sin(Math.PI / sides));

const emptyScene = (): StereoTemplateScene => ({ vertices: {}, edges: [], labels: {}, cylinders: [], cones: [], spheres: [] });

/** Кольцо основания в сцену: вершины, рёбра по кругу и подписи от центра наружу. */
const addRing = (scene: StereoTemplateScene, points: Vec3[], suffix: string): string[] => {
  const names = points.map((_, index) => baseName(index, suffix));

  points.forEach((point, index) => {
    const name = names[index];
    const next = names[(index + 1) % names.length];

    if (name === undefined || next === undefined) return;

    scene.vertices[name] = point;
    scene.labels[name] = labelToward([point[0], point[1], 0], suffix !== '', 'above');
    scene.edges.push({ from: name, to: next });
  });

  return names;
};

/** Боковые рёбра между соответственными вершинами двух оснований. */
const addLaterals = (scene: StereoTemplateScene, bottom: string[], top: string[]): void => {
  bottom.forEach((name, index) => {
    const upper = top[index];

    if (upper !== undefined) scene.edges.push({ from: name, to: upper });
  });
};

/** Призма или усечённая пирамида: два подобных основания, общий центр. */
const twoRings = (bottom: Vec3[], top: Vec3[]): StereoTemplateScene => {
  const scene = emptyScene();
  const lower = addRing(scene, bottom, '');
  const upper = addRing(scene, top, '1');

  addLaterals(scene, lower, upper);

  return scene;
};

const buildPrism = (params: StereoTemplateParams): StereoTemplateScene => {
  const radius = circumradiusOf(params.sides, params.edge);

  return twoRings(ringPoints(params.sides, radius, 0), ringPoints(params.sides, radius, params.height));
};

const buildFrustum = (params: StereoTemplateParams): StereoTemplateScene =>
  twoRings(
    ringPoints(params.sides, circumradiusOf(params.sides, params.edge), 0),
    ringPoints(params.sides, circumradiusOf(params.sides, params.topEdge), params.height),
  );

/** Прямоугольное основание `depth × width` (вдоль x и y), вершины в том же порядке, что у квадрата. */
const rectangle = (depth: number, width: number, z: number): Vec3[] => {
  const corners: Vec3[] = [
    [-depth / 2, -width / 2, z],
    [depth / 2, -width / 2, z],
    [depth / 2, width / 2, z],
    [-depth / 2, width / 2, z],
  ];

  return corners.map(roundVec3);
};

const buildPyramid = (params: StereoTemplateParams): StereoTemplateScene => {
  const scene = emptyScene();
  const base = addRing(scene, ringPoints(params.sides, circumradiusOf(params.sides, params.edge), 0), '');

  scene.vertices.S = roundVec3([0, 0, params.height]);
  scene.labels.S = 'above';
  base.forEach((name) => scene.edges.push({ from: 'S', to: name }));

  return scene;
};

/** Цилиндр как прежний шаблон: центры оснований, осевое сечение в плоскости x = 0. */
const buildCylinder = (params: StereoTemplateParams): StereoTemplateScene => {
  const r = roundTo(params.radius);
  const h = roundTo(params.height);

  return {
    vertices: { O1: [0, 0, 0], O2: [0, 0, h], A: [0, -r, 0], B: [0, r, 0], A1: [0, -r, h], B1: [0, r, h] },
    edges: [
      { from: 'O1', to: 'O2' },
      { from: 'A', to: 'B' },
      { from: 'A1', to: 'B1' },
      { from: 'A', to: 'A1' },
      { from: 'B', to: 'B1' },
    ],
    labels: {
      O1: 'below',
      O2: 'above',
      A: labelToward([0, -r, 0], false, 'left'),
      B: labelToward([0, r, 0], false, 'right'),
      A1: labelToward([0, -r, 0], true, 'above left'),
      B1: labelToward([0, r, 0], true, 'above right'),
    },
    cylinders: [{ base: 'O1', top: 'O2', radius: r }],
    cones: [],
    spheres: [],
  };
};

const buildCone = (params: StereoTemplateParams): StereoTemplateScene => {
  const r = roundTo(params.radius);

  return {
    vertices: { O: [0, 0, 0], S: [0, 0, roundTo(params.height)], A: [0, -r, 0], B: [0, r, 0] },
    edges: [
      { from: 'S', to: 'O' },
      { from: 'A', to: 'B' },
      { from: 'S', to: 'A' },
      { from: 'S', to: 'B' },
    ],
    labels: { O: 'below', S: 'above', A: labelToward([0, -r, 0], false, 'left'), B: labelToward([0, r, 0], false, 'right') },
    cylinders: [],
    cones: [{ base: 'O', apex: 'S', radius: r }],
    spheres: [],
  };
};

const buildSphere = (params: StereoTemplateParams): StereoTemplateScene => {
  const r = roundTo(params.radius);

  return {
    vertices: { O: [0, 0, 0], A: [0, r, 0] },
    edges: [{ from: 'O', to: 'A' }],
    labels: { O: 'left', A: labelToward([0, r, 0], false, 'right') },
    cylinders: [],
    cones: [],
    spheres: [{ center: 'O', radius: r }],
  };
};

export const STEREO_TEMPLATES: StereoTemplate[] = [
  {
    id: 'cube',
    labelKey: 'drawings_stereo_template_cube',
    glyph: '◫',
    fields: [EDGE_FIELD],
    defaults: { ...BASE_PARAMS, edge: 5 },
    build: (params) => twoRings(rectangle(params.edge, params.edge, 0), rectangle(params.edge, params.edge, params.edge)),
  },
  {
    id: 'parallelepiped',
    labelKey: 'drawings_stereo_template_parallelepiped',
    glyph: '▭',
    fields: [DEPTH_FIELD, WIDTH_FIELD, HEIGHT_FIELD],
    defaults: { ...BASE_PARAMS, depth: 6, width: 6, height: 5 },
    build: (params) => twoRings(rectangle(params.depth, params.width, 0), rectangle(params.depth, params.width, params.height)),
  },
  {
    id: 'prism',
    labelKey: 'drawings_stereo_template_prism',
    glyph: '⬡',
    fields: [SIDES_FIELD, EDGE_FIELD, HEIGHT_FIELD],
    defaults: { ...BASE_PARAMS, sides: 3, edge: 5, height: 5 },
    build: buildPrism,
  },
  {
    id: 'pyramid',
    labelKey: 'drawings_stereo_template_pyramid',
    glyph: '△',
    fields: [SIDES_FIELD, EDGE_FIELD, HEIGHT_FIELD],
    defaults: { ...BASE_PARAMS, sides: 4, edge: 6, height: 5.5 },
    build: buildPyramid,
  },
  {
    id: 'frustum',
    labelKey: 'drawings_stereo_template_frustum',
    glyph: '⏢',
    fields: [SIDES_FIELD, EDGE_FIELD, TOP_EDGE_FIELD, HEIGHT_FIELD],
    defaults: { ...BASE_PARAMS, sides: 4, edge: 6, topEdge: 3, height: 4 },
    build: buildFrustum,
  },
  {
    id: 'cylinder',
    labelKey: 'drawings_stereo_template_cylinder',
    glyph: '⌭',
    fields: [RADIUS_FIELD, HEIGHT_FIELD],
    defaults: { ...BASE_PARAMS, radius: 3, height: 5.5 },
    build: buildCylinder,
  },
  {
    id: 'cone',
    labelKey: 'drawings_stereo_template_cone',
    glyph: '▲',
    fields: [RADIUS_FIELD, HEIGHT_FIELD],
    defaults: { ...BASE_PARAMS, radius: 3, height: 5.5 },
    build: buildCone,
  },
  {
    id: 'sphere',
    labelKey: 'drawings_stereo_template_sphere',
    glyph: '◯',
    fields: [RADIUS_FIELD],
    defaults: { ...BASE_PARAMS, radius: 3 },
    build: buildSphere,
  },
];

/** Параметры в допустимых пределах полей шаблона; `sides` — целое. Нечисловое поле → умолчание шаблона. */
export const clampTemplateParams = (template: StereoTemplate, params: StereoTemplateParams): StereoTemplateParams =>
  template.fields.reduce<StereoTemplateParams>(
    (result, field) => {
      const raw = Number.isFinite(params[field.key]) ? params[field.key] : template.defaults[field.key];
      const value = field.key === 'sides' ? Math.round(raw) : raw;

      return { ...result, [field.key]: Math.min(field.max, Math.max(field.min, value)) };
    },
    { ...params },
  );

const minus = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** Точки шара для оболочки: два полюса и параллели между ними. */
const spherePoints = (center: Vec3, radius: number): Vec3[] => {
  const parallels = Array.from({ length: SPHERE_PARALLELS }, (_, index) => {
    const latitude = Math.PI * ((index + 1) / (SPHERE_PARALLELS + 1) - 0.5);
    const level: Vec3 = [center[0], center[1], center[2] + radius * Math.sin(latitude)];

    return circle3d(level, UP, radius * Math.cos(latitude), PARALLEL_POINTS);
  });

  return [[center[0], center[1], center[2] + radius], [center[0], center[1], center[2] - radius], ...parallels.flat()];
};

/**
 * Точки тел вращения, которых нет среди вершин, — для выпуклой оболочки
 * невидимых линий: окружности оснований цилиндров и конусов, полюса и
 * параллели шаров. Тело со ссылкой на несуществующую вершину пропускается.
 */
export const roundBodyPoints = (vertices: Record<string, Vec3>, bodies: RoundBodies): Vec3[] => {
  const cylinders = bodies.cylinders.flatMap((cylinder) => {
    const base = vertices[cylinder.base];
    const top = vertices[cylinder.top];

    if (!base || !top) return [];

    const axis = minus(top, base);

    return [...circle3d(base, axis, cylinder.radius, RIM_POINTS), ...circle3d(top, axis, cylinder.radius, RIM_POINTS)];
  });
  const cones = bodies.cones.flatMap((cone) => {
    const base = vertices[cone.base];
    const apex = vertices[cone.apex];

    return base && apex ? circle3d(base, minus(apex, base), cone.radius, RIM_POINTS) : [];
  });
  const spheres = bodies.spheres.flatMap((sphere) => {
    const center = vertices[sphere.center];

    return center ? spherePoints(center, sphere.radius) : [];
  });

  return [...cylinders, ...cones, ...spheres];
};
