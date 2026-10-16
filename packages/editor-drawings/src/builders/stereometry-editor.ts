import { createDisposer, el, on, type Translate, type Unsubscribe } from '@rich-editor/core';
import { project3dToPlane, projectOblique, rotatePoint3d, type SvgPoint, type Viewport } from '../render/coords';
import { renderGeometrySvg, resolveGeometryViewport } from '../render/geometry-svg';
import { fmt, pointsAttr } from '../render/svg-builder';
import { normalizeGeometryScene } from '../scene/normalize';
import type { AngleStyle, EdgeStyle, GeometryHighlight, GeometryScene, Point, Vec2, Vec3 } from '../scene/types';
import { angleBetween, distance, projectOnSegment, roundTo, snapToGrid } from './geometry-utils';
import { HistoryStack } from './history';
import { ChangeEmitter, HIT_RADIUS_PX, SketchCanvas, type PointerInfo } from './sketch-canvas';
import { ToolBar, actionButton, propertyField, selectControl, type ToolButton } from './tool-bar';
import type { RawScene, SceneEditor, SceneEditorContext, SceneEditorFactory } from './types';

type Tool = 'select' | 'point' | 'segment' | 'section' | 'angle' | 'delete';

const TOOLS: ToolButton<Tool>[] = [
  { id: 'select', labelKey: 'drawings_tool_select', glyph: '↖' },
  { id: 'point', labelKey: 'drawings_tool_point', glyph: '•' },
  { id: 'segment', labelKey: 'drawings_tool_segment', glyph: '╱' },
  { id: 'section', labelKey: 'drawings_tool_section', glyph: '◇' },
  { id: 'angle', labelKey: 'drawings_tool_angle', glyph: '∠' },
  { id: 'delete', labelKey: 'drawings_tool_delete', glyph: '✕' },
];

/** Ключи подсказок целиком, а не из префикса: проверка таблиц переводов ищет их в коде. */
const HINTS: Record<Tool, string> = {
  select: 'drawings_stereo_hint_select',
  point: 'drawings_stereo_hint_point',
  segment: 'drawings_stereo_hint_segment',
  section: 'drawings_stereo_hint_section',
  angle: 'drawings_stereo_hint_angle',
  delete: 'drawings_stereo_hint_delete',
};

/**
 * Полотно конструктора и его исходный масштаб. Экспортируется, чтобы тесты
 * считали координаты кликов той же проекцией, что и конструктор.
 */
export const STEREOMETRY_CANVAS = { width: 560, height: 420, scale: 40 } as const;

/** Вращение правой кнопкой: градусов на пиксель и предел наклона. */
const ROTATION_DEGREES_PER_PX = 0.8;
const MAX_TILT = 85;

/** Вид по умолчанию у шаблонов и пустой сцены — как в оригинале. */
const DEFAULT_ANGLE_Y = 15;
const DEFAULT_ANGLE_Z = -30;

/** Прилипание точки на плоскости z = 0 к полуклеткам сетки. */
const GROUND_STEP = 0.5;

/** Доля ребра, ближе которой к концу точку не ставим: иначе она сольётся с вершиной. */
const EDGE_POINT_MIN_T = 0.1;
const EDGE_POINT_MAX_T = 0.9;

/** Определитель, при котором плоскость z = 0 считается видимой с ребра. */
const DEGENERATE_DET = 1e-6;

/** Положение подписи у новых точек: на ребре — над ним, на плоскости — у ног. */
const EDGE_POINT_LABEL = 'above';
const GROUND_POINT_LABEL = 'below right';

const DRAFT_COLOR = '#8b5cf6';
const SECTION_STROKE = '#10b981';
const RIGHT_ANGLE_TOLERANCE = 1.5;

const LABEL_POSITIONS = ['above', 'below', 'left', 'right', 'above left', 'above right', 'below left', 'below right'];
const ANGLE_STYLES: AngleStyle[] = ['single', 'double', 'triple', 'right'];

const SECTION_FILLS: Array<{ value: string; labelKey: string }> = [
  { value: 'rgba(16, 185, 129, 0.25)', labelKey: 'drawings_stereo_fill_green' },
  { value: 'rgba(37, 99, 235, 0.25)', labelKey: 'drawings_stereo_fill_blue' },
  { value: 'rgba(249, 115, 22, 0.25)', labelKey: 'drawings_stereo_fill_orange' },
  { value: 'rgba(236, 72, 153, 0.25)', labelKey: 'drawings_stereo_fill_pink' },
  { value: 'rgba(100, 116, 139, 0.25)', labelKey: 'drawings_stereo_fill_gray' },
];

type TemplateId = 'pyramid3' | 'pyramid4' | 'prism3' | 'parallelepiped' | 'cylinder';

const TEMPLATES: Array<{ id: TemplateId; labelKey: string; glyph: string }> = [
  { id: 'pyramid3', labelKey: 'drawings_stereo_template_pyramid3', glyph: '△' },
  { id: 'pyramid4', labelKey: 'drawings_stereo_template_pyramid4', glyph: '⬠' },
  { id: 'prism3', labelKey: 'drawings_stereo_template_prism3', glyph: '⬡' },
  { id: 'parallelepiped', labelKey: 'drawings_stereo_template_parallelepiped', glyph: '▭' },
  { id: 'cylinder', labelKey: 'drawings_stereo_template_cylinder', glyph: '⌭' },
];

interface StereoEdge {
  from: string;
  to: string;
  style: EdgeStyle;
  color?: string;
  ticks?: number;
}

interface StereoSection {
  vertices: string[];
  fill?: string;
  stroke?: string;
}

interface StereoCylinder {
  base: string;
  top: string;
  radius: number;
}

interface StereoAngle {
  points: [string, string, string];
  style: AngleStyle;
  label?: string;
}

