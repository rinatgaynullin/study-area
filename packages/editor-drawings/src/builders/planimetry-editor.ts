import { createDisposer, el, on, type Translate, type Unsubscribe } from '@rich-editor/core';
import { resolveGeometryViewport, renderGeometrySvg } from '../render/geometry-svg';
import { fmt } from '../render/svg-builder';
import { normalizeGeometryScene } from '../scene/normalize';
import type { AngleStyle, GeometryHighlight, GeometryScene, GeometryTextLabel, Vec2 } from '../scene/types';
import {
  angleBetween,
  distance,
  distanceToSegment,
  formatAngleMeasure,
  isAngleMeasureLabel,
  nearestOnCircle,
  projectOnSegment,
  roundPoint,
  roundTo,
  snapToGrid,
} from './geometry-utils';
import { HistoryStack, cloneScene } from './history';
import { ChangeEmitter, isCancelled, SketchCanvas, type PointerInfo } from './sketch-canvas';
import { checkField, numberField, propsEmpty, propsTitle, selectField, textField } from './fields';
import { ToolBar, actionButton, type ToolButton } from './tool-bar';
import type { RawScene, SceneEditor, SceneEditorContext, SceneEditorFactory } from './types';

type Tool = 'select' | 'point' | 'segment' | 'circle' | 'angle' | 'ticks' | 'text' | 'delete';

const TOOLS: ToolButton<Tool>[] = [
  { id: 'select', labelKey: 'drawings_tool_select', icon: 'select' },
  { id: 'point', labelKey: 'drawings_tool_point', icon: 'point' },
  { id: 'segment', labelKey: 'drawings_tool_segment', icon: 'segment' },
  { id: 'circle', labelKey: 'drawings_tool_circle', icon: 'circle' },
  { id: 'angle', labelKey: 'drawings_tool_angle', icon: 'angle' },
  { id: 'ticks', labelKey: 'drawings_tool_ticks', icon: 'ticks' },
  { id: 'text', labelKey: 'drawings_tool_text', icon: 'text' },
  { id: 'delete', labelKey: 'drawings_tool_delete', icon: 'delete' },
];

const CANVAS_WIDTH = 560;
const CANVAS_HEIGHT = 420;
const GRID_STEP = 0.5;
const LABEL_POSITIONS = ['above', 'below', 'left', 'right', 'above left', 'above right', 'below left', 'below right'];
const ANGLE_STYLES: AngleStyle[] = ['single', 'double', 'triple', 'right'];

interface Circle {
  id: string;
  centerVertex: string;
  radius: number;
  label?: string;
  color?: string;
}

/** Что выбрано на полотне. */
type Selection =
  | { type: 'vertex'; id: string }
  | { type: 'edge'; index: number }
  | { type: 'angle'; index: number }
  | { type: 'circle'; index: number }
  | { type: 'text'; index: number }
  | null;

/** Угол в состоянии конструктора. */
interface PlanimetryAngle {
  points: [string, string, string];
  style: AngleStyle;
  label?: string;
  /** Подпись — величина угла, конструктор пересчитывает её сам. В сцену не пишется, в истории есть. */
  measured: boolean;
}

/** Живая сцена конструктора: подмножество `GeometryScene` для плоскости плюс всё чужое как есть. */
interface PlanimetryState {
  vertices: Record<string, Vec2>;
  edges: Array<{ from: string; to: string; style: 'solid' | 'dashed'; ticks?: number }>;
  angles: PlanimetryAngle[];
  labels: Record<string, string>;
  textLabels: GeometryTextLabel[];
  circles: Circle[];
  showGrid: boolean;
  /** Поля сцены, которых конструктор не знает: уходят обратно нетронутыми. */
  extra: RawScene;
}

const KNOWN_KEYS = new Set(['type', 'vertices', 'edges', 'angles', 'labels', 'text_labels', 'plots', 'circle', 'circles', 'markings', 'showGrid', 'scale', 'offsetX', 'offsetY']);

/** Следующее свободное имя точки: A…Z, потом A1, B1… */
const nextVertexName = (used: Record<string, unknown>, preferred?: string): string => {
  if (preferred && !(preferred in used)) return preferred;

  for (let round = 0; round < 10; round += 1) {
    for (let code = 65; code <= 90; code += 1) {
      const name = `${String.fromCharCode(code)}${round === 0 ? '' : round}`;

      if (!(name in used)) return name;
    }
  }

  return `P${Object.keys(used).length + 1}`;
};

/** Величина угла в градусах; `null`, если какой-то из трёх точек нет. */
const angleMeasure = (points: [string, string, string], vertices: Record<string, Vec2>): number | null => {
  const [a, vertex, b] = points.map((name) => vertices[name]);

  return a && vertex && b ? angleBetween(vertex, a, b) : null;
};

let circleCount = 0;

