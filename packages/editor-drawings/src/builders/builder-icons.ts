/** Примитив значка: имя SVG-элемента и его геометрические атрибуты. */
export type BuilderIconShape =
  | ['path', { d: string }]
  | ['line', { x1: number; y1: number; x2: number; y2: number }]
  | ['circle', { cx: number; cy: number; r: number }]
  | ['ellipse', { cx: number; cy: number; rx: number; ry: number }]
  | ['rect', { x: number; y: number; width: number; height: number; rx?: number }]
  | ['polyline', { points: string }]
  | ['polygon', { points: string }];

export interface BuilderIconSpec {
  shapes: BuilderIconShape[];
  /** Индексы примитивов, которые рисуются пунктиром (невидимые рёбра тел). */
  dashed?: number[];
  /** Индексы примитивов, которые заливаются `currentColor` (точки). */
  filled?: number[];
}

export type BuilderIconId =
  // Инструменты
  | 'select'
  | 'point'
  | 'segment'
  | 'circle'
  | 'angle'
  | 'ticks'
  | 'text'
  | 'delete'
  | 'section'
  | 'pencil'
  | 'shading'
  // Действия
  | 'undo'
  | 'redo'
  | 'grid'
  | 'axes'
  | 'zoomIn'
  | 'zoomOut'
  | 'fit'
  | 'resetView'
  // Тела
  | 'cube'
  | 'box'
  | 'prism'
  | 'pyramid'
  | 'frustum'
  | 'cylinder'
  | 'cone'
  | 'sphere'
  // Графики
  | 'parabola'
  | 'hyperbola'
  | 'lineFn'
  | 'root'
  | 'plotCircle'
  | 'pointHollow'
  // Вкладки
  | 'tabPlane'
  | 'tabSolid'
  | 'tabPlot'
  | 'tabPhysics';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Пунктир невидимых рёбер: с учётом скруглённых концов штрих ≈ 3.75, просвет ≈ 1.75. */
const DASH = '2 3.5';

const DEFAULT_SIZE = 20;

/** Оси графиков: общие для всей группы, начало координат в центре поля. */
const PLOT_AXES: BuilderIconShape = ['path', { d: 'M3 12 H21 M12 3 V21' }];

/** Куб в косоугольной проекции: передняя грань, видимые и невидимые рёбра задней части. */
const CUBE_FRONT: BuilderIconShape = ['rect', { x: 3, y: 8, width: 13, height: 13 }];
const CUBE_BACK: BuilderIconShape = ['path', { d: 'M3 8 L8 3 H21 V16 L16 21 M16 8 L21 3' }];

