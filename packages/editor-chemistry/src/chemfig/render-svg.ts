import { formatChemLabel } from './format-label';
import { LABEL_HEIGHT, labelBox, layoutChemTree, type PlacedBond } from './layout';
import { tryParseChemfig } from './parse-chemfig';
import type { ChemRing, ChemStructure } from './types';

export interface ChemistrySvgOptions {
  /** Масштаб картинки относительно естественного размера; 1 — подпись кеглем 12. */
  scale?: number;
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

  toSvg(scale: number): string {
    const safeScale = scale > 0 && Number.isFinite(scale) ? scale : 1;
    const hasContent = Number.isFinite(this.minX);
    const minX = hasContent ? this.minX - PADDING : 0;
    const minY = hasContent ? this.minY - PADDING : 0;
    const width = hasContent ? this.maxX - this.minX + PADDING * 2 : PADDING * 2;
    const height = hasContent ? this.maxY - this.minY + PADDING * 2 : PADDING * 2;

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

/** Вершины правильного многоугольника вокруг начала координат, по часовой на экране. */
const ringVertices = (size: number): Array<{ x: number; y: number; angle: number }> => {
  const start = RING_START_ANGLES[size] ?? 90;

  return Array.from({ length: size }, (_, index) => {
    const angle = start - (index * 360) / size;
    const radians = (angle * Math.PI) / 180;

    return {
      x: RING_RADIUS * Math.cos(radians),
      y: -RING_RADIUS * Math.sin(radians),
      angle,
    };
  });
};

const drawRing = (canvas: SvgCanvas, ring: ChemRing): void => {
  const vertices = ringVertices(ring.size);

  if (ring.aromatic) {
    const apothem = RING_RADIUS * Math.cos(Math.PI / ring.size);

    canvas.circle(0, 0, Math.max(apothem - AROMATIC_INSET, RING_RADIUS / 4));
  }

  vertices.forEach((vertex, index) => {
    const next = vertices[(index + 1) % ring.size];

    canvas.bond({
      type: ring.bonds[index] ?? '-',
      x1: vertex.x,
      y1: vertex.y,
      x2: next.x,
      y2: next.y,
      angle: 0,
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

    layout.bonds.forEach((bond) => canvas.bond(bond));
    layout.atoms.forEach((placed) => canvas.label(placed.x, placed.y, placed.atom.label));
  });
};

/** SVG структуры; `scale` — масштаб картинки, подписи считаются при кегле 12. */
export const renderChemistrySvg = (
  structure: ChemStructure,
  options: ChemistrySvgOptions = {},
): string => {
  const canvas = new SvgCanvas();

  if (structure.kind === 'ring') {
    drawRing(canvas, structure);
  } else {
    const layout = layoutChemTree(structure.root, 0, 0, { startAngle: structure.startAngle });

    layout.bonds.forEach((bond) => canvas.bond(bond));
    layout.atoms.forEach((placed) => canvas.label(placed.x, placed.y, placed.atom.label));

    // Одинокий безымянный узел без подписи всё равно должен занять место.
    if (layout.bonds.length === 0) canvas.include(0, 0, LABEL_HEIGHT / 2);
  }

  return canvas.toSvg(options.scale ?? 1);
};

/**
 * Код chemfig → SVG. `null`, если код не разобрать: вызывающий показывает
 * сам код, а документ остаётся целым.
 */
export const chemfigToSvg = (code: string, options: ChemistrySvgOptions = {}): string | null => {
  const structure = tryParseChemfig(code);

  return structure ? renderChemistrySvg(structure, options) : null;
};
