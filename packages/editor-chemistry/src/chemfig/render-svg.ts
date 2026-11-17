import { formatChemLabel } from './format-label';
import { LABEL_HEIGHT, labelBox, layoutChemTree, type PlacedBond } from './layout';
import { tryParseChemfig } from './parse-chemfig';
import type { ChemAtom, ChemBond, ChemRing, ChemStructure } from './types';

export interface ChemistrySvgOptions {
  /** Масштаб картинки относительно естественного размера; 1 — подпись кеглем 12. */
  scale?: number;
}

/** Сторона кольца: у кольца связи — типы по сторонам, а не объекты, поэтому ссылка — номер. */
export interface RingBondRef {
  ring: ChemRing;
  index: number;
}

export interface ChemLayoutAtom {
  atom: ChemAtom;
  x: number;
  y: number;
  /** Атом стоит в вершине кольца. */
  ring: boolean;
}

export interface ChemLayoutBond {
  bond: ChemBond | RingBondRef;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Положения атомов и связей со ссылками на модель — в координатах итогового SVG. */
export interface ChemLayout {
  width: number;
  height: number;
  atoms: ChemLayoutAtom[];
  bonds: ChemLayoutBond[];
}

/** Радиус кольца и отступ картинки от края. */
const RING_RADIUS = 50;
const PADDING = 12;
const LABEL_FONT_SIZE = 12;
const LABEL_BASELINE_SHIFT = 4.5;
const LABEL_RADIUS = 4;

/** Толщины и смещения линий связи. */
const SINGLE_WIDTH = 2.5;
const DOUBLE_WIDTH = 2;
const DOUBLE_OFFSET = 2.5;
const TRIPLE_SIDE_WIDTH = 1.4;
const TRIPLE_OFFSET = 4;
const AROMATIC_INSET = 12;

/** Угол первой вершины: шестиугольник стоит на ребре, остальные — вершиной вверх. */
const RING_START_ANGLES: Record<number, number> = { 4: 45, 6: 30, 8: 22.5 };

const escapeXml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Число без хвоста плавающей точки: `-0` тоже становится `0`. */
const fmt = (value: number): string => String(Number(value.toFixed(1)));

interface CanvasFrame {
  minX: number;
  minY: number;
  width: number;
  height: number;
  scale: number;
}

/**
 * Накопитель SVG: линии, подписи, окружность и общий габарит.
 *
 * Элементы и рамка растут вместе по мере обхода цепи и кольца, поэтому они —
 * поля одного объекта, а не параметры, которые пришлось бы передавать по
 * кругу. Цвета не зашиты: линии и текст — `currentColor`, подложка подписи
 * — класс, который стили красят под тему.
 */
class SvgCanvas {
  private readonly strokes: string[] = [];

  private readonly labels: string[] = [];

  private minX = Infinity;

  private minY = Infinity;

  private maxX = -Infinity;

  private maxY = -Infinity;

  include(x: number, y: number, halfWidth = 0, halfHeight = halfWidth): void {
    this.minX = Math.min(this.minX, x - halfWidth);
    this.maxX = Math.max(this.maxX, x + halfWidth);
    this.minY = Math.min(this.minY, y - halfHeight);
    this.maxY = Math.max(this.maxY, y + halfHeight);
  }

  line(x1: number, y1: number, x2: number, y2: number, width: number): void {
    this.strokes.push(
      `<line x1="${fmt(x1)}" y1="${fmt(y1)}" x2="${fmt(x2)}" y2="${fmt(y2)}" stroke-width="${fmt(width)}" />`,
    );
    this.include(x1, y1);
    this.include(x2, y2);
  }

  /** Связь по типу: одна линия, две со смещением, три. */
  bond(bond: PlacedBond): void {
    const dx = bond.x2 - bond.x1;
    const dy = bond.y2 - bond.y1;
    const length = Math.hypot(dx, dy);

    if (length === 0) return;

    // Единичная нормаль к связи: вдоль неё раздвигаются параллельные линии.
    const nx = -dy / length;
    const ny = dx / length;

    const parallel = (offset: number, width: number): void => {
      this.line(
        bond.x1 + nx * offset,
        bond.y1 + ny * offset,
        bond.x2 + nx * offset,
        bond.y2 + ny * offset,
        width,
      );
    };

    if (bond.type === '=') {
      parallel(DOUBLE_OFFSET, DOUBLE_WIDTH);
      parallel(-DOUBLE_OFFSET, DOUBLE_WIDTH);
    } else if (bond.type === '~') {
      parallel(TRIPLE_OFFSET, TRIPLE_SIDE_WIDTH);
      parallel(0, DOUBLE_WIDTH);
      parallel(-TRIPLE_OFFSET, TRIPLE_SIDE_WIDTH);
    } else {
      parallel(0, SINGLE_WIDTH);
    }
  }

