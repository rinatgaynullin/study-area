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
    expect(serializeChemfig(parseChemfig('[:30]**6(------)'))).toBe('**6(------)');
    expect(serializeChemfig(parseChemfig('CH_3-*6(------)'))).toBe('*6((-CH_3)------)');
    expect(serializeChemfig(parseChemfig('[:60]A-B'))).toBe('[:60]A-B');
  });

  it('безымянный корень без связей кодом не становится', () => {
    expect(serializeChemfig({ kind: 'chain', root: { label: '', bonds: [] }, startAngle: 0 })).toBe('');
  });
});
