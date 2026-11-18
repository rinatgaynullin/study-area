import { describe, expect, it } from 'vitest';
import { BUILDER_ICONS, createBuilderIcon, type BuilderIconId, type BuilderIconShape } from '../src/builders/builder-icons';

/** Полный перечень идентификаторов: компилятор сверяет его с типом, тест — с набором. */
const ICON_IDS: BuilderIconId[] = [
  'select',
  'point',
  'segment',
  'circle',
  'angle',
  'ticks',
  'text',
  'delete',
  'section',
  'pencil',
  'shading',
  'undo',
  'redo',
  'grid',
  'axes',
  'zoomIn',
  'zoomOut',
  'fit',
  'resetView',
  'copy',
  'paste',
  'check',
  'cube',
  'box',
  'prism',
  'pyramid',
  'frustum',
  'cylinder',
  'cone',
  'sphere',
  'parabola',
  'hyperbola',
  'lineFn',
  'root',
  'sine',
  'modulus',
  'plotCircle',
  'pointHollow',
  'tabPlane',
  'tabSolid',
  'tabPlot',
  'tabPhysics',
];

const NUMBER = /-?\d*\.?\d+/g;

/** Все числа примитива: атрибуты-числа, точки `points` и аргументы команд `d`. */
const numbersOf = ([, attrs]: BuilderIconShape): string[] =>
  Object.values(attrs).flatMap((value) => (typeof value === 'number' ? [String(value)] : (String(value).match(NUMBER) ?? [])));

describe('BUILDER_ICONS', () => {
  it('описывает каждый идентификатор хотя бы одним примитивом', () => {
    expect(Object.keys(BUILDER_ICONS).sort()).toEqual([...ICON_IDS].sort());

    ICON_IDS.forEach((id) => {
      expect(BUILDER_ICONS[id].shapes.length, id).toBeGreaterThan(0);
    });
  });

  it('держит координаты в поле 0…24 с одним знаком после запятой', () => {
    ICON_IDS.forEach((id) => {
      BUILDER_ICONS[id].shapes.forEach((shape) => {
        numbersOf(shape).forEach((text) => {
          const value = Number(text);

          expect(value, `${id}: ${text}`).toBeGreaterThanOrEqual(0);
          expect(value, `${id}: ${text}`).toBeLessThanOrEqual(24);
          expect(text, id).toMatch(/^\d+(\.\d)?$/);
        });
      });
    });
  });

  it('использует в path только команды M L H V C Q A Z', () => {
    ICON_IDS.forEach((id) => {
      BUILDER_ICONS[id].shapes.forEach(([name, attrs]) => {
        if (name !== 'path') return;

        const commands = attrs.d.replace(/[\d\s.,-]/g, '');

        expect(commands, id).toMatch(/^[MLHVCQAZ]+$/i);
      });
    });
  });

  it('ссылается на существующие примитивы в dashed, filled и thin', () => {
    ICON_IDS.forEach((id) => {
      const { shapes, dashed = [], filled = [], thin = [] } = BUILDER_ICONS[id];

      [...dashed, ...filled, ...thin].forEach((index) => {
        expect(shapes[index], `${id}[${index}]`).toBeDefined();
      });
    });
  });

  it('не содержит двух одинаковых значков', () => {
    const descriptions = ICON_IDS.map((id) => JSON.stringify(BUILDER_ICONS[id]));

    expect(new Set(descriptions).size).toBe(ICON_IDS.length);
  });
});

describe('createBuilderIcon', () => {
  it('собирает svg с общими атрибутами и примитивами из описания', () => {
    ICON_IDS.forEach((id) => {
      const spec = BUILDER_ICONS[id];
      const svg = createBuilderIcon(id);

      expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
      expect(svg.tagName.toLowerCase()).toBe('svg');
      expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
      expect(svg.getAttribute('fill')).toBe('none');
      expect(svg.getAttribute('stroke')).toBe('currentColor');
      expect(svg.getAttribute('stroke-width')).toBe('1.75');
      expect(svg.getAttribute('stroke-linecap')).toBe('round');
      expect(svg.getAttribute('stroke-linejoin')).toBe('round');
      expect(svg.getAttribute('aria-hidden')).toBe('true');
      expect(svg.classList.contains('rte-builder-icon')).toBe(true);
      expect(svg.children.length, id).toBe(spec.shapes.length);

      spec.shapes.forEach(([name], index) => {
        const child = svg.children.item(index);

        expect(child?.tagName.toLowerCase(), `${id}[${index}]`).toBe(name);
        expect(child?.hasAttribute('stroke-dasharray'), `${id}[${index}]`).toBe(spec.dashed?.includes(index) ?? false);
        expect(child?.getAttribute('fill'), `${id}[${index}]`).toBe(spec.filled?.includes(index) ? 'currentColor' : null);
        expect(child?.getAttribute('stroke-width'), `${id}[${index}]`).toBe(spec.thin?.includes(index) ? '1' : null);
      });
    });
  });

  it('переносит геометрию примитива в атрибуты', () => {
    const svg = createBuilderIcon('segment');
    const line = svg.querySelector('line');

    expect(line?.getAttribute('x1')).toBe('5');
    expect(line?.getAttribute('y2')).toBe('5');
    expect(svg.querySelectorAll('circle[fill="currentColor"]')).toHaveLength(2);
  });

  it('рисует тела без пунктира: на 20px он превращается в шум', () => {
    const solids: BuilderIconId[] = ['section', 'cube', 'box', 'prism', 'pyramid', 'frustum', 'cylinder', 'cone', 'sphere', 'tabSolid'];

    solids.forEach((id) => {
      expect(createBuilderIcon(id).querySelectorAll('[stroke-dasharray]'), id).toHaveLength(0);
    });
  });

  it('у параболы и корня нет креста осей: одна тонкая ось под кривой', () => {
    (['parabola', 'root', 'sine', 'modulus'] as const).forEach((id) => {
      const svg = createBuilderIcon(id);

      expect(svg.querySelectorAll('[stroke-width="1"]'), id).toHaveLength(1);
      expect(svg.innerHTML, id).not.toContain('M3 12 H21 M12 3 V21');
    });
    expect(createBuilderIcon('hyperbola').innerHTML).not.toContain('M3 12 H21 M12 3 V21');
  });

  it('задаёт размер параметром size, по умолчанию 20', () => {
    const regular = createBuilderIcon('grid');
    const large = createBuilderIcon('grid', 32);

    expect(regular.getAttribute('width')).toBe('20');
    expect(regular.getAttribute('height')).toBe('20');
    expect(large.getAttribute('width')).toBe('32');
    expect(large.getAttribute('height')).toBe('32');
  });

  it('не использует цветовых литералов, только currentColor', () => {
    ICON_IDS.forEach((id) => {
      const svg = createBuilderIcon(id);
      const colors = [svg, ...Array.from(svg.children)].flatMap((node) => [node.getAttribute('fill'), node.getAttribute('stroke')]);

      colors.forEach((color) => {
        expect([null, 'none', 'currentColor'], id).toContain(color);
      });
    });
  });
});