  circle(cx: number, cy: number, r: number): void {
    this.strokes.push(`<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(r)}" stroke-width="${DOUBLE_WIDTH}" />`);
    this.include(cx, cy, r);
  }

  /** Подпись атома на подложке: подложка прячет линию связи под текстом. */
  label(x: number, y: number, rawLabel: string): void {
    const text = formatChemLabel(rawLabel);

    if (!text) return;

    const box = labelBox(rawLabel);

    this.labels.push(
      `<rect class="rte-chemistry__label-bg" x="${fmt(x - box.width / 2)}" y="${fmt(y - box.height / 2)}" `
        + `width="${fmt(box.width)}" height="${fmt(box.height)}" rx="${LABEL_RADIUS}" fill="#fff" />`
        + `<text x="${fmt(x)}" y="${fmt(y + LABEL_BASELINE_SHIFT)}">${escapeXml(text)}</text>`,
    );
    this.include(x, y, box.width / 2, box.height / 2);
  }

  /** Рамка картинки с полями: viewBox и масштаб, которым он ложится в пиксели. */
  frame(scale: number): CanvasFrame {
    const safeScale = scale > 0 && Number.isFinite(scale) ? scale : 1;
    const hasContent = Number.isFinite(this.minX);

    return {
      minX: hasContent ? this.minX - PADDING : 0,
      minY: hasContent ? this.minY - PADDING : 0,
      width: hasContent ? this.maxX - this.minX + PADDING * 2 : PADDING * 2,
      height: hasContent ? this.maxY - this.minY + PADDING * 2 : PADDING * 2,
      scale: safeScale,
    };
  }

