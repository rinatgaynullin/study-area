import type { GeometryHighlight, GeometryScene, Plot, Point, Vec2, Vec3 } from '../scene/types';
import {
  DEFAULT_GEOMETRY_SCALE,
  DEFAULT_PLOT_SCALE,
  fitViewport,
  project3dToPlane,
  projectOblique,
  rotatePoint3d,
  worldToSvg,
  type SvgPoint,
  type Viewport,
} from './coords';
import { perpendicularOffset, prettifyMathText, renderAngleMark, renderEqualityTicks, safeColor } from './geometry-marks';
import { renderCirclePlot, renderPlot2dContent, type PlotSize } from './plot2d-svg';
import { DIAGONAL_STRIPE_DEFS, HIGHLIGHT_COLOR, INK, SvgBuilder, polylinePath, wrapSvg, type StrokeOptions } from './svg-builder';

/**
 * Геометрический чертёж в SVG: 2D, 3D (кабинетная проекция) и графики
 * функций. Слои идут снизу вверх — сетка, сечения, цилиндры, рёбра, углы,
 * окружности, вершины, подписи — чтобы буквы и точки не прятались под
 * линиями. Сцена уже нормализована; всё, чего в ней нет, пропускается.
 */

export interface GeometryRenderOptions {
  width?: number;
  height?: number;
  highlight?: GeometryHighlight | null;
  /** Подобрать масштаб и центр по содержимому, а не брать из сцены. */
  autoFit?: boolean;
}

const DEFAULT_SIZE = 300;

/** Вписывание: у графиков отступ меньше и масштаб может быть мельче. */
const FIT_GEOMETRY = { padding: 45, minScale: 12, maxScale: 120, fallbackScale: 25 };
const FIT_PLOT = { padding: 30, minScale: 8, maxScale: 120, fallbackScale: 15 };

const GRID_2D_COLOR = '#f1f5f9';
const AXIS_2D_COLOR = '#cbd5e1';
const GRID_3D_COLOR = '#e2e8f0';
/** Оси 3D в цветах конструктора стереометрии; по ним ученик узнаёт X, Y, Z. */
const AXES_3D: Array<{ name: string; tip: Vec3; color: string }> = [
  { name: 'X', tip: [5.5, 0, 0], color: '#dc2626' },
  { name: 'Y', tip: [0, 5.5, 0], color: '#16a34a' },
  { name: 'Z', tip: [0, 0, 5.5], color: '#2563eb' },
];
const GRID_3D_HALF = 5;
const ARROW_LENGTH = 6;
const ARROW_HALF_WIDTH = 3;
/** Сетка не чаще шести пикселей, иначе она превращается в заливку. */
const MIN_GRID_PIXELS = 6;

const SECTION_FILL = 'rgba(16, 185, 129, 0.2)';
const SECTION_STROKE = '#10b981';
const SECTION_HIGHLIGHT_FILL = 'rgba(236, 72, 153, 0.35)';

const CYLINDER_SEGMENTS = 32;
const CIRCLE_2D_COLOR = '#475569';
const DRAFT_COLOR = '#8b5cf6';

const EDGE_WIDTH = 1.8;
const DASHED_EDGE_WIDTH = 1.2;
const EDGE_DASH = '4';
const VERTEX_RADIUS = 3;

/** Подпись отрезка отходит от него на кегль; у коротких отрезков — дальше, чтобы не лечь на вершины. */
const SHORT_SEGMENT = 45;

type Projector = (point: Point) => SvgPoint;

const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));

const isFinitePoint = (point: SvgPoint): boolean => Number.isFinite(point.x) && Number.isFinite(point.y);

/** Битый элемент пропускается молча: остальная картинка важнее. */
const attempt = (draw: () => void): void => {
  try {
    draw();
  } catch {
    // Намеренно пусто: см. комментарий выше.
  }
};

/** Сколько единиц ветви кривой показывать при вписывании, если `domain` не задан. */
const CURVE_EXTENT = 2;

