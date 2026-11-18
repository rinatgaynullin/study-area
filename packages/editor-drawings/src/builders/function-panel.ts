import { el, type Translate } from '@rich-editor/core';
import { checkField, pairField, sliderField, textField, type SliderField } from './fields';
import { functionParts, functionText, parseFunction, type FormulaPart, type FunctionNode, type ParsedFunction } from './function-expr';

/** Что показывает блок: запись в поле, буквы-параметры, область, цвет карточки, признак подписи-формулы. */
export interface FunctionView {
  /** Запись в поле: набранная функция или запись готовой кривой. */
  expr: string;
  /** Буквы-параметры записи по порядку и их значения; у готовой кривой — пусто. */
  params: Array<{ name: string; value: number }>;
  domain?: [number, number];
  color?: string;
  formulaLabel: boolean;
}

export interface FunctionPanelOptions {
  t: Translate;
  /** Десятичный разделитель в записи: `,` или `.` (из таблицы переводов). */
  separator: string;
  /** Набор в поле разобрался: живой просмотр. `first` — первое изменение правки: пора снять снимок для истории. */
  onInput(expr: string, params: string[], first: boolean): void;
  /** Правка поля закончена (`change`, Enter, потеря фокуса): шаг истории. */
  onCommit(): void;
  /** Escape в поле: вернуть всё, как было до начала правки. */
  onRevert(): void;
  /** Ползунок параметра двигают; `first` — первое движение жеста. */
  onParamSlide(name: string, value: number, first: boolean): void;
  /** Жест ползунка закончен. */
  onParamRelease(): void;
  /** Число параметра введено в поле — одна правка. */
  onParamChange(name: string, value: number): void;
  onDomain(domain: [number, number] | undefined): void;
  /** Флажок «Подписать график формулой». */
  onFormulaLabel(checked: boolean): void;
}

/** Ползунок параметра: от −10 до 10 шагом 0,1; число в поле — без границ. */
const PARAM_RANGE = { min: -10, max: 10, step: 0.1 };

/** Шаг стрелок полей области — шаг сетки полотна. */
const DOMAIN_STEP = 0.5;

/**
 * Кнопка-подсказка под полем: вставляет текст в позицию курсора. `wrap` —
 * открывающая и закрывающая части: выделенный текст оказывается внутри,
 * курсор без выделения — между ними.
 */
interface KeySpec {
  text: string;
  /** Имя для скринридера, если надпись — знак. */
  labelKey?: string;
  insert(before: string): string;
  close?: string;
}

/** Перед курсором — то, что можно возвести в степень: буква, цифра, скобка или черта модуля. */
const endsOperand = (before: string): boolean => /[\p{L}\d)|π²³]\s*$/u.test(before);

const KEYS: KeySpec[] = [
  // Квадрат: после операнда — степень, иначе сам `x²`.
  { text: 'x²', labelKey: 'drawings_plots_fn_key_square', insert: (before) => (endsOperand(before) ? '^2' : 'x^2') },
  { text: 'xⁿ', labelKey: 'drawings_plots_fn_key_power', insert: () => '^' },
  { text: '√', labelKey: 'drawings_plots_fn_key_sqrt', insert: () => '√(', close: ')' },
  { text: '|x|', labelKey: 'drawings_plots_fn_key_abs', insert: () => '|', close: '|' },
  { text: '( )', labelKey: 'drawings_plots_fn_key_parens', insert: () => '(', close: ')' },
  { text: 'π', labelKey: 'drawings_plots_fn_key_pi', insert: () => 'π' },
  { text: 'sin', insert: () => 'sin(', close: ')' },
  { text: 'cos', insert: () => 'cos(', close: ')' },
  { text: 'tg', insert: () => 'tg(', close: ')' },
  { text: 'ln', insert: () => 'ln(', close: ')' },
];

/** Элемент с детьми — узлами и строками: `el` принимает только узлы. */
const box = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string | undefined, children: Array<Node | string>): HTMLElementTagNameMap[K] => {
  const element = el(tag, className ? { class: className } : {});

  element.append(...children);

  return element;
};

