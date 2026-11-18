import { el } from '@rich-editor/core';
import { ColorPicker, type ColorPickerOptions } from './color-picker';

/**
 * Строки панели свойств конструкторов: одно и то же поле выглядит и ведёт
 * себя одинаково на всех вкладках. Каждая фабрика возвращает строку
 * `.rte-builder__prop` с подписью `.rte-builder__prop-label`; обработчик
 * получает уже разобранное значение.
 */

export interface FieldOption {
  value: string;
  label: string;
}

/** Поле панели свойств: подпись и элемент управления; щелчок по подписи — фокус в поле. */
export const propertyField = (label: string, control: HTMLElement): HTMLElement =>
  el('label', { class: 'rte-builder__prop', children: [el('span', { class: 'rte-builder__prop-label', text: label }), control] });

export const selectControl = (options: FieldOption[], value: string): HTMLSelectElement => {
  const select = el('select', { class: 'rte-input rte-builder__select' });

  options.forEach((option) => {
    const item = el('option', { text: option.label, attrs: { value: option.value } });

    if (option.value === value) item.selected = true;

    select.appendChild(item);
  });

  return select;
};

/** Заголовок блока панели: название выделенного или раздела. */
export const propsTitle = (text: string): HTMLElement => el('h4', { class: 'rte-builder__props-title', text });

/** Пустое состояние панели: ничего не выделено. */
export const propsEmpty = (text: string): HTMLElement => el('p', { class: 'rte-builder__props-empty', text });

/** Число из поля ввода: пустое и нечисловое — `null`. */
const parseNumber = (text: string): number | null => {
  const value = Number(text);

  return text.trim() === '' || !Number.isFinite(value) ? null : value;
};

const optionalNumber = (value: number | undefined): string | undefined => (value === undefined ? undefined : String(value));

export interface TextFieldOptions {
  label: string;
  value: string;
  /** `data-prop` поля: по нему его находят тесты и синхронизация панели. */
  prop?: string;
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
  /** Только показ значения (величина угла): обработчика нет. */
  readOnly?: boolean;
  /** Поле получает фокус, когда панель открывают на новом выделении. */
  autofocus?: boolean;
  /** Дополнительный класс поля ввода. */
  className?: string;
  /** Новое значение без пробелов по краям, по `change`. */
  onChange?(value: string, input: HTMLInputElement): void;
}

export const textField = (options: TextFieldOptions): HTMLElement => {
  const input = el('input', {
    class: options.className ? `rte-input ${options.className}` : 'rte-input',
    attrs: {
      type: 'text',
      value: options.value,
      placeholder: options.placeholder,
      maxlength: optionalNumber(options.maxLength),
      readonly: options.readOnly,
      disabled: options.disabled,
      autocomplete: 'off',
      spellcheck: 'false',
      'data-prop': options.prop,
      'data-autofocus': options.autofocus,
    },
  });
  const { onChange } = options;

  if (onChange) input.addEventListener('change', () => onChange(input.value.trim(), input));

  return propertyField(options.label, input);
};

export interface NumberFieldOptions {
  label: string;
  value: number;
  step: number;
  min?: number;
  max?: number;
  prop?: string;
  /**
   * Разобранное число по `change`; пустой и нечисловой ввод обработчик не
   * вызывает. `false` — число не принято: поле показывает прежнее значение.
   */
  onChange(value: number): boolean | void;
}

export const numberField = (options: NumberFieldOptions): HTMLElement => {
  const input = el('input', {
    class: 'rte-input',
    attrs: {
      type: 'number',
      step: String(options.step),
      min: optionalNumber(options.min),
      max: optionalNumber(options.max),
      value: String(options.value),
      'data-prop': options.prop,
    },
  });
  let shown = input.value;

  input.addEventListener('change', () => {
    const value = parseNumber(input.value);

    if (value === null || options.onChange(value) === false) {
      input.value = shown;

      return;
    }

    shown = input.value;
  });

  return propertyField(options.label, input);
};

export interface CheckFieldOptions {
  label: string;
  checked: boolean;
  prop?: string;
  disabled?: boolean;
  onChange(checked: boolean): void;
}

/** Флажок в строку с подписью: подпись справа, вся строка нажимается. */
export const checkField = (options: CheckFieldOptions): HTMLElement => {
  const input = el('input', { class: 'rte-builder__check', attrs: { type: 'checkbox', disabled: options.disabled, 'data-prop': options.prop } });

  input.checked = options.checked;
  input.addEventListener('change', () => options.onChange(input.checked));

  return el('label', {
    class: 'rte-builder__prop rte-builder__prop--check',
    children: [input, el('span', { class: 'rte-builder__prop-label', text: options.label })],
  });
};