/**
 * Конструктор планиметрии: точки, отрезки, окружности, углы, засечки и
 * подписи с прилипанием к сетке, отрезкам и окружностям.
 *
 * Инструмент, черновик, выделение, история и сцена — общее состояние
 * обработчиков указателя, клавиатуры и панели свойств, поэтому класс.
 */
class PlanimetryEditor implements SceneEditor {
  readonly element: HTMLElement;

  private readonly t: Translate;

  private readonly disposer = createDisposer();

  private readonly changes = new ChangeEmitter();

  private readonly history = new HistoryStack<PlanimetryState>();

  private readonly canvas: SketchCanvas;

  private readonly tools: ToolBar<Tool>;

  private readonly hint: HTMLElement;

  private readonly properties: HTMLElement;

  private state: PlanimetryState = PlanimetryEditor.emptyState();

  private tool: Tool = 'select';

  private currentSelection: Selection = null;

  /** Какой конец отрезка двигает поле «Длина»; не часть сцены и истории, при смене выделения — `to`. */
  private lengthEnd: 'from' | 'to' = 'to';

  /** Точки, уже выбранные текущим инструментом: начало отрезка, центр, стороны угла. */
  private draft: string[] = [];

  private cursor: Vec2 | null = null;

  private drag: { id: string; moved: boolean } | null = null;

  private get selection(): Selection {
    return this.currentSelection;
  }

  private set selection(value: Selection) {
    this.currentSelection = value;
    this.lengthEnd = 'to';
  }

  constructor(context: SceneEditorContext) {
    this.t = context.t;

    this.canvas = new SketchCanvas({
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      scale: 40,
      onPointerDown: this.onPointerDown,
      onPointerMove: this.onPointerMove,
      onPointerUp: this.onPointerUp,
      onDoubleClick: this.onDoubleClick,
      onKeyDown: this.onKeyDown,
      onViewportChange: () => this.render(),
      canPanFrom: this.canPanFrom,
      grabOnHover: () => this.tool === 'select',
    });

    this.tools = new ToolBar<Tool>({ t: this.t, tools: TOOLS, onSelect: (tool) => this.setTool(tool) });

    const actions = el('div', {
      class: 'rte-builder__actions',
      children: [
        actionButton(this.t('drawings_undo'), 'undo', () => this.undo()),
        actionButton(this.t('drawings_redo'), 'redo', () => this.redo()),
        actionButton(this.t('drawings_grid'), 'grid', () => this.toggleGrid()),
        actionButton(this.t('drawings_zoom_in'), 'zoomIn', () => this.canvas.zoomBy(1.25)),
        actionButton(this.t('drawings_zoom_out'), 'zoomOut', () => this.canvas.zoomBy(0.8)),
        actionButton(this.t('drawings_zoom_reset'), 'fit', () => this.fitView()),
      ],
    });

    this.hint = el('p', { class: 'rte-builder__hint', attrs: { role: 'status' } });
    this.properties = el('div', { class: 'rte-builder__props', attrs: { 'aria-live': 'polite' } });

    this.element = el('div', {
      class: 'rte-builder rte-builder--planimetry',
      children: [
        el('div', { class: 'rte-builder__bar', children: [this.tools.element, actions] }),
        el('div', {
          class: 'rte-builder__body',
          children: [el('div', { class: 'rte-builder__stage', children: [this.canvas.element] }), this.properties],
        }),
        this.hint,
      ],
    });

    this.setTool('select');
    this.renderProperties();
    this.render();
  }

  static emptyState(): PlanimetryState {
    return { vertices: {}, edges: [], angles: [], labels: {}, textLabels: [], circles: [], showGrid: true, extra: {} };
  }

  // ----------------------------------------------------------- SceneEditor

  load(raw: RawScene): void {
    const scene = normalizeGeometryScene(raw);
    const vertices: Record<string, Vec2> = {};

    Object.entries(scene.vertices).forEach(([name, point]) => {
      vertices[name] = [point[0], point[1]];
    });

    const circles: Circle[] = [];
    const foreignPlots: unknown[] = [];

    scene.plots.forEach((plot) => {
      if (plot.type !== 'circle') {
        foreignPlots.push(plot);

        return;
      }

      // Центр окружности — точка сцены: так её можно двигать вместе с окружностью.
      let center = plot.centerVertex;

      if (!center || !(center in vertices)) {
        center = Object.entries(vertices).find(([, vertex]) => distance(vertex, plot.center) < 0.01)?.[0] ?? nextVertexName(vertices, 'O');
        vertices[center] = [plot.center[0], plot.center[1]];
      }

      circleCount += 1;
      circles.push({ id: plot.id ?? `circle_${circleCount}`, centerVertex: center, radius: plot.radius, label: plot.label, color: plot.color });
    });

    const extra: RawScene = {};

    Object.entries(raw).forEach(([key, value]) => {
      if (!KNOWN_KEYS.has(key)) extra[key] = value;
    });

    if (foreignPlots.length > 0) extra.plots = foreignPlots;

    this.state = {
      vertices,
      edges: scene.edges.map((edge) => ({ from: edge.from, to: edge.to, style: edge.style, ...(edge.ticks ? { ticks: edge.ticks } : {}) })),
      // Подпись, совпадающая с величиной, дальше ведётся сама; чужая («α», «45°» не в масштабе) — нет.
      angles: scene.angles.map((angle) => {
        const points = [...angle.points] as [string, string, string];
        const degrees = angleMeasure(points, vertices);

        return { points, style: angle.style, label: angle.label, measured: degrees !== null && isAngleMeasureLabel(angle.label, degrees) };
      }),
      labels: { ...scene.labels },
      textLabels: scene.textLabels.map((label) => ({ ...label })),
      circles,
      showGrid: scene.showGrid,
      extra,
    };
    this.history.clear();
    this.selection = null;
    this.draft = [];
    this.drag = null;
    // Жест, начатый над прежней сценой, в новую не переходит.
    this.canvas.resetGestures();
    this.fitView();
  }

