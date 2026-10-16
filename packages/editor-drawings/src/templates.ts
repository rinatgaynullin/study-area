import type { DrawingKind } from './scene/types';

export interface DrawingTemplate {
  id: string;
  kind: DrawingKind;
  /** Ключ перевода названия. */
  labelKey: string;
  /** Сцена как объект; в атрибут узла попадает её JSON. */
  scene: Record<string, unknown>;
}

/** Готовые сцены для диалога — по одной на каждый вид чертежа из README PinQueen. */
export const DRAWING_TEMPLATES: DrawingTemplate[] = [
  {
    id: 'triangle',
    kind: 'geometry',
    labelKey: 'drawings_template_triangle',
    scene: {
      type: '2d',
      vertices: { A: [0, 0], B: [4, 0], C: [0, 3] },
      edges: [['A', 'B'], ['B', 'C'], ['C', 'A']],
      angles: [{ points: ['B', 'A', 'C'], style: 'right' }],
      labels: { A: 'below left', B: 'below right', C: 'above' },
    },
  },
  {
    id: 'pyramid',
    kind: 'geometry',
    labelKey: 'drawings_template_pyramid',
    scene: {
      type: '3d',
      vertices: { A: [0, 0, 0], B: [3, 0, 0], C: [3, 3, 0], D: [0, 3, 0], S: [1.5, 1.5, 3.5] },
      edges: [
        ['A', 'B'],
        ['B', 'C'],
        ['C', 'D'],
        { from: 'D', to: 'A', style: 'dashed' },
        ['S', 'A'],
        ['S', 'B'],
        ['S', 'C'],
        { from: 'S', to: 'D', style: 'dashed' },
      ],
      labels: { S: 'above', A: 'below left', B: 'below right', C: 'right', D: 'left' },
      angleY: 15,
      angleZ: -30,
    },
  },
  {
    id: 'parabola',
    kind: 'geometry',
    labelKey: 'drawings_template_parabola',
    scene: {
      type: 'plot_2d',
      axes: { x_label: 'x', y_label: 'y' },
      plots: [
        { type: 'parabola', vertex: [1, -2], direction: 'up', stretchY: 1, label: 'y = (x-1)^2 - 2' },
        { type: 'point', coords: [1, -2], style: 'solid', label: 'A' },
      ],
    },
  },
  {
    id: 'block-force',
    kind: 'physics',
    labelKey: 'drawings_template_block_force',
    scene: {
      type: 'physics',
      elements: [
        { id: 'floor', type: 'surface', points: [[-5, 0], [5, 0]], hatching: 'bottom' },
        { id: 'm', type: 'block', subtype: 'rectangle', center: [0, 0.5], width: 1.6, height: 1, label: 'm' },
        { id: 'F', type: 'vector', vectorType: 'force', points: [[0.8, 0.5], [3, 0.5]], label: '\\vec{F}' },
        { id: 'mg', type: 'vector', vectorType: 'force', points: [[0, 0.5], [0, -1.5]], label: 'm\\vec{g}' },
      ],
    },
  },
  {
    id: 'circuit',
    kind: 'physics',
    labelKey: 'drawings_template_circuit',
    scene: {
      type: 'physics',
      elements: [
        { id: 'w1', type: 'wire', points: [[-3, -2], [-3, 2], [-1, 2]] },
        { id: 'r', type: 'circuit_component', subtype: 'resistor', points: [[-1, 2], [1, 2]], label: 'R' },
        { id: 'w2', type: 'wire', points: [[1, 2], [3, 2], [3, -2], [1, -2]] },
        { id: 'e', type: 'circuit_component', subtype: 'source', points: [[1, -2], [-1, -2]], label: '\\mathcal{E}' },
        { id: 'w3', type: 'wire', points: [[-1, -2], [-3, -2]] },
      ],
    },
  },
  {
    id: 'lens',
    kind: 'physics',
    labelKey: 'drawings_template_lens',
    scene: {
      type: 'physics',
      showGrid: false,
      elements: [
        { id: 'lens', type: 'lens', subtype: 'converging', center: [0, 0], height: 4, focalLength: 2 },
        { id: 'obj', type: 'optics_arrow', center: [-4, 0], height: 1.5, label: 'AB' },
        { id: 'ray1', type: 'ray', points: [[-4, 1.5], [0, 1.5], [4, -1.5]] },
        { id: 'ray2', type: 'ray', points: [[-4, 1.5], [0, 0], [4, -1.5]] },
      ],
    },
  },
  {
    id: 'thermo',
    kind: 'physics',
    labelKey: 'drawings_template_thermo',
    scene: {
      type: 'physics',
      showGrid: false,
      elements: [
        { id: 'axes', type: 'thermo_axes', xLabel: 'V', yLabel: 'p', xLength: 6, yLength: 5 },
        { id: 'p1', type: 'thermo_point', coords: [1.5, 3.5], label: '1' },
        { id: 'p2', type: 'thermo_point', coords: [4.5, 3.5], label: '2' },
        { id: 'p3', type: 'thermo_point', coords: [4.5, 1.2], label: '3' },
        { id: 'pr1', type: 'thermo_process', subtype: 'line', points: [[1.5, 3.5], [4.5, 3.5]] },
        { id: 'pr2', type: 'thermo_process', subtype: 'line', points: [[4.5, 3.5], [4.5, 1.2]] },
        { id: 'pr3', type: 'thermo_process', subtype: 'isotherm', points: [[4.5, 1.2], [1.5, 3.5]] },
      ],
    },
  },
];
