import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Translate } from '@rich-editor/core';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { BUILDER_MESSAGES } from '../src/builders/messages';
import { physicsEditorFactory } from '../src/builders/physics-editor';
import { PHYSICS_BUILDER_MESSAGES } from '../src/builders/physics-messages';
import type { SceneEditor } from '../src/builders/types';
import { renderPhysicsSvg } from '../src/render/physics-svg';
import { normalizePhysicsScene } from '../src/scene/normalize';
import type { PhysicsElementType } from '../src/scene/types';

/** jsdom не знает PointerEvent — полотно слушает именно его. */
beforeAll(() => {
  if (typeof globalThis.PointerEvent === 'undefined') {
    class PointerEventPolyfill extends MouseEvent {
      readonly pointerId: number;

      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
      }
    }

    globalThis.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent;
  }
});

const t: Translate = (key) => PHYSICS_BUILDER_MESSAGES.ru[key] ?? BUILDER_MESSAGES.ru[key] ?? key;

/** Полотно 560×420 при масштабе 30: начало координат мира в (280, 210), ось y вверх. */
const CX = 280;
const CY = 210;
const SCALE = 30;

type Vec2 = [number, number];

const svgOf = ([x, y]: Vec2): Vec2 => [CX + x * SCALE, CY - y * SCALE];

const pointer = (target: HTMLElement, type: 'pointerdown' | 'pointermove' | 'pointerup', world: Vec2, init: Partial<PointerEventInit> = {}): void => {
  const [clientX, clientY] = svgOf(world);

  target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, clientX, clientY, pointerId: 1, ...init }));
};

const click = (target: HTMLElement, world: Vec2, init: Partial<PointerEventInit> = {}): void => {
  pointer(target, 'pointerdown', world, init);
  pointer(target, 'pointerup', world, init);
};

const drag = (target: HTMLElement, from: Vec2, to: Vec2, init: Partial<PointerEventInit> = {}): void => {
  pointer(target, 'pointerdown', from, init);
  pointer(target, 'pointermove', [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2], init);
  pointer(target, 'pointermove', to, init);
  pointer(target, 'pointerup', to, init);
};

const key = (target: HTMLElement, name: string, init: Partial<KeyboardEventInit> = {}): void => {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init }));
};

const pickTool = (editor: SceneEditor, tool: string): void => {
  editor.element.querySelector<HTMLButtonElement>(`button[data-tool="${tool}"]`)?.click();
};

const pickSection = (editor: SceneEditor, section: string): void => {
  editor.element.querySelector<HTMLButtonElement>(`button[data-section="${section}"]`)?.click();
};

const addElement = (editor: SceneEditor, id: string): void => {
  const button = editor.element.querySelector<HTMLButtonElement>(`button[data-element="${id}"]`);

  if (!button) throw new Error(`Нет кнопки палитры «${id}»`);

  button.click();
};

const canvasOf = (editor: SceneEditor): HTMLElement => {
  const canvas = editor.element.querySelector<HTMLElement>('.rte-sketch');

  if (!canvas) throw new Error('Нет полотна');

  return canvas;
};

type Item = Record<string, unknown> & { id: string; type: string };

const elementsOf = (editor: SceneEditor): Item[] => editor.getScene().elements as Item[];

const propInput = <T extends HTMLElement = HTMLInputElement>(editor: SceneEditor, prop: string): T => {
  const input = editor.element.querySelector<T>(`.rte-builder__props [data-prop="${prop}"]`);

  if (!input) throw new Error(`Нет поля «${prop}»`);

  return input;
};

const change = (input: HTMLInputElement | HTMLSelectElement, value: string): void => {
  input.value = value;
  input.dispatchEvent(new Event('change', { bubbles: true }));
};

const GRAPHIC_TAGS = ['line', 'path', 'circle', 'polygon', 'polyline', 'rect', 'ellipse', 'text'];

/** Графические элементы SVG без линий сетки. */
const graphicCount = (svg: string): number => {
  const withoutGrid = svg.replace(/<line[^>]*class="rte-drawing__grid"[^>]*\/>/g, '');

  return GRAPHIC_TAGS.reduce((total, tag) => total + (withoutGrid.match(new RegExp(`<${tag}\\b`, 'g')) ?? []).length, 0);
};