  getScene(): RawScene {
    const { state } = this;
    const scene: RawScene = {
      ...state.extra,
      type: '2d',
      vertices: Object.fromEntries(Object.entries(state.vertices).map(([name, point]) => [name, roundPoint(point)])),
      edges: state.edges.map((edge) => ({ from: edge.from, to: edge.to, style: edge.style, ...(edge.ticks ? { ticks: edge.ticks } : {}) })),
    };

    if (state.angles.length > 0) scene.angles = state.angles.map((angle) => ({ points: angle.points, style: angle.style, ...(angle.label ? { label: angle.label } : {}) }));

    if (Object.keys(state.labels).length > 0) scene.labels = { ...state.labels };

    if (state.textLabels.length > 0) scene.text_labels = state.textLabels.map((label) => ({ ...label }));

    const plots = [
      ...state.circles.map((circle) => ({
        type: 'circle',
        id: circle.id,
        centerVertex: circle.centerVertex,
        center: roundPoint(state.vertices[circle.centerVertex] ?? [0, 0]),
        radius: roundTo(circle.radius),
        ...(circle.label ? { label: circle.label } : {}),
        ...(circle.color ? { color: circle.color } : {}),
      })),
      ...((state.extra.plots as unknown[] | undefined) ?? []),
    ];

    if (plots.length > 0) scene.plots = plots;

    if (!state.showGrid) scene.showGrid = false;

    // Точка на отрезке делит его при сохранении — так ждёт TikZ. Нормализация
    // режет рёбра сама; остаётся забрать результат.
    const normalized = normalizeGeometryScene(scene);

    scene.edges = normalized.edges.map((edge) => ({ from: edge.from, to: edge.to, style: edge.style, ...(edge.ticks ? { ticks: edge.ticks } : {}) }));

    return scene;
  }

  onChange(listener: () => void): Unsubscribe {
    return this.changes.on(listener);
  }

  focus(): void {
    this.canvas.focus();
  }

  /** Escape: черновик и выделение — прочь, инструмент — «Выбрать». */
  cancel(): void {
    // Перетаскивание, уже сдвинувшее точку, откатывается: точка — на прежнем месте, шага истории нет.
    this.cancelDrag();
    this.canvas.cancelPan();
    this.selection = null;
    this.setTool('select');
    this.render();
    this.renderProperties();
  }

  destroy(): void {
    this.disposer.dispose();
    this.changes.clear();
    this.tools.destroy();
    this.canvas.destroy();
    this.element.remove();
  }

  // --------------------------------------------------------------- рендер

  /** Сцена для рендера: окно просмотра полотна вместо autoFit. */
  private renderScene(): GeometryScene {
    const { viewport } = this.canvas;
    const raw = this.getScene();

    return {
      ...normalizeGeometryScene(raw),
      scale: viewport.scale,
      offsetX: viewport.cx - CANVAS_WIDTH / 2,
      offsetY: viewport.cy - CANVAS_HEIGHT / 2,
      showGrid: this.state.showGrid,
    };
  }

  private highlight(): GeometryHighlight | null {
    const { selection, state } = this;

    if (!selection) return null;

    switch (selection.type) {
      case 'vertex':
        return { type: 'vertex', id: selection.id };
      case 'edge': {
        const edge = state.edges[selection.index];

        return edge ? { type: 'edge', from: edge.from, to: edge.to } : null;
      }
      case 'angle': {
        const angle = state.angles[selection.index];

        return angle ? { type: 'angle', id: `angle_${angle.points.join('')}` } : null;
      }
      case 'circle': {
        const circle = state.circles[selection.index];

        return circle ? { type: 'circle_plot', id: circle.id } : null;
      }
      default:
        return null;
    }
  }

  private render(): void {
    this.canvas.setScene(renderGeometrySvg(this.renderScene(), { width: CANVAS_WIDTH, height: CANVAS_HEIGHT, highlight: this.highlight() }));
    this.renderOverlay();
  }

