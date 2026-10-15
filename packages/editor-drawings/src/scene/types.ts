/**
 * Модель чертежей — JSON-сцены в формате PinQueen.
 *
 * Один и тот же JSON живёт в атрибуте узла (`data-geometry-data`,
 * `data-physics-data`), в тексте от распознавания между маркерами
 * `<<<DATA_START>>>` и в конструкторах. Сцена от нейросети «грязная»:
 * типы ниже описывают её уже после `normalizeGeometryScene` /
 * `normalizePhysicsScene`, а сырой JSON хранится в узле как есть.
 */

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
/** Вершина: 2D или 3D; у 3D-сцены z может быть нулём. */
export type Point = Vec2 | Vec3;

export type DrawingKind = 'geometry' | 'physics';

// ----------------------------------------------------------------- геометрия

export type GeometrySceneType = '2d' | '3d' | 'plot_2d';

export type EdgeStyle = 'solid' | 'dashed';

export interface GeometryEdge {
  from: string;
  to: string;
  style: EdgeStyle;
  color?: string;
  /** Засечки равенства, 0–4. */
  ticks?: number;
}

export type AngleStyle = 'right' | 'single' | 'double' | 'triple';

export interface GeometryAngle {
  /** Три вершины; вершина угла — вторая. */
  points: [string, string, string];
  style: AngleStyle;
  label?: string;
}

export interface GeometryTextLabel {
  text: string;
  /** Подпись у середины отрезка между двумя вершинами. */
  position?: [string, string];
  /** С какой стороны отрезка. */
  offset?: 'left' | 'right';
  /** Или в точке мира. */
  coords?: Vec2;
}

export interface GeometrySection {
  vertices: string[];
  fill?: string;
  stroke?: string;
}

export interface GeometryCylinder {
  base: string;
  top: string;
  radius: number;
}

export type PlotStyle = 'solid' | 'dashed';

interface PlotBase {
  id?: string;
  color?: string;
  label?: string;
  style?: PlotStyle;
}

export interface CirclePlot extends PlotBase {
  type: 'circle';
  center: Vec2;
  /** Центр — вершина сцены; тогда `center` — её координаты на момент нормализации. */
  centerVertex?: string;
  radius: number;
  fill?: boolean;
}

export interface ParabolaPlot extends PlotBase {
  type: 'parabola';
  vertex: Vec2;
  direction: 'up' | 'down';
  stretchX: number;
  stretchY: number;
  domain?: [number, number];
}

export interface SqrtPlot extends PlotBase {
  type: 'sqrt';
  vertex: Vec2;
  directionX: 'left' | 'right';
  directionY: 'up' | 'down';
  stretch: number;
  domain?: [number, number];
}

export interface HyperbolaPlot extends PlotBase {
  type: 'hyperbola';
  center: Vec2;
  k: number;
  domain?: [number, number];
}

export interface LinePlot extends PlotBase {
  type: 'line';
  /** Отрезок по двум точкам — или прямая `y = kx + b` на `domain`. */
  p1?: Vec2;
  p2?: Vec2;
  k?: number;
  b?: number;
  domain?: [number, number];
}

export interface PointPlot extends PlotBase {
  type: 'point';
  coords: Vec2;
  pointStyle: 'solid' | 'hollow';
}

export interface ShadingPlot extends PlotBase {
  type: 'shading';
  /** Многоугольник — или прямоугольник `[x1, x2, y1, y2]`. */
  points?: Vec2[];
  bounds?: [number, number, number, number];
}

export interface FreehandPlot extends PlotBase {
  type: 'freehand';
  points: Vec2[];
}

export type Plot =
  | CirclePlot
  | ParabolaPlot
  | SqrtPlot
  | HyperbolaPlot
  | LinePlot
  | PointPlot
  | ShadingPlot
  | FreehandPlot;

export interface GeometryScene {
  type: GeometrySceneType;
  vertices: Record<string, Point>;
  edges: GeometryEdge[];
  angles: GeometryAngle[];
  /** Положение буквы у вершины: `below left`, `above` и т. п. */
  labels: Record<string, string>;
  textLabels: GeometryTextLabel[];
  /** Только 3D. */
  sections: GeometrySection[];
  cylinders: GeometryCylinder[];
  plots: Plot[];
  /** Повороты 3D-сцены в градусах. */
  angleY: number;
  angleZ: number;
  /** Пикселей на единицу; `undefined` — умолчание рендера. */
  scale?: number;
  offsetX: number;
  offsetY: number;
  showGrid: boolean;
  showAxes: boolean;
  showAxesTicks: boolean;
  axes: { xLabel: string; yLabel: string };
}

// -------------------------------------------------------------------- физика

export type PhysicsElementType =
  | 'surface'
  | 'arc_surface'
  | 'block'
  | 'rope'
  | 'spring'
  | 'vector'
  | 'angle'
  | 'stickman'
  | 'balloon'
  | 'ellipse_platform'
  | 'dimension_line'
  | 'thermo_axes'
  | 'thermo_point'
  | 'thermo_process'
  | 'piston_vessel'
  | 'circuit_component'
  | 'wire'
  | 'charge'
  | 'field_line'
  | 'capacitor_plate'
  | 'current_conductor'
  | 'circle_shape'
  | 'lens'
  | 'mirror'
  | 'ray'
  | 'optics_arrow'
  | 'prism'
  | 'glass_slab'
  | 'text_label';

export interface AxisTick {
  val: number;
  label?: string;
}

/**
 * Элемент физической схемы. Поля общие для всех типов — у каждого типа
 * читается своё подмножество (см. `17-drawings.md`); так проще принимать
 * данные от нейросети, чем гонять их через размеченный союз.
 */
export interface PhysicsElement {
  id: string;
  type: PhysicsElementType;
  /** Подпись в LaTeX-подмножестве: греческие буквы, индексы, `\vec{}`. */
  label?: string;
  color?: string;
  dashed?: boolean;
  strokeWidth?: number;
  points?: Vec2[];
  center?: Vec2;
  coords?: Vec2;
  subtype?: string;
  hatching?: 'top' | 'bottom' | 'left' | 'right' | 'inner' | 'outer';
  width?: number;
  height?: number;
  radius?: number;
  /** Поворот в градусах против часовой. */
  angle?: number;
  vectorType?: string;
  angleType?: 'inner' | 'outer';
  arcRadius?: number;
  rx?: number;
  ry?: number;
  xLabel?: string;
  yLabel?: string;
  originLabel?: string;
  xLength?: number;
  yLength?: number;
  offset?: Vec2;
  xTicks?: AxisTick[];
  yTicks?: AxisTick[];
  pistonHeight?: number;
  pistonThickness?: number;
  weight?: boolean;
  focalLength?: number;
  wavy?: boolean;
  text?: string;
  charge?: string;
  plateType?: 'positive' | 'negative' | 'neutral';
}

export interface PhysicsScene {
  type: 'physics';
  scale?: number;
  offsetX: number;
  offsetY: number;
  showGrid: boolean;
  elements: PhysicsElement[];
}

// ---------------------------------------------------------------- подсветка

/** Что подсветить в геометрии: конструктор показывает так выделение. */
export type GeometryHighlight =
  | { type: 'edge'; from: string; to: string }
  | { type: 'vertex' | 'vertex_draft'; id: string }
  | { type: 'angle'; id: string }
  | { type: 'section'; vertices: string[] }
  | { type: 'plot' | 'circle_plot'; id: string }
  | { type: 'angle_draft'; points: string[] };

/** В физике подсвечивается элемент по id. */
export interface PhysicsHighlight {
  id: string;
}