/** Формула из DOM-узлов: буквы курсивом, степень и индекс — `sup` и `sub`, дробь и корень — разметкой и CSS. */
const formulaNodes = (parts: FormulaPart[]): Array<Node | string> =>
  parts.map((part) => {
    switch (part.kind) {
      case 'text':
        return part.text;
      case 'var':
        return el('i', { class: 'rte-plots-fn__var', text: part.name });
      case 'sup':
        return box('sup', undefined, formulaNodes(part.body));
      case 'sub':
        return box('sub', undefined, formulaNodes(part.body));
      case 'abs':
        return box('span', 'rte-plots-fn__abs', ['|', ...formulaNodes(part.body), '|']);
      case 'frac':
        return box('span', 'rte-plots-fn__frac', [box('span', 'rte-plots-fn__num', formulaNodes(part.num)), box('span', 'rte-plots-fn__den', formulaNodes(part.den))]);
      case 'sqrt':
        return box('span', 'rte-plots-fn__sqrt', [
          el('span', { class: 'rte-plots-fn__radical', text: part.index === '3' ? '∛' : '√' }),
          box('span', 'rte-plots-fn__radicand', formulaNodes(part.body)),
        ]);
      default:
        return '';
    }
  });

/** Счётчик id текста ошибки: поле ссылается на него через `aria-describedby`. */
let errorCount = 0;

/**
 * Блок «Функция» панели свойств: карточка формулы, поле ввода записи с
 * кнопками-подсказками, ползунки букв-параметров, область по x и подпись
 * формулой.
 *
 * Идущая правка поля, запись на её начало, жест ползунка и строки
 * параметров — общее состояние обработчиков, поэтому класс. Пока идёт
 * правка или жест, блок не пересоздаётся: поле и ползунок не теряют фокус.
 */
export class FunctionPanel {
  readonly element: HTMLElement;

  private view: FunctionView | null = null;

  /** Последняя правильная запись: её показывает карточка, пока в поле ошибка. */
  private ast: FunctionNode | null = null;

  /** Запись на начало правки: её возвращает Escape. */
  private committed = '';

  /** Идёт правка поля: изменения уже на полотне, шага истории ещё нет. */
  private editing = false;

  /** Параметр, ползунок которого тянут. */
  private gesture: string | null = null;

  private readonly card: HTMLElement;

  private input: HTMLInputElement | null = null;

  private readonly error: HTMLElement;

  private readonly params: HTMLElement;

  /** Строки параметров: ползунок и число обновляются на месте, без пересоздания. */
  private readonly rows = new Map<string, SliderField>();

  private labelCheckbox: HTMLInputElement | null = null;

  constructor(private readonly options: FunctionPanelOptions) {
    errorCount += 1;
    this.card = el('div', { class: 'rte-plots-fn__formula', attrs: { role: 'img' } });
    this.error = el('p', { class: 'rte-plots-fn__error', attrs: { id: `rte-plots-fn-error-${errorCount}`, hidden: true } });
    this.params = el('div', { class: 'rte-plots-fn__params' });
    this.element = el('section', { class: 'rte-plots-fn', attrs: { 'aria-label': options.t('drawings_plots_fn_title') } });
  }

  /** Поле записи: в него ставят фокус после «+ Функция» и шаблона. */
  get field(): HTMLInputElement | null {
    return this.input;
  }

  /** Собирает блок заново. */
  show(view: FunctionView): HTMLElement {
    const { t } = this.options;

    this.view = view;
    this.editing = false;
    this.gesture = null;
    this.committed = view.expr;
    this.rows.clear();
    this.params.replaceChildren();
    this.setError(null);

    const parsed = parseFunction(view.expr);

    this.ast = parsed.ok ? parsed.ast : null;
    this.element.replaceChildren(
      el('h5', { class: 'rte-plots-fn__title', text: t('drawings_plots_fn_title') }),
      this.card,
      this.exprField(view.expr),
      this.error,
      this.keys(),
      this.params,
      this.domainField(view.domain),
      this.labelToggle(view.formulaLabel),
    );
    this.renderCard();
    this.renderParams(view.params);

    return this.element;
  }