/**
 * Точки мира, которые должны попасть в картинку: вершины (3D — уже в
 * плоскости проекции) и опорные точки графиков у плоских сцен. У кривых
 * кроме вершины берётся кусок ветвей — иначе одна парабола вписывается
 * вершиной в центр на максимальном масштабе, и самой параболы не видно.
 */
export const collectGeometryPoints = (scene: GeometryScene): Vec2[] => {
  const points: Vec2[] = Object.values(scene.vertices).map((vertex) =>
    scene.type === '3d' ? project3dToPlane(vertex, scene.angleY, scene.angleZ) : [vertex[0], vertex[1]],
  );

  if (scene.type !== '3d') {
    scene.plots.forEach((plot) => {
      switch (plot.type) {
        case 'circle': {
          const [x, y] = plot.center;
          const r = plot.radius;

          points.push([x - r, y], [x + r, y], [x, y - r], [x, y + r]);
          break;
        }
        case 'hyperbola': {
          const [x, y] = plot.center;

          points.push([x, y], [x + 1, y + plot.k], [x - 1, y - plot.k], [x + plot.k, y + 1], [x - plot.k, y - 1]);
          break;
        }
        case 'parabola': {
          const [x, y] = plot.vertex;
          const reach = CURVE_EXTENT * plot.stretchX;
          const rise = CURVE_EXTENT * CURVE_EXTENT * plot.stretchY * (plot.direction === 'down' ? -1 : 1);

          points.push([x, y], [x - reach, y + rise], [x + reach, y + rise]);
          break;
        }
        case 'sqrt': {
          const [x, y] = plot.vertex;
          const reach = CURVE_EXTENT * CURVE_EXTENT * (plot.directionX === 'left' ? -1 : 1);
          const rise = CURVE_EXTENT * plot.stretch * (plot.directionY === 'down' ? -1 : 1);

          points.push([x, y], [x + reach, y + rise]);
          break;
        }
        case 'line':
          if (plot.p1) points.push(plot.p1);

          if (plot.p2) points.push(plot.p2);
          break;
        case 'point':
          points.push(plot.coords);
          break;
        case 'shading':
          if (plot.points) points.push(...plot.points);

          if (plot.bounds) points.push([plot.bounds[0], plot.bounds[2]], [plot.bounds[1], plot.bounds[3]]);
          break;
        case 'freehand':
          points.push(...plot.points);
          break;
        default:
          break;
      }
    });
  }

  return points.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
};

/** Масштаб и центр картинки: из сцены или подбором по содержимому при `autoFit`. */
export const resolveGeometryViewport = (scene: GeometryScene, options: GeometryRenderOptions = {}): Viewport => {
  const width = options.width ?? DEFAULT_SIZE;
  const height = options.height ?? DEFAULT_SIZE;
  const isPlot = scene.type === 'plot_2d';

  if (options.autoFit) {
    return fitViewport(collectGeometryPoints(scene), { width, height, ...(isPlot ? FIT_PLOT : FIT_GEOMETRY) });
  }

  return {
    scale: scene.scale ?? (isPlot ? DEFAULT_PLOT_SCALE : DEFAULT_GEOMETRY_SCALE),
    cx: width / 2 + scene.offsetX,
    cy: height / 2 + scene.offsetY,
  };
};

const makeProjector = (scene: GeometryScene, viewport: Viewport): Projector =>
  scene.type === '3d'
    ? (point) => projectOblique(rotatePoint3d(point, scene.angleY, scene.angleZ), viewport.scale, viewport.cx, viewport.cy)
    : (point) => worldToSvg(point, viewport.scale, viewport.cx, viewport.cy);

interface FigureContext {
  scene: GeometryScene;
  viewport: Viewport;
  size: PlotSize;
  highlight: GeometryHighlight | null;
  builder: SvgBuilder;
  project: Projector;
  /** Вершины в координатах SVG; нет вершины — нет и записи. */
  placed: Map<string, SvgPoint>;
}

