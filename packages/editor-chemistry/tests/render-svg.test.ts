import { sanitizeSvg } from '@rich-editor/core';
import { describe, expect, it } from 'vitest';
import { chemfigToSvg, layoutChemTree, parseChemfig, renderChemistrySvg } from '../src';

const count = (svg: string, tag: string): number => (svg.match(new RegExp(`<${tag}\\b`, 'g')) ?? []).length;

const texts = (svg: string): string[] =>
  [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((match) => match[1]);

const svgOf = (code: string): string => {
  const svg = chemfigToSvg(code);

  if (svg === null) throw new Error(`Код не разобран: ${code}`);

  return svg;
};

/** Центры подложек подписей: по ним видно, где лёг атом и не легли ли атомы друг на друга. */
const labelCenters = (svg: string): Array<[number, number]> =>
  [...svg.matchAll(/<rect [^>]*x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/g)].map(
    (match) => [
      Number(match[1]) + Number(match[3]) / 2,
      Number(match[2]) + Number(match[4]) / 2,
    ],
  );

const labelPositions = (svg: string): string[] =>
  labelCenters(svg).map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`);

describe('рендер chemfig в SVG', () => {
  it('бензол: шесть сторон и окружность внутри, без подписей', () => {
    const svg = svgOf('[:30]**6(------)');

    expect(count(svg, 'line')).toBe(6);
    expect(count(svg, 'circle')).toBe(1);
    expect(count(svg, 'text')).toBe(0);
  });

  it('циклогексан без окружности, двойные связи кольца — по две линии', () => {
    expect(count(svgOf('*6(------)'), 'circle')).toBe(0);
    // Три двойные (по две линии) и три одинарные.
    expect(count(svgOf('*6(=-=-=-)'), 'line')).toBe(9);
  });

  it('этанол: три подписи с индексами и две связи', () => {
    const svg = svgOf('CH_3-CH_2-OH');

    expect(texts(svg)).toEqual(['CH₃', 'CH₂', 'OH']);
    expect(count(svg, 'line')).toBe(2);
    expect(count(svg, 'rect')).toBe(3);
  });

  it('двойная и тройная связи рисуются двумя и тремя линиями', () => {
    expect(count(svgOf('C=O'), 'line')).toBe(2);
    expect(count(svgOf('N~N'), 'line')).toBe(3);
  });

  it('разветвлённая цепочка: атомы не накладываются, ветви уходят вверх и вниз', () => {
    const svg = svgOf('H-C(-[2]H)(-[6]H)-H');
    const positions = labelPositions(svg);

    expect(positions).toHaveLength(5);
    expect(new Set(positions).size).toBe(5);

    const { root } = parseChemfig('H-C(-H)(-H)-H') as Extract<ReturnType<typeof parseChemfig>, { kind: 'chain' }>;
    const layout = layoutChemTree(root, 0, 0, { startAngle: 0 });
    const carbonBonds = layout.bonds.filter((bond) => bond.x1 !== 0);

    // Ветви без угла идут поперёк цепи: одна вверх (y меньше), другая вниз.
    expect(carbonBonds.map((bond) => Math.sign(Math.round(bond.y2 - bond.y1)))).toEqual([-1, 1, 0]);
  });

  it('заместитель кольца уходит наружу от центра', () => {
    const svg = svgOf('**6(---(-OH)---)');
    const [[x, y]] = labelCenters(svg);

    expect(texts(svg)).toEqual(['OH']);
    // Кольцо радиусом 50 вокруг начала координат: подпись дальше радиуса.
    expect(Math.hypot(x, y)).toBeGreaterThan(50);
  });

  it('явный угол заместителя, смотрящий внутрь кольца, разворачивается наружу', () => {
    // Четвёртая вершина смотрит вниз-влево; `[:90]` вело бы вверх, сквозь кольцо.
    const [[x, y]] = labelCenters(svgOf('**6(---(-[:90]OH)---)'));

    expect(Math.hypot(x, y)).toBeGreaterThan(50);
    // Развёрнуто на 180°: вниз, то есть y растёт.
    expect(y).toBeGreaterThan(50);
  });

  it('подпись вершины заменяет углерод и ложится на вершину кольца', () => {
    const svg = svgOf('*6(-=-N=-=)');
    const [[x, y]] = labelCenters(svg);

    expect(texts(svg)).toEqual(['N']);
    expect(Math.hypot(x, y)).toBeCloseTo(50, 0);
  });

  it('масштаб меняет размеры картинки, но не viewBox', () => {
    const base = svgOf('CH_3-OH');
    const scaled = chemfigToSvg('CH_3-OH', { scale: 2 }) ?? '';

    const size = (svg: string): [number, number] => {
      const match = /width="(\d+)" height="(\d+)"/.exec(svg);

      return [Number(match?.[1]), Number(match?.[2])];
    };

    const viewBox = (svg: string): number[] =>
      (/viewBox="([^"]+)"/.exec(svg)?.[1] ?? '').split(' ').map(Number);

    expect(viewBox(scaled)).toEqual(viewBox(base));

    const [, , width, height] = viewBox(base);

    expect(size(base)).toEqual([Math.round(width), Math.round(height)]);
    expect(size(scaled)).toEqual([Math.round(width * 2), Math.round(height * 2)]);
  });

  it('подписи экранируются, цвета берутся из currentColor', () => {
    const svg = svgOf('A<b>-"C"');

    expect(svg).not.toContain('<b>');
    expect(svg).toContain('A&lt;b&gt;');
    expect(svg).toContain('&quot;C&quot;');
    expect(svg).toContain('stroke="currentColor"');
    expect(svg).not.toMatch(/#1e293b/);
  });

  it('проходит санитайзер SVG без потерь', () => {
    const svg = svgOf('CH_3-C(=[1]O)-[7]OH');
    const clean = sanitizeSvg(svg);

    expect(count(clean, 'line')).toBe(count(svg, 'line'));
    expect(count(clean, 'text')).toBe(count(svg, 'text'));
    expect(clean).toContain('rte-chemistry__label-bg');
    expect(clean).toContain('stroke-linecap');
  });

  it('код вне подмножества даёт null, а не исключение', () => {
    expect(chemfigToSvg('')).toBeNull();
    expect(chemfigToSvg('A-(B')).toBeNull();
    expect(chemfigToSvg('*6(------)-CH_3')).toBeNull();
  });

  it('renderChemistrySvg рисует уже разобранную структуру', () => {
    expect(count(renderChemistrySvg(parseChemfig('*5(-----)')), 'line')).toBe(5);
  });
});
