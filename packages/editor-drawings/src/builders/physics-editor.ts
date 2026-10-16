import { createDisposer, el, on, type Translate, type Unsubscribe } from '@rich-editor/core';
import { renderPhysicsSvg, resolvePhysicsViewport } from '../render/physics-svg';
import { HIGHLIGHT_COLOR, fmt } from '../render/svg-builder';
import { normalizePhysicsScene } from '../scene/normalize';
import type { AxisTick, PhysicsElement, PhysicsElementType, PhysicsScene, Vec2 } from '../scene/types';
import { distance, distanceToSegment, projectOnSegment, roundPoint, roundTo, snapToGrid } from './geometry-utils';
import { HistoryStack, cloneScene } from './history';
import { ChangeEmitter, SketchCanvas, type PointerInfo } from './sketch-canvas';
import { ToolBar, actionButton, propertyField, selectControl, type ToolButton } from './tool-bar';
import type { RawScene, SceneEditor, SceneEditorContext, SceneEditorFactory } from './types';

type Tool = 'select' | 'delete';

const TOOLS: ToolButton<Tool>[] = [
  { id: 'select', labelKey: 'drawings_tool_select', glyph: '↖' },
  { id: 'delete', labelKey: 'drawings_tool_delete', glyph: '✕' },
];

type Section = 'mechanics' | 'thermo' | 'circuit' | 'optics';

const SECTIONS: Array<{ id: Section; labelKey: string }> = [
  { id: 'mechanics', labelKey: 'drawings_tab_mechanics' },
  { id: 'thermo', labelKey: 'drawings_tab_thermo' },
  { id: 'circuit', labelKey: 'drawings_tab_circuit' },
  { id: 'optics', labelKey: 'drawings_tab_optics' },
];

const CANVAS_WIDTH = 560;
const CANVAS_HEIGHT = 420;
const DEFAULT_SCALE = 30;
const GRID_STEP = 0.5;
/** Порог прилипания к отрезкам чужих элементов, в пикселях экрана. */
const SEGMENT_SNAP_PX = 12;
/** Сдвиг дубликата и вставки, чтобы копия не легла точно на оригинал. */
const DUPLICATE_SHIFT: Vec2 = [0.5, 0.5];
/** Радиус дуги угла задан в пикселях при масштабе 25 — так его читает рендер. */
const ANGLE_ARC_BASE_SCALE = 25;
const ISOTHERM_SAMPLES = 16;

type KnownFields = Omit<PhysicsElement, 'id' | 'type'>;

/**
 * Элемент живой сцены: известные поля типизированы, всё остальное —
 * чужое и уходит в `getScene()` нетронутым.
 */
interface PhysicsItem extends Partial<KnownFields> {
  id: string;
  type: PhysicsElementType;
  [foreign: string]: unknown;
}

interface PhysicsState {
  elements: PhysicsItem[];
  showGrid: boolean;
  /** Поля сцены, которых конструктор не знает (в том числе `scale`/`offsetX`/`offsetY`). */
  extra: RawScene;
}

/** Ключи элемента, которые читает нормализация: всё прочее — чужое. */
const KNOWN_ELEMENT_KEYS = new Set([
  'id', 'type', 'label', 'name', 'color', 'dashed', 'strokeWidth', 'points', 'center', 'position', 'coords', 'subtype',
  'hatching', 'width', 'height', 'radius', 'angle', 'vectorType', 'angleType', 'arcRadius', 'rx', 'ry', 'xLabel', 'yLabel',
  'originLabel', 'xLength', 'yLength', 'offset', 'xTicks', 'yTicks', 'pistonHeight', 'pistonThickness', 'weight',
  'focalLength', 'wavy', 'text', 'charge', 'plateType', 'rect', 'orientation',
]);

const KNOWN_SCENE_KEYS = new Set(['type', 'elements', 'showGrid']);
/** Ключи старых термографиков: нормализация разворачивает их в элементы, назад они не нужны. */
const LEGACY_THERMO_KEYS = new Set(['thermo_axes', 'thermo_point', 'thermo_process', 'axes', 'points', 'path']);
const LEGACY_THERMO_TYPES = new Set(['graph_pv', 'graph_pV', 'pv_diagram', 'graph']);

const PHYSICS_TYPES = new Set<string>([
  'surface', 'arc_surface', 'block', 'rope', 'spring', 'vector', 'angle', 'stickman', 'balloon', 'ellipse_platform',
  'dimension_line', 'thermo_axes', 'thermo_point', 'thermo_process', 'piston_vessel', 'circuit_component', 'wire',
  'charge', 'field_line', 'capacitor_plate', 'current_conductor', 'circle_shape', 'lens', 'mirror', 'ray',
  'optics_arrow', 'prism', 'glass_slab', 'text_label',
]);

/** Фигуры с площадью: клик по ним уступает линиям и точкам, лежащим поверх. */
const AREA_TYPES = new Set<PhysicsElementType>([
  'block', 'stickman', 'balloon', 'ellipse_platform', 'piston_vessel', 'circle_shape', 'glass_slab', 'prism',
]);

/** Числовые поля, которые округляются при выгрузке. */
const NUMERIC_KEYS = [
  'width', 'height', 'radius', 'angle', 'arcRadius', 'rx', 'ry', 'xLength', 'yLength', 'pistonHeight',
  'pistonThickness', 'focalLength', 'strokeWidth',
] as const;

type NumericKey = (typeof NUMERIC_KEYS)[number];

// ------------------------------------------------------------------ палитра

interface PaletteItem {
  id: string;
  labelKey: string;
  glyph: string;
  type: PhysicsElementType;
  /** Поля нового элемента вокруг точки `at` — центра окна просмотра. */
  build(at: Vec2, state: PhysicsState, t: Translate): Partial<KnownFields>;
}

const shifted = ([x, y]: Vec2, pairs: Vec2[]): Vec2[] => pairs.map(([dx, dy]) => [x + dx, y + dy]);