const arrowHead = (builder: SvgBuilder, from: SvgPoint, to: SvgPoint, color: string): void => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);

  if (length === 0) return;

  const ux = dx / length;
  const uy = dy / length;
  const base = { x: to.x - ux * ARROW_LENGTH, y: to.y - uy * ARROW_LENGTH };

  builder.polygon(
    [
      to,
      { x: base.x - uy * ARROW_HALF_WIDTH, y: base.y + ux * ARROW_HALF_WIDTH },
      { x: base.x + uy * ARROW_HALF_WIDTH, y: base.y - ux * ARROW_HALF_WIDTH },
    ],
    { fill: color, className: 'rte-drawing__axis' },
  );
};

/** Сетка плоскости z = 0 и оси X, Y, Z в проекции — только по флагам сцены. */
const renderBackdrop3d = ({ scene, builder, project }: FigureContext): void => {
  if (scene.showGrid) {
    const stroke: StrokeOptions = { color: GRID_3D_COLOR, width: 0.5, dashed: '1,2', className: 'rte-drawing__grid' };

    for (let i = -GRID_3D_HALF; i <= GRID_3D_HALF; i += 1) {
      builder.line(project([-GRID_3D_HALF, i, 0]), project([GRID_3D_HALF, i, 0]), stroke);
      builder.line(project([i, -GRID_3D_HALF, 0]), project([i, GRID_3D_HALF, 0]), stroke);
    }
  }

  if (!scene.showAxes) return;

  const origin = project([0, 0, 0]);

  AXES_3D.forEach((axis) => {
    const tip = project(axis.tip);

    builder.line(origin, tip, { color: axis.color, width: 1, dashed: '3,1', opacity: 0.6, className: 'rte-drawing__axis' });
    arrowHead(builder, origin, tip, axis.color);

    const at = axis.name === 'Z' ? { x: tip.x, y: tip.y - 8 } : { x: tip.x + 8, y: tip.y + 4 };

    builder.text(at, axis.name, { size: 10, color: axis.color, anchor: axis.name === 'Z' ? 'middle' : 'start' });
  });
};

const firstGridLine = (origin: number, step: number): number => ((origin % step) + step) % step;

/** Клетчатая сетка по единице мира и пунктирные оси через начало координат. */
const renderBackdrop2d = ({ scene, viewport, size, builder }: FigureContext): void => {
  if (!scene.showGrid) return;

  const { scale, cx, cy } = viewport;
  const step = scale < MIN_GRID_PIXELS ? scale * Math.ceil(MIN_GRID_PIXELS / scale) : scale;
  const grid: StrokeOptions = { color: GRID_2D_COLOR, width: 0.8, className: 'rte-drawing__grid' };
  const axis: StrokeOptions = { color: AXIS_2D_COLOR, width: 1, dashed: '2,2', opacity: 0.65, className: 'rte-drawing__axis' };

  for (let x = firstGridLine(cx, step); x < size.width; x += step) builder.line({ x, y: 0 }, { x, y: size.height }, grid);

  for (let y = firstGridLine(cy, step); y < size.height; y += step) builder.line({ x: 0, y }, { x: size.width, y }, grid);

  builder.line({ x: 0, y: cy }, { x: size.width, y: cy }, axis);
  builder.line({ x: cx, y: 0 }, { x: cx, y: size.height }, axis);
};

const sameVertices = (a: string[], b: string[]): boolean => a.length === b.length && a.every((name, index) => name === b[index]);

const renderSections = ({ scene, highlight, builder, placed }: FigureContext): void => {
  scene.sections.forEach((section) => {
    const points = section.vertices.map((name) => placed.get(name)).filter((point): point is SvgPoint => point !== undefined);

    if (points.length < 3) return;

    const highlighted = highlight?.type === 'section' && sameVertices(highlight.vertices, section.vertices);

    builder.polygon(points, {
      fill: highlighted ? SECTION_HIGHLIGHT_FILL : safeColor(section.fill, SECTION_FILL),
      color: highlighted ? HIGHLIGHT_COLOR : safeColor(section.stroke, SECTION_STROKE),
      width: highlighted ? 2.5 : 1.5,
      dashed: highlighted ? false : '3',
    });
  });
};

