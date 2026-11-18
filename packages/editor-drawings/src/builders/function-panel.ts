import { el, type Translate } from '@rich-editor/core';
import type { Plot } from '../scene/types';
import {
  applyFunctionParam,
  canLabelWithFormula,
  describeFunction,
  functionParams,
  functionText,
  type FormulaPart,
  type FunctionParam,
  type FunctionParamId,
  type ParabolaForm,
} from './plot-functions';

export interface FunctionPanelOptions {
  t: Translate;
  /** Десятичный разделитель в формуле: `,` или `.` (из таблицы переводов). */
  separator: string;
  /** Живой просмотр жеста ползунка; `first` — первое движение жеста: пора записать шаг истории. */
  onPreview(plot: Plot, first: boolean): void;
  /** Окончательное значение; `gesture` — завершает жест, шаг истории уже записан. */
  onCommit(plot: Plot, gesture: boolean): void;
  /** Флажок «Подписать график формулой». */
  onFormulaLabel(checked: boolean): void;
}

/** Строка параметра: ползунок и число — обновляются на месте, без пересоздания. */
interface ParamRow {
  range: HTMLInputElement;
  number: HTMLInputElement;
}

/** Пояснения к параметрам простыми словами; `m` и `n` везде — сдвиги, у окружности `a`, `b` — сдвиги центра. */
const HINT_KEYS: Record<string, string> = {
  line_k: 'drawings_plots_fn_hint_line_k',
  line_b: 'drawings_plots_fn_hint_line_b',
  line_c: 'drawings_plots_fn_hint_line_c',
  parabola_a: 'drawings_plots_fn_hint_parabola_a',
  parabola_b: 'drawings_plots_fn_hint_parabola_b',
  parabola_c: 'drawings_plots_fn_hint_parabola_c',
  hyperbola_k: 'drawings_plots_fn_hint_hyperbola_k',
  sqrt_a: 'drawings_plots_fn_hint_sqrt_a',
  circle_a: 'drawings_plots_fn_hint_circle_a',
  circle_b: 'drawings_plots_fn_hint_circle_b',
  circle_r: 'drawings_plots_fn_hint_circle_r',
  shift_m: 'drawings_plots_fn_hint_shift_x',
  shift_n: 'drawings_plots_fn_hint_shift_y',
};

const hintKey = (type: Plot['type'], id: FunctionParamId): string | undefined =>
  HINT_KEYS[id === 'm' || id === 'n' ? `shift_${id}` : `${type}_${id}`];

/** Формула из DOM-узлов: буквы курсивом, степень — `sup`, дробь и корень — разметкой и CSS. */
const formulaNodes = (parts: FormulaPart[]): Array<Node | string> =>
  parts.map((part) => {
    switch (part.kind) {
      case 'text':
        return part.text;
      case 'var':
        return el('i', { class: 'rte-plots-fn__var', text: part.name });
      case 'sup':
        return el('sup', { text: part.text });
      case 'frac': {
        const fraction = el('span', { class: 'rte-plots-fn__frac' });
        const numerator = el('span', { class: 'rte-plots-fn__num' });
        const denominator = el('span', { class: 'rte-plots-fn__den' });

        numerator.append(...formulaNodes(part.num));
        denominator.append(...formulaNodes(part.den));
        fraction.append(numerator, denominator);

        return fraction;
      }
      case 'sqrt': {
        const radicand = el('span', { class: 'rte-plots-fn__radicand' });

        radicand.append(...formulaNodes(part.body));

        return el('span', { class: 'rte-plots-fn__sqrt', children: [el('span', { class: 'rte-plots-fn__radical', text: '√' }), radicand] });
      }
      default:
        return '';
    }
  });

/** Значение для `input type="number"`: точка, без лишних нулей. */
const numberValue = (value: number): string => String(value);

/**
 * Блок «Функция» панели свойств: формула выделенной кривой, параметры
 * ползунком и числом, вид записи параболы, ветвь корня, подпись формулой.
 *
 * Выделенная кривая, вид записи параболы и идущий жест ползунка — общее
 * состояние обработчиков, поэтому класс. Пока идёт жест, блок не
 * пересоздаётся: значения меняются на месте, ползунок не теряет захват.
 */
