import { describe, expect, it } from 'vitest';
import {
  ChemfigSyntaxError,
  formatChemLabel,
  parseChemfig,
  tryParseChemfig,
  unwrapChemfig,
  type ChemChain,
  type ChemRing,
} from '../src';

const chain = (code: string): ChemChain => {
  const structure = parseChemfig(code);

  if (structure.kind !== 'chain') throw new Error(`Ожидалась цепочка, получено кольцо: ${code}`);

  return structure;
};

const ring = (code: string): ChemRing => {
  const structure = parseChemfig(code);

  if (structure.kind !== 'ring') throw new Error(`Ожидалось кольцо, получена цепочка: ${code}`);

  return structure;
};

describe('обёртка и подписи', () => {
  it('снимает \\chemfig{…} в обоих написаниях', () => {
    expect(unwrapChemfig('\\chemfig{CH_3-OH}')).toBe('CH_3-OH');
    expect(unwrapChemfig('\\\\chemfig{ CH_3-OH }')).toBe('CH_3-OH');
    expect(unwrapChemfig('  CH_3-OH ')).toBe('CH_3-OH');
  });

  it('переводит индексы и степени в юникод', () => {
    expect(formatChemLabel('CH_3')).toBe('CH₃');
    expect(formatChemLabel('SO_4^{2-}')).toBe('SO₄²⁻');
    expect(formatChemLabel('CH3')).toBe('CH₃');
    expect(formatChemLabel('H_{12}')).toBe('H₁₂');
    expect(formatChemLabel('Na^+')).toBe('Na⁺');
    expect(formatChemLabel('')).toBe('');
  });
});

describe('цепочки', () => {
  it('читает атомы, связи и углы', () => {
    const { root, startAngle } = chain('[:30]CH_3-CH=[1]CH_2~N');

    expect(startAngle).toBe(30);
    expect(root.label).toBe('CH_3');

    const [toCH] = root.bonds;

    expect(toCH.type).toBe('-');
    expect(toCH.angle).toBeNull();
    expect(toCH.branch).toBe(false);

    const [toCH2] = toCH.target.bonds;

    expect(toCH2.type).toBe('=');
    // `[1]` — доли по 45°.
    expect(toCH2.angle).toBe(45);

    const [toN] = toCH2.target.bonds;

    expect(toN.type).toBe('~');
    expect(toN.target.label).toBe('N');
    expect(toN.target.bonds).toHaveLength(0);
  });

  it('ветви в скобках помечены и идут перед продолжением цепи', () => {
    const { root } = chain('H-C(-[2]H)(-[6]H)-H');
    const carbon = root.bonds[0].target;

    expect(carbon.label).toBe('C');
    expect(carbon.bonds.map((bond) => [bond.branch, bond.angle])).toEqual([
      [true, 90],
      [true, 270],
      [false, null],
    ]);
  });

  it('пропускает параметры связи кроме угла и считает `[:` абсолютным углом', () => {
    const { root } = chain('A-[,2]B-[:-45]C');

    expect(root.bonds[0].angle).toBeNull();
    expect(root.bonds[0].target.bonds[0].angle).toBe(-45);
  });

  it('скобки без связи внутри — часть подписи', () => {
    const { root } = chain('Si(CH_3)_3-Cl');

    expect(root.label).toBe('Si(CH_3)_3');
    expect(root.bonds[0].target.label).toBe('Cl');
  });

  it('безымянный корень с одной связью допустим', () => {
    const { root } = chain('-OH');

    expect(root.label).toBe('');
    expect(root.bonds[0].target.label).toBe('OH');
  });
});

describe('кольца', () => {
  it('бензол: шесть вершин, ароматическое, связи по умолчанию', () => {
    const benzene = ring('[:30]**6(------)');

    expect(benzene.size).toBe(6);
    expect(benzene.aromatic).toBe(true);
    expect(benzene.bonds).toEqual(['-', '-', '-', '-', '-', '-']);
    expect(benzene.vertices.every((vertex) => vertex === null)).toBe(true);
  });

  it('типы связей по сторонам и недостающие связи дополняются одинарными', () => {
    expect(ring('*6(=-=-=-)').bonds).toEqual(['=', '-', '=', '-', '=', '-']);
    expect(ring('*5(-=)').bonds).toEqual(['-', '=', '-', '-', '-']);
    expect(ring('*5(-----)').aromatic).toBe(false);
  });

  it('текст между связями принадлежит вершине, до которой дошли', () => {
    const pyridine = ring('*6(-=-N=-=)');

    expect(pyridine.vertices[3]?.label).toBe('N');
    expect(pyridine.vertices.filter(Boolean)).toHaveLength(1);
  });

  it('заместитель в скобках — связи вершины наружу', () => {
    const phenol = ring('**6(---(-OH)---)');
    const vertex = phenol.vertices[3];

    expect(vertex?.label).toBe('');
    expect(vertex?.bonds[0].type).toBe('-');
    expect(vertex?.bonds[0].target.label).toBe('OH');

    const toluene = ring('**6(-=-(-CH_3)(-Cl)=-=)');

    expect(toluene.vertices[3]?.bonds.map((bond) => bond.target.label)).toEqual(['CH_3', 'Cl']);
  });

  it('префикс перед кольцом: с связью — заместитель первой вершины, без — её подпись', () => {
    const methylRing = ring('CH_3-*6(------)');

    expect(methylRing.vertices[0]?.label).toBe('');
    expect(methylRing.vertices[0]?.bonds[0].target.label).toBe('CH_3');

    const pyrrole = ring('N*5(-=--=)');

    expect(pyrrole.vertices[0]?.label).toBe('N');
  });
});

describe('ошибки', () => {
  it.each([
    ['', 'Empty'],
    ['\\chemfig{}', 'Empty'],
    ['A-(B', 'Unclosed'],
    ['A-B)', 'Unexpected'],
    ['A(-B', 'Expected ")"'],
    ['*9(---------)', 'not supported'],
    ['*6(------)-CH_3', 'Unexpected'],
    ['A-[:30', 'Unclosed'],
  ])('%s → ChemfigSyntaxError (%s)', (code, fragment) => {
    expect(() => parseChemfig(code)).toThrow(ChemfigSyntaxError);
    expect(() => parseChemfig(code)).toThrow(fragment);
    expect(tryParseChemfig(code)).toBeNull();
  });

  it('tryParseChemfig возвращает структуру для корректного кода', () => {
    expect(tryParseChemfig('CH_3-OH')?.kind).toBe('chain');
  });
});
