import { describe, expect, it } from 'vitest';
import { chemfigToSvg, parseChemfig, serializeChemfig } from '../src';
import { CHEMISTRY_TEMPLATES } from '../src/templates';

/** Свои примеры: цепочки с ветвями и углами, кольца с заместителями и префиксом, кратные связи. */
const EXAMPLES = [
  'CH_3-C(=[1]O)-[7]OH',
  'H-C(-[2]H)(-[6]H)-H',
  '[:30]-[:-30]-[:30]-[:-30]',
  '[2]CH_3-CH_2',
  'HO-CH_2-CH(-OH)-CH_2-OH',
  'CH_3-C(-[:90]CH_3)(-[:-90]CH_3)-CH_3',
  'CH_2=CH-C~N',
  'N~N',
  'C=O',
  'Si(CH_3)_3-Cl',
  'SO_4^{2-}',
  'X',
  'A-',
  '[:0][x]A-[][y]B',
  '**6(------)',
  '[:30]**6(------)',
  '*6(=-=-=-)',
  '*6(-=-N=-=)',
  '**6(---(-OH)---)',
  '**6(---(-[:90]OH)---)',
  'CH_3-*6(------)',
  'CH_3-*6(N(-OH)------)',
  'N*5(-----)',
  '*5((-[:90]CH_2-CH_3)----=)',
  '*3(---)',
  '*8(-=-=-=-=)',
  '**6(-(-NO_2)-(-[:270]Cl)---(=O)-)',
];

const roundTrip = (code: string): void => {
  const model = parseChemfig(code);
  const serialized = serializeChemfig(model);

  expect(parseChemfig(serialized), `${code} → ${serialized}`).toEqual(model);
};

describe('serializeChemfig', () => {
  it('шаблоны диалога переживают разбор после записи', () => {
    CHEMISTRY_TEMPLATES.forEach((template) => roundTrip(template.code));
  });

  it('свои примеры переживают разбор после записи', () => {
    EXAMPLES.forEach(roundTrip);
  });

  it('картинка после записи та же, что у исходного кода', () => {
    [...CHEMISTRY_TEMPLATES.map((template) => template.code), ...EXAMPLES].forEach((code) => {
      expect(chemfigToSvg(serializeChemfig(parseChemfig(code))), code).toBe(chemfigToSvg(code));
    });
  });

  it('пишет углы явно, ветви — в скобках, кольцо — по вершинам', () => {
    expect(serializeChemfig(parseChemfig('CH_3-C(=[1]O)-[7]OH'))).toBe('CH_3-C(=[:45]O)-[:315]OH');
    // Поворот кольца рендер не использует, но в коде он остаётся.
    expect(serializeChemfig(parseChemfig('[:30]**6(------)'))).toBe('[:30]**6(------)');
    expect(serializeChemfig(parseChemfig('CH_3-*6(------)'))).toBe('*6((-CH_3)------)');
    expect(serializeChemfig(parseChemfig('[:60]A-B'))).toBe('[:60]A-B');
  });

  it('безымянный корень без связей кодом не становится', () => {
    expect(serializeChemfig({ kind: 'chain', root: { label: '', bonds: [] }, startAngle: 0 })).toBe('');
  });
});

describe('параметры связей, которые модель хранит не целиком', () => {
  const LOSSLESS = ['[:30]-[::-60]-[::60]OH', 'A-[:30,1.5]B', 'A-[2,0.8]B', '[::30]A-B', '[:30,2]A-B', 'A(-[::90,1.2]C)-B'];

  it('круговой разбор даёт исходную строку', () => {
    LOSSLESS.forEach((code) => {
      expect(serializeChemfig(parseChemfig(code))).toBe(code);
    });
  });

  it('связь запоминает исходный текст параметров, угол без потерь — нет', () => {
    const structure = parseChemfig('A-[:30,1.5]B-[::60]C-[2]D');

    if (structure.kind !== 'chain') throw new Error('ждали цепочку');

    const first = structure.root.bonds[0];
    const second = first?.target.bonds[0];
    const third = second?.target.bonds[0];

    expect(first?.spec).toBe(':30,1.5');
    expect(first?.angle).toBe(30);
    expect(second?.spec).toBe('::60');
    expect(second?.angle).toBeNull();
    expect(third?.spec).toBeUndefined();
    expect(third?.angle).toBe(90);
  });
});

describe('цепочка перед кольцом', () => {
  it('к вершине примыкает последний атом префикса, типы связей сохраняются', () => {
    const structure = parseChemfig('CH_3=CH-CH_2-*6(------)');

    if (structure.kind !== 'ring') throw new Error('ждали кольцо');

    const near = structure.vertices[0]?.bonds[0]?.target;
    const middle = near?.bonds[0];
    const far = middle?.target.bonds[0];

    expect(near?.label).toBe('CH_2');
    expect(middle?.type).toBe('-');
    expect(middle?.target.label).toBe('CH');
    expect(far?.type).toBe('=');
    expect(far?.target.label).toBe('CH_3');
    expect(structure.lossy).toBeUndefined();
    expect(serializeChemfig(parseChemfig('CH_3-CH_2-*6(------)'))).toBe('*6((-CH_2-CH_3)------)');
  });
});

describe('потери при разборе помечаются', () => {
  it('структуры, которые модель не повторит без потерь, помечены lossy', () => {
    [
      'CH_3(-OH)-*6(------)',
      'CH_3-[:30]CH_2-*6(------)',
      'A*6(B-----)',
      'A-B*6(------)',
      '*6(---)',
      '*6(-------)',
      '*6(------X)',
    ].forEach((code) => {
      expect(parseChemfig(code).lossy, code).toBe(true);
    });
  });

  it('шаблоны и обычные префиксы не помечены', () => {
    [...CHEMISTRY_TEMPLATES.map((template) => template.code), 'CH_3-*6(------)', 'N*5(-----)', '[:30]**6(------)'].forEach(
      (code) => {
        expect(parseChemfig(code).lossy, code).toBeUndefined();
      },
    );
  });
});