export class FunctionPanel {
  readonly element: HTMLElement;

  private plot: Plot | null = null;

  private parabolaForm: ParabolaForm = 'vertex';

  /** Ползунок, который сейчас тянут: `input` уже был, `change` ещё нет. */
  private gesture: HTMLInputElement | null = null;

  private formulaLabel = false;

  private readonly card: HTMLElement;

  private readonly rows = new Map<FunctionParamId, ParamRow>();

  private labelCheckbox: HTMLInputElement | null = null;

  constructor(private readonly options: FunctionPanelOptions) {
    this.card = el('div', { class: 'rte-plots-fn__formula', attrs: { role: 'img' } });
    this.element = el('section', { class: 'rte-plots-fn', attrs: { 'aria-label': options.t('drawings_plots_fn_title') } });
  }

  /** Вид записи параболы: хранится в конструкторе и действует на все параболы. */
  get form(): ParabolaForm {
    return this.parabolaForm;
  }

  /** Собирает блок для кривой заново. */
  show(plot: Plot, formulaLabel: boolean): HTMLElement {
    const { t } = this.options;

    this.plot = plot;
    this.formulaLabel = formulaLabel;
    this.gesture = null;
    this.rows.clear();
    this.labelCheckbox = null;
    this.element.replaceChildren(el('h5', { class: 'rte-plots-fn__title', text: t('drawings_plots_fn_title') }), this.card);
    this.renderCard();

    if (plot.type === 'parabola') this.element.appendChild(this.formSwitch());

    if (plot.type === 'sqrt') this.element.appendChild(this.branchSwitch(plot.directionX));

    functionParams(plot, this.parabolaForm).forEach((param) => this.element.appendChild(this.paramRow(plot, param)));

    if (canLabelWithFormula(plot)) this.element.appendChild(this.labelToggle());

    return this.element;
  }

  /**
   * Новые значения на месте: карточка, ползунки, числа, флажок. Если набор
   * параметров стал другим (не тот тип кривой), блок собирается заново.
   */
  update(plot: Plot, formulaLabel: boolean): void {
    const params = functionParams(plot, this.parabolaForm);
    const same =
      this.plot !== null && this.plot.type === plot.type && params.length === this.rows.size && params.every((param) => this.rows.has(param.id));

    if (!same) {
      this.show(plot, formulaLabel);

      return;
    }

    this.plot = plot;
    this.formulaLabel = formulaLabel;
    this.renderCard();
    params.forEach((param) => {
      const row = this.rows.get(param.id);

      if (!row) return;

      if (row.range !== this.gesture) row.range.value = numberValue(param.value);

      row.number.value = numberValue(param.value);
    });

    if (this.labelCheckbox) this.labelCheckbox.checked = formulaLabel;

    // Ветвь корня переключается на месте: кнопка не теряет фокус.
    if (plot.type === 'sqrt') {
      this.element.querySelectorAll<HTMLButtonElement>('.rte-plots-fn__option').forEach((button) => {
        const checked = button.dataset.value === plot.directionX;

        button.setAttribute('aria-checked', String(checked));
        button.classList.toggle('rte-builder__tool--active', checked);
      });
    }
  }

  private renderCard(): void {
    const { plot } = this;

    if (!plot) return;

    const parts = describeFunction(plot, this.parabolaForm, this.options.separator) ?? [];

    this.card.replaceChildren(...formulaNodes(parts));
    this.card.setAttribute('aria-label', functionText(plot, this.parabolaForm, this.options.separator));
    // Цвет графика: строка из сцены идёт через CSSOM, недопустимую браузер просто не примет.
    this.card.style.color = plot.color ?? '';
  }

  /** Переключатель из кнопок с `role="radio"`: стрелки не нужны, кнопок всего две. */
  private radioGroup(label: string, items: Array<{ value: string; text: string; checked: boolean }>, onPick: (value: string) => void): HTMLElement {
    const group = el('div', { class: 'rte-plots-fn__switch', attrs: { role: 'radiogroup', 'aria-label': label } });

    items.forEach((item) => {
      const button = el('button', {
        class: 'rte-builder__tool rte-plots-fn__option',
        attrs: { type: 'button', role: 'radio', 'aria-checked': String(item.checked), 'data-value': item.value },
        text: item.text,
      });

      button.classList.toggle('rte-builder__tool--active', item.checked);
      button.addEventListener('click', () => {
        if (button.getAttribute('aria-checked') !== 'true') onPick(item.value);
      });
      group.appendChild(button);
    });

    return group;
  }