const BLOCK_WITH_FORCE = {
  type: 'physics',
  elements: [
    { id: 'floor', type: 'surface', points: [[-5, 0], [5, 0]], hatching: 'bottom' },
    { type: 'block', subtype: 'rectangle', center: [0, 0.5], width: 1.6, height: 1 },
    { id: 'F', type: 'vector', vectorType: 'force', points: [[0.8, 0.5], [3, 0.5]], label: '\\vec{F}' },
  ],
};

describe('конструктор физических схем', () => {
  let editor: SceneEditor | undefined;

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
  });

  const create = (): SceneEditor => {
    editor = physicsEditorFactory.create({ t });
    document.body.appendChild(editor.element);

    return editor;
  };

  it('загружает сцену «брусок с силой» и отдаёт её обратно с id у каждого элемента', () => {
    const physics = create();

    physics.load(BLOCK_WITH_FORCE);

    const scene = physics.getScene();
    const elements = scene.elements as Item[];

    expect(scene.type).toBe('physics');
    expect(elements).toHaveLength(3);
    expect(elements[0]).toMatchObject({ id: 'floor', type: 'surface', points: [[-5, 0], [5, 0]], hatching: 'bottom' });
    expect(elements[1]).toMatchObject({ type: 'block', subtype: 'rectangle', center: [0, 0.5], width: 1.6, height: 1 });
    expect(elements[1].id).toMatch(/^block_\d+$/);
    expect(elements[2]).toMatchObject({ id: 'F', type: 'vector', vectorType: 'force', points: [[0.8, 0.5], [3, 0.5]], label: '\\vec{F}' });
    // Умолчания нормализации не засоряют сцену.
    expect(elements[0]).not.toHaveProperty('dashed');
    expect(elements[1]).not.toHaveProperty('points');
    expect(scene.showGrid).toBeUndefined();
    expect(canvasOf(physics).querySelector('svg')).not.toBeNull();
  });

  it('каждая кнопка каждого раздела добавляет элемент с полями, которые рендер умеет нарисовать', () => {
    const physics = create();
    const sections = [...physics.element.querySelectorAll<HTMLButtonElement>('button[data-section]')].map((tab) => tab.dataset.section);
    const types = new Set<string>();
    let changes = 0;

    physics.onChange(() => {
      changes += 1;
    });

    expect(sections).toEqual(['mechanics', 'thermo', 'circuit', 'optics']);

    sections.forEach((section) => {
      pickSection(physics, section!);

      const ids = [...physics.element.querySelectorAll<HTMLButtonElement>('button[data-element]')].map((button) => button.dataset.element!);

      expect(ids.length).toBeGreaterThan(0);

      ids.forEach((id) => {
        const before = elementsOf(physics).length;

        addElement(physics, id);

        const elements = elementsOf(physics);
        const added = elements[elements.length - 1];

        expect(elements).toHaveLength(before + 1);
        expect(added.id).toMatch(new RegExp(`^${added.type}_\\d+$`));
        types.add(added.type);

        const svg = renderPhysicsSvg(normalizePhysicsScene({ type: 'physics', showGrid: false, elements: [added] }));

        expect(graphicCount(svg), `${id} (${added.type}) рисуется`).toBeGreaterThan(0);
      });
    });

    const ALL_TYPES: PhysicsElementType[] = [
      'surface', 'arc_surface', 'block', 'rope', 'spring', 'vector', 'angle', 'stickman', 'balloon', 'ellipse_platform',
      'dimension_line', 'thermo_axes', 'thermo_point', 'thermo_process', 'piston_vessel', 'circuit_component', 'wire',
      'charge', 'field_line', 'capacitor_plate', 'current_conductor', 'circle_shape', 'lens', 'mirror', 'ray',
      'optics_arrow', 'prism', 'glass_slab', 'text_label',
    ];

    expect([...types].sort()).toEqual([...ALL_TYPES].sort());
    expect(changes).toBe(elementsOf(physics).length);

    // Подтипы и знаки из палитры попадают в элемент.
    const elements = elementsOf(physics);

    expect(elements.find((item) => item.id === 'block_3')).toMatchObject({ subtype: 'pulley', radius: 0.6 });
    expect(elements.find((item) => item.id === 'charge_2')).toMatchObject({ charge: '-' });
    expect(elements.find((item) => item.id === 'lens_2')).toMatchObject({ subtype: 'diverging' });
    expect(elements.find((item) => item.id === 'thermo_point_1')).toMatchObject({ label: '1' });
  });

  it('переключение раздела меняет палитру, но не трогает сцену', () => {
    const physics = create();

    addElement(physics, 'block_rect');
    addElement(physics, 'force');

    const before = JSON.stringify(physics.getScene());

    pickSection(physics, 'optics');
    expect(physics.element.querySelector('button[data-section="optics"]')?.getAttribute('aria-selected')).toBe('true');
    expect(physics.element.querySelector('button[data-element="lens_converging"]')).not.toBeNull();
    expect(physics.element.querySelector('button[data-element="block_rect"]')).toBeNull();
    expect(JSON.stringify(physics.getScene())).toBe(before);

    pickSection(physics, 'circuit');
    addElement(physics, 'resistor');
    expect(elementsOf(physics).map((item) => item.type)).toEqual(['block', 'vector', 'circuit_component']);
  });

  it('клик выбирает элемент и показывает его свойства, перетаскивание двигает его целиком', () => {
    const physics = create();
    const canvas = canvasOf(physics);

    addElement(physics, 'block_rect');
    addElement(physics, 'rope');
    pickTool(physics, 'select');

    click(canvas, [-4, -4]);
    expect(physics.element.querySelector('.rte-builder__props-empty')).not.toBeNull();

    click(canvas, [0.3, 0.2]);
    expect(physics.element.querySelector('.rte-builder__props-title')?.textContent).toBe('Брусок');
    expect(canvasOf(physics).querySelector('.rte-sketch__overlay rect')).not.toBeNull();

    drag(canvas, [0.3, 0.2], [2.3, 1.2]);
    expect(elementsOf(physics)[0].center).toEqual([2, 1]);

    // Верёвка: все точки едут вместе.
    drag(canvas, [0, 1], [1, -2]);
    expect(elementsOf(physics)[1].points).toEqual([[-1, -2], [3, -2]]);
  });

  it('ручка двигает одну точку, а ручка размера меняет ширину и высоту бруска', () => {
    const physics = create();
    const canvas = canvasOf(physics);

    addElement(physics, 'rope');
    pickTool(physics, 'select');
    click(canvas, [0, 1]);
    drag(canvas, [2, 1], [3, 2]);
    expect(elementsOf(physics)[0].points).toEqual([[-2, 1], [3, 2]]);

    addElement(physics, 'block_rect');
    // Угол бруска 1.8×1.2 — ручка размера в (0.9, 0.6).
    drag(canvas, [0.9, 0.6], [1.5, 1]);
    expect(elementsOf(physics)[1]).toMatchObject({ width: 3, height: 2 });
  });

  it('точка прилипает к точке другого элемента, к его отрезку и к сетке; Shift отключает прилипание', () => {
    const physics = create();
    const canvas = canvasOf(physics);

    addElement(physics, 'rope');
    addElement(physics, 'force');
    pickTool(physics, 'select');
    click(canvas, [1, 0]);

    drag(canvas, [2, 0], [1.9, 0.8]);
    expect(elementsOf(physics)[1].points).toEqual([[0, 0], [2, 1]]);

    drag(canvas, [2, 1], [0.3, 0.7]);
    expect(elementsOf(physics)[1].points).toEqual([[0, 0], [0.3, 1]]);

    drag(canvas, [0.3, 1], [-1.23, -0.77]);
    expect(elementsOf(physics)[1].points).toEqual([[0, 0], [-1, -1]]);

    drag(canvas, [-1, -1], [-1.23, -0.77], { shiftKey: true });
    expect(elementsOf(physics)[1].points).toEqual([[0, 0], [-1.23, -0.77]]);
  });

  it('Ctrl+клик дублирует элемент со сдвигом и выбирает копию', () => {
    const physics = create();
    const canvas = canvasOf(physics);

    addElement(physics, 'block_circle');
    pickTool(physics, 'select');
    click(canvas, [0, 0], { ctrlKey: true });

    const elements = elementsOf(physics);

    expect(elements.map((item) => item.id)).toEqual(['block_1', 'block_2']);
    expect(elements[1]).toMatchObject({ subtype: 'circle', radius: 0.8, center: [0.5, 0.5] });
    expect(physics.element.querySelector('.rte-builder__props-title')?.textContent).toBe('Шар');

    key(canvas, 'z', { ctrlKey: true });
    expect(elementsOf(physics)).toHaveLength(1);
  });

  it('Ctrl+C и Ctrl+V копируют выбранный элемент', () => {
    const physics = create();
    const canvas = canvasOf(physics);

    addElement(physics, 'force');
    pickTool(physics, 'select');
    click(canvas, [1, 0]);
    key(canvas, 'c', { ctrlKey: true });
    key(canvas, 'v', { ctrlKey: true });
    key(canvas, 'v', { ctrlKey: true });

    const elements = elementsOf(physics);

    expect(elements.map((item) => item.id)).toEqual(['vector_1', 'vector_2', 'vector_3']);
    expect(elements[1]).toMatchObject({ vectorType: 'force', label: '\\vec{F}', points: [[0.5, 0.5], [2.5, 0.5]] });
    expect(elements[2].points).toEqual([[1, 1], [3, 1]]);
  });

  it('панель свойств меняет подпись, вид, цвет и пунктир', () => {
    const physics = create();
    const canvas = canvasOf(physics);

    addElement(physics, 'force');
    change(propInput(physics, 'label'), '\\vec{N}');
    expect(elementsOf(physics)[0].label).toBe('\\vec{N}');

    change(propInput<HTMLSelectElement>(physics, 'vectorType'), 'acc');
    expect(elementsOf(physics)[0].vectorType).toBe('acc');

    change(propInput<HTMLSelectElement>(physics, 'color'), '#dc2626');
    expect(elementsOf(physics)[0].color).toBe('#dc2626');

    change(propInput(physics, 'color-hex'), '#ABCDEF');
    expect(elementsOf(physics)[0].color).toBe('#abcdef');

    change(propInput(physics, 'color-hex'), 'не цвет');
    expect(elementsOf(physics)[0].color).toBe('#abcdef');

    const dashed = propInput(physics, 'dashed');

    dashed.checked = true;
    dashed.dispatchEvent(new Event('change', { bubbles: true }));
    expect(elementsOf(physics)[0].dashed).toBe(true);

    addElement(physics, 'block_rect');
    change(propInput<HTMLSelectElement>(physics, 'subtype'), 'circle');
    expect(elementsOf(physics)[1].subtype).toBe('circle');
    expect(propInput(physics, 'radius')).not.toBeNull();

    change(propInput(physics, 'radius'), '1.5');
    expect(elementsOf(physics)[1].radius).toBe(1.5);

    change(propInput(physics, 'radius'), '-1');
    expect(elementsOf(physics)[1].radius).toBe(1.5);

    // Клик внутри шара, но подальше от стрелки: линии перехватывают клик у фигур.
    pickTool(physics, 'select');
    click(canvas, [0, -1]);
    expect(physics.element.querySelector('.rte-builder__props-title')?.textContent).toBe('Шар');
  });

  it('деления осей добавляются, правятся и удаляются', () => {
    const physics = create();

    pickSection(physics, 'thermo');
    addElement(physics, 'thermo_axes');
    expect(elementsOf(physics)[0]).toMatchObject({ xLabel: 'V', yLabel: 'p', xLength: 7, yLength: 5.5 });

    physics.element.querySelector<HTMLButtonElement>('button[data-add-tick="xTicks"]')?.click();
    physics.element.querySelector<HTMLButtonElement>('button[data-add-tick="xTicks"]')?.click();
    expect(elementsOf(physics)[0].xTicks).toEqual([{ val: 1 }, { val: 2 }]);

    const rows = physics.element.querySelectorAll<HTMLElement>('[data-prop="xTicks"] .rte-builder__tick');

    expect(rows).toHaveLength(2);
    change(rows[1].querySelector<HTMLInputElement>('input[data-tick="val"]')!, '3.5');
    expect(elementsOf(physics)[0].xTicks).toEqual([{ val: 1 }, { val: 3.5 }]);

    change(physics.element.querySelectorAll<HTMLInputElement>('[data-prop="xTicks"] input[data-tick="label"]')[0], 'V_1');
    expect(elementsOf(physics)[0].xTicks).toEqual([{ val: 1, label: 'V_1' }, { val: 3.5 }]);

    physics.element.querySelector<HTMLButtonElement>('[data-prop="xTicks"] .rte-builder__tick-remove')?.click();
    expect(elementsOf(physics)[0].xTicks).toEqual([{ val: 3.5 }]);

    change(propInput(physics, 'xLabel'), 'T');
    expect(elementsOf(physics)[0].xLabel).toBe('T');
  });

  it('отмена возвращает перетаскивание одним шагом, повтор — снова двигает', () => {
    const physics = create();
    const canvas = canvasOf(physics);

    addElement(physics, 'block_rect');
    pickTool(physics, 'select');
    drag(canvas, [0, 0], [2, 2]);
    expect(elementsOf(physics)[0].center).toEqual([2, 2]);

    key(canvas, 'z', { ctrlKey: true });
    expect(elementsOf(physics)[0].center).toEqual([0, 0]);

    key(canvas, 'y', { ctrlKey: true });
    expect(elementsOf(physics)[0].center).toEqual([2, 2]);

    key(canvas, 'z', { ctrlKey: true, shiftKey: true });
    expect(elementsOf(physics)[0].center).toEqual([2, 2]);

    key(canvas, 'z', { ctrlKey: true });
    key(canvas, 'z', { ctrlKey: true });
    expect(elementsOf(physics)).toHaveLength(0);
  });

  it('Delete удаляет выбранное, инструмент удаления — по клику, Escape снимает выделение', () => {
    const physics = create();
    const canvas = canvasOf(physics);

    // Верёвка лежит на y = 1, брусок — в начале координат: клики не спорят.
    addElement(physics, 'rope');
    addElement(physics, 'block_rect');
    pickTool(physics, 'select');
    click(canvas, [0, 0]);
    key(canvas, 'Escape');
    expect(physics.element.querySelector('.rte-builder__props-empty')).not.toBeNull();

    key(canvas, 'Delete');
    expect(elementsOf(physics)).toHaveLength(2);

    click(canvas, [0, 0]);
    key(canvas, 'Delete');
    expect(elementsOf(physics).map((item) => item.type)).toEqual(['rope']);

    pickTool(physics, 'delete');
    click(canvas, [1, 1]);
    expect(elementsOf(physics)).toHaveLength(0);

    addElement(physics, 'rope');
    physics.element.querySelector<HTMLButtonElement>('.rte-builder__remove')?.click();
    expect(elementsOf(physics)).toHaveLength(0);
  });

  it('чужие поля элемента и сцены возвращаются нетронутыми', () => {
    const physics = create();

    physics.load({
      ...BLOCK_WITH_FORCE,
      scale: 40,
      meta: { source: 'ocr' },
      elements: [{ ...BLOCK_WITH_FORCE.elements[0], arcDirection: 'down', custom: { keep: true } }],
    });

    const scene = physics.getScene();

    expect(scene.meta).toEqual({ source: 'ocr' });
    expect(scene.scale).toBe(40);
    expect((scene.elements as Item[])[0]).toMatchObject({ id: 'floor', arcDirection: 'down', custom: { keep: true } });

    physics.load({ type: 'physics', elements: [{ type: 'wall', points: [[0, 0], [2, 0]], note: 'alias' }] });
    expect((physics.getScene().elements as Item[])[0]).toMatchObject({ type: 'surface', note: 'alias' });
  });

  it('принимает любую физическую сцену', () => {
    expect(physicsEditorFactory.id).toBe('physics');
    expect(physicsEditorFactory.kind).toBe('physics');
    expect(physicsEditorFactory.accepts(BLOCK_WITH_FORCE)).toBe(true);
    expect(physicsEditorFactory.accepts({})).toBe(true);
  });
});

describe('подписи конструктора физики', () => {
  const source = readFileSync(resolve(process.cwd(), 'packages/editor-drawings/src/builders/physics-editor.ts'), 'utf8');

  it('английская таблица повторяет набор ключей русской', () => {
    expect(Object.keys(PHYSICS_BUILDER_MESSAGES.en).sort()).toEqual(Object.keys(PHYSICS_BUILDER_MESSAGES.ru).sort());
  });

  it('каждый ключ читается кодом конструктора', () => {
    const unused = Object.keys(PHYSICS_BUILDER_MESSAGES.ru).filter((key) => !source.includes(`'${key}'`));

    expect(unused).toEqual([]);
  });
});