const PALETTE: Record<Section, PaletteItem[]> = {
  mechanics: [
    { id: 'surface', labelKey: 'drawings_physics_el_surface', glyph: '▬', type: 'surface', build: (at) => ({ points: shifted(at, [[-3, -1], [3, -1]]), hatching: 'bottom' }) },
    { id: 'incline', labelKey: 'drawings_physics_el_incline', glyph: '◿', type: 'surface', build: (at) => ({ points: shifted(at, [[-4, -1], [4, 2]]), hatching: 'bottom' }) },
    { id: 'arc_surface', labelKey: 'drawings_physics_el_arc_surface', glyph: '◡', type: 'arc_surface', build: ([x, y]) => ({ center: [x, y + 1], points: shifted([x, y], [[3, 1], [-3, 1]]) }) },
    { id: 'block_rect', labelKey: 'drawings_physics_el_block_rect', glyph: '▭', type: 'block', build: (at) => ({ center: at, subtype: 'rectangle', width: 1.8, height: 1.2 }) },
    { id: 'block_circle', labelKey: 'drawings_physics_el_block_circle', glyph: '●', type: 'block', build: (at) => ({ center: at, subtype: 'circle', radius: 0.8 }) },
    { id: 'pulley', labelKey: 'drawings_physics_el_pulley', glyph: '◎', type: 'block', build: (at) => ({ center: at, subtype: 'pulley', radius: 0.6 }) },
    { id: 'rope', labelKey: 'drawings_physics_el_rope', glyph: '⌒', type: 'rope', build: (at) => ({ points: shifted(at, [[-2, 1], [2, 1]]) }) },
    { id: 'spring', labelKey: 'drawings_physics_el_spring', glyph: '∿', type: 'spring', build: (at) => ({ points: shifted(at, [[-2, 0], [2, 0]]) }) },
    { id: 'force', labelKey: 'drawings_physics_el_force', glyph: 'F→', type: 'vector', build: (at) => ({ points: shifted(at, [[0, 0], [2, 0]]), vectorType: 'force', label: '\\vec{F}' }) },
    { id: 'acc', labelKey: 'drawings_physics_el_acc', glyph: 'a→', type: 'vector', build: (at) => ({ points: shifted(at, [[0, 0], [2, 0]]), vectorType: 'acc', label: '\\vec{a}' }) },
    { id: 'angle', labelKey: 'drawings_physics_el_angle', glyph: '∠', type: 'angle', build: (at) => ({ center: at, points: shifted(at, [[1.5, 0], [1, 1]]), label: '\\alpha', angleType: 'inner' }) },
    { id: 'stickman', labelKey: 'drawings_physics_el_stickman', glyph: '웃', type: 'stickman', build: (at) => ({ center: at, height: 1.6 }) },
    { id: 'balloon', labelKey: 'drawings_physics_el_balloon', glyph: '○', type: 'balloon', build: ([x, y]) => ({ center: [x, y + 1], radius: 0.6, points: [[x, y - 1.5]] }) },
    { id: 'platform', labelKey: 'drawings_physics_el_platform', glyph: '⬭', type: 'ellipse_platform', build: (at) => ({ center: at, rx: 2, ry: 0.5 }) },
    { id: 'dimension', labelKey: 'drawings_physics_el_dimension', glyph: '↔', type: 'dimension_line', build: (at) => ({ points: shifted(at, [[-3, 0], [-3, 2]]), label: 'h' }) },
    { id: 'text', labelKey: 'drawings_physics_el_text', glyph: 'T', type: 'text_label', build: (at, _state, t) => ({ coords: at, text: t('drawings_physics_text_default') }) },
  ],
  thermo: [
    { id: 'thermo_axes', labelKey: 'drawings_physics_el_thermo_axes', glyph: '⌊', type: 'thermo_axes', build: ([x, y]) => ({ offset: [x - 3, y - 2.5], xLength: 7, yLength: 5.5, xLabel: 'V', yLabel: 'p', originLabel: '0' }) },
    { id: 'thermo_point', labelKey: 'drawings_physics_el_thermo_point', glyph: '•', type: 'thermo_point', build: (at, state) => ({ coords: at, label: String(state.elements.filter((item) => item.type === 'thermo_point').length + 1) }) },
    { id: 'process', labelKey: 'drawings_physics_el_process', glyph: '↗', type: 'thermo_process', build: (at) => ({ points: shifted(at, [[-1.5, -1], [1.5, 1]]), subtype: 'line' }) },
    // Изотерма рендера — гипербола pV = const в координатах мира, поэтому обе точки в первой четверти.
    { id: 'isotherm', labelKey: 'drawings_physics_el_isotherm', glyph: '∿', type: 'thermo_process', build: (at) => ({ points: shifted(at, [[0.5, 2], [2.5, 0.5]]), subtype: 'isotherm' }) },
    { id: 'isochor', labelKey: 'drawings_physics_el_isochor', glyph: '↑', type: 'thermo_process', build: (at) => ({ points: shifted(at, [[0, -1], [0, 1]]), subtype: 'isochor' }) },
    { id: 'piston', labelKey: 'drawings_physics_el_piston', glyph: '⊓', type: 'piston_vessel', build: (at) => ({ center: at, width: 2.5, height: 3.5, pistonHeight: 0.6, pistonThickness: 0.15 }) },
    { id: 'text', labelKey: 'drawings_physics_el_text', glyph: 'T', type: 'text_label', build: (at, _state, t) => ({ coords: at, text: t('drawings_physics_text_default') }) },
  ],
  circuit: [
    { id: 'resistor', labelKey: 'drawings_physics_el_resistor', glyph: '▭', type: 'circuit_component', build: (at) => ({ points: shifted(at, [[-2, 0], [2, 0]]), subtype: 'resistor' }) },
    { id: 'capacitor', labelKey: 'drawings_physics_el_capacitor', glyph: '⫴', type: 'circuit_component', build: (at) => ({ points: shifted(at, [[-2, 0], [2, 0]]), subtype: 'capacitor' }) },
    { id: 'inductor', labelKey: 'drawings_physics_el_inductor', glyph: '∩∩', type: 'circuit_component', build: (at) => ({ points: shifted(at, [[-2, 0], [2, 0]]), subtype: 'inductor' }) },
    { id: 'switch', labelKey: 'drawings_physics_el_switch', glyph: '⟋', type: 'circuit_component', build: (at) => ({ points: shifted(at, [[-2, 0], [2, 0]]), subtype: 'switch' }) },
    { id: 'source', labelKey: 'drawings_physics_el_source', glyph: '⊣|', type: 'circuit_component', build: (at) => ({ points: shifted(at, [[-2, 0], [2, 0]]), subtype: 'source' }) },
    { id: 'voltmeter', labelKey: 'drawings_physics_el_voltmeter', glyph: 'V', type: 'circuit_component', build: (at) => ({ points: shifted(at, [[-2, 0], [2, 0]]), subtype: 'voltmeter' }) },
    { id: 'ammeter', labelKey: 'drawings_physics_el_ammeter', glyph: 'A', type: 'circuit_component', build: (at) => ({ points: shifted(at, [[-2, 0], [2, 0]]), subtype: 'ammeter' }) },
    { id: 'lamp', labelKey: 'drawings_physics_el_lamp', glyph: '◉', type: 'circuit_component', build: (at) => ({ points: shifted(at, [[-2, 0], [2, 0]]), subtype: 'lamp' }) },
    { id: 'diode', labelKey: 'drawings_physics_el_diode', glyph: '▷|', type: 'circuit_component', build: (at) => ({ points: shifted(at, [[-2, 0], [2, 0]]), subtype: 'diode' }) },
    { id: 'wire', labelKey: 'drawings_physics_el_wire', glyph: '—', type: 'wire', build: (at) => ({ points: shifted(at, [[-2, 0], [2, 0]]) }) },
    { id: 'charge_plus', labelKey: 'drawings_physics_el_charge_plus', glyph: '⊕', type: 'charge', build: (at) => ({ coords: at, charge: '+' }) },
    { id: 'charge_minus', labelKey: 'drawings_physics_el_charge_minus', glyph: '⊖', type: 'charge', build: (at) => ({ coords: at, charge: '-' }) },
    { id: 'field_electric', labelKey: 'drawings_physics_el_field_electric', glyph: 'E', type: 'field_line', build: (at) => ({ points: shifted(at, [[-3, 0], [3, 0]]), subtype: 'electric' }) },
    { id: 'field_magnetic', labelKey: 'drawings_physics_el_field_magnetic', glyph: 'B', type: 'field_line', build: (at) => ({ points: shifted(at, [[-3, 0], [3, 0]]), subtype: 'magnetic' }) },
    { id: 'plate', labelKey: 'drawings_physics_el_plate', glyph: '▐', type: 'capacitor_plate', build: (at) => ({ points: shifted(at, [[-3, 0], [3, 0]]), plateType: 'positive' }) },
    { id: 'conductor_dot', labelKey: 'drawings_physics_el_conductor_dot', glyph: '⊙', type: 'current_conductor', build: (at) => ({ coords: at, subtype: 'dot' }) },
    { id: 'conductor_cross', labelKey: 'drawings_physics_el_conductor_cross', glyph: '⊗', type: 'current_conductor', build: (at) => ({ coords: at, subtype: 'cross' }) },
    { id: 'circle_shape', labelKey: 'drawings_physics_el_circle_shape', glyph: '○', type: 'circle_shape', build: (at) => ({ center: at, radius: 0.8 }) },
  ],
  optics: [
    { id: 'lens_converging', labelKey: 'drawings_physics_el_lens_converging', glyph: '()', type: 'lens', build: (at) => ({ center: at, height: 4.5, focalLength: 2, subtype: 'converging' }) },
    { id: 'lens_diverging', labelKey: 'drawings_physics_el_lens_diverging', glyph: ')(', type: 'lens', build: (at) => ({ center: at, height: 4.5, focalLength: 2, subtype: 'diverging' }) },
    { id: 'mirror', labelKey: 'drawings_physics_el_mirror', glyph: '▤', type: 'mirror', build: (at) => ({ points: shifted(at, [[-2, -2], [2, 2]]), hatching: 'bottom' }) },
    { id: 'ray', labelKey: 'drawings_physics_el_ray', glyph: '↗', type: 'ray', build: (at) => ({ points: shifted(at, [[-4, 2], [0, 0]]) }) },
    { id: 'optics_arrow', labelKey: 'drawings_physics_el_optics_arrow', glyph: '↑', type: 'optics_arrow', build: (at) => ({ center: at, height: 1.8, label: 'AB' }) },
    { id: 'prism', labelKey: 'drawings_physics_el_prism', glyph: '△', type: 'prism', build: (at) => ({ points: shifted(at, [[-1.5, -1], [1.5, -1], [0, 1.6]]) }) },
    { id: 'glass_slab', labelKey: 'drawings_physics_el_glass_slab', glyph: '▭', type: 'glass_slab', build: (at) => ({ center: at, width: 3.5, height: 2 }) },
  ],
};

const ALL_PALETTE_ITEMS = Object.values(PALETTE).flat();

// ------------------------------------------------------------- свойства

interface Option {
  value: string;
  labelKey: string;
}

