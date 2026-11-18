import type { Translate } from '@rich-editor/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  checkField,
  colorField,
  numberField,
  pairField,
  propertyField,
  propsEmpty,
  propsTitle,
  selectControl,
  selectField,
  sliderField,
  textField,
  type NumberPair,
} from '../src/builders/fields';
import { BUILDER_MESSAGES } from '../src/builders/messages';
import * as toolBar from '../src/builders/tool-bar';

const t: Translate = (key) => BUILDER_MESSAGES.ru[key] ?? key;

const mount = <T extends HTMLElement>(element: T): T => {
  document.body.appendChild(element);

  return element;
};

const input = (row: HTMLElement, selector = 'input'): HTMLInputElement => {
  const found = row.querySelector<HTMLInputElement>(selector);

  if (!found) throw new Error(`Нет ${selector}`);

  return found;
};

const change = (target: HTMLInputElement | HTMLSelectElement, value: string): void => {
  target.value = value;
  target.dispatchEvent(new Event('change', { bubbles: true }));
};

/** Подпись строки называет поле: щелчок по ней — фокус в поле. */
const labelOf = (control: HTMLElement): string | undefined => {
  const label = control.closest('label');

  return label?.querySelector('.rte-builder__prop-label')?.textContent ?? undefined;
};

describe('общие поля панели свойств', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('заголовок и пустое состояние — прежние классы', () => {
    expect(propsTitle('Отрезок').outerHTML).toBe('<h4 class="rte-builder__props-title">Отрезок</h4>');
    expect(propsEmpty('Ничего не выбрано').outerHTML).toBe('<p class="rte-builder__props-empty">Ничего не выбрано</p>');
  });

  it('propertyField и selectControl по-прежнему экспортирует tool-bar', () => {
    expect(toolBar.propertyField).toBe(propertyField);
    expect(toolBar.selectControl).toBe(selectControl);
  });

  it('текстовое поле: подпись связана с полем, значение без пробелов по краям', () => {
    const values: string[] = [];
    const row = mount(textField({ label: 'Подпись', value: 'A', prop: 'label', placeholder: '30°', maxLength: 4, onChange: (value) => values.push(value) }));
    const field = input(row);

    expect(row.className).toBe('rte-builder__prop');
    expect(row.tagName).toBe('LABEL');
    expect(labelOf(field)).toBe('Подпись');
    expect(field).toMatchObject({ type: 'text', value: 'A', placeholder: '30°', maxLength: 4 });
    expect(field.classList.contains('rte-input')).toBe(true);
    expect(field.dataset.prop).toBe('label');

    change(field, '  B  ');
    expect(values).toEqual(['B']);
  });

  it('текстовое поле только для показа и недоступное', () => {
    const shown = input(textField({ label: 'Величина', value: '60°', readOnly: true }));
    const disabled = input(textField({ label: 'Подпись', value: '', disabled: true, onChange: () => undefined }));

    expect(shown.readOnly).toBe(true);
    expect(disabled.disabled).toBe(true);
  });

  it('числовое поле: шаг, границы, разобранное число; нечисловой ввод обработчик не вызывает', () => {
    const values: number[] = [];
    const row = mount(numberField({ label: 'Радиус', value: 1, step: 0.5, min: 0, max: 10, prop: 'radius', onChange: (value) => values.push(value) }));
    const field = input(row);

    expect(labelOf(field)).toBe('Радиус');
    expect(field).toMatchObject({ type: 'number', step: '0.5', min: '0', max: '10', value: '1' });
    expect(field.dataset.prop).toBe('radius');

    change(field, '2.5');
    change(field, '');
    change(field, 'abc');
    expect(values).toEqual([2.5]);
    // Нечисловое — поле показывает последнее принятое значение.
    expect(field.value).toBe('2.5');
  });

  it('числовое поле: отказ обработчика возвращает прежнее значение', () => {
    const field = input(numberField({ label: 'Длина', value: 3, step: 0.5, onChange: (value) => value > 0 }));

    change(field, '-1');
    expect(field.value).toBe('3');

    change(field, '4');
    expect(field.value).toBe('4');
  });

  it('флажок: один класс .rte-builder__check, подпись в строку', () => {
    const values: boolean[] = [];
    const row = mount(checkField({ label: 'Пунктир', checked: false, prop: 'dashed', onChange: (checked) => values.push(checked) }));
    const box = input(row);

    expect(row.className).toBe('rte-builder__prop rte-builder__prop--check');
    expect(box.className).toBe('rte-builder__check');
    expect(box.type).toBe('checkbox');
    expect(labelOf(box)).toBe('Пунктир');

    box.click();
    expect(values).toEqual([true]);
    expect(checkField({ label: 'x', checked: true, disabled: true, onChange: () => undefined }).querySelector('input')).toMatchObject({ checked: true, disabled: true });
  });

  it('список: варианты, выбранный, значение в обработчик', () => {
    const values: string[] = [];
    const row = mount(
      selectField({
        label: 'Стиль',
        options: [
          { value: 'solid', label: 'Сплошная' },
          { value: 'dashed', label: 'Пунктир' },
        ],
        value: 'dashed',
        prop: 'style',
        onChange: (value) => values.push(value),
      }),
    );
    const select = row.querySelector('select');

    if (!select) throw new Error('Нет списка');

    expect(select.className).toBe('rte-input rte-builder__select');
    expect(select.value).toBe('dashed');
    expect(select.dataset.prop).toBe('style');
    expect([...select.options].map((option) => option.textContent)).toEqual(['Сплошная', 'Пунктир']);
    expect(labelOf(select)).toBe('Стиль');

    change(select, 'solid');
    expect(values).toEqual(['solid']);
  });

  it('пара чисел: оба значения, пустое — null; отказ возвращает прежние', () => {
    const values: NumberPair[] = [];
    const row = mount(
      pairField({
        label: 'Точка (x, y)',
        values: [1, 2],
        step: 0.5,
        onChange: (pair) => {
          values.push(pair);

          return pair[0] !== null;
        },
      }),
    );
    const [first, second] = [...row.querySelectorAll('input')];

    if (!first || !second) throw new Error('Нет полей пары');

    expect(row.querySelector('.rte-builder__pair')?.children).toHaveLength(2);
    expect(labelOf(first)).toBe('Точка (x, y)');
    expect(first).toMatchObject({ type: 'number', step: '0.5', value: '1' });

    change(second, '3');
    expect(values).toEqual([[1, 3]]);

    change(first, 'abc');
    expect(values.at(-1)).toEqual([null, 3]);
    expect(first.value).toBe('1');
  });

  it('строка-ползунок: «двигаю» и «отпустил» раздельно, число из поля — правка, значение обновляется без пересоздания', () => {
    const slides: number[] = [];
    const edits: number[] = [];
    let releases = 0;
    const slider = sliderField({
      label: 'Наклон',
      value: 10,
      min: -85,
      max: 85,
      step: 1,
      inputStep: 5,
      prop: 'angleY',
      rangeProp: 'angleYRange',
      hint: 'Тяните ползунок',
      onSlide: (value) => slides.push(value),
      onRelease: () => {
        releases += 1;
      },
      onChange: (value) => edits.push(value),
    });
    const row = mount(slider.element);
    const range = input(row, 'input[type="range"]');
    const number = input(row, 'input[type="number"]');

    expect(row.className).toBe('rte-builder__prop rte-builder__prop--slider');
    expect(row.querySelector('.rte-builder__prop-label')?.textContent).toBe('Наклон');
    expect(row.querySelector('.rte-builder__prop-hint')?.textContent).toBe('Тяните ползунок');
    expect(range).toMatchObject({ min: '-85', max: '85', step: '1', value: '10' });
    expect(number).toMatchObject({ step: '5', value: '10' });
    expect(range.getAttribute('aria-label')).toBe('Наклон');
    expect(number.getAttribute('aria-label')).toBe('Наклон');
    expect(range.dataset.prop).toBe('angleYRange');
    expect(number.dataset.prop).toBe('angleY');

    range.value = '20';
    range.dispatchEvent(new Event('input'));
    range.value = '30';
    range.dispatchEvent(new Event('input'));
    expect(slides).toEqual([20, 30]);
    expect(releases).toBe(0);
    expect(number.value).toBe('30');

    range.dispatchEvent(new Event('change'));
    expect(releases).toBe(1);
    expect(edits).toEqual([]);

    change(number, '45');
    expect(edits).toEqual([45]);
    expect(range.value).toBe('45');

    change(number, 'abc');
    expect(edits).toEqual([45]);
    expect(number.value).toBe('45');

    slider.setValue(-15);
    expect(row.isConnected).toBe(true);
    expect(range.value).toBe('-15');
    expect(number.value).toBe('-15');

    // Поле в фокусе не трогается: его правят.
    number.focus();
    slider.setValue(5);
    expect(number.value).toBe('-15');
    expect(range.value).toBe('5');
  });

  it('строка-ползунок: свои имена для скринридера; введённое число показывается таким, каким его приняли', () => {
    const slider = sliderField({
      label: 'k',
      value: 1,
      min: -5,
      max: 5,
      step: 0.1,
      rangeLabel: 'Ползунок k',
      inputLabel: 'Значение k',
      onSlide: () => undefined,
      onRelease: () => undefined,
      // Ноль не годится: сцена принимает 0,1 и возвращает его в строку.
      onChange: (value) => slider.setValue(value === 0 ? 0.1 : value),
    });
    const row = mount(slider.element);
    const number = input(row, 'input[type="number"]');

    expect(input(row, 'input[type="range"]').getAttribute('aria-label')).toBe('Ползунок k');
    expect(number.getAttribute('aria-label')).toBe('Значение k');

    number.focus();
    change(number, '0');
    expect(number.value).toBe('0.1');
    expect(input(row, 'input[type="range"]').value).toBe('0.1');
  });

  it('цвет — палитра плиток с подписью', () => {
    const values: string[] = [];
    const row = mount(colorField({ t, label: 'Цвет', value: '', allowDefault: true, onChange: (value) => values.push(value) }));

    expect(row.className).toBe('rte-builder__prop rte-builder__prop--color');
    expect(row.querySelector('.rte-builder__prop-label')?.textContent).toBe('Цвет');
    expect(row.querySelectorAll('[role="radio"]')).toHaveLength(10);

    row.querySelector<HTMLButtonElement>('[data-color="purple"]')?.click();
    expect(values).toEqual(['#8b5cf6']);
  });
});