  /** Черновик текущего инструмента: линия к курсору, кружки выбранных точек. */
  private renderOverlay(): void {
    const parts: string[] = [];

    this.draft.forEach((name) => {
      const point = this.state.vertices[name];

      if (!point) return;

      const at = this.canvas.toSvg(point);

      parts.push(`<circle cx="${fmt(at.x)}" cy="${fmt(at.y)}" r="9" fill="none" stroke="#8b5cf6" stroke-width="2" stroke-dasharray="3 3" />`);
    });

    const [anchorName] = this.draft;
    const anchor = anchorName === undefined ? undefined : this.state.vertices[anchorName];

    if (this.cursor && anchor && (this.tool === 'segment' || this.tool === 'circle')) {
      const from = this.canvas.toSvg(anchor);
      const to = this.canvas.toSvg(this.cursor);

      if (this.tool === 'segment') {
        parts.push(`<line x1="${fmt(from.x)}" y1="${fmt(from.y)}" x2="${fmt(to.x)}" y2="${fmt(to.y)}" stroke="#8b5cf6" stroke-width="1.5" stroke-dasharray="4 3" />`);
      } else {
        const radius = distance(anchor, this.cursor) * this.canvas.viewport.scale;

        parts.push(`<circle cx="${fmt(from.x)}" cy="${fmt(from.y)}" r="${fmt(radius)}" fill="none" stroke="#8b5cf6" stroke-width="1.5" stroke-dasharray="4 3" />`);
      }
    }

    this.canvas.setOverlay(parts.join(''));
  }

  private fitView(): void {
    const scene = normalizeGeometryScene(this.getScene());
    const viewport = resolveGeometryViewport(scene, { width: CANVAS_WIDTH, height: CANVAS_HEIGHT, autoFit: true });

    this.canvas.setViewport(Object.keys(scene.vertices).length > 0 ? viewport : { scale: 40, cx: CANVAS_WIDTH / 2, cy: CANVAS_HEIGHT / 2 });
  }

  // ------------------------------------------------------------ изменения

  private commit(mutate: (state: PlanimetryState) => void): void {
    this.history.record(this.state);
    mutate(this.state);
    this.afterChange();
  }

  private afterChange(): void {
    this.splitEdgesInState();
    this.measureAngles();
    this.render();
    this.renderProperties();
    this.changes.emit();
  }

  /** Точка, поставленная на отрезок, делит его сразу: клики и подписи видят уже две стороны. */
  private splitEdgesInState(): void {
    const normalized = normalizeGeometryScene({ type: '2d', vertices: this.state.vertices, edges: this.state.edges });

    if (normalized.edges.length !== this.state.edges.length) {
      this.state.edges = normalized.edges.map((edge) => ({ from: edge.from, to: edge.to, style: edge.style, ...(edge.ticks ? { ticks: edge.ticks } : {}) }));
    }
  }

  /** Подписи-величины углов следуют за геометрией; чужие подписи и углы без точек не трогаем. */
  private measureAngles(): void {
    this.state.angles.forEach((angle) => {
      const degrees = angle.measured ? angleMeasure(angle.points, this.state.vertices) : null;

      if (degrees !== null) angle.label = formatAngleMeasure(degrees);
    });
  }

  private undo(): void {
    const previous = this.history.undo(this.state);

    if (!previous) return;

    // Отмена посреди перетаскивания его заканчивает: снимок жеста уже ушёл в повтор.
    this.drag = null;
    this.state = previous;
    this.selection = null;
    this.afterChange();
  }

  private redo(): void {
    const next = this.history.redo(this.state);

    if (!next) return;

    this.drag = null;
    this.state = next;
    this.selection = null;
    this.afterChange();
  }

  private toggleGrid(): void {
    this.commit((state) => {
      state.showGrid = !state.showGrid;
    });
  }

  private setTool(tool: Tool): void {
    this.tool = tool;
    this.draft = [];
    this.tools.setActive(tool);
    this.hint.textContent = this.t(`drawings_hint_${tool}`);
    this.renderOverlay();
  }

  // ------------------------------------------------------------- хит-тест

  private vertexAt(point: Vec2): string | null {
    const radius = this.canvas.hitRadius;
    let best: { name: string; d: number } | null = null;

    for (const [name, vertex] of Object.entries(this.state.vertices)) {
      const d = distance(point, vertex);

      if (d <= radius && (best === null || d < best.d)) best = { name, d };
    }

    return best === null ? null : best.name;
  }

  private edgeAt(point: Vec2): number | null {
    const radius = this.canvas.hitRadius;
    let best: { index: number; d: number } | null = null;

    for (const [index, edge] of this.state.edges.entries()) {
      const a = this.state.vertices[edge.from];
      const b = this.state.vertices[edge.to];

      if (!a || !b) continue;

      const d = distanceToSegment(point, a, b);

      if (d <= radius && (best === null || d < best.d)) best = { index, d };
    }

    return best === null ? null : best.index;
  }