/** Живая сцена конструктора: 3D-подмножество `GeometryScene` плюс всё чужое как есть. */
interface StereometryState {
  vertices: Record<string, Vec3>;
  edges: StereoEdge[];
  sections: StereoSection[];
  cylinders: StereoCylinder[];
  angles: StereoAngle[];
  labels: Record<string, string>;
  angleY: number;
  angleZ: number;
  showGrid: boolean;
  showAxes: boolean;
  /** Поля сцены, которых конструктор не знает: уходят обратно нетронутыми. */
  extra: RawScene;
}

type TemplateScene = Pick<StereometryState, 'vertices' | 'edges' | 'labels' | 'cylinders'>;

/** Что выбрано на полотне. */
type Selection =
  | { type: 'vertex'; id: string }
  | { type: 'edge'; index: number }
  | { type: 'section'; index: number }
  | { type: 'angle'; index: number }
  | null;

const KNOWN_KEYS = new Set([
  'type',
  'vertices',
  'edges',
  'angles',
  'markings',
  'labels',
  'sections',
  'cylinders',
  'angleY',
  'angleZ',
  'showGrid',
  'grid',
  'showAxes',
  'scale',
  'offsetX',
  'offsetY',
]);

const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));

/** Поворот вокруг вертикали — по кругу: 370° и 10° — один и тот же вид. */
const wrapDegrees = (value: number): number => ((((value + 180) % 360) + 360) % 360) - 180;

const toVec3 = (point: Point): Vec3 => [point[0], point[1], point[2] ?? 0];

const roundVec3 = (point: Vec3): Vec3 => [roundTo(point[0]), roundTo(point[1]), roundTo(point[2])];

const toVec2 = (point: SvgPoint): Vec2 => [point.x, point.y];

const copyEdge = (edge: StereoEdge): StereoEdge => ({
  from: edge.from,
  to: edge.to,
  style: edge.style,
  ...(edge.color ? { color: edge.color } : {}),
  ...(edge.ticks ? { ticks: edge.ticks } : {}),
});

const copyAngle = (angle: StereoAngle): StereoAngle => ({
  points: [...angle.points] as [string, string, string],
  style: angle.style,
  ...(angle.label ? { label: angle.label } : {}),
});

const copySection = (section: StereoSection): StereoSection => ({
  vertices: [...section.vertices],
  ...(section.fill ? { fill: section.fill } : {}),
  ...(section.stroke ? { stroke: section.stroke } : {}),
});

/** Следующее свободное имя точки: A…Z, потом A1, B1… */
const nextVertexName = (used: Record<string, unknown>): string => {
  for (let round = 0; round < 10; round += 1) {
    for (let code = 65; code <= 90; code += 1) {
      const name = `${String.fromCharCode(code)}${round === 0 ? '' : round}`;

      if (!(name in used)) return name;
    }
  }

  return `P${Object.keys(used).length + 1}`;
};

/** Угол между лучами `vertex→a` и `vertex→b` в пространстве, градусы 0–180. */
const angle3d = (vertex: Vec3, a: Vec3, b: Vec3): number => {
  const u = [a[0] - vertex[0], a[1] - vertex[1], a[2] - vertex[2]];
  const w = [b[0] - vertex[0], b[1] - vertex[1], b[2] - vertex[2]];
  const length = Math.hypot(...u) * Math.hypot(...w);

  if (length === 0) return 0;

  const cos = (u[0] * w[0] + u[1] * w[1] + u[2] * w[2]) / length;

  return (Math.acos(clamp(cos, -1, 1)) * 180) / Math.PI;
};

/** Точка внутри многоугольника — лучом вправо, по чётности пересечений. */
const insidePolygon = (point: SvgPoint, polygon: SvgPoint[]): boolean => {
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    const straddles = a.y > point.y !== b.y > point.y;

    if (straddles && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }

  return inside;
};

/**
 * Имена трёх вершин из текста «SOH»: буква с необязательным индексом
 * (`SA1B` → S, A1, B) либо три слова через пробел или запятую. Регистр не
 * важен; все три должны быть разными вершинами сцены.
 */
export const parseAngleVertices = (text: string, names: string[]): [string, string, string] | null => {
  const words = text.trim().split(/[\s,;]+/).filter(Boolean);
  const parts = words.length === 3 ? words : (text.match(/[A-Za-zА-Яа-яЁё][0-9]*/g) ?? []);

  if (parts.length !== 3) return null;

  const byUpper = new Map(names.map((name) => [name.toUpperCase(), name]));
  const found = parts.map((part) => byUpper.get(part.toUpperCase()));

  if (found.some((name) => name === undefined) || new Set(found).size < 3) return null;

  return found as [string, string, string];
};

/** Точка сцены на полотне: поворот и кабинетная проекция — ровно как в `renderGeometrySvg`. */
export const projectVertex = (point: Point, angleY: number, angleZ: number, viewport: Viewport): SvgPoint =>
  projectOblique(rotatePoint3d(point, angleY, angleZ), viewport.scale, viewport.cx, viewport.cy);

/**
 * Обратная проекция точки картинки (в единицах мира, как `SketchCanvas.toWorld`)
 * на плоскость z = 0. Проекция линейна по (x, y), поэтому её матрица 2×2 —
 * образы единичных векторов плоскости; система решается по Крамеру.
 */
export const unprojectToGround = (plane: Vec2, angleY: number, angleZ: number): Vec2 => {
  const [a, c] = project3dToPlane([1, 0, 0], angleY, angleZ);
  const [b, d] = project3dToPlane([0, 1, 0], angleY, angleZ);
  const det = a * d - b * c;
  const [px, py] = plane;

  if (Math.abs(det) > DEGENERATE_DET) {
    return [(px * d - b * py) / det, (a * py - c * px) / det];
  }

  // Плоскость видна с ребра (наклон ≈ −19,5°): обратной проекции нет, и точка
  // ложится на повёрнутую ось y туда, где курсор по горизонтали.
  const radians = (angleZ * Math.PI) / 180;

  return [px * Math.sin(radians), px * Math.cos(radians)];
};

// ---------------------------------------------------------------- шаблоны

const edge = (from: string, to: string, style: EdgeStyle = 'solid'): StereoEdge => ({ from, to, style });

