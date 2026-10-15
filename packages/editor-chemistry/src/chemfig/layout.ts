import { formatChemLabel } from './format-label';
import type { ChemAtom, ChemBond, ChemBondType } from './types';

/** Метрики подписи в пикселях при кегле 12: ширина по числу знаков. */
export const LABEL_CHAR_WIDTH = 9;
export const LABEL_PADDING = 8;
export const LABEL_HEIGHT = 18;

/** Минимальная длина связи и зазор между подписями на её концах. */
const MIN_BOND_LENGTH = 48;
const BOND_GAP = 22;

/** Углы ветвей без явного угла относительно направления цепи: вверх, вниз, затем наискось. */
const DEFAULT_BRANCH_OFFSETS = [90, -90, 45, -45, 135, -135];

export interface LabelBox {
  width: number;
  height: number;
}

export interface PlacedAtom {
  atom: ChemAtom;
  x: number;
  y: number;
}

export interface PlacedBond {
  type: ChemBondType;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Направление в градусах, как в коде: 0 — вправо, против часовой. */
  angle: number;
}

export interface TreeLayoutOptions {
  /** Направление первой связи без явного угла. */
  startAngle: number;
  /**
   * Направление «наружу» для заместителя кольца: явный угол, смотрящий
   * внутрь кольца, разворачивается — иначе заместитель лёг бы на кольцо.
   */
  outwardAngle?: number;
}

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

export const normalizeAngle = (degrees: number): number => ((degrees % 360) + 360) % 360;

/** Габарит подписи; пустая подпись — точка без рамки. */
export const labelBox = (label: string): LabelBox => {
  const text = formatChemLabel(label);

  return text
    ? { width: text.length * LABEL_CHAR_WIDTH + LABEL_PADDING, height: LABEL_HEIGHT }
    : { width: 0, height: 0 };
};

/** Половина габарита подписи вдоль направления связи: на столько связь надо удлинить. */
const halfExtentAlong = (label: string, angleRad: number): number => {
  const box = labelBox(label);

  return (box.width / 2) * Math.abs(Math.cos(angleRad)) + (box.height / 2) * Math.abs(Math.sin(angleRad));
};

/**
 * Раскладка дерева атомов на плоскости.
 *
 * Обход рекурсивный: каждый атом кладёт свои связи, а их цели — свои. Список
 * размещённых атомов и связей общий для всего обхода, поэтому живёт в полях.
 * Координаты экранные: ось y вниз, угол 0 — вправо, растёт против часовой.
 */
export class ChemTreeLayout {
  readonly atoms: PlacedAtom[] = [];

  readonly bonds: PlacedBond[] = [];

  private readonly visited = new Set<ChemAtom>();

  constructor(private readonly options: TreeLayoutOptions) {}

  /** Кладёт атом в точку и рекурсивно всё, что к нему привязано. */
  place(atom: ChemAtom, x: number, y: number, incomingAngle: number | null = null): void {
    if (this.visited.has(atom)) return;

    this.visited.add(atom);
    this.atoms.push({ atom, x, y });

    const base = incomingAngle ?? this.options.startAngle;
    let branchIndex = 0;

    atom.bonds.forEach((bond) => {
      const angle = this.resolveAngle(bond, base, branchIndex);

      if (bond.branch && bond.angle === null) branchIndex += 1;

      const radians = toRadians(angle);
      const length = Math.max(
        MIN_BOND_LENGTH,
        Math.round(halfExtentAlong(atom.label, radians) + halfExtentAlong(bond.target.label, radians) + BOND_GAP),
      );

      const x2 = x + length * Math.cos(radians);
      const y2 = y - length * Math.sin(radians);

      this.bonds.push({ type: bond.type, x1: x, y1: y, x2, y2, angle });
      this.place(bond.target, x2, y2, angle);
    });
  }

  /**
   * Угол связи: явный — как задан (у заместителя кольца с разворотом
   * наружу), ветвь без угла — поперёк цепи, продолжение — по цепи.
   */
  private resolveAngle(bond: ChemBond, base: number, branchIndex: number): number {
    if (bond.angle !== null) return this.towardsOutside(bond.angle);

    if (!bond.branch) return normalizeAngle(base);

    const offset = DEFAULT_BRANCH_OFFSETS[branchIndex % DEFAULT_BRANCH_OFFSETS.length] ?? 90;

    return normalizeAngle(base + offset);
  }

  private towardsOutside(angle: number): number {
    const { outwardAngle } = this.options;

    if (outwardAngle === undefined) return normalizeAngle(angle);

    const inward = Math.cos(toRadians(angle - outwardAngle)) < -0.1;

    return normalizeAngle(inward ? angle + 180 : angle);
  }
}

/** Раскладывает дерево от корня в точке (x, y). */
export const layoutChemTree = (
  root: ChemAtom,
  x: number,
  y: number,
  options: TreeLayoutOptions,
): ChemTreeLayout => {
  const layout = new ChemTreeLayout(options);

  layout.place(root, x, y);

  return layout;
};