  private formSwitch(): HTMLElement {
    const { t } = this.options;
    const forms: ParabolaForm[] = ['vertex', 'standard'];

    return this.radioGroup(
      t('drawings_plots_fn_form'),
      forms.map((form) => ({ value: form, text: t(`drawings_plots_fn_form_${form}`), checked: form === this.parabolaForm })),
      (value) => {
        this.parabolaForm = value === 'standard' ? 'standard' : 'vertex';

        if (!this.plot) return;

        this.show(this.plot, this.formulaLabel);
        this.element.querySelector<HTMLButtonElement>(`.rte-plots-fn__option[data-value="${this.parabolaForm}"]`)?.focus();
      },
    );
  }

  private branchSwitch(current: 'left' | 'right'): HTMLElement {
    const { t } = this.options;
    const branches: Array<'right' | 'left'> = ['right', 'left'];

    return this.radioGroup(
      t('drawings_plots_fn_branch'),
      branches.map((branch) => ({ value: branch, text: t(`drawings_plots_${branch}`), checked: branch === current })),
      (value) => {
        const { plot } = this;

        if (plot?.type === 'sqrt') this.options.onCommit({ ...plot, directionX: value === 'left' ? 'left' : 'right' }, false);
      },
    );
  }

  private paramRow(plot: Plot, param: FunctionParam): HTMLElement {
    const { t } = this.options;
    const attrs = { min: param.min, max: param.max, step: param.step, value: numberValue(param.value), 'data-param': param.id };
    const range = el('input', { class: 'rte-plots-fn__range', attrs: { ...attrs, type: 'range', 'aria-label': `${t('drawings_plots_fn_slider')} ${param.id}` } });
    const number = el('input', {
      class: 'rte-input rte-plots-fn__number',
      attrs: { ...attrs, type: 'number', min: null, max: null, 'aria-label': `${t('drawings_plots_fn_value')} ${param.id}` },
    });
    const key = hintKey(plot.type, param.id);

    range.addEventListener('input', () => {
      const first = this.gesture === null;

      this.gesture = range;
      this.preview(param.id, Number(range.value), first);
    });
    range.addEventListener('change', () => {
      const inGesture = this.gesture !== null;

      this.gesture = null;
      this.commit(param.id, Number(range.value), inGesture);
    });
    number.addEventListener('change', () => {
      const value = Number(number.value);

      if (number.value.trim() === '' || !Number.isFinite(value)) {
        if (this.plot) this.update(this.plot, this.formulaLabel);

        return;
      }

      this.commit(param.id, value, false);
    });
    this.rows.set(param.id, { range, number });

    return el('div', {
      class: 'rte-plots-fn__param',
      children: [
        el('div', {
          class: 'rte-plots-fn__controls',
          children: [el('i', { class: 'rte-plots-fn__var rte-plots-fn__letter', text: param.id, attrs: { 'aria-hidden': 'true' } }), range, number],
        }),
        key ? el('p', { class: 'rte-plots-fn__hint', text: t(key) }) : null,
      ],
    });
  }

  private labelToggle(): HTMLElement {
    const input = el('input', { attrs: { type: 'checkbox', 'data-formula-label': true } });

    input.checked = this.formulaLabel;
    input.addEventListener('change', () => this.options.onFormulaLabel(input.checked));
    this.labelCheckbox = input;

    return el('label', {
      class: 'rte-builder__prop rte-plots__check',
      children: [input, el('span', { class: 'rte-builder__prop-label', text: this.options.t('drawings_plots_fn_label') })],
    });
  }

  private preview(id: FunctionParamId, value: number, first: boolean): void {
    if (this.plot) this.options.onPreview(applyFunctionParam(this.plot, this.parabolaForm, id, value), first);
  }

  private commit(id: FunctionParamId, value: number, gesture: boolean): void {
    if (this.plot) this.options.onCommit(applyFunctionParam(this.plot, this.parabolaForm, id, value), gesture);
  }
}