  /** Новые значения на месте: карточка, параметры, флажок; поле — только если его сейчас не правят. */
  update(view: FunctionView): void {
    this.view = view;

    if (!this.editing) {
      const parsed = parseFunction(view.expr);

      this.ast = parsed.ok ? parsed.ast : null;
      this.committed = view.expr;

      if (this.input && this.input !== document.activeElement) {
        this.input.value = view.expr;
        this.setError(null);
      }
    }

    this.renderCard();
    this.renderParams(view.params);

    if (this.labelCheckbox) this.labelCheckbox.checked = view.formulaLabel;
  }

  private renderCard(): void {
    const { ast, view } = this;
    const parts = ast ? functionParts(ast, this.options.separator) : [];

    this.card.replaceChildren(el('i', { class: 'rte-plots-fn__var', text: 'y' }), ' = ', ...formulaNodes(parts));
    this.card.setAttribute('aria-label', ast ? functionText(ast, this.options.separator) : 'y =');
    // Цвет графика: строка из сцены идёт через CSSOM, недопустимую браузер просто не примет.
    this.card.style.color = view?.color ?? '';
  }

  /** Строки параметров: набор букв стал другим — строки заново, иначе только значения. */
  private renderParams(params: FunctionView['params']): void {
    const same = params.length === this.rows.size && params.every((param) => this.rows.has(param.name));

    if (!same) {
      this.rows.clear();
      this.params.replaceChildren(...params.map((param) => this.paramRow(param.name, param.value)));

      return;
    }

    params.forEach((param) => {
      // Строку тянутого ползунка не трогают: число в ней уже ведёт сам ползунок.
      if (param.name !== this.gesture) this.rows.get(param.name)?.setValue(param.value);
    });
  }

  private setError(parsed: ParsedFunction | null): void {
    const failed = parsed !== null && !parsed.ok;

    this.error.hidden = !failed;
    this.error.textContent = parsed && !parsed.ok ? this.options.t(parsed.error.key, { word: parsed.error.word ?? '' }) : '';
    this.input?.setAttribute('aria-invalid', String(failed));
  }

  private exprField(value: string): HTMLElement {
    const { t } = this.options;
    const field = textField({ label: 'y =', value, prop: 'expr', placeholder: 'x^2 - 4', className: 'rte-plots-fn__input' });
    const input = field.querySelector('input');

    field.classList.add('rte-plots-fn__field');
    this.input = input;

    if (!input) return field;

    // На телефоне — обычная клавиатура без автозамены и заглавной буквы.
    input.setAttribute('inputmode', 'text');
    input.setAttribute('autocapitalize', 'off');
    input.setAttribute('autocorrect', 'off');
    input.setAttribute('spellcheck', 'false');
    input.setAttribute('aria-label', t('drawings_plots_fn_input'));
    input.setAttribute('aria-describedby', this.error.id);
    input.setAttribute('aria-invalid', 'false');
    input.addEventListener('input', () => this.typed(input.value));
    input.addEventListener('change', () => this.commit());
    input.addEventListener('blur', () => this.commit());
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.commit();
      }

