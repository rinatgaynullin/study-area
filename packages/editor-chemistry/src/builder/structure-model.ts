/**
 * Правки модели структуры для конструктора: чистые вычисления над
 * `ChemStructure` и её раскладкой. Состояние (выделение, история, DOM) — в
 * `StructureEditor`, здесь только то, что можно проверить без него.
 */
import { normalizeAngle } from '../chemfig/layout';
import { tryParseChemfig } from '../chemfig/parse-chemfig';
import { ringVertexAngle, type ChemLayout } from '../chemfig/render-svg';
import { serializeChemfig } from '../chemfig/serialize-chemfig';
import type { ChemAtom, ChemBond, ChemBondType, ChemChain, ChemRing, ChemStructure } from '../chemfig/types';

/** Восемь направлений «плюсов» вокруг атома, в градусах как в коде. */
export const PLUS_DIRECTIONS = [0, 45, 90, 135, 180, 225, 270, 315];

/** Направление занято, если ближе этого к нему уже идёт связь. */
const BUSY_SECTOR = 30;

/** Порог разворота заместителя кольца — тот же, что в раскладке (`towardsOutside`). */
const INWARD_COS = -0.1;

/** Совпадение точек раскладки: концы связи и центр атома считаются в одной арифметике. */
const SAME_POINT = 0.5;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/** Угол между направлениями, от 0 до 180. */
export const angularDistance = (a: number, b: number): number => {
  const difference = normalizeAngle(a - b);

  return Math.min(difference, 360 - difference);
};

const emptyAtom = (): ChemAtom => ({ label: '', bonds: [] });

/**
 * Код в модель конструктора. Безымянные вершины кольца становятся атомами
 * без подписи: их можно выделить, а в код они пишутся так же пусто.
 */
export const parseForEditing = (code: string): ChemStructure | null => {
  const structure = tryParseChemfig(code);

  if (structure?.kind === 'ring') {
    structure.vertices = structure.vertices.map((vertex) => vertex ?? emptyAtom());
  }

  return structure;
};

/** Код структуры; пустая строка — структуры нет. */
export const structureCode = (structure: ChemStructure | null): string =>
  structure ? serializeChemfig(structure) : '';

/**
 * Своя группа: `C2H5` → `C_2H_5`, `C6H12O6` → `C_6H_{12}O_6`. Цифры после
 * буквы или скобки становятся индексами; пробелы выбрасываются. Подпись принимается, только если сама по
 * себе разбирается как одиночный атом — иначе код структуры сломался бы.
 */
export const normalizeGroupLabel = (input: string): string | null => {
  const compact = input.replace(/\s+/g, '');

  if (!/[A-Za-z]/.test(compact) || !/^[A-Za-z0-9_^{}()+]+$/.test(compact)) return null;

  // Многозначный индекс — в фигурных скобках: chemfig опускает в индекс
  // только первую цифру после `_`, `C_12` дал бы C₁2.
  const label = compact.replace(/(?<=[A-Za-z)])(\d+)/g, (digits: string) =>
    digits.length > 1 ? `_{${digits}}` : `_${digits}`,
  );
  const parsed = tryParseChemfig(label);

  return parsed?.kind === 'chain' && parsed.root.label === label && parsed.root.bonds.length === 0
    ? label
    : null;
};

/** Где атом в структуре: связь от родителя и вершина кольца, к которой относится его дерево. */
export interface AtomPlace {
  parent: ChemAtom | null;
  /** Номер вершины кольца, чьё дерево содержит атом; `null` — цепочка. */
  vertex: number | null;
}

const walkTree = (atom: ChemAtom, parent: ChemAtom | null, visit: (atom: ChemAtom, parent: ChemAtom | null) => void): void => {
  visit(atom, parent);
  atom.bonds.forEach((bond) => walkTree(bond.target, atom, visit));
};

export const locateAtom = (structure: ChemStructure, atom: ChemAtom): AtomPlace | null => {
  const found: AtomPlace[] = [];
  const roots: Array<{ root: ChemAtom; vertex: number | null }> =
    structure.kind === 'chain'
      ? [{ root: structure.root, vertex: null }]
      : structure.vertices.flatMap((root, vertex) => (root ? [{ root, vertex }] : []));

  roots.forEach(({ root, vertex }) => {
    walkTree(root, null, (current, parent) => {
      if (current === atom) found.push({ parent, vertex });
    });
  });

  return found[0] ?? null;
};

/** Направление вершины кольца наружу, в пределах 0–360. */
const outwardAngle = (ring: ChemRing, vertex: number): number =>
  normalizeAngle(ringVertexAngle(ring.size, vertex));