const coordinate = (point: Point, axis: number): number => point[axis] ?? 0;

/**
 * Цилиндр по двум вершинам оси и радиусу: оба основания — многоугольники
 * из 32 точек в проекции, две образующие по крайним точкам верхнего
 * основания, у нижнего видна только передняя половина — задняя пунктиром.
 */
const renderCylinders = ({ scene, builder, project }: FigureContext): void => {
  scene.cylinders.forEach((cylinder) => {
    const base = scene.vertices[cylinder.base];
    const top = scene.vertices[cylinder.top];

    if (!base || !top) return;

    const axis = [0, 1, 2].map((i) => coordinate(top, i) - coordinate(base, i)) as Vec3;
    const length = Math.hypot(...axis);

    if (length < 1e-6) return;

    // Базис плоскости основания: `u` лежит в плоскости xy (или вдоль x у
    // вертикальной оси), `v` — векторное произведение оси и `u`.
    const horizontal = Math.hypot(axis[0], axis[1]);
    const u: Vec3 =
      horizontal > 1e-3
        ? [(-axis[1] / horizontal) * cylinder.radius, (axis[0] / horizontal) * cylinder.radius, 0]
        : [cylinder.radius, 0, 0];
    const v: Vec3 = [
      (axis[1] * u[2] - axis[2] * u[1]) / length,
      (axis[2] * u[0] - axis[0] * u[2]) / length,
      (axis[0] * u[1] - axis[1] * u[0]) / length,
    ];

    const ring = (center: Point): SvgPoint[] =>
      Array.from({ length: CYLINDER_SEGMENTS }, (_, index) => {
        const angle = (index * 2 * Math.PI) / CYLINDER_SEGMENTS;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        return project([
          coordinate(center, 0) + u[0] * cos + v[0] * sin,
          coordinate(center, 1) + u[1] * cos + v[1] * sin,
          coordinate(center, 2) + u[2] * cos + v[2] * sin,
        ]);
      });

    const topRing = ring(top);
    const baseRing = ring(base);
    let leftmost = 0;
    let rightmost = 0;

    topRing.forEach((point, index) => {
      if (point.x < topRing[leftmost].x) leftmost = index;

      if (point.x > topRing[rightmost].x) rightmost = index;
    });

    builder.line(baseRing[leftmost], topRing[leftmost], { width: 1.5 });
    builder.line(baseRing[rightmost], topRing[rightmost], { width: 1.5 });
    builder.path(polylinePath(topRing, true), { width: 1.5 });

    // Нижнее основание делится образующими на две дуги; передняя — та, что
    // ниже на экране (к зрителю), задняя прячется за боковой поверхностью.
    const arcFrom = (start: number, end: number): SvgPoint[] => {
      const arc: SvgPoint[] = [];

      for (let index = start; index !== end; index = (index + 1) % CYLINDER_SEGMENTS) arc.push(baseRing[index]);

      arc.push(baseRing[end]);

      return arc;
    };
    const meanY = (arc: SvgPoint[]): number => arc.reduce((sum, point) => sum + point.y, 0) / arc.length;
    const first = arcFrom(leftmost, rightmost);
    const second = arcFrom(rightmost, leftmost);
    const [front, back] = meanY(first) > meanY(second) ? [first, second] : [second, first];

    builder.path(polylinePath(back), { width: DASHED_EDGE_WIDTH, dashed: EDGE_DASH });
    builder.path(polylinePath(front), { width: EDGE_WIDTH });
  });
};

const isEdgeHighlighted = (highlight: GeometryHighlight | null, from: string, to: string): boolean =>
  highlight?.type === 'edge'
  && ((highlight.from === from && highlight.to === to) || (highlight.from === to && highlight.to === from));