      if (event.key === 'Escape') this.revert(event);
    });

    return field;
  }

  /** Набор в поле: разобралось — график и карточка сразу, нет — ошибка, на полотне прежний график. */
  private typed(text: string): void {
    const parsed = parseFunction(text);

    this.setError(parsed);

    if (!parsed.ok) return;

    const first = !this.editing;

    this.editing = true;
    this.ast = parsed.ast;
    this.renderCard();
    this.options.onInput(text.trim(), parsed.params, first);
  }

  private commit(): void {
    if (!this.editing) return;

    this.editing = false;
    this.committed = this.input?.value.trim() ?? this.committed;
    this.options.onCommit();
  }

  /** Escape: запись на начало правки, ошибка прочь; окно не закрывается — Escape уже обработан. */
  private revert(event: KeyboardEvent): void {
    const { input } = this;

    if (!input || (!this.editing && input.value.trim() === this.committed)) return;

    event.preventDefault();

    const wasEditing = this.editing;

    this.editing = false;
    input.value = this.committed;
    this.setError(null);

    const parsed = parseFunction(this.committed);

    this.ast = parsed.ok ? parsed.ast : null;
    this.renderCard();

    if (wasEditing) this.options.onRevert();
  }

  /** Кнопки-подсказки: нажатие не уводит фокус из поля, текст встаёт на место курсора. */
  private keys(): HTMLElement {
    const { t } = this.options;
    const group = el('div', { class: 'rte-plots-fn__keys', attrs: { role: 'group', 'aria-label': t('drawings_plots_fn_keys') } });

    KEYS.forEach((key) => {
      const label = key.labelKey ? t(key.labelKey) : undefined;
      const button = el('button', {
        class: 'rte-builder__tool rte-plots-fn__key',
        attrs: { type: 'button', 'aria-label': label, title: label, 'data-key': key.text },
        text: key.text,
      });

      // Фокус остаётся в поле: на телефоне не прячется клавиатура, а потеря фокуса не закрывает правку.
      button.addEventListener('pointerdown', (event) => event.preventDefault());
      button.addEventListener('mousedown', (event) => event.preventDefault());
      button.addEventListener('click', () => this.insert(key));
      group.appendChild(button);
    });

    return group;
  }

  private insert(key: KeySpec): void {
    const { input } = this;

    if (!input) return;

    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    const before = input.value.slice(0, start);
    const selected = input.value.slice(start, end);
    const opening = key.insert(before);
    const closing = key.close ?? '';

    input.value = `${before}${opening}${selected}${closing}${input.value.slice(end)}`;
    input.focus();

    // Курсор — после вставленного; без выделения у пары — между её частями.
    const caret = start + opening.length + selected.length + (selected === '' ? 0 : closing.length);

    input.setSelectionRange(caret, caret);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  private paramRow(name: string, value: number): HTMLElement {
    const { t } = this.options;
    const row = sliderField({
      label: name,
      value,
      ...PARAM_RANGE,
      inputStep: PARAM_RANGE.step,
      freeInput: true,
      prop: name,
      rangeProp: name,
      rangeLabel: `${t('drawings_plots_fn_slider')} ${name}`,
      inputLabel: `${t('drawings_plots_fn_value')} ${name}`,
      onSlide: (next) => this.slide(name, next),
      onRelease: () => this.release(name),
      onChange: (next) => this.edit(name, next),
    });

    this.rows.set(name, row);

    return row.element;
  }

  /** Движение ползунка: первое начинает жест — снимок и шаг истории по его итогу. */
  private slide(name: string, value: number): void {
    // Другой ползунок, пока прежний жест не закрыт, — прежний сначала закрывается.
    if (this.gesture !== null && this.gesture !== name) this.release(this.gesture);

    const first = this.gesture === null;

    this.gesture = name;
    this.options.onParamSlide(name, value, first);
  }

  private release(name: string): void {
    if (this.gesture !== name) return;

    this.gesture = null;
    this.options.onParamRelease();
  }

  /** Число в поле — одна правка; незакрытый жест закрывается раньше неё. */
  private edit(name: string, value: number): void {
    if (this.gesture !== null) this.release(this.gesture);

    this.options.onParamChange(name, value);
  }

  /** Область по x: пустое поле — граница в бесконечности, оба пустые — без ограничения. */
  private domainField(domain: [number, number] | undefined): HTMLElement {
    const shown = (value: number | undefined): number | null => (value === undefined || !Number.isFinite(value) ? null : value);
    const bound = (value: number | null, open: number): number => (value === null ? open : value);

    return pairField({
      label: this.options.t('drawings_plots_prop_domain'),
      values: [shown(domain?.[0]), shown(domain?.[1])],
      step: DOMAIN_STEP,
      onChange: ([low, high]) => {
        const from = bound(low, -Infinity);
        const to = bound(high, Infinity);

        this.options.onDomain(from === -Infinity && to === Infinity ? undefined : [Math.min(from, to), Math.max(from, to)]);
      },
    });
  }

  private labelToggle(checked: boolean): HTMLElement {
    const field = checkField({
      label: this.options.t('drawings_plots_fn_label'),
      checked,
      prop: 'formula-label',
      onChange: (value) => this.options.onFormulaLabel(value),
    });

    this.labelCheckbox = field.querySelector('input');

    return field;
  }
}