  toSvg(scale: number): string {
    const { minX, minY, width, height, scale: safeScale } = this.frame(scale);

    return (
      `<svg class="rte-chemistry__svg" xmlns="http://www.w3.org/2000/svg" `
      + `viewBox="${fmt(minX)} ${fmt(minY)} ${fmt(width)} ${fmt(height)}" `
      + `width="${Math.round(width * safeScale)}" height="${Math.round(height * safeScale)}" `
      + `role="presentation" aria-hidden="true" focusable="false">`
      + `<g class="rte-chemistry__bonds" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">`
      + this.strokes.join('')
      + '</g>'
      + `<g class="rte-chemistry__labels" fill="currentColor" font-family="system-ui, Arial, sans-serif" `
      + `font-size="${LABEL_FONT_SIZE}" font-weight="600" text-anchor="middle">`
      + this.labels.join('')
      + '</g></svg>'
    );
  }
}

/** Направление вершины кольца от его центра, в градусах как в коде. */
export const ringVertexAngle = (size: number, index: number): number =>
  (RING_START_ANGLES[size] ?? 90) - (index * 360) / size;

/** Вершины правильного многоугольника вокруг начала координат, по часовой на экране. */
const ringVertices = (size: number): Array<{ x: number; y: number; angle: number }> =>
  Array.from({ length: size }, (_, index) => {
    const angle = ringVertexAngle(size, index);
    const radians = (angle * Math.PI) / 180;

    return {
      x: RING_RADIUS * Math.cos(radians),
      y: -RING_RADIUS * Math.sin(radians),
      angle,
    };
  });

/**
 * Структура, разложенная на плоскости в собственных координатах: атомы и
 * линии связей со ссылками на модель. По ней рисуется SVG и строится
 * раскладка для конструктора — поэтому они не расходятся.
 */
interface ChemScene {
  atoms: ChemLayoutAtom[];
  bonds: Array<{ ref: ChemBond | RingBondRef; placed: PlacedBond }>;
  /** Радиус окружности ароматического кольца. */
  circle: number | null;
  /** Цепочка без связей: одинокий узел всё равно должен занять место. */
  lone: boolean;
}

const placeRing = (ring: ChemRing): ChemScene => {
  const vertices = ringVertices(ring.size);
  const scene: ChemScene = { atoms: [], bonds: [], circle: null, lone: false };

  if (ring.aromatic) {
    const apothem = RING_RADIUS * Math.cos(Math.PI / ring.size);

    scene.circle = Math.max(apothem - AROMATIC_INSET, RING_RADIUS / 4);
  }

  vertices.forEach((vertex, index) => {
    const next = vertices[(index + 1) % ring.size];

    if (!next) return;

    scene.bonds.push({
      ref: { ring, index },
      placed: {
        type: ring.bonds[index] ?? '-',
        x1: vertex.x,
        y1: vertex.y,
        x2: next.x,
        y2: next.y,
        angle: 0,
      },
    });
  });

  // Атом вершины кладём в саму вершину: подпись заменяет углерод, заместители
  // уходят наружу от центра.
  vertices.forEach((vertex, index) => {
    const atom = ring.vertices[index];

    if (!atom) return;

    const layout = layoutChemTree(atom, vertex.x, vertex.y, {
      startAngle: vertex.angle,
      outwardAngle: vertex.angle,
    });

    layout.bonds.forEach((placed) => {
      if (placed.source) scene.bonds.push({ ref: placed.source, placed });
    });
    layout.atoms.forEach((placed) => {
      scene.atoms.push({ atom: placed.atom, x: placed.x, y: placed.y, ring: placed.atom === atom });
    });
  });

  return scene;
};

const placeStructure = (structure: ChemStructure): ChemScene => {
  if (structure.kind === 'ring') return placeRing(structure);

  const layout = layoutChemTree(structure.root, 0, 0, { startAngle: structure.startAngle });
  const scene: ChemScene = { atoms: [], bonds: [], circle: null, lone: layout.bonds.length === 0 };

  layout.bonds.forEach((placed) => {
    if (placed.source) scene.bonds.push({ ref: placed.source, placed });
  });
  layout.atoms.forEach((placed) => {
    scene.atoms.push({ atom: placed.atom, x: placed.x, y: placed.y, ring: false });
  });

  return scene;
};

/** Рисует сцену на холсте: окружность, линии связей, подписи. */
const drawScene = (scene: ChemScene): SvgCanvas => {
  const canvas = new SvgCanvas();

  if (scene.circle !== null) canvas.circle(0, 0, scene.circle);

  scene.bonds.forEach(({ placed }) => canvas.bond(placed));
  scene.atoms.forEach((placed) => canvas.label(placed.x, placed.y, placed.atom.label));

  if (scene.lone) canvas.include(0, 0, LABEL_HEIGHT / 2);

  return canvas;
};

/** SVG структуры; `scale` — масштаб картинки, подписи считаются при кегле 12. */
export const renderChemistrySvg = (
  structure: ChemStructure,
  options: ChemistrySvgOptions = {},
): string => drawScene(placeStructure(structure)).toSvg(options.scale ?? 1);

/** Раскладка структуры в координатах `renderChemistrySvg` (с учётом полей и масштаба). */
export const layoutChemistry = (
  structure: ChemStructure,
  options: ChemistrySvgOptions = {},
): ChemLayout => {
  const scene = placeStructure(structure);
  const frame = drawScene(scene).frame(options.scale ?? 1);
  const toX = (x: number): number => (x - frame.minX) * frame.scale;
  const toY = (y: number): number => (y - frame.minY) * frame.scale;

  return {
    width: Math.round(frame.width * frame.scale),
    height: Math.round(frame.height * frame.scale),
    atoms: scene.atoms.map((placed) => ({ ...placed, x: toX(placed.x), y: toY(placed.y) })),
    bonds: scene.bonds.map(({ ref, placed }) => ({
      bond: ref,
      x1: toX(placed.x1),
      y1: toY(placed.y1),
      x2: toX(placed.x2),
      y2: toY(placed.y2),
    })),
  };
};

/**
 * Код chemfig → SVG. `null`, если код не разобрать: вызывающий показывает
 * сам код, а документ остаётся целым.
 */
export const chemfigToSvg = (code: string, options: ChemistrySvgOptions = {}): string | null => {
  const structure = tryParseChemfig(code);

  return structure ? renderChemistrySvg(structure, options) : null;
};