const SUBTYPE_OPTIONS: Partial<Record<PhysicsElementType, Option[]>> = {
  block: [
    { value: 'rectangle', labelKey: 'drawings_physics_subtype_rectangle' },
    { value: 'circle', labelKey: 'drawings_physics_subtype_circle' },
    { value: 'pulley', labelKey: 'drawings_physics_subtype_pulley' },
  ],
  circuit_component: [
    { value: 'resistor', labelKey: 'drawings_physics_subtype_resistor' },
    { value: 'capacitor', labelKey: 'drawings_physics_subtype_capacitor' },
    { value: 'inductor', labelKey: 'drawings_physics_subtype_inductor' },
    { value: 'switch', labelKey: 'drawings_physics_subtype_switch' },
    { value: 'source', labelKey: 'drawings_physics_subtype_source' },
    { value: 'battery', labelKey: 'drawings_physics_subtype_battery' },
    { value: 'voltmeter', labelKey: 'drawings_physics_subtype_voltmeter' },
    { value: 'ammeter', labelKey: 'drawings_physics_subtype_ammeter' },
    { value: 'lamp', labelKey: 'drawings_physics_subtype_lamp' },
    { value: 'diode', labelKey: 'drawings_physics_subtype_diode' },
  ],
  lens: [
    { value: 'converging', labelKey: 'drawings_physics_subtype_converging' },
    { value: 'diverging', labelKey: 'drawings_physics_subtype_diverging' },
  ],
  thermo_process: [
    { value: 'line', labelKey: 'drawings_physics_subtype_line' },
    { value: 'isotherm', labelKey: 'drawings_physics_subtype_isotherm' },
    { value: 'isochor', labelKey: 'drawings_physics_subtype_isochor' },
  ],
  current_conductor: [
    { value: 'dot', labelKey: 'drawings_physics_subtype_dot' },
    { value: 'cross', labelKey: 'drawings_physics_subtype_cross' },
  ],
  field_line: [
    { value: 'electric', labelKey: 'drawings_physics_subtype_electric' },
    { value: 'magnetic', labelKey: 'drawings_physics_subtype_magnetic' },
  ],
};

const VECTOR_TYPE_OPTIONS: Option[] = [
  { value: 'force', labelKey: 'drawings_physics_vector_force' },
  { value: 'acc', labelKey: 'drawings_physics_vector_acc' },
  { value: 'other', labelKey: 'drawings_physics_vector_other' },
];

const HATCHING_OPTIONS: Option[] = [
  { value: '', labelKey: 'drawings_physics_hatching_none' },
  { value: 'top', labelKey: 'drawings_physics_hatching_top' },
  { value: 'bottom', labelKey: 'drawings_physics_hatching_bottom' },
  { value: 'left', labelKey: 'drawings_physics_hatching_left' },
  { value: 'right', labelKey: 'drawings_physics_hatching_right' },
];

const PLATE_OPTIONS: Option[] = [
  { value: 'positive', labelKey: 'drawings_physics_plate_positive' },
  { value: 'negative', labelKey: 'drawings_physics_plate_negative' },
  { value: 'neutral', labelKey: 'drawings_physics_plate_neutral' },
];

const ANGLE_TYPE_OPTIONS: Option[] = [
  { value: 'inner', labelKey: 'drawings_physics_angle_inner' },
  { value: 'outer', labelKey: 'drawings_physics_angle_outer' },
];

const COLOR_OPTIONS: Option[] = [
  { value: '', labelKey: 'drawings_physics_color_default' },
  { value: '#2563eb', labelKey: 'drawings_physics_color_blue' },
  { value: '#dc2626', labelKey: 'drawings_physics_color_red' },
  { value: '#16a34a', labelKey: 'drawings_physics_color_green' },
  { value: '#f97316', labelKey: 'drawings_physics_color_orange' },
  { value: '#8b5cf6', labelKey: 'drawings_physics_color_purple' },
  { value: '#64748b', labelKey: 'drawings_physics_color_gray' },
];

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** Типы, у которых рендер читает `label`. */
const LABELED_TYPES = new Set<PhysicsElementType>(['vector', 'angle', 'dimension_line', 'thermo_point', 'piston_vessel', 'optics_arrow']);
/** Типы, у которых рендер читает `dashed`. */
const DASHABLE_TYPES = new Set<PhysicsElementType>([
  'surface', 'arc_surface', 'block', 'rope', 'spring', 'vector', 'stickman', 'balloon', 'ellipse_platform', 'dimension_line',
  'thermo_process', 'piston_vessel', 'wire', 'charge', 'field_line', 'capacitor_plate', 'current_conductor', 'circle_shape',
  'lens', 'mirror', 'ray', 'optics_arrow',
]);

// ------------------------------------------------------------- геометрия

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const addVec = ([x, y]: Vec2, [dx, dy]: Vec2): Vec2 => [x + dx, y + dy];

const subVec = ([x, y]: Vec2, [ox, oy]: Vec2): Vec2 => [x - ox, y - oy];

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

const normalizeDegrees = (degrees: number): number => ((degrees % 360) + 360) % 360;

const angleOf = (from: Vec2, to: Vec2): number => (Math.atan2(to[1] - from[1], to[0] - from[0]) * 180) / Math.PI;

/** Точка в системе элемента: сдвиг к центру и поворот на `-angle` (угол элемента — против часовой в мире). */
const toLocal = (point: Vec2, center: Vec2, angleDegrees: number): Vec2 => {
  const [dx, dy] = subVec(point, center);
  const cos = Math.cos(toRadians(-angleDegrees));
  const sin = Math.sin(toRadians(-angleDegrees));

  return [dx * cos - dy * sin, dx * sin + dy * cos];
};

const fromLocal = (local: Vec2, center: Vec2, angleDegrees: number): Vec2 => {
  const cos = Math.cos(toRadians(angleDegrees));
  const sin = Math.sin(toRadians(angleDegrees));

  return [center[0] + local[0] * cos - local[1] * sin, center[1] + local[0] * sin + local[1] * cos];
};

/** Расстояние до круга: внутри — 0. */
const outsideCircle = (point: Vec2, center: Vec2, radius: number): number => Math.max(0, distance(point, center) - radius);

/** Расстояние до повёрнутого прямоугольника: внутри — 0. */
const outsideRect = (point: Vec2, center: Vec2, width: number, height: number, angleDegrees: number): number => {
  const [lx, ly] = toLocal(point, center, angleDegrees);

  return Math.hypot(Math.max(0, Math.abs(lx) - width / 2), Math.max(0, Math.abs(ly) - height / 2));
};

/** Расстояние до эллипса приближённо: внутри — 0, снаружи — по меньшей полуоси. */
const outsideEllipse = (point: Vec2, center: Vec2, rx: number, ry: number, angleDegrees: number): number => {
  const [lx, ly] = toLocal(point, center, angleDegrees);
  const normalized = Math.hypot(lx / rx, ly / ry);

  return normalized <= 1 ? 0 : (normalized - 1) * Math.min(rx, ry);
};

/** Расстояние до дуги по часовой от `a` к `b` вокруг `center`; вне сектора — до ближайшего конца. */
const arcDistance = (point: Vec2, center: Vec2, a: Vec2, b: Vec2): number => {
  const radius = distance(center, a);
  const start = angleOf(center, a);
  const span = normalizeDegrees(start - angleOf(center, b));
  const offset = normalizeDegrees(start - angleOf(center, point));

  if (offset <= span) return Math.abs(distance(point, center) - radius);

  return Math.min(distance(point, a), distance(point, b));
};

/** Ломаная изотермы pV = const между двумя точками — та же, что рисует рендер. */
const isothermSamples = (from: Vec2, to: Vec2): Vec2[] => {
  const constantFrom = from[0] * from[1];
  const constantTo = to[0] * to[1];
  const step = (to[0] - from[0]) / ISOTHERM_SAMPLES;
  const samples: Vec2[] = [];

  for (let index = 0; index <= ISOTHERM_SAMPLES; index += 1) {
    const x = from[0] + step * index;
    const y = (constantFrom + (constantTo - constantFrom) * (index / ISOTHERM_SAMPLES)) / x;

    if (Number.isFinite(y)) samples.push([x, y]);
  }

  return samples;
};

const polylineDistance = (point: Vec2, points: Vec2[], closed = false): number => {
  let best = Infinity;

  points.forEach((vertex) => {
    best = Math.min(best, distance(point, vertex));
  });

  for (let index = 0; index < points.length - 1; index += 1) {
    best = Math.min(best, distanceToSegment(point, points[index], points[index + 1]));
  }

  if (closed && points.length > 2) best = Math.min(best, distanceToSegment(point, points[points.length - 1], points[0]));

  return best;
};

// ---------------------------------------------------------------- элемент