export interface SelectFieldOptions {
  label: string;
  options: FieldOption[];
  value: string;
  prop?: string;
  onChange(value: string): void;
}

export const selectField = (options: SelectFieldOptions): HTMLElement => {
  const select = selectControl(options.options, options.value);

  if (options.prop) select.dataset.prop = options.prop;

  select.addEventListener('change', () => options.onChange(select.value));

  return propertyField(options.label, select);
};

/** Пара чисел; `null` — пустое поле. */
export type NumberPair = [number | null, number | null];

export interface PairFieldOptions {
  /** Подпись называет оба числа: «Точка (x, y)», «Область (от, до)». */
  label: string;
  values: NumberPair;
  step: number;
  /**
   * Оба числа по `change` любого из полей; пустое или нечисловое — `null`.
   * `false` — пара не принята: поля показывают прежние значения.
   */
  onChange(values: NumberPair): boolean | void;
}

export const pairField = (options: PairFieldOptions): HTMLElement => {
  const show = (value: number | null): string => (value === null ? '' : String(value));
  const input = (value: number | null): HTMLInputElement =>
    el('input', { class: 'rte-input', attrs: { type: 'number', step: String(options.step), value: show(value) } });
  const first = input(options.values[0]);
  const second = input(options.values[1]);
  let shown = options.values;
  const apply = (): void => {
    const values: NumberPair = [parseNumber(first.value), parseNumber(second.value)];

    if (options.onChange(values) === false) {
      first.value = show(shown[0]);
      second.value = show(shown[1]);

      return;
    }

    shown = values;
  };

  first.addEventListener('change', apply);
  second.addEventListener('change', apply);

  return propertyField(options.label, el('div', { class: 'rte-builder__pair', children: [first, second] }));
};

export interface SliderFieldOptions {
  label: string;
  value: number;
  min: number;
  max: number;
  /** Шаг ползунка. */
  step: number;
  /** Шаг стрелок числового поля, если он не совпадает с шагом ползунка. */
  inputStep?: number;
  /** `data-prop` числового поля. */
  prop?: string;
  /** `data-prop` ползунка. */
  rangeProp?: string;
  /** Пояснение под строкой. */
  hint?: string;
  /** Ползунок двигают: значение на каждом шаге жеста. */
  onSlide(value: number): void;
  /**
   * Жест ползунка закончен: `change`, отпущены указатель или клавиша, ушёл
   * фокус. Приходит и без движения — отличать это дело вызывающего.
   */
  onRelease(): void;
  /** Число введено в поле — одна правка. */
  onChange(value: number): void;
}

export interface SliderField {
  element: HTMLElement;
  /** Новое значение без пересоздания строки; поле в фокусе не трогается — его правят. */
  setValue(value: number): void;
}

/** Строка-ползунок: ползунок и числовое поле с общей подписью, под ними — пояснение. */
export const sliderField = (options: SliderFieldOptions): SliderField => {
  const min = String(options.min);
  const max = String(options.max);
  const value = String(options.value);
  const range = el('input', {
    class: 'rte-builder__range',
    attrs: { type: 'range', min, max, step: String(options.step), value, 'aria-label': options.label, 'data-prop': options.rangeProp },
  });
  const input = el('input', {
    class: 'rte-input',
    attrs: { type: 'number', min, max, step: String(options.inputStep ?? options.step), value, 'aria-label': options.label, 'data-prop': options.prop },
  });
  const setValue = (next: number): void => {
    [range, input].forEach((control) => {
      if (control !== document.activeElement) control.value = String(next);
    });
  };
  const slide = (): void => {
    const next = parseNumber(range.value);

    if (next === null) return;

    if (input !== document.activeElement) input.value = range.value;

    options.onSlide(next);
  };

  range.addEventListener('input', slide);
  range.addEventListener('change', () => {
    slide();
    options.onRelease();
  });
  // Ползунок увели и вернули на место — `change` не придёт, жест закрывают эти события.
  ['pointerup', 'keyup', 'blur'].forEach((type) => range.addEventListener(type, () => options.onRelease()));
  input.addEventListener('change', () => {
    const next = parseNumber(input.value);

    if (next === null) {
      input.value = range.value;

      return;
    }

    range.value = String(next);
    options.onChange(next);
  });

  const element = el('div', {
    class: 'rte-builder__prop rte-builder__prop--slider',
    children: [
      el('span', { class: 'rte-builder__prop-label', text: options.label }),
      el('div', { class: 'rte-builder__slider', children: [range, input] }),
      options.hint ? el('p', { class: 'rte-builder__prop-hint', text: options.hint }) : null,
    ],
  });

  return { element, setValue };
};

/** Поле «Цвет»: палитра плиток (`color-picker.ts`). */
export const colorField = (options: ColorPickerOptions): HTMLElement => new ColorPicker(options).element;
