import { el, type Translate } from '@rich-editor/core';
import type { Plot } from '../scene/types';
import { checkField, sliderField, type SliderField } from './fields';
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
  /** Выбран вид записи параболы: подпись-формула выделенной кривой переходит в него. */
  onForm(form: ParabolaForm): void;
}

/** Идущий жест ползунка: параметр, кривая на его начало и последнее значение. */
interface Gesture {
  id: FunctionParamId;
  /** Параметр применяется к кривой на начало жеста, а не к уже изменённой, — сдвиг не копится. */
  base: Plot;
  value: number;
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

  /**
   * Жест ползунка: начинается первым движением и закрывается, когда ползунок
   * отпустили, — даже если его вернули на прежнее значение и `change` не пришёл.
   */
  private gesture: Gesture | null = null;

  private formulaLabel = false;

  private readonly card: HTMLElement;

  /** Строки параметров: ползунок и число обновляются на месте, без пересоздания. */
  private readonly rows = new Map<FunctionParamId, SliderField>();

  private labelCheckbox: HTMLInputElement | null = null;

  constructor(private readonly options: FunctionPanelOptions) {
    this.card = el('div', { class: 'rte-plots-fn__formula', attrs: { role: 'img' } });
    this.element = el('section', { class: 'rte-plots-fn', attrs: { 'aria-label': options.t('drawings_plots_fn_title') } });
  }

  /** Вид записи параболы: хранится в конструкторе и действует на все параболы. */
  get form(): ParabolaForm {
    return this.parabolaForm;
  }

  /** Вид записи от конструктора (подпись-формула выделенной параболы); блок покажет его при следующей сборке. */
  set form(form: ParabolaForm) {
    this.parabolaForm = form;
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
      // Строку тянутого ползунка не трогают: число в ней уже ведёт сам ползунок.
      if (param.id !== this.gesture?.id) this.rows.get(param.id)?.setValue(param.value);
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
        this.options.onForm(this.parabolaForm);

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
    const key = hintKey(plot.type, param.id);
    const row = sliderField({
      label: param.id,
      value: param.value,
      min: param.min,
      max: param.max,
      step: param.step,
      prop: param.id,
      rangeProp: param.id,
      rangeLabel: `${t('drawings_plots_fn_slider')} ${param.id}`,
      inputLabel: `${t('drawings_plots_fn_value')} ${param.id}`,
      hint: key ? t(key) : undefined,
      onSlide: (value) => this.slide(param.id, value),
      onRelease: () => this.release(param.id),
      onChange: (value) => this.edit(param.id, value),
    });

    this.rows.set(param.id, row);

    return row.element;
  }

  private labelToggle(): HTMLElement {
    const field = checkField({
      label: this.options.t('drawings_plots_fn_label'),
      checked: this.formulaLabel,
      prop: 'formula-label',
      onChange: (checked) => this.options.onFormulaLabel(checked),
    });

    this.labelCheckbox = field.querySelector('input');

    return field;
  }

  /** Движение ползунка: первое начинает жест — снимок кривой и шаг истории. */
  private slide(id: FunctionParamId, value: number): void {
    // Другой ползунок, пока прежний жест не закрыт, — прежний сначала закрывается.
    if (this.gesture && this.gesture.id !== id) this.release(this.gesture.id);

    const first = this.gesture === null;
    const base = this.gesture?.base ?? this.plot;

    if (!base) return;

    this.gesture = { id, base, value };
    this.options.onPreview(applyFunctionParam(base, this.parabolaForm, id, value), first);
  }

  /** Ползунок отпустили: окончательное значение жеста, снимок больше не нужен. */
  private release(id: FunctionParamId): void {
    const { gesture } = this;

    if (!gesture || gesture.id !== id) return;

    this.gesture = null;
    this.options.onCommit(applyFunctionParam(gesture.base, this.parabolaForm, id, gesture.value), true);
  }

  /** Число в поле — одна правка текущей кривой; незакрытый жест закрывается раньше неё. */
  private edit(id: FunctionParamId, value: number): void {
    if (this.gesture) this.release(this.gesture.id);

    const { plot } = this;

    if (plot) this.options.onCommit(applyFunctionParam(plot, this.parabolaForm, id, value), false);
  }
}