/** Нормализованный элемент плюс чужие поля; умолчания нормализации (`dashed: false`, пустые `points`) не сохраняются. */
const toItem = (element: PhysicsElement, foreign: Record<string, unknown>): PhysicsItem => {
  const item: PhysicsItem = { ...foreign, id: element.id, type: element.type };
  const target = item as Record<string, unknown>;

  (Object.keys(element) as Array<keyof PhysicsElement>).forEach((key) => {
    const value = element[key];

    if (value === undefined || key === 'id' || key === 'type') return;

    if ((key === 'dashed' || key === 'weight' || key === 'wavy') && value === false) return;

    if (key === 'points' && Array.isArray(value) && value.length === 0) return;

    target[key] = value;
  });

  return item;
};

const foreignFields = (raw: unknown): Record<string, unknown> => {
  if (!isRecord(raw)) return {};

  return Object.fromEntries(Object.entries(raw).filter(([key]) => !KNOWN_ELEMENT_KEYS.has(key)));
};

/** Элемент в формат PinQueen: округлённые координаты и размеры, чужие поля как есть. */
const serializeItem = (item: PhysicsItem): Record<string, unknown> => {
  const out: Record<string, unknown> = { ...item };

  if (item.points) out.points = item.points.map((point) => roundPoint(point));

  (['center', 'coords', 'offset'] as const).forEach((key) => {
    const value = item[key];

    if (value) out[key] = roundPoint(value);
  });

  NUMERIC_KEYS.forEach((key) => {
    const value = item[key];

    if (typeof value === 'number') out[key] = roundTo(value);
  });

  (['xTicks', 'yTicks'] as const).forEach((key) => {
    const ticks = item[key];

    if (ticks) out[key] = ticks.map((tick) => ({ val: roundTo(tick.val), ...(tick.label ? { label: tick.label } : {}) }));
  });

  return out;
};

/** Опорная точка элемента для перетаскивания целиком. */
const anchorOf = (item: PhysicsItem): Vec2 | null => item.center ?? item.coords ?? item.points?.[0] ?? item.offset ?? null;

/** Сдвигает всю геометрию элемента: точки, центр, координаты, начало осей. */
const shiftItem = (item: PhysicsItem, delta: Vec2): void => {
  if (item.points) item.points = item.points.map((point) => addVec(point, delta));

  if (item.center) item.center = addVec(item.center, delta);

  if (item.coords) item.coords = addVec(item.coords, delta);

  if (item.offset) item.offset = addVec(item.offset, delta);
};

/** Клонирует элемент под новым id со сдвигом — для дубликата и вставки. */
const duplicateItem = (item: PhysicsItem, id: string, delta: Vec2): PhysicsItem => {
  const copy = cloneScene(item);

  copy.id = id;
  shiftItem(copy, delta);

  return copy;
};

// ------------------------------------------------------------------ ручки

type Handle =
  | { kind: 'point'; index: number; at: Vec2 }
  /** Центр дуги, вершина угла, шарик: двигает элемент целиком. */
  | { kind: 'center'; at: Vec2 }
  | { kind: 'origin'; at: Vec2 }
  /** Ручка размера; `apply` получает положение ручки в системе элемента. */
  | { kind: 'size'; at: Vec2; apply(item: PhysicsItem, local: Vec2): void };

const sizeHandle = (center: Vec2, angle: number, local: Vec2, apply: (item: PhysicsItem, local: Vec2) => void): Handle => ({
  kind: 'size',
  at: fromLocal(local, center, angle),
  apply,
});

const positive = (value: number, min: number): number => roundTo(Math.max(min, value), 1);

const handlesOf = (item: PhysicsItem): Handle[] => {
  const handles: Handle[] = (item.points ?? []).map((at, index) => ({ kind: 'point', index, at }));
  const { center } = item;
  const angle = item.angle ?? 0;

  if (item.type === 'thermo_axes') handles.push({ kind: 'origin', at: item.offset ?? [0, 0] });

  if (!center) return handles;

  switch (item.type) {
    case 'arc_surface':
    case 'angle':
    case 'balloon':
      handles.push({ kind: 'center', at: center });

      if (item.type === 'balloon') {
        handles.push(sizeHandle(center, 0, [item.radius ?? 0.6, 0], (target, [lx, ly]) => {
          target.radius = positive(Math.hypot(lx, ly), 0.1);
        }));
      }
      break;
    case 'block':
      if (item.subtype === 'circle' || item.subtype === 'pulley') {
        handles.push(sizeHandle(center, 0, [item.radius ?? 0.5, 0], (target, [lx, ly]) => {
          target.radius = positive(Math.hypot(lx, ly), 0.1);
        }));
      } else {
        handles.push(sizeHandle(center, angle, [(item.width ?? 0.8) / 2, (item.height ?? 0.6) / 2], (target, [lx, ly]) => {
          target.width = positive(Math.abs(lx) * 2, 0.2);
          target.height = positive(Math.abs(ly) * 2, 0.2);
        }));
      }
      break;
    case 'piston_vessel':
      handles.push(sizeHandle(center, angle, [(item.width ?? 2) / 2, (item.height ?? 3.5) / 2], (target, [lx, ly]) => {
        target.width = positive(Math.abs(lx) * 2, 0.4);
        target.height = positive(Math.abs(ly) * 2, 0.4);
      }));
      break;
    case 'glass_slab':
      handles.push(sizeHandle(center, 0, [(item.width ?? 2) / 2, (item.height ?? 1) / 2], (target, [lx, ly]) => {
        target.width = positive(Math.abs(lx) * 2, 0.2);
        target.height = positive(Math.abs(ly) * 2, 0.2);
      }));
      break;
    case 'ellipse_platform':
      handles.push(sizeHandle(center, angle, [item.rx ?? 2, item.ry ?? 0.5], (target, [lx, ly]) => {
        target.rx = positive(Math.abs(lx), 0.1);
        target.ry = positive(Math.abs(ly), 0.1);
      }));
      break;
    case 'circle_shape':
      handles.push(sizeHandle(center, 0, [item.radius ?? 0.8, 0], (target, [lx, ly]) => {
        target.radius = positive(Math.hypot(lx, ly), 0.1);
      }));
      break;
    case 'lens':
      handles.push(sizeHandle(center, 0, [0, (item.height ?? 3) / 2], (target, [, ly]) => {
        target.height = positive(Math.abs(ly) * 2, 0.2);
      }));
      break;
    case 'stickman':
      handles.push(sizeHandle(center, 0, [0, (item.height ?? 1.6) / 2], (target, [, ly]) => {
        target.height = positive(Math.abs(ly) * 2, 0.3);
      }));
      break;
    case 'optics_arrow': {
      // Остриё: знак высоты задаёт направление предмета.
      handles.push(sizeHandle(center, 0, [0, item.height ?? 1], (target, [, ly]) => {
        const sign = ly < 0 ? -1 : 1;

        target.height = roundTo(sign * Math.max(0.1, Math.abs(ly)), 1);
      }));
      break;
    }
    default:
      break;
  }

  return handles;
};

type Drag =
  | { kind: 'element'; id: string; start: Vec2; origin: PhysicsItem; recorded: boolean; moved: boolean }
  | { kind: 'handle'; id: string; handle: Handle; recorded: boolean; moved: boolean };

/**
 * Конструктор физических схем: четыре палитры (механика, термодинамика,
 * электричество, оптика) над одной сценой. Элемент добавляется кнопкой в
 * центр окна просмотра, дальше его двигают целиком или за точки с
 * прилипанием к точкам и отрезкам соседей и к сетке; свойства — в панели.
 *
 * Сцена, выделение, перетаскивание, буфер обмена и история — общее
 * состояние обработчиков указателя, клавиатуры, палитры и панели свойств,
 * поэтому класс. Смена раздела меняет только палитру — сцена остаётся.
 */
class PhysicsEditor implements SceneEditor {
  readonly element: HTMLElement;

  private readonly t: Translate;

  private readonly disposer = createDisposer();

  /** Слушатели панели свойств живут до её перерисовки. */
  private readonly propsDisposer = createDisposer();

  private readonly changes = new ChangeEmitter();

  private readonly history = new HistoryStack<PhysicsState>();

  private readonly canvas: SketchCanvas;

  private readonly tools: ToolBar<Tool>;

  private readonly sectionTabs = new Map<Section, HTMLButtonElement>();

  private readonly palette: HTMLElement;

  private readonly hint: HTMLElement;

  private readonly properties: HTMLElement;

  private state: PhysicsState = { elements: [], showGrid: true, extra: {} };

  private tool: Tool = 'select';

  private section: Section = 'mechanics';

  /** id выбранного элемента. */
  private selection: string | null = null;

  private clipboard: PhysicsItem | null = null;

  private drag: Drag | null = null;