const renderEdges = ({ scene, highlight, builder, placed }: FigureContext): void => {
  scene.edges.forEach((edge) => {
    const a = placed.get(edge.from);
    const b = placed.get(edge.to);

    if (!a || !b) return;

    const dashed = edge.style === 'dashed';
    const width = dashed ? DASHED_EDGE_WIDTH : EDGE_WIDTH;
    const color = safeColor(edge.color, INK);

    if (isEdgeHighlighted(highlight, edge.from, edge.to)) {
      builder.line(a, b, { color: HIGHLIGHT_COLOR, width: width + 5, opacity: 0.45, linecap: 'round' });
    }

    builder.line(a, b, { color, width, dashed: dashed && EDGE_DASH });

    if (edge.ticks) renderEqualityTicks(builder, a, b, edge.ticks, color);
  });
};

const renderAngles = ({ scene, viewport, highlight, builder, placed }: FigureContext): void => {
  scene.angles.forEach((angle) => {
    const [fromName, vertexName, toName] = angle.points;
    const vertex = placed.get(vertexName);
    const from = placed.get(fromName);
    const to = placed.get(toName);

    if (!vertex || !from || !to) return;

    renderAngleMark(builder, {
      vertex,
      from,
      to,
      style: angle.style,
      label: angle.label,
      scale: viewport.scale,
      highlighted: highlight?.type === 'angle' && highlight.id === `angle_${angle.points.join('')}`,
    });
  });
};

/** Черновик угла в конструкторе: кружки у выбранных точек, пунктир между первыми двумя. */
const renderAngleDraft = ({ highlight, builder, placed }: FigureContext): void => {
  if (highlight?.type !== 'angle_draft') return;

  const points = highlight.points.map((name) => placed.get(name)).filter((point): point is SvgPoint => point !== undefined);

  points.forEach((point, index) => {
    const color = index === 1 ? DRAFT_COLOR : HIGHLIGHT_COLOR;

    builder.circle(point, 8, { color, width: 2, dashed: '2 2', opacity: 0.9 });
    builder.circle(point, 12, { fill: color, color: 'none', width: 0, opacity: 0.15 });
  });

  if (points.length === 2) {
    builder.line(points[0], points[1], { color: DRAFT_COLOR, width: 1.5, dashed: '3 3', opacity: 0.8 });
  }
};

const isPlotHighlighted = (highlight: GeometryHighlight | null, plot: Plot): boolean =>
  (highlight?.type === 'circle_plot' || highlight?.type === 'plot') && plot.id !== undefined && highlight.id === plot.id;

/** Окружности на плоском чертеже; центр может быть вершиной сцены. */
const renderCircles = ({ scene, viewport, highlight, builder, placed, project }: FigureContext): void => {
  scene.plots.forEach((plot) => {
    if (plot.type !== 'circle') return;

    const center = (plot.centerVertex !== undefined ? placed.get(plot.centerVertex) : undefined) ?? project(plot.center);

    renderCirclePlot(builder, plot, center, viewport.scale, isPlotHighlighted(highlight, plot), CIRCLE_2D_COLOR);
  });
};

/** Смещение буквы от вершины по словам `left`/`right`/`above`/`below` и их сочетаниям. */
const labelOffset = (placement: string | undefined, size: number): SvgPoint => {
  const offset = { x: 0, y: -size * 0.9 };

  if (!placement) return offset;

  if (placement.includes('left')) offset.x = -size * 1.1;

  if (placement.includes('right')) offset.x = size * 1.1;

  if (placement.includes('below')) offset.y = size * 1.3;

  if (placement.includes('above')) offset.y = -size * 0.9;

  // Чисто сбоку — на уровне вершины.
  if (placement === 'left' || placement === 'right') offset.y = size * 0.3;

  return offset;
};