  private circleAt(point: Vec2): number | null {
    const radius = this.canvas.hitRadius;
    let best: { index: number; d: number } | null = null;

    for (const [index, circle] of this.state.circles.entries()) {
      const center = this.state.vertices[circle.centerVertex];

      if (!center) continue;

      const d = Math.abs(distance(point, center) - circle.radius);

      if (d <= radius && (best === null || d < best.d)) best = { index, d };
    }

    return best === null ? null : best.index;
  }

  /** Угол выбирается кликом рядом с его дугой: внутри сектора, недалеко от вершины. */
  private angleAt(point: Vec2): number | null {
    const near = this.canvas.hitRadius * 2.5;
    let best: { index: number; d: number } | null = null;

    for (const [index, angle] of this.state.angles.entries()) {
      const [a, vertex, b] = angle.points.map((name) => this.state.vertices[name]);

      if (!a || !vertex || !b) continue;

      const d = distance(point, vertex);

      if (d > near || d < this.canvas.hitRadius * 0.3) continue;

      const inside = angleBetween(vertex, a, point) + angleBetween(vertex, point, b) <= angleBetween(vertex, a, b) + 1;

      if (inside && (best === null || d < best.d)) best = { index, d };
    }

    return best === null ? null : best.index;
  }

  /** Точка с прилипанием: к точке, к отрезку, к окружности, к сетке. */
  private snap(point: Vec2, info: PointerInfo, ignore?: string): Vec2 {
    if (info.shift) return point;

    const radius = this.canvas.hitRadius;
    let best: { point: Vec2; d: number } | null = null;

    for (const edge of this.state.edges) {
      if (edge.from === ignore || edge.to === ignore) continue;

      const a = this.state.vertices[edge.from];
      const b = this.state.vertices[edge.to];

      if (!a || !b) continue;

      const projected = projectOnSegment(point, a, b).point;
      const d = distance(point, projected);

      if (d <= radius && (best === null || d < best.d)) best = { point: projected, d };
    }

    for (const circle of this.state.circles) {
      if (circle.centerVertex === ignore) continue;

      const center = this.state.vertices[circle.centerVertex];

      if (!center) continue;

      const nearest = nearestOnCircle(point, center, circle.radius);
      const d = distance(point, nearest);

      if (d <= radius && (best === null || d < best.d)) best = { point: nearest, d };
    }

    return best === null ? snapToGrid(point, GRID_STEP) : roundPoint(best.point);
  }

  /** Существующая точка под курсором или новая в месте клика. */
  private pickOrCreateVertex(info: PointerInfo, preferred?: string): string {
    const existing = this.vertexAt(info.world);

    if (existing) return existing;

    const name = nextVertexName(this.state.vertices, preferred);

    this.commit((state) => {
      state.vertices[name] = this.snap(info.world, info);
    });

    return name;
  }

  // ------------------------------------------------------------- указатель

  /** С пустого места протяжка двигает лист в любом инструменте: ни один не рисует протяжкой. */
  private readonly canPanFrom = (info: PointerInfo): boolean =>
    this.vertexAt(info.world) === null && this.angleAt(info.world) === null && this.edgeAt(info.world) === null && this.circleAt(info.world) === null;

  private readonly onPointerDown = (info: PointerInfo): void => {
    if (info.button !== 0) return;

    switch (this.tool) {
      case 'select':
        this.selectAt(info);
        break;
      case 'point':
        this.pickOrCreateVertex(info);
        break;
      case 'segment':
        this.drawSegment(info);
        break;
      case 'circle':
        this.drawCircle(info);
        break;
      case 'angle':
        this.drawAngle(info);
        break;
      case 'ticks':
        this.cycleTicks(info);
        break;
      case 'text':
        this.addText(info);
        break;
      case 'delete':
        this.deleteAt(info);
        break;
      default:
        break;
    }
  };

  private readonly onPointerMove = (info: PointerInfo): void => {
    this.cursor = info.world;

    if (this.drag) {
      const { id } = this.drag;

      if (!this.drag.moved) {
        this.history.record(this.state);
        this.drag.moved = true;
      }

      this.state.vertices[id] = this.snap(info.world, info, id);
      // Величины углов меняются вместе с точкой, не дожидаясь отпускания.
      this.measureAngles();
      this.render();

      return;
    }

    if (this.draft.length > 0) this.renderOverlay();
  };

  private readonly onPointerUp = (info: PointerInfo): void => {
    if (isCancelled(info)) {
      this.cancelDrag();

      return;
    }

    this.finishDrag();
  };

  /**
   * Конец перетаскивания, как при отпускании кнопки: объект остаётся там, куда
   * дотащили, его шаг истории остаётся. Зовётся перед клавишей, пишущей свой шаг,
   * чтобы последующий Escape не снял чужой.
   */
  private finishDrag(): void {
    if (this.drag?.moved) this.afterChange();

    this.drag = null;
  }