/** Направления связей, уже выходящих из точки раскладки (к детям, к родителю, стороны кольца). */
const bondDirectionsAt = (layout: ChemLayout, x: number, y: number): number[] =>
  layout.bonds.flatMap((bond) => {
    const fromStart = Math.hypot(bond.x1 - x, bond.y1 - y) < SAME_POINT;
    const fromEnd = Math.hypot(bond.x2 - x, bond.y2 - y) < SAME_POINT;

    if (!fromStart && !fromEnd) return [];

    const dx = fromStart ? bond.x2 - x : bond.x1 - x;
    const dy = fromStart ? bond.y2 - y : bond.y1 - y;

    return [normalizeAngle((Math.atan2(-dy, dx) * 180) / Math.PI)];
  });

/**
 * Свободные направления «плюсов» у атома. У вершины кольца — один «плюс»
 * наружу, пока заместителя нет. В дереве заместителя кольца направление,
 * которое раскладка развернула бы наружу, не предлагается: «плюс» обещал бы
 * не то место, куда ляжет атом.
 */
export const freeDirections = (structure: ChemStructure, layout: ChemLayout, atom: ChemAtom): number[] => {
  const place = locateAtom(structure, atom);
  const placed = layout.atoms.find((item) => item.atom === atom);

  if (!place || !placed) return [];

  const outward = structure.kind === 'ring' && place.vertex !== null ? outwardAngle(structure, place.vertex) : null;

  if (outward !== null && place.parent === null) return atom.bonds.length === 0 ? [outward] : [];

  const busy = bondDirectionsAt(layout, placed.x, placed.y);

  return PLUS_DIRECTIONS.filter(
    (direction) =>
      busy.every((angle) => angularDistance(direction, angle) >= BUSY_SECTOR)
      && (outward === null || Math.cos(toRadians(direction - outward)) >= INWARD_COS),
  );
};

/**
 * Присоединяет к атому новый атом связью под явным углом. Первая связь атома
 * цепочки — продолжение, остальные — ветви перед продолжением: в таком
 * порядке их возвращает разбор. У вершины кольца связи — только ветви.
 */
export const attachAtom = (
  structure: ChemStructure,
  atom: ChemAtom,
  angle: number,
  type: ChemBondType,
  label: string,
): ChemAtom | null => {
  const place = locateAtom(structure, atom);

  if (!place) return null;

  const isVertex = place.vertex !== null && place.parent === null;
  const continuationIndex = atom.bonds.findIndex((bond) => !bond.branch);
  const branch = isVertex || continuationIndex !== -1;
  const target: ChemAtom = { label, bonds: [] };
  const bond: ChemBond = { type, angle: normalizeAngle(angle), branch, target };

  if (continuationIndex === -1) atom.bonds.push(bond);
  else atom.bonds.splice(continuationIndex, 0, bond);

  return target;
};

/**
 * Убирает атом со всем, что на нём держится. Корень цепочки и вершина
 * кольца без структуры не живут — тогда структуры больше нет (`null`).
 */
export const removeAtom = (structure: ChemStructure, atom: ChemAtom): ChemStructure | null => {
  const place = locateAtom(structure, atom);

  if (!place?.parent) return null;

  const { bonds } = place.parent;
  const index = bonds.findIndex((bond) => bond.target === atom);

  if (index !== -1) bonds.splice(index, 1);

  return structure;
};

/** Новая цепочка из одного атома. */
export const createChain = (label: string): ChemChain => ({
  kind: 'chain',
  root: { label, bonds: [] },
  startAngle: 0,
});

/** Новое кольцо: все вершины — безымянный углерод, все стороны одинарные. */
export const createRing = (size: number, aromatic: boolean): ChemRing => ({
  kind: 'ring',
  size,
  aromatic,
  bonds: Array.from({ length: size }, (): ChemBondType => '-'),
  vertices: Array.from({ length: size }, emptyAtom),
});

/** Можно ли начать кольцо: только на пустом полотне или у концевого корня цепочки. */
export type RingAvailability = 'empty' | 'attach' | 'has-ring' | 'not-root';

export const ringAvailability = (structure: ChemStructure | null, selected: ChemAtom | null): RingAvailability => {
  if (!structure) return 'empty';

  if (structure.kind === 'ring') return 'has-ring';

  return selected === structure.root && structure.root.bonds.length <= 1 ? 'attach' : 'not-root';
};

/**
 * Кольцо у концевого корня цепочки: цепочка становится заместителем той
 * вершины, чьё направление наружу ближе всего к направлению цепи, — так она
 * продолжает уходить от кольца, а не ложится на него.
 */
export const attachRing = (chain: ChemChain, layout: ChemLayout, ring: ChemRing): ChemRing => {
  const placed = layout.atoms.find((item) => item.atom === chain.root);
  const direction = placed ? bondDirectionsAt(layout, placed.x, placed.y)[0] : undefined;
  const scores = ring.vertices.map((_, index) =>
    direction === undefined ? index : angularDistance(outwardAngle(ring, index), direction),
  );
  const vertex = scores.indexOf(Math.min(...scores));
  const holder = ring.vertices[vertex];

  holder?.bonds.push({ type: '-', angle: outwardAngle(ring, vertex), branch: true, target: chain.root });

  return ring;
};
