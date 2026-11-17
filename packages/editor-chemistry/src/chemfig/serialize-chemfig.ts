import type { ChemAtom, ChemBond, ChemRing, ChemStructure } from './types';

/**
 * Угол связи в квадратных скобках. Без угла скобок нет — кроме случая, когда
 * подпись цели сама начинается с `[`: тогда пустые `[]` не дают разбору
 * принять её начало за угол.
 */
const angleSpec = (angle: number | null, nextLabel: string): string => {
  if (angle !== null) return `[:${String(angle)}]`;

  return nextLabel.startsWith('[') ? '[]' : '';
};

/**
 * Атом с его связями: ветви — в скобках, продолжение цепи (последняя связь не
 * в скобках) — следом. У вершины кольца продолжения нет: знак связи на
 * верхнем уровне там — сторона кольца, поэтому все связи идут ветвями.
 */
const serializeAtom = (atom: ChemAtom, onlyBranches: boolean): string => {
  const continuation = onlyBranches ? null : atom.bonds.filter((bond) => !bond.branch).pop() ?? null;
  const branches = atom.bonds
    .filter((bond) => bond !== continuation)
    .map((bond) => `(${serializeBond(bond)})`)
    .join('');

  return atom.label + branches + (continuation ? serializeBond(continuation) : '');
};

const serializeBond = (bond: ChemBond): string =>
  bond.type + angleSpec(bond.angle, bond.target.label) + serializeAtom(bond.target, false);

/**
 * Кольцо `*n(…)`: фрагмент вершины стоит перед знаком своей стороны. Префикс
 * перед `*` не нужен — разбор кладёт его в первую вершину, туда же его и
 * пишем.
 */
const serializeRing = (ring: ChemRing): string => {
  const sides = Array.from({ length: ring.size }, (_, index) => {
    const vertex = ring.vertices[index];

    return (vertex ? serializeAtom(vertex, true) : '') + (ring.bonds[index] ?? '-');
  });

  return `${ring.aromatic ? '**' : '*'}${ring.size}(${sides.join('')})`;
};

/**
 * Код chemfig для модели: `parseChemfig(serializeChemfig(s))` даёт равную
 * модель. Пустая модель (безымянный корень без связей) даёт пустую строку —
 * её вызывающий обрабатывает сам.
 */
export const serializeChemfig = (structure: ChemStructure): string => {
  if (structure.kind === 'ring') return serializeRing(structure);

  const { root, startAngle } = structure;

  if (!root.label && root.bonds.length === 0) return '';

  const prefix = startAngle === 0 ? angleSpec(null, root.label) : `[:${String(startAngle)}]`;

  return prefix + serializeAtom(root, false);
};
