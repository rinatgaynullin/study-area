import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chemfigToSvg, layoutChemistry, parseChemfig, type ChemAtom, type ChemStructure } from '../src';
import { CHEMISTRY_TEMPLATES } from '../src/templates';

/**
 * SVG, снятые рендером до того, как он стал строиться по общей раскладке:
 * картинки сохранённых формул не должны измениться ни на символ.
 */
const BASELINE: Record<string, string> = JSON.parse(
  readFileSync(resolve(process.cwd(), 'packages/editor-chemistry/tests/fixtures/chemfig-svg.json'), 'utf8'),
);

/** Атомы и связи модели: обход дерева цепочки или вершин кольца с заместителями. */
const countModel = (structure: ChemStructure): { atoms: number; bonds: number } => {
  let atoms = 0;
  let bonds = 0;

  const walk = (atom: ChemAtom): void => {
    atoms += 1;
    atom.bonds.forEach((bond) => {
      bonds += 1;
      walk(bond.target);
    });
  };

  if (structure.kind === 'chain') {
    walk(structure.root);
  } else {
    bonds += structure.size;
    structure.vertices.forEach((vertex) => {
      if (vertex) walk(vertex);
    });
  }

  return { atoms, bonds };
};

const CODES = [
  ...CHEMISTRY_TEMPLATES.map((template) => template.code),
  'CH_3-*6(------)',
  '*6(-=-N=-=)',
  'HO-CH_2-CH(-OH)-CH_2-OH',
  'X',
];

describe('layoutChemistry', () => {
  it('SVG шаблонов и примеров совпадает со снятым до правки рендера байт в байт', () => {
    const entries = Object.entries(BASELINE);

    expect(entries.length).toBeGreaterThan(40);

    entries.forEach(([key, svg]) => {
      const [code, scale] = key.split(' @');

      expect(chemfigToSvg(code ?? '', scale ? { scale: Number(scale) } : {}), key).toBe(svg);
    });
  });

  it('число атомов и связей совпадает с моделью, координаты внутри картинки', () => {
    CODES.forEach((code) => {
      const structure = parseChemfig(code);
      const layout = layoutChemistry(structure);
      const expected = countModel(structure);

      expect(layout.atoms, code).toHaveLength(expected.atoms);
      expect(layout.bonds, code).toHaveLength(expected.bonds);

      const inside = (x: number, y: number): boolean =>
        x >= 0 && y >= 0 && x <= layout.width && y <= layout.height;

      layout.atoms.forEach((atom) => expect(inside(atom.x, atom.y), code).toBe(true));
      layout.bonds.forEach((bond) => {
        expect(inside(bond.x1, bond.y1) && inside(bond.x2, bond.y2), code).toBe(true);
      });
    });
  });

  it('размер раскладки — размер SVG, масштаб растягивает координаты', () => {
    const structure = parseChemfig('CH_3-CH_2-OH');
    const svg = chemfigToSvg('CH_3-CH_2-OH', { scale: 2 }) ?? '';
    const layout = layoutChemistry(structure, { scale: 2 });
    const base = layoutChemistry(structure);

    expect(svg).toContain(`width="${layout.width}" height="${layout.height}"`);
    expect(layout.atoms[1]?.x).toBeCloseTo((base.atoms[1]?.x ?? 0) * 2, 5);
  });

  it('ссылки ведут на узлы модели; вершины кольца помечены', () => {
    const structure = parseChemfig('**6(---(-OH)---)');

    if (structure.kind !== 'ring') throw new Error('ждали кольцо');

    const layout = layoutChemistry(structure);
    const vertex = structure.vertices[3];

    expect(layout.atoms.map((atom) => atom.ring)).toEqual([true, false]);
    expect(layout.atoms[0]?.atom).toBe(vertex);
    expect(layout.bonds[0]?.bond).toEqual({ ring: structure, index: 0 });
    expect(layout.bonds[6]?.bond).toBe(vertex?.bonds[0]);
  });
});