  /** Отменённое перетаскивание: сцена — из снимка его начала, шаг истории снимается. */
  private cancelDrag(): void {
    const moved = this.drag?.moved === true;

    this.drag = null;

    if (!moved) return;

    const before = this.history.discard();

    if (before) this.state = before;

    this.afterChange();
  }

  private readonly onDoubleClick = (info: PointerInfo): void => {
    const vertex = this.vertexAt(info.world);

    if (!vertex) return;

    this.selection = { type: 'vertex', id: vertex };
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

    // Стрелки без выделения двигают лист на шаг сетки.
    if (!this.selection && !this.drag && !event.ctrlKey && !event.metaKey && !event.altKey && this.canvas.panByKey(event.key, GRID_STEP)) {
      event.preventDefault();

      return;
    }

    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (this.selection) {
        event.preventDefault();
        this.finishDrag();
        this.deleteSelection();
      }

      return;
    }

    if (event.key === 'Escape') {
      // Отмена сделана здесь: диалог по `defaultPrevented` её не повторяет.
      event.preventDefault();
      this.cancel();
    }
  };

  // ----------------------------------------------------------- инструменты

  private selectAt(info: PointerInfo): void {
    const vertex = this.vertexAt(info.world);

    if (vertex) {
      this.selection = { type: 'vertex', id: vertex };
      this.drag = { id: vertex, moved: false };
    } else {
      const angle = this.angleAt(info.world);
      const edge = angle === null ? this.edgeAt(info.world) : null;
      const circle = angle === null && edge === null ? this.circleAt(info.world) : null;

      this.selection =
        angle !== null ? { type: 'angle', index: angle } : edge !== null ? { type: 'edge', index: edge } : circle !== null ? { type: 'circle', index: circle } : null;
    }

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

    if (from === undefined || from === name) {
      this.renderOverlay();

      return;
    }

    this.commit((state) => {
      const exists = state.edges.some((edge) => (edge.from === from && edge.to === name) || (edge.from === name && edge.to === from));

      if (!exists) state.edges.push({ from, to: name, style: 'solid' });
    });
  }

  private drawCircle(info: PointerInfo): void {
    if (this.draft.length === 0) {
      this.draft = [this.pickOrCreateVertex(info, 'O')];
      this.renderOverlay();

      return;
    }

    const [center] = this.draft;

    if (center === undefined) return;

    const centerPoint = this.state.vertices[center];

    if (!centerPoint) return;

    const radius = roundTo(Math.max(0.25, distance(centerPoint, this.snap(info.world, info))), 2);

    this.draft = [];
    circleCount += 1;
    this.commit((state) => {
      state.circles.push({ id: `circle_${circleCount}`, centerVertex: center, radius });
    });
  }

  private drawAngle(info: PointerInfo): void {
    const vertex = this.vertexAt(info.world);

    if (!vertex) return;

    this.draft.push(vertex);

    if (this.draft.length < 3) {
      this.renderOverlay();

      return;
    }

    const points = [...this.draft] as [string, string, string];

    this.draft = [];

    if (new Set(points).size < 3) {
      this.renderOverlay();

      return;
    }

    this.commit((state) => {
      const [a, vertex, b] = points.map((name) => state.vertices[name]);

      if (!a || !vertex || !b) return;

      // Прямой угол — сразу уголком и без подписи: так рисуют чаще всего. Остальные подписаны величиной.
      const degrees = angleBetween(vertex, a, b);

      state.angles.push(
        Math.abs(degrees - 90) < 1.5
          ? { points, style: 'right', measured: false }
          : { points, style: 'single', label: formatAngleMeasure(degrees), measured: true },
      );
      this.selection = { type: 'angle', index: state.angles.length - 1 };
    });
  }

  private cycleTicks(info: PointerInfo): void {
    const index = this.edgeAt(info.world);

    if (index === null) return;

    this.commit((state) => {
      const edge = state.edges[index];

      if (!edge) return;

      edge.ticks = ((edge.ticks ?? 0) + 1) % 5;
    });
  }

  private addText(info: PointerInfo): void {
    const edge = this.edgeAt(info.world);

    if (edge !== null) {
      const segment = this.state.edges[edge];

      if (!segment) return;

      const { from, to } = segment;

      this.commit((state) => {
        state.textLabels.push({ text: '?', position: [from, to], offset: 'right' });
        this.selection = { type: 'text', index: state.textLabels.length - 1 };
      });

      return;
    }

    const point = this.snap(info.world, info);

    this.commit((state) => {
      state.textLabels.push({ text: '?', coords: point });
      this.selection = { type: 'text', index: state.textLabels.length - 1 };
    });
  }

  private deleteAt(info: PointerInfo): void {
    const vertex = this.vertexAt(info.world);

    if (vertex) {
      this.selection = { type: 'vertex', id: vertex };
    } else {
      const angle = this.angleAt(info.world);
      const edge = angle === null ? this.edgeAt(info.world) : null;
      const circle = angle === null && edge === null ? this.circleAt(info.world) : null;

      this.selection =
        angle !== null ? { type: 'angle', index: angle } : edge !== null ? { type: 'edge', index: edge } : circle !== null ? { type: 'circle', index: circle } : null;
    }

    this.deleteSelection();
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
          state.edges = state.edges.filter((edge) => edge.from !== id && edge.to !== id);
          state.angles = state.angles.filter((angle) => !angle.points.includes(id));
          state.circles = state.circles.filter((circle) => circle.centerVertex !== id);
          state.textLabels = state.textLabels.filter((label) => !label.position?.includes(id));
          break;
        }
        case 'edge':
          state.edges.splice(selection.index, 1);
          break;
        case 'angle':
          state.angles.splice(selection.index, 1);
          break;
        case 'circle':
          state.circles.splice(selection.index, 1);
          break;
        case 'text':
          state.textLabels.splice(selection.index, 1);
          break;
        default:
          break;
      }
    });
    this.selection = null;
    this.renderProperties();
    this.render();
  }

  /** Тянет подвижный конец ребра вдоль отрезка до длины `value`; неверное значение сцену не меняет — `false`. */
  private resizeEdge(index: number, value: number): boolean {
    const edge = this.state.edges[index];
    const fixedName = this.lengthEnd === 'from' ? edge?.to : edge?.from;
    const movingName = this.lengthEnd === 'from' ? edge?.from : edge?.to;
    const fixed = fixedName ? this.state.vertices[fixedName] : undefined;
    const moving = movingName ? this.state.vertices[movingName] : undefined;
    const current = fixed && moving ? distance(fixed, moving) : 0;

    if (!fixed || !moving || !movingName || !Number.isFinite(value) || value <= 0 || current === 0) return false;

    const factor = value / current;

    this.commit((draft) => {
      draft.vertices[movingName] = [roundTo(fixed[0] + (moving[0] - fixed[0]) * factor), roundTo(fixed[1] + (moving[1] - fixed[1]) * factor)];
    });

    return true;
  }

  // --------------------------------------------------------- панель свойств

  private renderProperties(): void {
    const { selection, state, t } = this;

    this.properties.replaceChildren();

    if (!selection) {
      this.properties.appendChild(propsEmpty(t('drawings_nothing_selected')));

      return;
    }

    this.properties.appendChild(propsTitle(t(`drawings_selected_${selection.type}`)));

    if (selection.type === 'vertex') {
      this.properties.append(
        textField({ label: t('drawings_prop_name'), value: selection.id, maxLength: 4, onChange: (value) => this.renameVertex(selection.id, value) }),
        selectField({
          label: t('drawings_prop_position'),
          options: LABEL_POSITIONS.map((value) => ({ value, label: t(`drawings_position_${value.replace(' ', '_')}`) })),
          value: state.labels[selection.id] ?? 'above',
          onChange: (value) =>
            this.commit((draft) => {
              draft.labels[selection.id] = value;
            }),
        }),
      );
    } else if (selection.type === 'edge') {
      const edge = state.edges[selection.index];

      if (!edge) return;

      const fromPoint = state.vertices[edge.from];
      const toPoint = state.vertices[edge.to];
      const currentLength = fromPoint && toPoint ? distance(fromPoint, toPoint) : 0;
      const updateEdge = (mutate: (draftEdge: PlanimetryState['edges'][number]) => void): void =>
        this.commit((draft) => {
          const draftEdge = draft.edges[selection.index];

          if (draftEdge) mutate(draftEdge);
        });

      this.properties.append(
        selectField({
          label: t('drawings_prop_style'),
          options: [
            { value: 'solid', label: t('drawings_style_solid') },
            { value: 'dashed', label: t('drawings_style_dashed') },
          ],
          value: edge.style,
          onChange: (value) =>
            updateEdge((draftEdge) => {
              draftEdge.style = value === 'dashed' ? 'dashed' : 'solid';
            }),
        }),
        selectField({
          label: t('drawings_prop_ticks'),
          options: [0, 1, 2, 3, 4].map((value) => ({ value: String(value), label: String(value) })),
          value: String(edge.ticks ?? 0),
          onChange: (value) =>
            updateEdge((draftEdge) => {
              draftEdge.ticks = Number(value) || undefined;
            }),
        }),
        numberField({
          label: t('drawings_prop_length'),
          value: roundTo(currentLength),
          step: 0.5,
          min: 0.01,
          prop: 'length',
          onChange: (value) => this.resizeEdge(selection.index, value),
        }),
        selectField({
          label: t('drawings_prop_length_end'),
          options: [
            { value: 'from', label: edge.from },
            { value: 'to', label: edge.to },
          ],
          value: this.lengthEnd,
          prop: 'lengthEnd',
          onChange: (value) => {
            this.lengthEnd = value === 'from' ? 'from' : 'to';
          },
        }),
      );
    } else if (selection.type === 'angle') {
      const angle = state.angles[selection.index];

      if (!angle) return;

      const degrees = angleMeasure(angle.points, state.vertices);
      const updateAngle = (mutate: (draftAngle: PlanimetryAngle) => void): void =>
        this.commit((draft) => {
          const draftAngle = draft.angles[selection.index];

          if (draftAngle) mutate(draftAngle);
        });

      this.properties.append(
        selectField({
          label: t('drawings_prop_style'),
          options: ANGLE_STYLES.map((value) => ({ value, label: t(`drawings_angle_${value}`) })),
          value: angle.style,
          onChange: (value) =>
            updateAngle((draftAngle) => {
              draftAngle.style = value as AngleStyle;
            }),
        }),
        textField({
          label: t('drawings_prop_angle_value'),
          value: degrees === null ? '' : formatAngleMeasure(degrees),
          readOnly: true,
          prop: 'angleValue',
        }),
        // Включение пишет величину в подпись (это делает `measureAngles`), выключение оставляет подпись текстом.
        checkField({
          label: t('drawings_prop_angle_measure'),
          checked: angle.measured,
          prop: 'angleMeasure',
          onChange: (checked) =>
            updateAngle((draftAngle) => {
              draftAngle.measured = checked;
            }),
        }),
        // Пока подпись ведётся сама, руками её не правят.
        textField({
          label: t('drawings_prop_label'),
          value: angle.label ?? '',
          placeholder: '30°',
          disabled: angle.measured,
          prop: 'angleLabel',
          onChange: (value) =>
            updateAngle((draftAngle) => {
              draftAngle.label = value || undefined;
            }),
        }),
      );
    } else if (selection.type === 'circle') {
      const circle = state.circles[selection.index];

      if (!circle) return;

      const updateCircle = (mutate: (draftCircle: Circle) => void): void =>
        this.commit((draft) => {
          const draftCircle = draft.circles[selection.index];

          if (draftCircle) mutate(draftCircle);
        });

      this.properties.append(
        numberField({
          label: t('drawings_prop_radius'),
          value: circle.radius,
          step: 0.25,
          min: 0.25,
          onChange: (value) => {
            if (value <= 0) return false;

            updateCircle((draftCircle) => {
              draftCircle.radius = roundTo(value);
            });

            return true;
          },
        }),
        textField({
          label: t('drawings_prop_label'),
          value: circle.label ?? '',
          onChange: (value) =>
            updateCircle((draftCircle) => {
              draftCircle.label = value || undefined;
            }),
        }),
      );
    } else if (selection.type === 'text') {
      const textLabel = state.textLabels[selection.index];

      if (!textLabel) return;

      const text = textField({
        label: t('drawings_prop_text'),
        value: textLabel.text,
        autofocus: true,
        onChange: (value) =>
          this.commit((draft) => {
            const draftLabel = draft.textLabels[selection.index];

            if (draftLabel) draftLabel.text = value;
          }),
      });

      this.properties.append(text);
      text.querySelector('input')?.focus();
    }

    const remove = el('button', { class: 'rte-button rte-button--danger rte-builder__remove', attrs: { type: 'button' }, text: t('drawings_remove_selected') });

    this.disposer.add(on(remove, 'click', () => this.deleteSelection()));
    this.properties.appendChild(remove);
  }

  /** Переименование точки тянет за собой рёбра, углы, окружности и подписи. */
  private renameVertex(from: string, to: string): void {
    if (!to || to === from || to in this.state.vertices) {
      this.renderProperties();

      return;
    }

    this.commit((state) => {
      const vertex = state.vertices[from];

      if (!vertex) return;

      state.vertices[to] = vertex;
      delete state.vertices[from];

      if (state.labels[from]) {
        state.labels[to] = state.labels[from];
        delete state.labels[from];
      }

      const rename = (name: string): string => (name === from ? to : name);

      state.edges.forEach((edge) => {
        edge.from = rename(edge.from);
        edge.to = rename(edge.to);
      });
      state.angles.forEach((angle) => {
        angle.points = angle.points.map(rename) as [string, string, string];
      });
      state.circles.forEach((circle) => {
        circle.centerVertex = rename(circle.centerVertex);
      });
      state.textLabels.forEach((label) => {
        if (label.position) label.position = [rename(label.position[0]), rename(label.position[1])];
      });
    });
    this.selection = { type: 'vertex', id: to };
    this.renderProperties();
    this.render();
  }
}

export const planimetryEditorFactory: SceneEditorFactory = {
  id: 'planimetry',
  kind: 'geometry',
  labelKey: 'drawings_tab_planimetry',
  icon: 'tabPlane',
  accepts: (scene) => {
    const normalized = normalizeGeometryScene(scene);

    return normalized.type === '2d';
  },
  create: (context) => new PlanimetryEditor(context),
};

export { cloneScene };