/**
 * Шаблоны фигур. Ось x уходит к зрителю, y — вправо, z — вверх; при виде
 * (15°, −30°) дальняя вершина основания — A, поэтому пунктиром идут её рёбра.
 */
const TEMPLATE_SCENES: Record<TemplateId, () => TemplateScene> = {
  pyramid3: () => ({
    vertices: { A: [-3, -2, 0], B: [3, -2, 0], C: [0, 3, 0], S: [0, 0, 5.5] },
    edges: [edge('A', 'B', 'dashed'), edge('B', 'C'), edge('C', 'A'), edge('S', 'A'), edge('S', 'B'), edge('S', 'C')],
    labels: { A: 'above right', B: 'left', C: 'right', S: 'above' },
    cylinders: [],
  }),
  pyramid4: () => ({
    vertices: { A: [-3, -3, 0], B: [3, -3, 0], C: [3, 3, 0], D: [-3, 3, 0], S: [0, 0, 5.5] },
    edges: [
      edge('A', 'B', 'dashed'),
      edge('B', 'C'),
      edge('C', 'D'),
      edge('D', 'A', 'dashed'),
      edge('S', 'A', 'dashed'),
      edge('S', 'B'),
      edge('S', 'C'),
      edge('S', 'D'),
    ],
    labels: { A: 'above right', B: 'left', C: 'below', D: 'right', S: 'above' },
    cylinders: [],
  }),
  prism3: () => ({
    vertices: { A: [-3, -2, 0], B: [3, -2, 0], C: [0, 3, 0], A1: [-3, -2, 5], B1: [3, -2, 5], C1: [0, 3, 5] },
    edges: [
      edge('A', 'B', 'dashed'),
      edge('B', 'C'),
      edge('C', 'A', 'dashed'),
      edge('A1', 'B1'),
      edge('B1', 'C1'),
      edge('C1', 'A1'),
      edge('A', 'A1', 'dashed'),
      edge('B', 'B1'),
      edge('C', 'C1'),
    ],
    labels: { A: 'right', B: 'left', C: 'right', A1: 'above', B1: 'left', C1: 'right' },
    cylinders: [],
  }),
  parallelepiped: () => ({
    vertices: {
      A: [-3, -3, 0],
      B: [3, -3, 0],
      C: [3, 3, 0],
      D: [-3, 3, 0],
      A1: [-3, -3, 5],
      B1: [3, -3, 5],
      C1: [3, 3, 5],
      D1: [-3, 3, 5],
    },
    edges: [
      edge('A', 'B', 'dashed'),
      edge('B', 'C'),
      edge('C', 'D'),
      edge('D', 'A', 'dashed'),
      edge('A1', 'B1'),
      edge('B1', 'C1'),
      edge('C1', 'D1'),
      edge('D1', 'A1'),
      edge('A', 'A1', 'dashed'),
      edge('B', 'B1'),
      edge('C', 'C1'),
      edge('D', 'D1'),
    ],
    labels: { A: 'right', B: 'left', C: 'below', D: 'right', A1: 'above', B1: 'left', C1: 'below right', D1: 'right' },
    cylinders: [],
  }),
  cylinder: () => ({
    vertices: { O1: [0, 0, 0], O2: [0, 0, 5.5], A: [0, -3, 0], B: [0, 3, 0], A1: [0, -3, 5.5], B1: [0, 3, 5.5] },
    edges: [edge('O1', 'O2', 'dashed'), edge('A', 'B', 'dashed'), edge('A1', 'B1'), edge('A', 'A1', 'dashed'), edge('B', 'B1')],
    labels: { O1: 'below', O2: 'above', A: 'left', B: 'right', A1: 'left', B1: 'right' },
    cylinders: [{ base: 'O1', top: 'O2', radius: 3 }],
  }),
};

/**
 * Конструктор стереометрии: вершины, рёбра, сечения, углы и цилиндры в
 * кабинетной проекции с вращением правой кнопкой мыши.
 *
 * Инструмент, черновик, выделение, жест вращения, история и сцена — общее
 * состояние обработчиков указателя, клавиатуры и панели свойств, поэтому класс.
 */
class StereometryEditor implements SceneEditor {
  readonly element: HTMLElement;

  private readonly t: Translate;

  private readonly disposer = createDisposer();

  private readonly changes = new ChangeEmitter();

  private readonly history = new HistoryStack<StereometryState>();

  private readonly canvas: SketchCanvas;

  private readonly tools: ToolBar<Tool>;

  private readonly hint: HTMLElement;

  private readonly properties: HTMLElement;

  private state: StereometryState = StereometryEditor.emptyState();

  private tool: Tool = 'select';

  private selection: Selection = null;

  /** Вершины, уже выбранные текущим инструментом: начало отрезка, стороны угла, контур сечения. */
  private draft: string[] = [];

  /** Курсор в координатах картинки — для черновика отрезка и сечения. */
  private cursor: SvgPoint | null = null;

  /** Жест вращения правой кнопкой: последняя точка экрана и сделан ли снимок истории. */
  private rotation: { x: number; y: number; recorded: boolean } | null = null;

  constructor(context: SceneEditorContext) {
    this.t = context.t;

    this.canvas = new SketchCanvas({
      width: STEREOMETRY_CANVAS.width,
      height: STEREOMETRY_CANVAS.height,
      scale: STEREOMETRY_CANVAS.scale,
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
        actionButton(this.t('drawings_stereo_axes'), 'xyz', () => this.toggleAxes()),
        actionButton(this.t('drawings_zoom_in'), '+', () => this.canvas.zoomBy(1.25)),
        actionButton(this.t('drawings_zoom_out'), '−', () => this.canvas.zoomBy(0.8)),
        actionButton(this.t('drawings_zoom_reset'), '⌂', () => this.fitView()),
      ],
    });

    const palette = el('div', {
      class: 'rte-builder__palette',
      attrs: { role: 'group', 'aria-label': this.t('drawings_stereo_templates') },
      children: TEMPLATES.map((template) => {
        const label = this.t(template.labelKey);

        return el('button', {
          class: 'rte-builder__tool',
          attrs: { type: 'button', title: label, 'data-template': template.id },
          children: [el('span', { class: 'rte-builder__tool-glyph', text: template.glyph }), el('span', { class: 'rte-builder__tool-label', text: label })],
        });
      }),
    });