/** Наборы значков. Тела нарисованы в одной косоугольной проекции со сдвигом глубины (5, −5). */
export const BUILDER_ICONS: Record<BuilderIconId, BuilderIconSpec> = {
  select: {
    shapes: [
      ['polygon', { points: '3.5,3.5 10.5,20.5 13,13 20.5,10.5' }],
      ['line', { x1: 13, y1: 13, x2: 19.5, y2: 19.5 }],
    ],
  },
  point: {
    shapes: [
      ['circle', { cx: 12, cy: 12, r: 3 }],
      ['circle', { cx: 12, cy: 12, r: 7.5 }],
    ],
    filled: [0],
  },
  segment: {
    shapes: [
      ['line', { x1: 5, y1: 19, x2: 19, y2: 5 }],
      ['circle', { cx: 5, cy: 19, r: 2.2 }],
      ['circle', { cx: 19, cy: 5, r: 2.2 }],
    ],
    filled: [1, 2],
  },
  circle: {
    shapes: [
      ['circle', { cx: 12, cy: 12, r: 9 }],
      ['line', { x1: 12, y1: 12, x2: 18.4, y2: 5.6 }],
      ['circle', { cx: 12, cy: 12, r: 1.6 }],
    ],
    filled: [2],
  },
  angle: {
    shapes: [
      ['polyline', { points: '20.5,19 4,19 14.5,5' }],
      ['path', { d: 'M11.5 19 A7.5 7.5 0 0 0 8.5 13' }],
    ],
  },
  ticks: {
    shapes: [
      ['line', { x1: 3, y1: 12, x2: 21, y2: 12 }],
      ['line', { x1: 10, y1: 8, x2: 10, y2: 16 }],
      ['line', { x1: 14, y1: 8, x2: 14, y2: 16 }],
    ],
  },
  text: {
    shapes: [
      ['path', { d: 'M6 6.5 V4 H18 V6.5 M12 4 V17' }],
      ['line', { x1: 5, y1: 20.5, x2: 19, y2: 20.5 }],
    ],
  },
  delete: {
    shapes: [
      ['line', { x1: 4, y1: 6.5, x2: 20, y2: 6.5 }],
      ['path', { d: 'M9 6.5 V4 H15 V6.5' }],
      ['path', { d: 'M6 6.5 L7 20 H17 L18 6.5' }],
      ['line', { x1: 10, y1: 10.5, x2: 10, y2: 16 }],
      ['line', { x1: 14, y1: 10.5, x2: 14, y2: 16 }],
    ],
  },
  section: {
    shapes: [
      ['polygon', { points: '3,17 8.5,7 21,7 15.5,17' }],
      ['line', { x1: 8.1, y1: 10.6, x2: 13.5, y2: 16 }],
      ['line', { x1: 10.5, y1: 8, x2: 15.9, y2: 13.4 }],
    ],
  },
  pencil: {
    shapes: [
      ['path', { d: 'M15 4.5 L19.5 9 L8.5 20 H4 V15.5 Z' }],
      ['line', { x1: 12.5, y1: 7, x2: 17, y2: 11.5 }],
    ],
  },
  shading: {
    shapes: [
      ['circle', { cx: 12, cy: 12, r: 8 }],
      ['line', { x1: 5.3, y1: 12.4, x2: 12.4, y2: 5.3 }],
      ['line', { x1: 7.5, y1: 16.5, x2: 16.5, y2: 7.5 }],
      ['line', { x1: 11.6, y1: 18.7, x2: 18.7, y2: 11.6 }],
    ],
  },

  undo: {
    shapes: [
      ['polyline', { points: '9,14 4,9 9,4' }],
      ['path', { d: 'M4 9 H14.5 A5.5 5.5 0 0 1 14.5 20 H11' }],
    ],
  },
  redo: {
    shapes: [
      ['polyline', { points: '15,14 20,9 15,4' }],
      ['path', { d: 'M20 9 H9.5 A5.5 5.5 0 0 0 9.5 20 H13' }],
    ],
  },
  grid: {
    shapes: [
      ['rect', { x: 4, y: 4, width: 16, height: 16, rx: 1 }],
      ['line', { x1: 9.3, y1: 4, x2: 9.3, y2: 20 }],
      ['line', { x1: 14.7, y1: 4, x2: 14.7, y2: 20 }],
      ['line', { x1: 4, y1: 9.3, x2: 20, y2: 9.3 }],
      ['line', { x1: 4, y1: 14.7, x2: 20, y2: 14.7 }],
    ],
  },
  axes: {
    shapes: [
      ['path', { d: 'M9 15 V3 M7 5 L9 3 L11 5' }],
      ['path', { d: 'M9 15 H21 M19 13 L21 15 L19 17' }],
      ['path', { d: 'M9 15 L3 21 M3 18.2 V21 H5.8' }],
    ],
  },
  zoomIn: {
    shapes: [
      ['circle', { cx: 10.5, cy: 10.5, r: 6.5 }],
      ['line', { x1: 15.3, y1: 15.3, x2: 20, y2: 20 }],
      ['line', { x1: 8, y1: 10.5, x2: 13, y2: 10.5 }],
      ['line', { x1: 10.5, y1: 8, x2: 10.5, y2: 13 }],
    ],
  },
  zoomOut: {
    shapes: [
      ['circle', { cx: 10.5, cy: 10.5, r: 6.5 }],
      ['line', { x1: 15.3, y1: 15.3, x2: 20, y2: 20 }],
      ['line', { x1: 8, y1: 10.5, x2: 13, y2: 10.5 }],
    ],
  },
  fit: {
    shapes: [
      ['rect', { x: 8, y: 8, width: 8, height: 8, rx: 1 }],
      ['path', { d: 'M3 7 V3 H7 M3 3 L6 6' }],
      ['path', { d: 'M17 3 H21 V7 M21 3 L18 6' }],
      ['path', { d: 'M21 17 V21 H17 M21 21 L18 18' }],
      ['path', { d: 'M7 21 H3 V17 M3 21 L6 18' }],
    ],
  },
  resetView: {
    shapes: [
      ['path', { d: 'M4 12 A8 8 0 1 0 6.3 6.3 L4 8.6' }],
      ['polyline', { points: '4,4 4,8.6 8.6,8.6' }],
    ],
  },

  cube: {
    shapes: [CUBE_FRONT, CUBE_BACK, ['path', { d: 'M3 21 L8 16 V3 M8 16 H21' }]],
    dashed: [2],
  },
  box: {
    shapes: [
      ['rect', { x: 2, y: 10, width: 15, height: 9 }],
      ['path', { d: 'M2 10 L7 5 H22 V14 L17 19 M17 10 L22 5' }],
      ['path', { d: 'M2 19 L7 14 V5 M7 14 H22' }],
    ],
    dashed: [2],
  },
  prism: {
    shapes: [
      ['polygon', { points: '3.5,20 15.5,20 9.5,9' }],
      ['path', { d: 'M15.5 20 L20.5 15 L14.5 4 L9.5 9' }],
      ['path', { d: 'M3.5 20 L8.5 15 H20.5 M8.5 15 L14.5 4' }],
    ],
    dashed: [2],
  },
  pyramid: {
    shapes: [
      ['path', { d: 'M3 20.5 H16 L21 15.5 M3 20.5 L12 3.5 L16 20.5 M12 3.5 L21 15.5' }],
      ['path', { d: 'M3 20.5 L8 15.5 H21 M8 15.5 L12 3.5' }],
    ],
    dashed: [1],
  },
  frustum: {
    shapes: [
      ['polygon', { points: '7.9,6.4 13.8,6.4 16.1,4.2 10.2,4.2' }],
      ['path', { d: 'M3 19.8 H16 L21 14.8 M3 19.8 L7.9 6.4 M16 19.8 L13.8 6.4 M21 14.8 L16.1 4.2' }],
      ['path', { d: 'M3 19.8 L8 14.8 H21 M8 14.8 L10.2 4.2' }],
    ],
    dashed: [2],
  },
  cylinder: {
    shapes: [
      ['ellipse', { cx: 12, cy: 6, rx: 7.5, ry: 2.5 }],
      ['path', { d: 'M4.5 6 V18 M19.5 6 V18' }],
      ['path', { d: 'M4.5 18 A7.5 2.5 0 0 0 19.5 18' }],
      ['path', { d: 'M4.5 18 A7.5 2.5 0 0 1 19.5 18' }],
    ],
    dashed: [3],
  },
  cone: {
    shapes: [
      ['path', { d: 'M4.5 18 L12 3.5 L19.5 18' }],
      ['path', { d: 'M4.5 18 A7.5 2.5 0 0 0 19.5 18' }],
      ['path', { d: 'M4.5 18 A7.5 2.5 0 0 1 19.5 18' }],
    ],
    dashed: [2],
  },
  sphere: {
    shapes: [
      ['circle', { cx: 12, cy: 12, r: 8.5 }],
      ['path', { d: 'M3.5 12 A8.5 3 0 0 0 20.5 12' }],
      ['path', { d: 'M3.5 12 A8.5 3 0 0 1 20.5 12' }],
    ],
    dashed: [2],
  },

  parabola: {
    shapes: [PLOT_AXES, ['path', { d: 'M7 5 Q9.5 16 12 16 Q14.5 16 17 5' }]],
  },
  hyperbola: {
    shapes: [
      PLOT_AXES,
      ['path', { d: 'M14 4 Q15.2 8.8 20 10' }],
      ['path', { d: 'M10 20 Q8.8 15.2 4 14' }],
    ],
  },
  lineFn: {
    shapes: [PLOT_AXES, ['line', { x1: 5, y1: 20.5, x2: 20.5, y2: 5 }]],
  },
  root: {
    shapes: [PLOT_AXES, ['path', { d: 'M5 17 Q5 11 20.5 5' }]],
  },
  plotCircle: {
    shapes: [PLOT_AXES, ['circle', { cx: 14.5, cy: 9.5, r: 5 }]],
  },
  pointHollow: {
    shapes: [PLOT_AXES, ['circle', { cx: 16.5, cy: 7.5, r: 2.5 }]],
  },

  tabPlane: {
    shapes: [
      ['polygon', { points: '4,19 20,19 9,5' }],
      ['circle', { cx: 4, cy: 19, r: 1.6 }],
      ['circle', { cx: 20, cy: 19, r: 1.6 }],
      ['circle', { cx: 9, cy: 5, r: 1.6 }],
    ],
    filled: [1, 2, 3],
  },
  tabSolid: {
    shapes: [CUBE_FRONT, CUBE_BACK],
  },
  tabPlot: {
    shapes: [
      ['path', { d: 'M4 3 V20 H21' }],
      ['path', { d: 'M7 16 C9.5 6 12 6 13.5 11 C15 16 17.5 16 20 7' }],
    ],
  },
  tabPhysics: {
    shapes: [
      ['rect', { x: 3, y: 7.5, width: 9, height: 9 }],
      ['line', { x1: 2, y1: 16.5, x2: 15, y2: 16.5 }],
      ['line', { x1: 12, y1: 12, x2: 21, y2: 12 }],
      ['polyline', { points: '18.5,9.5 21,12 18.5,14.5' }],
    ],
  },
};

/** SVG-элемент примитива: атрибуты геометрии переносятся как есть. */
const shapeElement = ([name, attrs]: BuilderIconShape): SVGElement => {
  const element = document.createElementNS(SVG_NS, name);

  Object.entries(attrs).forEach(([key, value]) => {
    if (value !== undefined) element.setAttribute(key, String(value));
  });

  return element;
};

/** Значок как элемент: `viewBox="0 0 24 24"`, `fill="none"`, `stroke="currentColor"`,
 *  толщина 1.75, скруглённые концы и стыки, `aria-hidden="true"`, класс `rte-builder-icon`. */
export const createBuilderIcon = (id: BuilderIconId, size = DEFAULT_SIZE): SVGSVGElement => {
  const spec = BUILDER_ICONS[id];
  const svg = document.createElementNS(SVG_NS, 'svg');

  svg.setAttribute('class', 'rte-builder-icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.75');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  spec.shapes.forEach((shape, index) => {
    const element = shapeElement(shape);

    if (spec.dashed?.includes(index)) element.setAttribute('stroke-dasharray', DASH);
    if (spec.filled?.includes(index)) element.setAttribute('fill', 'currentColor');

    svg.appendChild(element);
  });

  return svg;
};