const renderVertices = ({ scene, viewport, highlight, builder, placed }: FigureContext): void => {
  const size = clamp(Math.round(11 * (viewport.scale / 25)), 10, 22);

  placed.forEach((point, name) => {
    if ((highlight?.type === 'vertex' || highlight?.type === 'vertex_draft') && highlight.id === name) {
      builder.circle(point, 8, { color: HIGHLIGHT_COLOR, width: 2, opacity: 0.8 });
      builder.circle(point, 12, { fill: HIGHLIGHT_COLOR, color: 'none', width: 0, opacity: 0.25 });
    }

    builder.circle(point, VERTEX_RADIUS, { fill: INK, color: 'none', width: 0 });

    const offset = labelOffset(scene.labels[name], size);

    builder.text({ x: point.x + offset.x, y: point.y + offset.y }, name, { size, halo: size * 0.3 });
  });
};

/**
 * Текстовые подписи: у середины отрезка со смещением в сторону `offset`
 * (правая сторона — по ходу от первой вершины ко второй) или в точке мира
 * `coords`; без того и другого — в начале координат.
 */
const renderTextLabels = ({ scene, viewport, builder, placed, project }: FigureContext): void => {
  const size = clamp(Math.round(11 * (viewport.scale / 25)), 10, 20);

  scene.textLabels.forEach((label) => {
    let at: SvgPoint = { x: viewport.cx, y: viewport.cy };

    if (label.position) {
      const a = placed.get(label.position[0]);
      const b = placed.get(label.position[1]);

      if (!a || !b) return;

      const length = Math.hypot(b.x - a.x, b.y - a.y);
      const distance = size * 1.1 + (length < SHORT_SEGMENT ? (SHORT_SEGMENT - length) * 0.65 : 0);
      const normal = perpendicularOffset(a, b, distance);
      const side = label.offset === 'left' ? -1 : 1;

      at = { x: (a.x + b.x) / 2 + normal.x * side, y: (a.y + b.y) / 2 + normal.y * side + size * 0.35 };
    } else if (label.coords) {
      at = project(label.coords);
    }

    builder.text(at, prettifyMathText(label.text), { size, italic: true, halo: size * 0.25 });
  });
};

const renderFigure = (context: FigureContext): void => {
  const layers: Array<(context: FigureContext) => void> = [
    context.scene.type === '3d' ? renderBackdrop3d : renderBackdrop2d,
    ...(context.scene.type === '3d' ? [renderSections, renderCylinders] : []),
    renderEdges,
    renderAngles,
    renderAngleDraft,
    ...(context.scene.type === '2d' ? [renderCircles] : []),
    renderVertices,
    renderTextLabels,
  ];

  layers.forEach((layer) => attempt(() => layer(context)));
};

/**
 * Полная картинка `<svg>` чертежа. Графики функций рисует
 * `renderPlot2dContent`, остальное — слои `renderFigure`. Никогда не
 * бросает: сломанная сцена даёт пустую или частичную картинку.
 */
export const renderGeometrySvg = (scene: GeometryScene, options: GeometryRenderOptions = {}): string => {
  const width = options.width ?? DEFAULT_SIZE;
  const height = options.height ?? DEFAULT_SIZE;
  const builder = new SvgBuilder();

  attempt(() => {
    const viewport = resolveGeometryViewport(scene, { ...options, width, height });
    const size = { width, height };
    const highlight = options.highlight ?? null;

    if (scene.type === 'plot_2d') {
      renderPlot2dContent(scene, viewport, size, highlight, builder);

      return;
    }

    const project = makeProjector(scene, viewport);
    const placed = new Map<string, SvgPoint>();

    Object.entries(scene.vertices).forEach(([name, vertex]) => {
      attempt(() => {
        const point = project(vertex);

        if (isFinitePoint(point)) placed.set(name, point);
      });
    });

    renderFigure({ scene, viewport, size, highlight, builder, project, placed });
  });

  return wrapSvg(builder.toString(), { width, height, className: 'rte-drawing__svg', defs: DIAGONAL_STRIPE_DEFS });
};