    this.disposer.add(
      on(palette, 'click', (event) => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-template]');

        if (button) this.applyTemplate(button.dataset.template as TemplateId);
      }),
    );

    this.hint = el('p', { class: 'rte-builder__hint', attrs: { role: 'status' } });
    this.properties = el('div', { class: 'rte-builder__props', attrs: { 'aria-live': 'polite' } });

    this.element = el('div', {
      class: 'rte-builder rte-builder--stereometry',
      children: [
        el('div', { class: 'rte-builder__bar', children: [this.tools.element, actions] }),
        palette,
        el('div', { class: 'rte-builder__body', children: [this.canvas.element, this.properties] }),
        this.hint,
      ],
    });

    this.setTool('select');
  }

  static emptyState(): StereometryState {
    return {
      vertices: {},
      edges: [],
      sections: [],
      cylinders: [],
      angles: [],
      labels: {},
      angleY: DEFAULT_ANGLE_Y,
      angleZ: DEFAULT_ANGLE_Z,
      showGrid: true,
      showAxes: false,
      extra: {},
    };
  }

  // ----------------------------------------------------------- SceneEditor

  load(raw: RawScene): void {
    const scene = normalizeGeometryScene(raw);
    const vertices: Record<string, Vec3> = {};

    Object.entries(scene.vertices).forEach(([name, point]) => {
      vertices[name] = toVec3(point);
    });

    const extra: RawScene = {};

    Object.entries(raw).forEach(([key, value]) => {
      if (!KNOWN_KEYS.has(key)) extra[key] = value;
    });

    this.state = {
      vertices,
      edges: scene.edges.map(copyEdge),
      sections: scene.sections.map(copySection),
      cylinders: scene.cylinders.map((cylinder) => ({ ...cylinder })),
      angles: scene.angles.map(copyAngle),
      labels: { ...scene.labels },
      angleY: clamp(scene.angleY, -MAX_TILT, MAX_TILT),
      angleZ: wrapDegrees(scene.angleZ),
      showGrid: scene.showGrid,
      showAxes: scene.showAxes,
      extra,
    };
    this.history.clear();
    this.selection = null;
    this.draft = [];
    this.rotation = null;
    this.fitView();
    this.renderProperties();
  }

  getScene(): RawScene {
    const { state } = this;
    const scene: RawScene = {
      ...state.extra,
      type: '3d',
      vertices: Object.fromEntries(Object.entries(state.vertices).map(([name, point]) => [name, roundVec3(point)])),
      edges: state.edges.map(copyEdge),
      angleY: roundTo(state.angleY),
      angleZ: roundTo(state.angleZ),
    };

    if (state.angles.length > 0) scene.angles = state.angles.map(copyAngle);

    if (Object.keys(state.labels).length > 0) scene.labels = { ...state.labels };

    if (state.sections.length > 0) scene.sections = state.sections.map(copySection);

    if (state.cylinders.length > 0) {
      scene.cylinders = state.cylinders.map((cylinder) => ({ base: cylinder.base, top: cylinder.top, radius: roundTo(cylinder.radius) }));
    }

    if (!state.showGrid) scene.showGrid = false;

    if (state.showAxes) scene.showAxes = true;

    return scene;
  }

  onChange(listener: () => void): Unsubscribe {
    return this.changes.on(listener);
  }

  focus(): void {
    this.canvas.focus();
  }

  destroy(): void {
    this.disposer.dispose();
    this.changes.clear();
    this.tools.destroy();
    this.canvas.destroy();
    this.element.remove();
  }

  // --------------------------------------------------------------- рендер

  /**
   * Сцена для рендера: окно просмотра полотна вместо autoFit. Тип всегда
   * `3d` — иначе фигуру, у которой все точки легли на z = 0, нормализация
   * понизила бы до плоской, и клики перестали бы совпадать с картинкой.
   */
  private renderScene(): GeometryScene {
    const { viewport } = this.canvas;

    return {
      ...normalizeGeometryScene(this.getScene()),
      type: '3d',
      scale: viewport.scale,
      offsetX: viewport.cx - STEREOMETRY_CANVAS.width / 2,
      offsetY: viewport.cy - STEREOMETRY_CANVAS.height / 2,
      showGrid: this.state.showGrid,
      showAxes: this.state.showAxes,
    };
  }

  private highlight(): GeometryHighlight | null {
    const { selection, state } = this;

    // Черновик угла рисует общий рендер: он знает, где лежат вершины в проекции.
    if (this.tool === 'angle' && this.draft.length > 0) return { type: 'angle_draft', points: [...this.draft] };

    if (!selection) return null;

    switch (selection.type) {
      case 'vertex':
        return { type: 'vertex', id: selection.id };
      case 'edge': {
        const target = state.edges[selection.index];

        return target ? { type: 'edge', from: target.from, to: target.to } : null;
      }
      case 'section': {
        const section = state.sections[selection.index];

        return section ? { type: 'section', vertices: section.vertices } : null;
      }
      case 'angle': {
        const angle = state.angles[selection.index];

        return angle ? { type: 'angle', id: `angle_${angle.points.join('')}` } : null;
      }
      default:
        return null;
    }
  }

  private render(): void {
    this.canvas.setScene(
      renderGeometrySvg(this.renderScene(), { width: STEREOMETRY_CANVAS.width, height: STEREOMETRY_CANVAS.height, highlight: this.highlight() }),
    );
    this.renderOverlay();
  }

  /** Черновик отрезка или сечения: кружки выбранных вершин, линия к курсору, контур. */
  private renderOverlay(): void {
    if (this.tool === 'angle') {
      this.canvas.setOverlay('');

      return;
    }

    const placed = this.draft.map((name) => this.project(name)).filter((point): point is SvgPoint => point !== null);
    const parts = placed.map(
      (at) => `<circle cx="${fmt(at.x)}" cy="${fmt(at.y)}" r="9" fill="none" stroke="${DRAFT_COLOR}" stroke-width="2" stroke-dasharray="3 3" />`,
    );

    if (this.tool === 'segment' && placed.length === 1 && this.cursor) {
      const [from] = placed;

      parts.push(
        `<line x1="${fmt(from.x)}" y1="${fmt(from.y)}" x2="${fmt(this.cursor.x)}" y2="${fmt(this.cursor.y)}" stroke="${DRAFT_COLOR}" stroke-width="1.5" stroke-dasharray="4 3" />`,
      );
    }

    if (this.tool === 'section' && placed.length >= 2) {
      const outline = this.cursor ? [...placed, this.cursor] : placed;

      parts.push(
        `<polygon points="${pointsAttr(outline)}" fill="rgba(16, 185, 129, 0.12)" stroke="${DRAFT_COLOR}" stroke-width="1.5" stroke-dasharray="4 3" />`,
      );
    }

    this.canvas.setOverlay(parts.join(''));
  }

  /** Вершина на полотне в координатах картинки; `null`, если такой нет. */
  private project(name: string): SvgPoint | null {
    const point = this.state.vertices[name];

    return point ? projectVertex(point, this.state.angleY, this.state.angleZ, this.canvas.viewport) : null;
  }

  private fitView(): void {
    const scene: GeometryScene = { ...normalizeGeometryScene(this.getScene()), type: '3d' };
    const { width, height, scale } = STEREOMETRY_CANVAS;

    this.canvas.setViewport(
      Object.keys(scene.vertices).length > 0
        ? resolveGeometryViewport(scene, { width, height, autoFit: true })
        : { scale, cx: width / 2, cy: height / 2 },
    );
  }

  // ------------------------------------------------------------ изменения

  private commit(mutate: (state: StereometryState) => void): void {
    this.history.record(this.state);
    mutate(this.state);
    this.afterChange();
  }

  private afterChange(): void {
    this.splitEdgesInState();
    this.render();
    this.renderProperties();
    this.changes.emit();
  }

  /** Точка, попавшая на ребро (в том числе координатами из панели), делит его сразу. */
  private splitEdgesInState(): void {
    const normalized = normalizeGeometryScene({ type: '3d', vertices: this.state.vertices, edges: this.state.edges });

    if (normalized.edges.length !== this.state.edges.length) this.state.edges = normalized.edges.map(copyEdge);
  }

  private undo(): void {
    const previous = this.history.undo(this.state);

    if (!previous) return;

    this.state = previous;
    this.selection = null;
    this.draft = [];
    this.afterChange();
  }

  private redo(): void {
    const next = this.history.redo(this.state);

    if (!next) return;

    this.state = next;
    this.selection = null;
    this.draft = [];
    this.afterChange();
  }

  private toggleGrid(): void {
    this.commit((state) => {
      state.showGrid = !state.showGrid;
    });
  }

  private toggleAxes(): void {
    this.commit((state) => {
      state.showAxes = !state.showAxes;
    });
  }

  private setTool(tool: Tool): void {
    this.tool = tool;
    this.draft = [];
    this.tools.setActive(tool);
    this.hint.textContent = `${this.t(HINTS[tool])}. ${this.t('drawings_stereo_hint_rotate')}`;
    this.render();
    this.renderProperties();
  }

  /** Шаблон заменяет сцену целиком и возвращает вид по умолчанию. */
  private applyTemplate(id: TemplateId): void {
    const build = TEMPLATE_SCENES[id];

    if (!build) return;

    const template = build();

    this.draft = [];
    this.selection = null;
    this.commit((state) => {
      state.vertices = template.vertices;
      state.edges = template.edges;
      state.labels = template.labels;
      state.cylinders = template.cylinders;
      state.sections = [];
      state.angles = [];
      state.angleY = DEFAULT_ANGLE_Y;
      state.angleZ = DEFAULT_ANGLE_Z;
      state.extra = {};
    });
  }

  // ------------------------------------------------------------- хит-тест

  private vertexAt(at: SvgPoint): string | null {
    let best: { name: string; d: number } | null = null;

    for (const name of Object.keys(this.state.vertices)) {
      const placed = this.project(name);

      if (!placed) continue;

      const d = distance(toVec2(at), toVec2(placed));

      if (d <= HIT_RADIUS_PX && (best === null || d < best.d)) best = { name, d };
    }

    return best === null ? null : best.name;
  }

  private edgeAt(at: SvgPoint): number | null {
    let best: { index: number; d: number } | null = null;

    for (const [index, target] of this.state.edges.entries()) {
      const a = this.project(target.from);
      const b = this.project(target.to);

      if (!a || !b) continue;

      const d = distance(toVec2(at), projectOnSegment(toVec2(at), toVec2(a), toVec2(b)).point);

      if (d <= HIT_RADIUS_PX && (best === null || d < best.d)) best = { index, d };
    }

    return best === null ? null : best.index;
  }

  /** Угол выбирается кликом у его дуги: внутри сектора, недалеко от вершины. */
  private angleAt(at: SvgPoint): number | null {
    const near = HIT_RADIUS_PX * 2.5;
    let best: { index: number; d: number } | null = null;

    for (const [index, angle] of this.state.angles.entries()) {
      const [a, vertex, b] = angle.points.map((name) => this.project(name));

      if (!a || !vertex || !b) continue;

      const d = distance(toVec2(at), toVec2(vertex));

      if (d > near || d < HIT_RADIUS_PX * 0.3) continue;

      const inside = angleBetween(toVec2(vertex), toVec2(a), toVec2(at)) + angleBetween(toVec2(vertex), toVec2(at), toVec2(b))
        <= angleBetween(toVec2(vertex), toVec2(a), toVec2(b)) + 1;

      if (inside && (best === null || d < best.d)) best = { index, d };
    }

    return best === null ? null : best.index;
  }

  /** Сечение выбирается кликом внутри его контура; из нескольких берётся последнее — оно сверху. */
  private sectionAt(at: SvgPoint): number | null {
    for (let index = this.state.sections.length - 1; index >= 0; index -= 1) {
      const polygon = this.state.sections[index].vertices.map((name) => this.project(name)).filter((point): point is SvgPoint => point !== null);

      if (polygon.length >= 3 && insidePolygon(at, polygon)) return index;
    }

    return null;
  }

  /** Что под курсором, в порядке приоритета: вершина, угол, ребро, сечение. */
  private hitAt(at: SvgPoint): Selection {
    const vertex = this.vertexAt(at);

    if (vertex) return { type: 'vertex', id: vertex };

    const angle = this.angleAt(at);

    if (angle !== null) return { type: 'angle', index: angle };

    const index = this.edgeAt(at);

    if (index !== null) return { type: 'edge', index };

    const section = this.sectionAt(at);

    return section === null ? null : { type: 'section', index: section };
  }

  // ------------------------------------------------------------- указатель

  private readonly onPointerDown = (info: PointerInfo): void => {
    if (info.button === 2) {
      this.rotation = { x: info.event.clientX, y: info.event.clientY, recorded: false };

      return;
    }

    if (info.button !== 0) return;

    switch (this.tool) {
      case 'select':
        this.selection = this.hitAt(info.svg);
        this.render();
        this.renderProperties();
        break;
      case 'point':
        this.addPoint(info);
        break;
      case 'segment':
        this.drawSegment(info);
        break;
      case 'section':
        this.drawSection(info);
        break;
      case 'angle':
        this.drawAngle(info);
        break;
      case 'delete':
        this.selection = this.hitAt(info.svg);
        this.deleteSelection();
        break;
      default:
        break;
    }
  };

  private readonly onPointerMove = (info: PointerInfo): void => {
    if (this.rotation) {
      const dx = info.event.clientX - this.rotation.x;
      const dy = info.event.clientY - this.rotation.y;

      if (dx === 0 && dy === 0) return;

      // Один снимок на жест: отмена возвращает вид до начала вращения.
      if (!this.rotation.recorded) {
        this.history.record(this.state);
        this.rotation.recorded = true;
      }

      this.rotation.x = info.event.clientX;
      this.rotation.y = info.event.clientY;
      // Фигура следует за курсором: вправо — поворот вправо, вниз — наклон к зрителю.
      this.state.angleZ = wrapDegrees(this.state.angleZ + dx * ROTATION_DEGREES_PER_PX);
      this.state.angleY = clamp(this.state.angleY + dy * ROTATION_DEGREES_PER_PX, -MAX_TILT, MAX_TILT);
      this.render();

      return;
    }

    this.cursor = info.svg;

    if (this.draft.length > 0) this.renderOverlay();
  };

  private readonly onPointerUp = (): void => {
    if (this.rotation?.recorded) this.afterChange();

    this.rotation = null;
  };

  private readonly onDoubleClick = (info: PointerInfo): void => {
    if (this.tool === 'section') {
      this.closeSection();

      return;
    }

    const vertex = this.vertexAt(info.svg);

    if (!vertex) return;

    this.selection = { type: 'vertex', id: vertex };
    this.render();
    this.renderProperties();
    this.properties.querySelector<HTMLInputElement>('input')?.focus();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();

      if (event.shiftKey) this.redo();
      else this.undo();

      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      this.redo();

      return;
    }

    if (event.key === 'Enter' && this.tool === 'section') {
      event.preventDefault();
      this.closeSection();

      return;
    }

    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (this.selection) {
        event.preventDefault();
        this.deleteSelection();
      }

      return;
    }

    if (event.key === 'Escape') {
      this.draft = [];
      this.selection = null;
      this.render();
      this.renderProperties();
    }
  };

  // ----------------------------------------------------------- инструменты

  /** Точка на ребре в доле `t` его проекции под курсором; ребро делится на два. */
  private addPointOnEdge(index: number, at: SvgPoint): string {
    const target = this.state.edges[index];
    const a = this.project(target.from);
    const b = this.project(target.to);
    const from = this.state.vertices[target.from];
    const to = this.state.vertices[target.to];
    const t = a && b ? clamp(projectOnSegment(toVec2(at), toVec2(a), toVec2(b)).t, EDGE_POINT_MIN_T, EDGE_POINT_MAX_T) : 0.5;
    const point: Vec3 = [0, 1, 2].map((axis) => roundTo(from[axis] + t * (to[axis] - from[axis]))) as Vec3;
    const name = nextVertexName(this.state.vertices);

    this.commit((state) => {
      state.vertices[name] = point;
      state.labels[name] = EDGE_POINT_LABEL;
      state.edges.splice(index, 1, { ...target, to: name }, { ...target, from: name });
    });

    return name;
  }

  /** Точка в пустоте: обратная проекция курсора на плоскость z = 0 с прилипанием к полуклеткам. */
  private addGroundPoint(info: PointerInfo): string {
    const ground = unprojectToGround(info.world, this.state.angleY, this.state.angleZ);
    const [x, y] = info.shift ? ground : snapToGrid(ground, GROUND_STEP);
    const name = nextVertexName(this.state.vertices);

    this.commit((state) => {
      state.vertices[name] = [roundTo(x), roundTo(y), 0];
      state.labels[name] = GROUND_POINT_LABEL;
    });

    return name;
  }

  /** Вершина под курсором, иначе новая: на ребре или на плоскости z = 0. */
  private pickOrCreateVertex(info: PointerInfo): string {
    const existing = this.vertexAt(info.svg);

    if (existing) return existing;

    const index = this.edgeAt(info.svg);

    return index === null ? this.addGroundPoint(info) : this.addPointOnEdge(index, info.svg);
  }

  private addPoint(info: PointerInfo): void {
    const existing = this.vertexAt(info.svg);

    if (existing) {
      this.selection = { type: 'vertex', id: existing };
      this.render();
      this.renderProperties();

      return;
    }

    const name = this.pickOrCreateVertex(info);

    this.selection = { type: 'vertex', id: name };
    this.render();
    this.renderProperties();
  }

  private drawSegment(info: PointerInfo): void {
    const name = this.pickOrCreateVertex(info);

    if (this.draft.length === 0) {
      this.draft = [name];
      this.renderOverlay();

      return;
    }

    const [from] = this.draft;

    this.draft = [];

    if (from === name) {
      this.renderOverlay();

      return;
    }

    this.commit((state) => {
      const existing = state.edges.findIndex((target) => (target.from === from && target.to === name) || (target.from === name && target.to === from));

      if (existing === -1) state.edges.push({ from, to: name, style: 'solid' });

      this.selection = { type: 'edge', index: existing === -1 ? state.edges.length - 1 : existing };
    });
  }

  private drawSection(info: PointerInfo): void {
    const vertex = this.vertexAt(info.svg);

    if (!vertex) return;

    // Повторный клик по выбранной вершине замыкает контур, как двойной клик или Enter.
    if (this.draft.includes(vertex)) {
      if (this.draft.length >= 3) this.closeSection();

      return;
    }

    this.draft.push(vertex);
    this.renderOverlay();
  }

  /** Замыкает контур сечения; с двумя и менее вершинами черновик остаётся — набирать дальше. */
  private closeSection(): void {
    if (this.draft.length < 3) return;

    const vertices = [...this.draft];

    this.draft = [];
    this.commit((state) => {
      state.sections.push({ vertices, fill: SECTION_FILLS[0].value, stroke: SECTION_STROKE });
      this.selection = { type: 'section', index: state.sections.length - 1 };
    });
  }

  private drawAngle(info: PointerInfo): void {
    const vertex = this.vertexAt(info.svg);

    if (!vertex || this.draft.includes(vertex)) return;

    this.draft.push(vertex);

    if (this.draft.length < 3) {
      this.render();

      return;
    }

    const points = [...this.draft] as [string, string, string];

    this.draft = [];
    this.addAngle(points);
  }

  /** Прямой угол — сразу уголком: его в стереометрии отмечают чаще всего. */
  private addAngle(points: [string, string, string]): void {
    this.commit((state) => {
      const degrees = angle3d(state.vertices[points[1]], state.vertices[points[0]], state.vertices[points[2]]);

      state.angles.push({ points, style: Math.abs(degrees - 90) < RIGHT_ANGLE_TOLERANCE ? 'right' : 'single' });
      this.selection = { type: 'angle', index: state.angles.length - 1 };
    });
  }

  private deleteSelection(): void {
    const { selection } = this;

    if (!selection) return;

    this.commit((state) => {
      switch (selection.type) {
        case 'vertex': {
          const { id } = selection;

          delete state.vertices[id];
          delete state.labels[id];
          state.edges = state.edges.filter((target) => target.from !== id && target.to !== id);
          state.angles = state.angles.filter((angle) => !angle.points.includes(id));
          state.cylinders = state.cylinders.filter((cylinder) => cylinder.base !== id && cylinder.top !== id);
          // Сечение без одной вершины остаётся, пока в нём есть хотя бы треугольник.
          state.sections = state.sections
            .map((section) => ({ ...section, vertices: section.vertices.filter((name) => name !== id) }))
            .filter((section) => section.vertices.length >= 3);
          break;
        }
        case 'edge':
          state.edges.splice(selection.index, 1);
          break;
        case 'section':
          state.sections.splice(selection.index, 1);
          break;
        case 'angle':
          state.angles.splice(selection.index, 1);
          break;
        default:
          break;
      }
    });
    this.selection = null;
    this.render();
    this.renderProperties();
  }

  // --------------------------------------------------------- панель свойств

  private renderProperties(): void {
    const { selection, state, t } = this;

    this.properties.replaceChildren();

    if (!selection) {
      this.renderViewProperties();

      return;
    }

    const titleKey = selection.type === 'section' ? 'drawings_stereo_selected_section' : `drawings_selected_${selection.type}`;

    this.properties.appendChild(el('h4', { class: 'rte-builder__props-title', text: t(titleKey) }));

    if (selection.type === 'vertex') {
      this.renderVertexProperties(selection.id);
    } else if (selection.type === 'edge') {
      const target = state.edges[selection.index];

      if (!target) return;

      const style = selectControl(
        [
          { value: 'solid', label: t('drawings_style_solid') },
          { value: 'dashed', label: t('drawings_style_dashed') },
        ],
        target.style,
      );

      this.properties.appendChild(propertyField(t('drawings_prop_style'), style));
      on(style, 'change', () => {
        this.commit((draft) => {
          draft.edges[selection.index].style = style.value === 'dashed' ? 'dashed' : 'solid';
        });
      });
    } else if (selection.type === 'section') {
      const section = state.sections[selection.index];

      if (!section) return;

      const current = section.fill ?? SECTION_FILLS[0].value;
      const options = SECTION_FILLS.map((fill) => ({ value: fill.value, label: t(fill.labelKey) }));

      if (!SECTION_FILLS.some((fill) => fill.value === current)) options.push({ value: current, label: t('drawings_stereo_fill_custom') });

      const fill = selectControl(options, current);

      this.properties.appendChild(propertyField(t('drawings_stereo_prop_fill'), fill));
      on(fill, 'change', () => {
        this.commit((draft) => {
          draft.sections[selection.index].fill = fill.value;
        });
      });
    } else if (selection.type === 'angle') {
      const angle = state.angles[selection.index];

      if (!angle) return;

      const style = selectControl(ANGLE_STYLES.map((value) => ({ value, label: t(`drawings_angle_${value}`) })), angle.style);
      const label = el('input', { class: 'rte-input', attrs: { type: 'text', value: angle.label ?? '', placeholder: '30°' } });

      this.properties.append(propertyField(t('drawings_prop_style'), style), propertyField(t('drawings_prop_label'), label));
      on(style, 'change', () => {
        this.commit((draft) => {
          draft.angles[selection.index].style = style.value as AngleStyle;
        });
      });
      on(label, 'change', () => {
        this.commit((draft) => {
          const text = label.value.trim();

          if (text) draft.angles[selection.index].label = text;
          else delete draft.angles[selection.index].label;
        });
      });
    }

    const remove = el('button', { class: 'rte-button rte-button--danger rte-builder__remove', attrs: { type: 'button' }, text: t('drawings_remove_selected') });

    on(remove, 'click', () => this.deleteSelection());
    this.properties.appendChild(remove);
  }

  /** Ничего не выбрано: повороты, сетка и оси; у инструмента угла — ввод вершин текстом. */
  private renderViewProperties(): void {
    const { state, t } = this;

    this.properties.appendChild(el('h4', { class: 'rte-builder__props-title', text: t('drawings_stereo_view') }));

    const tilt = el('input', {
      class: 'rte-input',
      attrs: { type: 'number', step: '5', min: String(-MAX_TILT), max: String(MAX_TILT), value: String(roundTo(state.angleY)), 'data-prop': 'angleY' },
    });
    const turn = el('input', { class: 'rte-input', attrs: { type: 'number', step: '5', value: String(roundTo(state.angleZ)), 'data-prop': 'angleZ' } });

    this.properties.append(propertyField(t('drawings_stereo_prop_angle_y'), tilt), propertyField(t('drawings_stereo_prop_angle_z'), turn));
    on(tilt, 'change', () => {
      const value = Number(tilt.value);

      if (!Number.isFinite(value)) return;

      this.commit((draft) => {
        draft.angleY = clamp(value, -MAX_TILT, MAX_TILT);
      });
    });
    on(turn, 'change', () => {
      const value = Number(turn.value);

      if (!Number.isFinite(value)) return;

      this.commit((draft) => {
        draft.angleZ = wrapDegrees(value);
      });
    });

    const checkbox = (label: string, checked: boolean, toggle: () => void): HTMLElement => {
      const input = el('input', { attrs: { type: 'checkbox' } });

      input.checked = checked;
      on(input, 'change', toggle);

      return el('label', { class: 'rte-stereo__check', children: [input, el('span', { text: label })] });
    };

    this.properties.append(
      checkbox(t('drawings_grid'), state.showGrid, () => this.toggleGrid()),
      checkbox(t('drawings_stereo_axes'), state.showAxes, () => this.toggleAxes()),
    );

    if (this.tool !== 'angle') return;

    const input = el('input', {
      class: 'rte-input rte-stereo__angle-input',
      attrs: { type: 'text', placeholder: 'SOH', maxlength: 12, autocomplete: 'off', spellcheck: 'false' },
    });
    const note = el('p', { class: 'rte-stereo__note', text: t('drawings_stereo_angle_input_hint') });

    this.properties.append(propertyField(t('drawings_stereo_prop_angle_input'), input), note);
    on(input, 'change', () => {
      const points = parseAngleVertices(input.value, Object.keys(this.state.vertices));

      if (!points) {
        input.setAttribute('aria-invalid', 'true');
        note.textContent = t('drawings_stereo_angle_input_invalid');
        note.classList.add('rte-stereo__note--error');

        return;
      }

      this.draft = [];
      this.addAngle(points);
    });
  }

  private renderVertexProperties(id: string): void {
    const { state, t } = this;
    const point = state.vertices[id];

    if (!point) return;

    const nameInput = el('input', { class: 'rte-input', attrs: { type: 'text', value: id, maxlength: 4 } });
    const position = selectControl(
      LABEL_POSITIONS.map((value) => ({ value, label: t(`drawings_position_${value.replace(' ', '_')}`) })),
      state.labels[id] ?? 'above',
    );

    this.properties.append(propertyField(t('drawings_prop_name'), nameInput), propertyField(t('drawings_prop_position'), position));
    on(nameInput, 'change', () => this.renameVertex(id, nameInput.value.trim()));
    on(position, 'change', () => {
      this.commit((draft) => {
        draft.labels[id] = position.value;
      });
    });

    const axisKeys = ['drawings_stereo_prop_x', 'drawings_stereo_prop_y', 'drawings_stereo_prop_z'];
    const coords = el('div', {
      class: 'rte-stereo__coords',
      children: axisKeys.map((key, axis) => {
        const input = el('input', {
          class: 'rte-input',
          attrs: { type: 'number', step: '0.5', value: String(roundTo(point[axis])), 'data-axis': ['x', 'y', 'z'][axis] },
        });

        on(input, 'change', () => {
          const value = Number(input.value);

          if (!Number.isFinite(value)) return;

          this.commit((draft) => {
            const target = draft.vertices[id];

            if (target) target[axis] = roundTo(value);
          });
        });

        return propertyField(t(key), input);
      }),
    });

    this.properties.appendChild(coords);
  }

  /** Переименование точки тянет за собой рёбра, углы, сечения, цилиндры и подпись. */
  private renameVertex(from: string, to: string): void {
    if (!to || to === from || to in this.state.vertices) {
      this.renderProperties();

      return;
    }

    this.commit((state) => {
      state.vertices[to] = state.vertices[from];
      delete state.vertices[from];

      if (state.labels[from]) {
        state.labels[to] = state.labels[from];
        delete state.labels[from];
      }

      const rename = (name: string): string => (name === from ? to : name);

      state.edges.forEach((target) => {
        target.from = rename(target.from);
        target.to = rename(target.to);
      });
      state.angles.forEach((angle) => {
        angle.points = angle.points.map(rename) as [string, string, string];
      });
      state.sections.forEach((section) => {
        section.vertices = section.vertices.map(rename);
      });
      state.cylinders.forEach((cylinder) => {
        cylinder.base = rename(cylinder.base);
        cylinder.top = rename(cylinder.top);
      });
      this.selection = { type: 'vertex', id: to };
    });
  }
}

export const stereometryEditorFactory: SceneEditorFactory = {
  id: 'stereometry',
  kind: 'geometry',
  labelKey: 'drawings_tab_stereometry',
  accepts: (scene) => normalizeGeometryScene(scene).type === '3d',
  create: (context) => new StereometryEditor(context),
};
