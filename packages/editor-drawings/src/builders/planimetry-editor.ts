import { createDisposer, el, on, type Translate, type Unsubscribe } from '@rich-editor/core';
import { resolveGeometryViewport, renderGeometrySvg } from '../render/geometry-svg';
import { fmt } from '../render/svg-builder';
import { normalizeGeometryScene } from '../scene/normalize';
import type { AngleStyle, GeometryHighlight, GeometryScene, GeometryTextLabel, Vec2 } from '../scene/types';
import {
  angleBetween,
  distance,
  distanceToSegment,
  nearestOnCircle,
  projectOnSegment,
  roundPoint,
  roundTo,
  snapToGrid,
} from './geometry-utils';
import { HistoryStack, cloneScene } from './history';
import { ChangeEmitter, SketchCanvas, type PointerInfo } from './sketch-canvas';
import { ToolBar, actionButton, propertyField, selectControl, type ToolButton } from './tool-bar';
import type { RawScene, SceneEditor, SceneEditorContext, SceneEditorFactory } from './types';

type Tool = 'select' | 'point' | 'segment' | 'circle' | 'angle' | 'ticks' | 'text' | 'delete';

const TOOLS: ToolButton<Tool>[] = [
  { id: 'select', labelKey: 'drawings_tool_select', glyph: '↖' },
  { id: 'point', labelKey: 'drawings_tool_point', glyph: '•' },
  { id: 'segment', labelKey: 'drawings_tool_segment', glyph: '╱' },
  { id: 'circle', labelKey: 'drawings_tool_circle', glyph: '○' },
  { id: 'angle', labelKey: 'drawings_tool_angle', glyph: '∠' },
  { id: 'ticks', labelKey: 'drawings_tool_ticks', glyph: '╫' },
  { id: 'text', labelKey: 'drawings_tool_text', glyph: 'T' },
  { id: 'delete', labelKey: 'drawings_tool_delete', glyph: '✕' },
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

/** Живая сцена конструктора: подмножество `GeometryScene` для плоскости плюс всё чужое как есть. */
interface PlanimetryState {
  vertices: Record<string, Vec2>;
  edges: Array<{ from: string; to: string; style: 'solid' | 'dashed'; ticks?: number }>;
  angles: Array<{ points: [string, string, string]; style: AngleStyle; label?: string }>;
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

  private selection: Selection = null;

  /** Точки, уже выбранные текущим инструментом: начало отрезка, центр, стороны угла. */
  private draft: string[] = [];

  private cursor: Vec2 | null = null;

  private drag: { id: string; moved: boolean } | null = null;

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

    this.hint = el('p', { class: 'rte-builder__hint', attrs: { role: 'status' } });
    this.properties = el('div', { class: 'rte-builder__props', attrs: { 'aria-live': 'polite' } });

    this.element = el('div', {
      class: 'rte-builder rte-builder--planimetry',
      children: [
        el('div', { class: 'rte-builder__bar', children: [this.tools.element, actions] }),
        el('div', { class: 'rte-builder__body', children: [this.canvas.element, this.properties] }),
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
        center = Object.keys(vertices).find((name) => distance(vertices[name], plot.center) < 0.01) ?? nextVertexName(vertices, 'O');
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
      angles: scene.angles.map((angle) => ({ points: [...angle.points] as [string, string, string], style: angle.style, label: angle.label })),
      labels: { ...scene.labels },
      textLabels: scene.textLabels.map((label) => ({ ...label })),
      circles,
      showGrid: scene.showGrid,
      extra,
    };
    this.history.clear();
    this.selection = null;
    this.draft = [];
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

    if (this.cursor && this.draft.length > 0 && (this.tool === 'segment' || this.tool === 'circle')) {
      const from = this.canvas.toSvg(this.state.vertices[this.draft[0]]);
      const to = this.canvas.toSvg(this.cursor);

      if (this.tool === 'segment') {
        parts.push(`<line x1="${fmt(from.x)}" y1="${fmt(from.y)}" x2="${fmt(to.x)}" y2="${fmt(to.y)}" stroke="#8b5cf6" stroke-width="1.5" stroke-dasharray="4 3" />`);
      } else {
        const radius = distance(this.state.vertices[this.draft[0]], this.cursor) * this.canvas.viewport.scale;

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

  private undo(): void {
    const previous = this.history.undo(this.state);

    if (!previous) return;

    this.state = previous;
    this.selection = null;
    this.afterChange();
  }

  private redo(): void {
    const next = this.history.redo(this.state);

    if (!next) return;

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
      this.render();

      return;
    }

    if (this.draft.length > 0) this.renderOverlay();
  };

  private readonly onPointerUp = (): void => {
    if (this.drag?.moved) this.afterChange();

    this.drag = null;
  };

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

    if (from === name) {
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
    const radius = roundTo(Math.max(0.25, distance(this.state.vertices[center], this.snap(info.world, info))), 2);

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
      // Прямой угол — сразу уголком: так рисуют чаще всего.
      const degrees = angleBetween(state.vertices[points[1]], state.vertices[points[0]], state.vertices[points[2]]);

      state.angles.push({ points, style: Math.abs(degrees - 90) < 1.5 ? 'right' : 'single' });
      this.selection = { type: 'angle', index: state.angles.length - 1 };
    });
  }

  private cycleTicks(info: PointerInfo): void {
    const index = this.edgeAt(info.world);

    if (index === null) return;

    this.commit((state) => {
      const edge = state.edges[index];

      edge.ticks = ((edge.ticks ?? 0) + 1) % 5;
    });
  }

  private addText(info: PointerInfo): void {
    const edge = this.edgeAt(info.world);

    if (edge !== null) {
      const { from, to } = this.state.edges[edge];

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

  // --------------------------------------------------------- панель свойств

  private renderProperties(): void {
    const { selection, state, t } = this;

    this.properties.replaceChildren();

    if (!selection) {
      this.properties.appendChild(el('p', { class: 'rte-builder__props-empty', text: t('drawings_nothing_selected') }));

      return;
    }

    const title = el('h4', { class: 'rte-builder__props-title', text: t(`drawings_selected_${selection.type}`) });

    this.properties.appendChild(title);

    if (selection.type === 'vertex') {
      const nameInput = el('input', { class: 'rte-input', attrs: { type: 'text', value: selection.id, maxlength: 4 } });
      const position = selectControl(
        LABEL_POSITIONS.map((value) => ({ value, label: t(`drawings_position_${value.replace(' ', '_')}`) })),
        state.labels[selection.id] ?? 'above',
      );

      this.properties.append(propertyField(t('drawings_prop_name'), nameInput), propertyField(t('drawings_prop_position'), position));
      this.disposer.add(on(nameInput, 'change', () => this.renameVertex(selection.id, nameInput.value.trim())));
      this.disposer.add(
        on(position, 'change', () => {
          this.commit((draft) => {
            draft.labels[selection.id] = position.value;
          });
        }),
      );
    } else if (selection.type === 'edge') {
      const edge = state.edges[selection.index];

      if (!edge) return;

      const style = selectControl(
        [
          { value: 'solid', label: t('drawings_style_solid') },
          { value: 'dashed', label: t('drawings_style_dashed') },
        ],
        edge.style,
      );
      const ticks = selectControl([0, 1, 2, 3, 4].map((value) => ({ value: String(value), label: String(value) })), String(edge.ticks ?? 0));

      this.properties.append(propertyField(t('drawings_prop_style'), style), propertyField(t('drawings_prop_ticks'), ticks));
      this.disposer.add(
        on(style, 'change', () => {
          this.commit((draft) => {
            draft.edges[selection.index].style = style.value === 'dashed' ? 'dashed' : 'solid';
          });
        }),
      );
      this.disposer.add(
        on(ticks, 'change', () => {
          this.commit((draft) => {
            draft.edges[selection.index].ticks = Number(ticks.value) || undefined;
          });
        }),
      );
    } else if (selection.type === 'angle') {
      const angle = state.angles[selection.index];

      if (!angle) return;

      const style = selectControl(ANGLE_STYLES.map((value) => ({ value, label: t(`drawings_angle_${value}`) })), angle.style);
      const label = el('input', { class: 'rte-input', attrs: { type: 'text', value: angle.label ?? '', placeholder: '30°' } });

      this.properties.append(propertyField(t('drawings_prop_style'), style), propertyField(t('drawings_prop_label'), label));
      this.disposer.add(
        on(style, 'change', () => {
          this.commit((draft) => {
            draft.angles[selection.index].style = style.value as AngleStyle;
          });
        }),
      );
      this.disposer.add(
        on(label, 'change', () => {
          this.commit((draft) => {
            draft.angles[selection.index].label = label.value.trim() || undefined;
          });
        }),
      );
    } else if (selection.type === 'circle') {
      const circle = state.circles[selection.index];

      if (!circle) return;

      const radius = el('input', { class: 'rte-input', attrs: { type: 'number', step: '0.25', min: '0.25', value: String(circle.radius) } });
      const label = el('input', { class: 'rte-input', attrs: { type: 'text', value: circle.label ?? '' } });

      this.properties.append(propertyField(t('drawings_prop_radius'), radius), propertyField(t('drawings_prop_label'), label));
      this.disposer.add(
        on(radius, 'change', () => {
          const value = Number(radius.value);

          if (!Number.isFinite(value) || value <= 0) return;

          this.commit((draft) => {
            draft.circles[selection.index].radius = roundTo(value);
          });
        }),
      );
      this.disposer.add(
        on(label, 'change', () => {
          this.commit((draft) => {
            draft.circles[selection.index].label = label.value.trim() || undefined;
          });
        }),
      );
    } else if (selection.type === 'text') {
      const textLabel = state.textLabels[selection.index];

      if (!textLabel) return;

      const text = el('input', { class: 'rte-input', attrs: { type: 'text', value: textLabel.text, 'data-autofocus': true } });

      this.properties.append(propertyField(t('drawings_prop_text'), text));
      this.disposer.add(
        on(text, 'change', () => {
          this.commit((draft) => {
            draft.textLabels[selection.index].text = text.value;
          });
        }),
      );
      text.focus();
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
      state.vertices[to] = state.vertices[from];
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
  accepts: (scene) => {
    const normalized = normalizeGeometryScene(scene);

    return normalized.type === '2d';
  },
  create: (context) => new PlanimetryEditor(context),
};

export { cloneScene };