  constructor(context: SceneEditorContext) {
    this.t = context.t;

    this.canvas = new SketchCanvas({
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      scale: DEFAULT_SCALE,
      onPointerDown: this.onPointerDown,
      onPointerMove: this.onPointerMove,
      onPointerUp: this.onPointerUp,
      onDoubleClick: this.onDoubleClick,
      onKeyDown: this.onKeyDown,
      onViewportChange: () => this.render(),
    });

    this.tools = new ToolBar<Tool>({ t: this.t, tools: TOOLS, onSelect: (tool) => this.setTool(tool) });

    const actions = el('div', {
      class: 'rte-builder__actions',
      children: [
        actionButton(this.t('drawings_undo'), '↶', () => this.undo()),
        actionButton(this.t('drawings_redo'), '↷', () => this.redo()),
        actionButton(this.t('drawings_grid'), '#', () => this.toggleGrid()),
        actionButton(this.t('drawings_zoom_in'), '+', () => this.canvas.zoomBy(1.25)),
        actionButton(this.t('drawings_zoom_out'), '−', () => this.canvas.zoomBy(0.8)),
        actionButton(this.t('drawings_zoom_reset'), '⌂', () => this.fitView()),
      ],
    });

    const sections = el('div', {
      class: 'rte-builder__sections',
      attrs: { role: 'tablist', 'aria-label': this.t('drawings_physics_sections') },
    });

    SECTIONS.forEach((section) => {
      const label = this.t(section.labelKey);
      const button = el('button', {
        class: 'rte-builder__tool rte-builder__section',
        attrs: { type: 'button', role: 'tab', 'aria-selected': 'false', 'data-section': section.id },
        text: label,
      });

      this.sectionTabs.set(section.id, button);
      sections.appendChild(button);
    });

    this.disposer.add(
      on(sections, 'click', (event) => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-section]');

        if (button) this.setSection(button.dataset.section as Section);
      }),
    );

    this.palette = el('div', { class: 'rte-builder__palette', attrs: { role: 'group', 'aria-label': this.t('drawings_physics_palette') } });
    this.disposer.add(
      on(this.palette, 'click', (event) => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-element]');
        const item = button ? PALETTE[this.section].find((candidate) => candidate.id === button.dataset.element) : undefined;

        if (item) this.addItem(item);
      }),
    );

    this.hint = el('p', { class: 'rte-builder__hint', attrs: { role: 'status' } });
    this.properties = el('div', { class: 'rte-builder__props', attrs: { 'aria-live': 'polite' } });

    this.element = el('div', {
      class: 'rte-builder rte-builder--physics',
      children: [
        el('div', { class: 'rte-builder__bar', children: [this.tools.element, actions] }),
        sections,
        this.palette,
        el('div', { class: 'rte-builder__body', children: [this.canvas.element, this.properties] }),
        this.hint,
      ],
    });

    this.setSection('mechanics');
    this.setTool('select');
    this.renderProperties();
    this.render();
  }

  // ----------------------------------------------------------- SceneEditor

  load(raw: RawScene): void {
    const normalized = normalizePhysicsScene(raw);
    const rawElements = Array.isArray(raw.elements) ? raw.elements : [];
    // Чужие поля переносятся только когда список элементов не был развёрнут
    // нормализацией (группы, старые термографики): иначе соответствия нет.
    const aligned =
      rawElements.length === normalized.elements.length
      && rawElements.every((candidate, index) => {
        if (!isRecord(candidate)) return false;

        const type = candidate.type;

        return type === normalized.elements[index].type || (typeof type === 'string' && !PHYSICS_TYPES.has(type));
      });

    const legacyThermo =
      LEGACY_THERMO_TYPES.has(String(raw.type)) || Object.keys(raw).some((key) => key.startsWith('thermo_'));
    const extra: RawScene = {};

    Object.entries(raw).forEach(([key, value]) => {
      if (KNOWN_SCENE_KEYS.has(key)) return;

      if (legacyThermo && LEGACY_THERMO_KEYS.has(key)) return;

      extra[key] = value;
    });

    this.state = {
      elements: normalized.elements.map((element, index) => toItem(element, aligned ? foreignFields(rawElements[index]) : {})),
      showGrid: normalized.showGrid,
      extra,
    };
    this.history.clear();
    this.selection = null;
    this.drag = null;
    this.fitView();
    this.renderProperties();
  }

  getScene(): RawScene {
    const scene: RawScene = { ...this.state.extra, type: 'physics' };

    if (!this.state.showGrid) scene.showGrid = false;

    scene.elements = this.state.elements.map(serializeItem);

    return scene;
  }

  onChange(listener: () => void): Unsubscribe {
    return this.changes.on(listener);
  }

  focus(): void {
    this.canvas.focus();
  }

  destroy(): void {
    this.propsDisposer.dispose();
    this.disposer.dispose();
    this.changes.clear();
    this.tools.destroy();
    this.canvas.destroy();
    this.element.remove();
  }

  // --------------------------------------------------------------- рендер

  /** Сцена для рендера: окно просмотра полотна вместо autoFit. */
  private renderScene(): PhysicsScene {
    const { viewport } = this.canvas;

    return {
      ...normalizePhysicsScene(this.getScene()),
      scale: viewport.scale,
      offsetX: viewport.cx - CANVAS_WIDTH / 2,
      offsetY: viewport.cy - CANVAS_HEIGHT / 2,
      showGrid: this.state.showGrid,
    };
  }

  private render(): void {
    this.canvas.setScene(
      renderPhysicsSvg(this.renderScene(), {
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        highlight: this.selection ? { id: this.selection } : null,
      }),
    );
    this.renderOverlay();
  }

  /** Ручки выбранного элемента: кружки у точек, квадратики у ручек размера. */
  private renderOverlay(): void {
    const selected = this.selected();

    if (!selected) {
      this.canvas.setOverlay('');

      return;
    }

    const parts = handlesOf(selected).map((handle) => {
      const at = this.canvas.toSvg(handle.at);
      const stroke = `fill="#fff" stroke="${HIGHLIGHT_COLOR}" stroke-width="2"`;

      if (handle.kind === 'size') {
        return `<rect x="${fmt(at.x - 5)}" y="${fmt(at.y - 5)}" width="10" height="10" ${stroke} />`;
      }

      return `<circle cx="${fmt(at.x)}" cy="${fmt(at.y)}" r="${handle.kind === 'point' ? 6 : 7}" ${stroke} />`;
    });

    this.canvas.setOverlay(parts.join(''));
  }

  /** Вписывает сцену в полотно; пустая сцена — исходный вид с началом координат в центре. */
  private fitView(): void {
    if (this.state.elements.length === 0) {
      this.canvas.resetView();

      return;
    }

    const scene = normalizePhysicsScene(this.getScene());

    this.canvas.setViewport(resolvePhysicsViewport(scene, { width: CANVAS_WIDTH, height: CANVAS_HEIGHT, autoFit: true }));
  }

  // ------------------------------------------------------------ изменения

  private commit(mutate: (state: PhysicsState) => void): void {
    this.history.record(this.state);
    mutate(this.state);
    this.afterChange();
  }

  private afterChange(): void {
    if (this.selection && !this.state.elements.some((item) => item.id === this.selection)) this.selection = null;

    this.render();
    this.renderProperties();
    this.changes.emit();
  }

  private undo(): void {
    const previous = this.history.undo(this.state);

    if (!previous) return;

    this.state = previous;
    this.drag = null;
    this.afterChange();
  }

  private redo(): void {
    const next = this.history.redo(this.state);

    if (!next) return;

    this.state = next;
    this.drag = null;
    this.afterChange();
  }

  private toggleGrid(): void {
    this.commit((state) => {
      state.showGrid = !state.showGrid;
    });
  }

  private setTool(tool: Tool): void {
    this.tool = tool;
    this.tools.setActive(tool);
    this.hint.textContent = this.t(tool === 'delete' ? 'drawings_physics_hint_delete' : 'drawings_physics_hint_select');
  }

  /** Раздел меняет только палитру: сцена общая для всех четырёх. */
  private setSection(section: Section): void {
    this.section = section;

    this.sectionTabs.forEach((button, id) => {
      const active = id === section;

      button.classList.toggle('rte-builder__section--active', active);
      button.setAttribute('aria-selected', String(active));
    });

    this.palette.replaceChildren(
      ...PALETTE[section].map((item) => {
        const label = this.t(item.labelKey);

        return el('button', {
          class: 'rte-builder__tool rte-builder__palette-item',
          attrs: { type: 'button', title: label, 'data-element': item.id, 'data-type': item.type },
          children: [el('span', { class: 'rte-builder__tool-glyph', text: item.glyph }), el('span', { class: 'rte-builder__tool-label', text: label })],
        });
      }),
    );
  }

  private selected(): PhysicsItem | null {
    return this.state.elements.find((item) => item.id === this.selection) ?? null;
  }

  private nextId(type: PhysicsElementType): string {
    const used = new Set(this.state.elements.map((item) => item.id));
    let index = 1;

    while (used.has(`${type}_${index}`)) index += 1;

    return `${type}_${index}`;
  }

  /** Новый элемент из палитры — в центр окна просмотра, на сетку. */
  private addItem(palette: PaletteItem): void {
    const at = snapToGrid(this.canvas.toWorld({ x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2 }), GRID_STEP);
    const id = this.nextId(palette.type);
    const fields = palette.build(at, this.state, this.t);

    this.selection = id;
    this.commit((state) => {
      state.elements.push({ id, type: palette.type, ...fields });
    });
  }

  private deleteItem(id: string): void {
    if (!this.state.elements.some((item) => item.id === id)) return;

    this.commit((state) => {
      state.elements = state.elements.filter((item) => item.id !== id);
    });
  }

  private copySelection(): void {
    const selected = this.selected();

    if (selected) this.clipboard = cloneScene(selected);
  }

  /** Вставка кладёт копию со сдвигом и запоминает её: повторная вставка ляжет ещё дальше. */
  private paste(): void {
    if (!this.clipboard) return;

    const copy = duplicateItem(this.clipboard, this.nextId(this.clipboard.type), DUPLICATE_SHIFT);

    this.clipboard = cloneScene(copy);
    this.selection = copy.id;
    this.commit((state) => {
      state.elements.push(copy);
    });
  }

  // ------------------------------------------------------------- хит-тест

  /** Расстояние от точки мира до элемента: внутри фигур с площадью — 0. */
  private distanceTo(item: PhysicsItem, point: Vec2): number {
    const pixel = 1 / this.canvas.viewport.scale;
    const points = item.points ?? [];
    const { center, coords } = item;
    let best = polylineDistance(point, points, item.type === 'prism');

    if (center) best = Math.min(best, distance(point, center));

    if (coords) best = Math.min(best, distance(point, coords));

    switch (item.type) {
      case 'block':
        if (!center) break;

        if (item.subtype === 'circle' || item.subtype === 'pulley') {
          best = Math.min(best, outsideCircle(point, center, item.radius ?? (item.subtype === 'circle' ? 0.5 : 0.6)));
        } else {
          best = Math.min(best, outsideRect(point, center, item.width ?? 0.8, item.height ?? 0.6, item.angle ?? 0));
        }
        break;
      case 'circle_shape':
        if (center) best = Math.min(best, outsideCircle(point, center, item.radius ?? 0.8));
        break;
      case 'balloon':
        if (center) {
          const radius = (item.radius ?? 0.6) * 1.25;

          best = Math.min(best, outsideCircle(point, center, radius));

          if (points[0]) best = Math.min(best, distanceToSegment(point, [center[0], center[1] - radius], points[0]));
        }
        break;
      case 'stickman':
        if (center) best = Math.min(best, outsideRect(point, center, (item.height ?? 1.6) * 0.6, (item.height ?? 1.6) * 1.1, 0));
        break;
      case 'ellipse_platform':
        if (center) best = Math.min(best, outsideEllipse(point, center, item.rx ?? 2, item.ry ?? 0.5, item.angle ?? 0));
        break;
      case 'piston_vessel':
        if (center) best = Math.min(best, outsideRect(point, center, item.width ?? 2, item.height ?? 3.5, item.angle ?? 0));
        break;
      case 'glass_slab':
        if (center) best = Math.min(best, outsideRect(point, center, item.width ?? 2, item.height ?? 1, 0));
        break;
      case 'lens':
        if (center) {
          const half = (item.height ?? 3) / 2;

          best = Math.min(best, distanceToSegment(point, [center[0], center[1] - half], [center[0], center[1] + half]));
        }
        break;
      case 'optics_arrow':
        if (center) best = Math.min(best, distanceToSegment(point, center, [center[0], center[1] + (item.height ?? 1)]));
        break;
      case 'arc_surface':
        if (center && points.length >= 2) best = Math.min(best, arcDistance(point, center, points[0], points[1]));
        break;
      case 'angle':
        if (center && points.length >= 2) {
          const radius = (item.arcRadius ?? 32) / ANGLE_ARC_BASE_SCALE;

          best = Math.min(
            best,
            distanceToSegment(point, center, points[0]),
            distanceToSegment(point, center, points[1]),
            Math.abs(distance(point, center) - radius),
          );
        }
        break;
      case 'thermo_axes': {
        const origin = item.offset ?? [0, 0];

        best = Math.min(
          best,
          distanceToSegment(point, origin, [origin[0] + (item.xLength ?? 7), origin[1]]),
          distanceToSegment(point, origin, [origin[0], origin[1] + (item.yLength ?? 5.5)]),
        );
        break;
      }
      case 'thermo_process':
        if (item.subtype === 'isotherm' && points.length >= 2) {
          best = Math.min(best, polylineDistance(point, isothermSamples(points[0], points[1])));
        }
        break;
      case 'charge':
      case 'current_conductor':
        if (coords) best = Math.min(best, outsideCircle(point, coords, 9 * pixel));
        break;
      case 'text_label':
        if (coords) best = Math.min(best, outsideCircle(point, coords, 14 * pixel));
        break;
      default:
        break;
    }

    return best;
  }

  /** Элемент под курсором: линии и точки важнее фигур с площадью; при равенстве — верхний. */
  private elementAt(point: Vec2): PhysicsItem | null {
    const radius = this.canvas.hitRadius;
    const pick = (candidates: PhysicsItem[]): PhysicsItem | null => {
      let best: { item: PhysicsItem; d: number } | null = null;

      candidates.forEach((item) => {
        const d = this.distanceTo(item, point);

        if (d <= radius && (best === null || d <= best.d)) best = { item, d };
      });

      return best === null ? null : (best as { item: PhysicsItem }).item;
    };

    return pick(this.state.elements.filter((item) => !AREA_TYPES.has(item.type))) ?? pick(this.state.elements.filter((item) => AREA_TYPES.has(item.type)));
  }

  private handleAt(point: Vec2): Handle | null {
    const selected = this.selected();

    if (!selected) return null;

    const radius = this.canvas.hitRadius;
    let best: { handle: Handle; d: number } | null = null;

    handlesOf(selected).forEach((handle) => {
      const d = distance(point, handle.at);

      if (d <= radius && (best === null || d < best.d)) best = { handle, d };
    });

    return best === null ? null : (best as { handle: Handle }).handle;
  }

  /** Прилипание: к точкам чужих элементов → к их отрезкам → к сетке; `Shift` отключает. */
  private snap(point: Vec2, info: PointerInfo, ignoreId: string): Vec2 {
    if (info.shift) return point;

    const pointRadius = this.canvas.hitRadius;
    const segmentRadius = SEGMENT_SNAP_PX / this.canvas.viewport.scale;
    const others = this.state.elements.filter((item) => item.id !== ignoreId);
    let bestPoint: { at: Vec2; d: number } | null = null;

    others.forEach((item) => {
      const anchors: Vec2[] = [...(item.points ?? [])];

      if (item.center) anchors.push(item.center);

      if (item.coords) anchors.push(item.coords);

      if (item.offset) anchors.push(item.offset);

      anchors.forEach((anchor) => {
        const d = distance(point, anchor);

        if (d <= pointRadius && (bestPoint === null || d < bestPoint.d)) bestPoint = { at: anchor, d };
      });
    });

    if (bestPoint !== null) return [...(bestPoint as { at: Vec2 }).at] as Vec2;

    let bestSegment: { at: Vec2; d: number } | null = null;

    others.forEach((item) => {
      const points = item.points ?? [];

      for (let index = 0; index < points.length - 1; index += 1) {
        const projected = projectOnSegment(point, points[index], points[index + 1]).point;
        const d = distance(point, projected);

        if (d <= segmentRadius && (bestSegment === null || d < bestSegment.d)) bestSegment = { at: projected, d };
      }
    });

    if (bestSegment !== null) return roundPoint((bestSegment as { at: Vec2 }).at);

    return snapToGrid(point, GRID_STEP);
  }

  // ------------------------------------------------------------- указатель

  private readonly onPointerDown = (info: PointerInfo): void => {
    if (info.button !== 0) return;

    if (this.tool === 'delete') {
      const target = this.elementAt(info.world);

      if (target) this.deleteItem(target.id);

      return;
    }

    const handle = this.handleAt(info.world);

    if (handle && this.selection) {
      this.drag = { kind: 'handle', id: this.selection, handle, recorded: false, moved: false };

      return;
    }

    const target = this.elementAt(info.world);

    if (!target) {
      this.selection = null;
      this.render();
      this.renderProperties();

      return;
    }

    if (info.ctrl) {
      // Дубликат сразу под курсором: его можно тянуть дальше тем же жестом,
      // а отмена снимает и копию, и перенос одним шагом.
      const copy = duplicateItem(target, this.nextId(target.type), DUPLICATE_SHIFT);

      this.selection = copy.id;
      this.commit((state) => {
        state.elements.push(copy);
      });
      this.drag = { kind: 'element', id: copy.id, start: info.world, origin: cloneScene(copy), recorded: true, moved: false };

      return;
    }

    this.selection = target.id;
    this.drag = { kind: 'element', id: target.id, start: info.world, origin: cloneScene(target), recorded: false, moved: false };
    this.render();
    this.renderProperties();
  };

  private readonly onPointerMove = (info: PointerInfo): void => {
    const { drag } = this;

    if (!drag) return;

    const item = this.state.elements.find((candidate) => candidate.id === drag.id);

    if (!item) {
      this.drag = null;

      return;
    }

    if (!drag.recorded) {
      this.history.record(this.state);
      drag.recorded = true;
    }

    drag.moved = true;

    if (drag.kind === 'element') {
      this.moveElement(item, drag, info);
    } else {
      this.moveHandle(item, drag.handle, info);
    }

    this.render();
  };

  private readonly onPointerUp = (): void => {
    if (this.drag?.moved) this.afterChange();

    this.drag = null;
  };

  private readonly onDoubleClick = (info: PointerInfo): void => {
    const target = this.elementAt(info.world);

    if (!target) return;

    this.selection = target.id;
    this.render();
    this.renderProperties();
    this.properties.querySelector<HTMLInputElement>('input')?.focus();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const ctrl = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();

    if (ctrl && key === 'z') {
      event.preventDefault();

      if (event.shiftKey) this.redo();
      else this.undo();

      return;
    }

    if (ctrl && key === 'y') {
      event.preventDefault();
      this.redo();

      return;
    }

    if (ctrl && key === 'c') {
      if (this.selection) {
        event.preventDefault();
        this.copySelection();
      }

      return;
    }

    if (ctrl && key === 'v') {
      if (this.clipboard) {
        event.preventDefault();
        this.paste();
      }

      return;
    }

    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (this.selection) {
        event.preventDefault();
        this.deleteItem(this.selection);
      }

      return;
    }

    if (event.key === 'Escape') {
      this.selection = null;
      this.drag = null;
      this.render();
      this.renderProperties();
    }
  };

  /** Перенос целиком: прилипает опорная точка, остальная геометрия едет за ней. */
  private moveElement(item: PhysicsItem, drag: Extract<Drag, { kind: 'element' }>, info: PointerInfo): void {
    const anchor = anchorOf(drag.origin);

    if (!anchor) return;

    const delta = subVec(info.world, drag.start);
    const target = this.snap(addVec(anchor, delta), info, item.id);
    const shift = subVec(target, anchor);

    if (drag.origin.points) item.points = drag.origin.points.map((point) => addVec(point, shift));

    if (drag.origin.center) item.center = addVec(drag.origin.center, shift);

    if (drag.origin.coords) item.coords = addVec(drag.origin.coords, shift);

    if (drag.origin.offset) item.offset = addVec(drag.origin.offset, shift);
  }

  private moveHandle(item: PhysicsItem, handle: Handle, info: PointerInfo): void {
    const target = this.snap(info.world, info, item.id);

    switch (handle.kind) {
      case 'point': {
        const points = item.points ?? [];

        if (!points[handle.index]) return;

        points[handle.index] = target;

        // Дуга рисуется радиусом первой точки: вторая держится на той же окружности.
        if (item.type === 'arc_surface' && item.center && points.length >= 2) {
          const other = handle.index === 0 ? 1 : 0;
          const radius = distance(item.center, target);
          const direction = toRadians(angleOf(item.center, points[other]));

          points[other] = [item.center[0] + radius * Math.cos(direction), item.center[1] + radius * Math.sin(direction)];
        }

        item.points = points;
        break;
      }
      case 'center':
        if (item.center) shiftItem(item, subVec(target, item.center));
        break;
      case 'origin':
        item.offset = target;
        break;
      case 'size':
        if (item.center) handle.apply(item, toLocal(target, item.center, item.angle ?? 0));
        break;
      default:
        break;
    }
  }

  // --------------------------------------------------------- панель свойств

  /** Название элемента — подпись кнопки палитры, которая его создаёт. */
  private titleOf(item: PhysicsItem): string {
    const exact = ALL_PALETTE_ITEMS.find((candidate) => {
      if (candidate.type !== item.type) return false;

      const fields = candidate.build([0, 0], this.state, this.t);

      return (fields.subtype === undefined || fields.subtype === item.subtype)
        && (fields.vectorType === undefined || fields.vectorType === item.vectorType)
        && (fields.charge === undefined || fields.charge === item.charge);
    });
    const fallback = ALL_PALETTE_ITEMS.find((candidate) => candidate.type === item.type);
    const found = exact ?? fallback;

    return found ? this.t(found.labelKey) : item.type;
  }

  private renderProperties(): void {
    const { t } = this;
    const item = this.selected();

    this.propsDisposer.dispose();
    this.properties.replaceChildren();

    if (!item) {
      this.properties.appendChild(el('p', { class: 'rte-builder__props-empty', text: t('drawings_nothing_selected') }));

      return;
    }

    this.properties.appendChild(el('h4', { class: 'rte-builder__props-title', text: this.titleOf(item) }));

    if (item.type === 'text_label') this.textField(item, 'text', t('drawings_prop_text'));

    if (LABELED_TYPES.has(item.type)) this.textField(item, 'label', t('drawings_prop_label'));

    const subtypes = SUBTYPE_OPTIONS[item.type];

    if (subtypes) this.selectField(item, 'subtype', t('drawings_prop_subtype'), subtypes);

    if (item.type === 'vector') this.selectField(item, 'vectorType', t('drawings_prop_vector_type'), VECTOR_TYPE_OPTIONS);

    if (item.type === 'charge') this.textField(item, 'charge', t('drawings_prop_charge'));

    if (item.type === 'surface' || item.type === 'mirror') this.selectField(item, 'hatching', t('drawings_prop_hatching'), HATCHING_OPTIONS);

    if (item.type === 'capacitor_plate') this.selectField(item, 'plateType', t('drawings_physics_prop_plate_type'), PLATE_OPTIONS);

    if (item.type === 'angle') {
      this.selectField(item, 'angleType', t('drawings_physics_prop_angle_type'), ANGLE_TYPE_OPTIONS);
      this.numberField(item, 'arcRadius', t('drawings_physics_prop_arc_radius'), { min: 8, step: 1, fallback: 32 });
    }

    this.sizeFields(item);

    if (item.type === 'thermo_axes') this.axesFields(item);

    this.colorField(item);

    if (DASHABLE_TYPES.has(item.type)) this.checkField(item, 'dashed', t('drawings_prop_dashed'));

    if (item.type === 'piston_vessel') this.checkField(item, 'weight', t('drawings_physics_prop_weight'));

    if (item.type === 'wire') this.checkField(item, 'wavy', t('drawings_physics_prop_wavy'));

    const remove = el('button', { class: 'rte-button rte-button--danger rte-builder__remove', attrs: { type: 'button' }, text: t('drawings_remove_selected') });

    this.propsDisposer.add(on(remove, 'click', () => this.deleteItem(item.id)));
    this.properties.appendChild(remove);
  }

  /** Размеры по типу: что читает рендер, то и редактируется. */
  private sizeFields(item: PhysicsItem): void {
    const { t } = this;
    const width = () => this.numberField(item, 'width', t('drawings_physics_prop_width'), { min: 0.1, step: 0.1, fallback: 2 });
    const height = (fallback: number) => this.numberField(item, 'height', t('drawings_physics_prop_height'), { min: 0.1, step: 0.1, fallback });
    const radius = (fallback: number) => this.numberField(item, 'radius', t('drawings_prop_radius'), { min: 0.1, step: 0.1, fallback });
    const rotation = () => this.numberField(item, 'angle', t('drawings_prop_rotate'), { step: 5, fallback: 0, signed: true });

    switch (item.type) {
      case 'block':
        if (item.subtype === 'circle' || item.subtype === 'pulley') {
          radius(item.subtype === 'circle' ? 0.5 : 0.6);
        } else {
          width();
          height(0.6);
          rotation();
        }
        break;
      case 'piston_vessel':
        width();
        height(3.5);
        this.numberField(item, 'pistonHeight', t('drawings_physics_prop_piston_height'), { min: 0.05, max: 0.95, step: 0.05, fallback: 0.6 });
        rotation();
        break;
      case 'glass_slab':
        width();
        height(1);
        break;
      case 'stickman':
        height(1.6);
        break;
      case 'lens':
        height(3);
        this.numberField(item, 'focalLength', t('drawings_physics_prop_focal_length'), { min: 0.1, step: 0.1, fallback: 2 });
        break;
      case 'optics_arrow':
        this.numberField(item, 'height', t('drawings_physics_prop_height'), { step: 0.1, fallback: 1, signed: true });
        break;
      case 'balloon':
        radius(0.6);
        break;
      case 'circle_shape':
        radius(0.8);
        break;
      case 'ellipse_platform':
        this.numberField(item, 'rx', t('drawings_physics_prop_rx'), { min: 0.1, step: 0.1, fallback: 2 });
        this.numberField(item, 'ry', t('drawings_physics_prop_ry'), { min: 0.1, step: 0.1, fallback: 0.5 });
        rotation();
        break;
      default:
        break;
    }
  }

  private axesFields(item: PhysicsItem): void {
    const { t } = this;

    this.textField(item, 'xLabel', t('drawings_physics_prop_x_label'));
    this.textField(item, 'yLabel', t('drawings_physics_prop_y_label'));
    this.textField(item, 'originLabel', t('drawings_physics_prop_origin_label'));
    this.numberField(item, 'xLength', t('drawings_physics_prop_x_length'), { min: 0.5, step: 0.5, fallback: 7 });
    this.numberField(item, 'yLength', t('drawings_physics_prop_y_length'), { min: 0.5, step: 0.5, fallback: 5.5 });
    this.ticksField(item, 'xTicks', t('drawings_physics_prop_x_ticks'));
    this.ticksField(item, 'yTicks', t('drawings_physics_prop_y_ticks'));
  }

  private mutateSelected(id: string, mutate: (item: PhysicsItem) => void): void {
    this.commit((state) => {
      const target = state.elements.find((candidate) => candidate.id === id);

      if (target) mutate(target);
    });
  }

  private textField(item: PhysicsItem, key: 'label' | 'text' | 'charge' | 'xLabel' | 'yLabel' | 'originLabel', label: string): void {
    const input = el('input', { class: 'rte-input', attrs: { type: 'text', value: item[key] ?? '', 'data-prop': key } });

    this.properties.appendChild(propertyField(label, input));
    this.propsDisposer.add(
      on(input, 'change', () => {
        const value = input.value.trim();

        this.mutateSelected(item.id, (target) => {
          if (value) target[key] = value;
          else delete target[key];
        });
      }),
    );
  }

  private numberField(
    item: PhysicsItem,
    key: NumericKey,
    label: string,
    options: { min?: number; max?: number; step: number; fallback: number; signed?: boolean },
  ): void {
    const input = el('input', {
      class: 'rte-input',
      attrs: {
        type: 'number',
        step: String(options.step),
        min: options.min !== undefined ? String(options.min) : undefined,
        max: options.max !== undefined ? String(options.max) : undefined,
        value: String(item[key] ?? options.fallback),
        'data-prop': key,
      },
    });

    this.properties.appendChild(propertyField(label, input));
    this.propsDisposer.add(
      on(input, 'change', () => {
        const value = Number(input.value);
        const belowMin = options.min !== undefined && value < options.min;
        const aboveMax = options.max !== undefined && value > options.max;

        if (!Number.isFinite(value) || belowMin || aboveMax || (!options.signed && options.min === undefined && value <= 0)) {
          this.renderProperties();

          return;
        }

        this.mutateSelected(item.id, (target) => {
          target[key] = roundTo(value);
        });
      }),
    );
  }

  private checkField(item: PhysicsItem, key: 'dashed' | 'weight' | 'wavy', label: string): void {
    const input = el('input', { class: 'rte-builder__check', attrs: { type: 'checkbox', 'data-prop': key } });

    input.checked = item[key] === true;
    this.properties.appendChild(propertyField(label, input));
    this.propsDisposer.add(
      on(input, 'change', () => {
        const { checked } = input;

        this.mutateSelected(item.id, (target) => {
          if (checked) target[key] = true;
          else delete target[key];
        });
      }),
    );
  }

  private selectField(
    item: PhysicsItem,
    key: 'subtype' | 'vectorType' | 'hatching' | 'plateType' | 'angleType',
    label: string,
    options: Option[],
  ): void {
    const current = item[key] ?? '';
    const known = options.some((option) => option.value === current);
    const select = selectControl(
      [...options.map((option) => ({ value: option.value, label: this.t(option.labelKey) })), ...(known ? [] : [{ value: current, label: current }])],
      current,
    );

    select.dataset.prop = key;
    this.properties.appendChild(propertyField(label, select));
    this.propsDisposer.add(
      on(select, 'change', () => {
        const { value } = select;

        this.mutateSelected(item.id, (target) => {
          if (value) (target as Record<string, unknown>)[key] = value;
          else delete target[key];
        });
      }),
    );
  }

  /** Цвет: именованный из списка или свой hex; пустое значение — основной цвет темы. */
  private colorField(item: PhysicsItem): void {
    const { t } = this;
    const current = item.color ?? '';
    const known = COLOR_OPTIONS.some((option) => option.value === current);
    const select = selectControl(
      [...COLOR_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey) })), ...(known ? [] : [{ value: current, label: current }])],
      current,
    );
    const hex = el('input', { class: 'rte-input', attrs: { type: 'text', value: current, placeholder: '#2563eb', 'data-prop': 'color-hex' } });

    select.dataset.prop = 'color';
    this.properties.append(propertyField(t('drawings_prop_color'), select), propertyField(t('drawings_physics_prop_color_custom'), hex));

    const apply = (value: string): void => {
      this.mutateSelected(item.id, (target) => {
        if (value) target.color = value;
        else delete target.color;
      });
    };

    this.propsDisposer.add(on(select, 'change', () => apply(select.value)));
    this.propsDisposer.add(
      on(hex, 'change', () => {
        const value = hex.value.trim();

        if (value === '' || HEX_COLOR.test(value)) apply(value.toLowerCase());
        else this.renderProperties();
      }),
    );
  }

  /** Деления оси: строки «значение — подпись — убрать» и кнопка добавления. */
  private ticksField(item: PhysicsItem, key: 'xTicks' | 'yTicks', label: string): void {
    const { t } = this;
    const list = el('div', { class: 'rte-builder__ticks', attrs: { 'data-prop': key } });
    const ticks = item[key] ?? [];

    ticks.forEach((tick, index) => {
      const value = el('input', { class: 'rte-input', attrs: { type: 'number', step: '0.5', value: String(tick.val), 'aria-label': t('drawings_physics_tick_value'), 'data-tick': 'val' } });
      const text = el('input', { class: 'rte-input', attrs: { type: 'text', value: tick.label ?? '', placeholder: String(tick.val), 'aria-label': t('drawings_physics_tick_label'), 'data-tick': 'label' } });
      const remove = el('button', { class: 'rte-builder__tool rte-builder__tool--action rte-builder__tick-remove', attrs: { type: 'button', title: t('drawings_physics_remove_tick'), 'aria-label': t('drawings_physics_remove_tick') }, text: '✕' });
      const update = (mutate: (ticks: AxisTick[]) => void): void => {
        this.mutateSelected(item.id, (target) => {
          const next = [...(target[key] ?? [])];

          mutate(next);

          if (next.length > 0) target[key] = next;
          else delete target[key];
        });
      };

      this.propsDisposer.add(
        on(value, 'change', () => {
          const val = Number(value.value);

          if (!Number.isFinite(val)) {
            this.renderProperties();

            return;
          }

          update((next) => {
            next[index] = { ...next[index], val };
          });
        }),
      );
      this.propsDisposer.add(
        on(text, 'change', () => {
          const trimmed = text.value.trim();

          update((next) => {
            next[index] = trimmed ? { val: next[index].val, label: trimmed } : { val: next[index].val };
          });
        }),
      );
      this.propsDisposer.add(on(remove, 'click', () => update((next) => next.splice(index, 1))));
      list.appendChild(el('div', { class: 'rte-builder__tick', children: [value, text, remove] }));
    });

    const add = el('button', { class: 'rte-builder__tool rte-builder__tool--action', attrs: { type: 'button', 'data-add-tick': key }, text: `+ ${t('drawings_physics_add_tick')}` });

    this.propsDisposer.add(
      on(add, 'click', () => {
        this.mutateSelected(item.id, (target) => {
          const existing = target[key] ?? [];
          const last = existing.length > 0 ? Math.max(...existing.map((tick) => tick.val)) : 0;

          target[key] = [...existing, { val: last + 1 }];
        });
      }),
    );
    list.appendChild(add);
    this.properties.appendChild(propertyField(label, list));
  }
}

export const physicsEditorFactory: SceneEditorFactory = {
  id: 'physics',
  kind: 'physics',
  labelKey: 'drawings_tab_mechanics',
  // Любая физическая сцена редактируется здесь: четыре раздела — это палитры, а не форматы.
  accepts: () => true,
  create: (context) => new PhysicsEditor(context),
};
