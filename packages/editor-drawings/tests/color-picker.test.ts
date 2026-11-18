import type { Translate } from '@rich-editor/core';
import { afterEach, describe, expect, it } from 'vitest';
import { ColorPicker, DRAWING_COLORS, checkInk, findDrawingColor, nextTileIndex, type ColorPickerOptions } from '../src/builders/color-picker';
import { BUILDER_MESSAGES } from '../src/builders/messages';

const t: Translate = (key) => BUILDER_MESSAGES.ru[key] ?? key;

const IDS = ['blue', 'cyan', 'green', 'yellow', 'orange', 'red', 'pink', 'purple', 'brown', 'gray'];
const NAMES = ['Синий', 'Голубой', 'Зелёный', 'Жёлтый', 'Оранжевый', 'Красный', 'Розовый', 'Фиолетовый', 'Коричневый', 'Серый'];

interface Mounted {
  picker: ColorPicker;
  changes: string[];
  tiles(): HTMLButtonElement[];
  tile(id: string): HTMLButtonElement;
}

const mount = (options: Partial<ColorPickerOptions> = {}): Mounted => {
  const changes: string[] = [];
  const picker = new ColorPicker({
    t,
    label: 'Цвет',
    value: '',
    allowDefault: false,
    onChange: (value) => changes.push(value),
    ...options,
  });

  document.body.appendChild(picker.element);

  const tiles = (): HTMLButtonElement[] => [...picker.element.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
  const tile = (id: string): HTMLButtonElement => {
    const found = picker.element.querySelector<HTMLButtonElement>(`[data-color="${id}"]`);

    if (!found) throw new Error(`Нет плитки «${id}»`);

    return found;
  };

  return { picker, changes, tiles, tile };
};

const press = (target: HTMLElement, key: string): void => {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
};

const checked = (mounted: Mounted): string[] =>
  mounted.tiles().filter((tile) => tile.getAttribute('aria-checked') === 'true').map((tile) => tile.dataset.color ?? '');

describe('палитра цвета', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('десять плиток в заданном порядке, с названиями и фоном из палитры', () => {
    const mounted = mount();
    const group = mounted.picker.element.querySelector('[role="radiogroup"]');

    expect(DRAWING_COLORS.map((color) => color.id)).toEqual(IDS);
    expect(group?.getAttribute('aria-label')).toBe('Цвет');
    expect(mounted.picker.element.querySelector('.rte-builder__prop-label')?.textContent).toBe('Цвет');
    expect(mounted.tiles().map((tile) => tile.dataset.color)).toEqual(IDS);
    expect(mounted.tiles().map((tile) => tile.getAttribute('aria-label'))).toEqual(NAMES);
    expect(mounted.tiles().every((tile) => tile.type === 'button')).toBe(true);
    expect(mounted.tile('red').style.backgroundColor).toBe('rgb(220, 38, 38)');
    // Ничего не выбрано: ни одной отметки, в порядке Tab — первая плитка.
    expect(checked(mounted)).toEqual([]);
    expect(mounted.picker.element.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    expect(mounted.tile('blue').tabIndex).toBe(0);
  });

  it('нажатие плитки отдаёт её hex и отмечает её кольцом и галочкой', () => {
    const mounted = mount({ value: '#2563eb' });

    mounted.tile('red').click();
    expect(mounted.changes).toEqual(['#dc2626']);
    expect(checked(mounted)).toEqual(['red']);
    expect(mounted.tile('red').querySelector('.rte-builder__color-check')).not.toBeNull();
    expect(mounted.tile('blue').querySelector('.rte-builder__color-check')).toBeNull();
    expect(document.activeElement).toBe(mounted.tile('red'));

    // Тот же цвет ещё раз — правки нет.
    mounted.tile('red').click();
    expect(mounted.changes).toEqual(['#dc2626']);
  });

  it('прежние значения и другой регистр подсвечивают плитку палитры, сцену не трогают', () => {
    expect(findDrawingColor('#3B82F6')?.id).toBe('blue');
    expect(findDrawingColor('#10b981')?.id).toBe('green');
    expect(findDrawingColor('#F59E0B')?.id).toBe('orange');
    expect(findDrawingColor('#ef4444')?.id).toBe('red');
    expect(findDrawingColor('#475569')?.id).toBe('gray');
    expect(findDrawingColor('#DC2626')?.id).toBe('red');

    const mounted = mount({ value: '#3B82F6' });

    expect(checked(mounted)).toEqual(['blue']);
    expect(mounted.tiles()).toHaveLength(10);
    expect(mounted.changes).toEqual([]);
    // Синий уже выбран: нажатие на него пишет цвет палитры — это действие пользователя.
    mounted.tile('blue').click();
    expect(mounted.changes).toEqual(['#2563eb']);
  });

  it('цвет не из палитры — одиннадцатая выбранная плитка «Цвет из чертежа»; выбор палитры её убирает', () => {
    const mounted = mount({ value: '#ABCDEF' });
    const other = mounted.tile('other');

    expect(mounted.tiles()).toHaveLength(11);
    expect(mounted.tiles()[10]).toBe(other);
    expect(other.getAttribute('aria-label')).toBe('Цвет из чертежа');
    expect(other.getAttribute('aria-checked')).toBe('true');
    expect(other.tabIndex).toBe(0);
    expect(other.style.backgroundColor).toBe('rgb(171, 205, 239)');

    other.click();
    expect(mounted.changes).toEqual([]);

    mounted.tile('green').click();
    expect(mounted.changes).toEqual(['#16a34a']);
    expect(mounted.tiles()).toHaveLength(10);
    expect(mounted.picker.element.querySelector('[data-color="other"]')).toBeNull();
  });

  it('«Обычный цвет» есть только с allowDefault и отдаёт пустую строку', () => {
    expect(mount().picker.element.querySelector('[data-color="default"]')).toBeNull();
    document.body.replaceChildren();

    const mounted = mount({ value: '#dc2626', allowDefault: true });
    const reset = mounted.tile('default');

    expect(reset.textContent).toBe('Обычный цвет');
    expect(reset.getAttribute('aria-pressed')).toBe('false');
    reset.click();
    expect(mounted.changes).toEqual(['']);
    expect(reset.getAttribute('aria-pressed')).toBe('true');
    expect(checked(mounted)).toEqual([]);
    expect(document.activeElement).toBe(reset);
  });

  it('стрелки ходят по сетке пять в ряд, Home и End — к краям; Tab-остановка одна', () => {
    const mounted = mount({ value: '#2563eb' });

    press(mounted.tile('blue'), 'ArrowRight');
    expect(mounted.changes.at(-1)).toBe('#0891b2');
    expect(document.activeElement).toBe(mounted.tile('cyan'));

    press(mounted.tile('cyan'), 'ArrowDown');
    expect(checked(mounted)).toEqual(['pink']);
    expect(document.activeElement).toBe(mounted.tile('pink'));

    press(mounted.tile('pink'), 'ArrowUp');
    expect(checked(mounted)).toEqual(['cyan']);

    press(mounted.tile('cyan'), 'ArrowLeft');
    press(mounted.tile('blue'), 'ArrowLeft');
    expect(checked(mounted)).toEqual(['gray']);

    press(mounted.tile('gray'), 'Home');
    expect(checked(mounted)).toEqual(['blue']);

    press(mounted.tile('blue'), 'End');
    expect(checked(mounted)).toEqual(['gray']);
    expect(document.activeElement).toBe(mounted.tile('gray'));
    expect(mounted.picker.element.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    expect(mounted.tiles().filter((tile) => tile.tabIndex === -1)).toHaveLength(9);

    // Чужая клавиша — не выбор.
    const before = mounted.changes.length;

    press(mounted.tile('gray'), 'a');
    expect(mounted.changes).toHaveLength(before);
  });

  it('шаг по сетке: вниз и вверх через пять, у края — на месте', () => {
    expect(nextTileIndex('ArrowDown', 7, 10)).toBe(7);
    expect(nextTileIndex('ArrowUp', 2, 10)).toBe(2);
    expect(nextTileIndex('ArrowDown', 5, 11)).toBe(10);
    expect(nextTileIndex('ArrowRight', 9, 10)).toBe(0);
    expect(nextTileIndex('Tab', 0, 10)).toBeNull();
  });

  it('галочка контрастна плитке: на жёлтой тёмная, на синей белая', () => {
    expect(checkInk('#2563eb')).toBe('#ffffff');
    expect(checkInk('#92400e')).toBe('#ffffff');
    expect(checkInk('#ca8a04')).not.toBe('#ffffff');
    expect(checkInk('#fff')).not.toBe('#ffffff');
  });

  it('setValue перерисовывает отметку без пересоздания поля; поля hex нет', () => {
    const mounted = mount({ value: '#2563eb' });
    const { element } = mounted.picker;

    mounted.picker.setValue('#f97316');
    expect(mounted.picker.element).toBe(element);
    expect(checked(mounted)).toEqual(['orange']);
    expect(mounted.changes).toEqual([]);
    expect(element.querySelector('input')).toBeNull();
  });
});
