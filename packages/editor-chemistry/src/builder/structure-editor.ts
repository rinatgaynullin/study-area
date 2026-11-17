import { createDisposer, el, icon, on, sanitizeSvg, type Translate } from '@rich-editor/core';
import { formatChemLabel } from '../chemfig/format-label';
import { chemfigToSvg, layoutChemistry, renderChemistrySvg, type ChemLayout } from '../chemfig/render-svg';
import { tryParseChemfig } from '../chemfig/parse-chemfig';
import type { ChemAtom, ChemBond, ChemBondType, ChemStructure } from '../chemfig/types';
import { CHEMISTRY_TEMPLATES } from '../templates';
import {
  attachAtom,
  attachRing,
  createChain,
  createRing,
  freeDirections,
  locateAtom,
  normalizeGroupLabel,
  parseForEditing,
  removeAtom,
  ringAvailability,
  structureCode,
} from './structure-model';

export interface StructureEditorOptions {
  t: Translate;
  onChange?(): void;
}

/** Группы палитры: подпись в коде, на кнопке — через `formatChemLabel`. */
const GROUPS = ['CH_3', 'CH_2', 'CH', 'C', 'H', 'OH', 'O', 'NH_2', 'N', 'COOH', 'CHO', 'Cl', 'Br', 'F', 'I', 'S', 'NO_2'];

const BOND_TYPES: Array<{ type: ChemBondType; labelKey: string }> = [
  { type: '-', labelKey: 'chemistry_builder_single' },
  { type: '=', labelKey: 'chemistry_builder_double' },
  { type: '~', labelKey: 'chemistry_builder_triple' },
];

const RINGS: Array<{ id: string; size: number; aromatic: boolean; labelKey: string }> = [
  { id: 'benzene', size: 6, aromatic: true, labelKey: 'chemistry_builder_benzene' },
  { id: 'hexagon', size: 6, aromatic: false, labelKey: 'chemistry_builder_hexagon' },
  { id: 'pentagon', size: 5, aromatic: false, labelKey: 'chemistry_builder_pentagon' },
];

/** Миниатюры готовых формул — тем же рендером в масштабе. */
const TEMPLATE_SCALE = 0.45;

/** Геометрия слоя поверх структуры, в пикселях раскладки при масштабе 1. */
const ATOM_HIT_RADIUS = 14;
const BOND_HIT_WIDTH = 12;
const SELECTED_RADIUS = 15;
const PLUS_DISTANCE = 42;
const PLUS_RADIUS = 10;
/** Область нажатия «плюса» шире видимого кружка: на телефоне в него надо попасть пальцем. */
const PLUS_HIT_RADIUS = 16;
const PLUS_ARM = 5;

/** Поля вокруг структуры (под «плюсы») и наименьший видимый кадр: одинокий атом не раздувается на всё полотно. */
const VIEW_MARGIN = 64;
const MIN_VIEW_WIDTH = 320;
const MIN_VIEW_HEIGHT = 200;

/** Сколько снимков помнит отмена. */
const HISTORY_LIMIT = 100;

const SVG_NS = 'http://www.w3.org/2000/svg';

type Selection =
  | { kind: 'atom'; atom: ChemAtom }
  | { kind: 'bond'; bond: ChemBond }
  | { kind: 'ring-bond'; index: number }
  | null;

const num = (value: number): string => String(Math.round(value * 10) / 10);

const svgElement = (tag: string, attrs: Record<string, string | number>): SVGElement => {
  const element = document.createElementNS(SVG_NS, tag);

  Object.entries(attrs).forEach(([name, value]) => {
    element.setAttribute(name, typeof value === 'number' ? num(value) : value);
  });

  return element;
};

/** Кнопка конструктора с подписью; `data-*` — по ним работает делегирование кликов. */
const builderButton = (text: string, data: Record<string, string>, extraClass = ''): HTMLButtonElement =>
  el('button', {
    class: `rte-chem-builder__button ${extraClass}`.trim(),
    text,
    attrs: { type: 'button', ...Object.fromEntries(Object.entries(data).map(([name, value]) => [`data-${name}`, value])) },
  });

const iconButton = (name: string, label: string, action: string): HTMLButtonElement =>
  el('button', {
    class: 'rte-chem-builder__button rte-chem-builder__button--icon',
    attrs: { type: 'button', title: label, 'aria-label': label, 'data-action': action },
    children: [icon(name, 18)],
  });

const isTextField = (target: EventTarget | null): boolean =>
  target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;

/**
 * Конструктор структурной формулы: полотно со структурой и «плюсами»,
 * палитра групп, тип связи, свойства выделенного, готовые формулы.
 *
 * Правит ту же модель, что даёт разбор chemfig, рисует её тем же рендером,
 * что и документ, а код получает сериализацией. Класс: модель, выделение,
 * история и элементы панели — общее состояние всех обработчиков.
 */
export class StructureEditor {
  readonly element: HTMLElement;

  private readonly t: Translate;

  private readonly disposer = createDisposer();

  private structure: ChemStructure | null = null;

  /** Раскладка текущей структуры: по ней стоят области нажатия и «плюсы». */
  private layout: ChemLayout | null = null;

  private selection: Selection = null;

  /** Группа, которую ставят «плюсы». Выбрана всегда. */
  private group = 'CH_3';

  private bondType: ChemBondType = '-';

  /** «Плюсы» текущего выделенного атома: номер в `data-plus` — индекс здесь. */
  private pluses: Array<{ atom: ChemAtom; angle: number }> = [];

  /** История — снимки кода; `historyIndex` — текущий. */
  private history: string[] = [''];

  private historyIndex = 0;

  private readonly stage: HTMLElement;

  private readonly hint: HTMLElement;

  private readonly status: HTMLElement;

  private readonly side: HTMLElement;

  private readonly customInput: HTMLInputElement;

  private readonly replaceToggle: HTMLInputElement;

  private readonly props: HTMLElement;

  private readonly propsTitle: HTMLElement;

  private readonly atomProps: HTMLElement;

  private readonly bondProps: HTMLElement;

  private readonly clearLabelButton: HTMLButtonElement;

  private readonly bondDeleteButton: HTMLButtonElement;

  private readonly undoButton: HTMLButtonElement;

  private readonly redoButton: HTMLButtonElement;

  private readonly clearButton: HTMLButtonElement;

  constructor(private readonly options: StructureEditorOptions) {
    const { t } = options;

    this.t = t;

    this.undoButton = iconButton('undo', t('chemistry_builder_undo'), 'undo');
    this.redoButton = iconButton('redo', t('chemistry_builder_redo'), 'redo');
    this.clearButton = builderButton(t('chemistry_builder_clear'), { action: 'clear' });

    this.hint = el('p', { class: 'rte-chem-builder__hint', attrs: { 'aria-live': 'polite' } });
    this.status = el('p', { class: 'rte-chem-builder__status', attrs: { role: 'status' } });
    this.stage = el('div', {
      class: 'rte-chem-builder__stage',
      attrs: { tabindex: 0, 'aria-label': t('chemistry_builder_canvas'), 'data-autofocus': true },
    });

    this.customInput = el('input', {
      class: 'rte-input rte-chem-builder__custom-input',
      attrs: {
        type: 'text',
        spellcheck: 'false',
        autocapitalize: 'off',
        autocomplete: 'off',
        placeholder: 'C2H5',
        'aria-label': t('chemistry_builder_custom'),
      },
    });

    this.replaceToggle = el('input', { attrs: { type: 'checkbox' } });
    this.clearLabelButton = builderButton(t('chemistry_builder_clear_label'), { action: 'clear-label' });
    this.bondDeleteButton = builderButton(
      t('chemistry_builder_delete'),
      { action: 'delete' },
      'rte-chem-builder__button--danger',
    );

    this.propsTitle = el('h3', { class: 'rte-chem-builder__title' });
    this.atomProps = el('div', {
      class: 'rte-chem-builder__row',
      children: [
        el('label', {
          class: 'rte-chem-builder__toggle',
          children: [this.replaceToggle, el('span', { text: t('chemistry_builder_replace') })],
        }),
        this.clearLabelButton,
        builderButton(t('chemistry_builder_delete'), { action: 'delete' }, 'rte-chem-builder__button--danger'),
      ],
    });
    this.bondProps = el('div', {
      class: 'rte-chem-builder__row',
      children: [
        ...BOND_TYPES.map(({ type, labelKey }) => builderButton(t(labelKey), { 'set-bond': type })),
        this.bondDeleteButton,
      ],
    });
    this.props = el('section', {
      class: 'rte-chem-builder__section rte-chem-builder__props',
      children: [this.propsTitle, this.atomProps, this.bondProps],
    });

    const section = (titleKey: string, ...children: HTMLElement[]): HTMLElement =>
      el('section', {
        class: 'rte-chem-builder__section',
        children: [el('h3', { class: 'rte-chem-builder__title', text: t(titleKey) }), ...children],
      });

    this.side = el('div', {
      class: 'rte-chem-builder__side',
      children: [
        section(
          'chemistry_builder_groups',
          el('div', {
            class: 'rte-chem-builder__palette',
            attrs: { role: 'group', 'aria-label': t('chemistry_builder_groups') },
            children: GROUPS.map((group) =>
              builderButton(formatChemLabel(group), { group }, 'rte-chem-builder__button--group'),
            ),
          }),
          el('div', {
            class: 'rte-chem-builder__custom',
            children: [
              el('span', { class: 'rte-chem-builder__label', text: t('chemistry_builder_custom') }),
              el('div', {
                class: 'rte-chem-builder__row rte-chem-builder__row--nowrap',
                children: [this.customInput, builderButton(t('chemistry_builder_custom_apply'), { action: 'custom' })],
              }),
            ],
          }),
          el('div', {
            class: 'rte-chem-builder__row',
            attrs: { role: 'group', 'aria-label': t('chemistry_builder_rings') },
            children: RINGS.map(({ id, labelKey }) => builderButton(t(labelKey), { ring: id })),
          }),
        ),
        section(
          'chemistry_builder_bond',
          el('div', {
            class: 'rte-chem-builder__row',
            attrs: { role: 'group', 'aria-label': t('chemistry_builder_bond') },
            children: BOND_TYPES.map(({ type, labelKey }) => builderButton(t(labelKey), { bond: type })),
          }),
        ),
        this.props,
        section(
          'chemistry_templates',
          el('div', {
            class: 'rte-chem-builder__templates',
            children: CHEMISTRY_TEMPLATES.map((template) => {
              const label = t(template.labelKey);
              const svg = chemfigToSvg(template.code, { scale: TEMPLATE_SCALE });

              return el('button', {
                class: 'rte-chem-builder__template',
                attrs: { type: 'button', title: label, 'aria-label': label, 'data-code': template.code },
                // Миниатюра — наш же SVG, тем же путём через санитайзер.
                html: svg ? sanitizeSvg(svg) : '',
                text: svg ? undefined : label,
              });
            }),
          }),
        ),
      ],
    });

    this.element = el('div', {
      class: 'rte-chem-builder',
      children: [
        el('div', {
          class: 'rte-chem-builder__main',
          children: [
            el('div', {
              class: 'rte-chem-builder__toolbar',
              children: [this.undoButton, this.redoButton, this.clearButton],
            }),
            this.stage,
            this.hint,
            this.status,
          ],
        }),
        this.side,
      ],
    });

    this.disposer.add(on(this.stage, 'click', this.onStageClick));
    this.disposer.add(on(this.element, 'click', this.onPanelClick));
    this.disposer.add(on(this.element, 'keydown', this.onKeydown));
    this.disposer.add(on(this.customInput, 'keydown', this.onCustomKeydown));

    this.render();
  }

  /** Загружает код chemfig; `false`, если код не разбирается (конструктор тогда пуст). */
  load(code: string): boolean {
    const structure = code.trim() ? parseForEditing(code) : null;

    this.structure = structure;
    this.selection = null;
    this.history = [structureCode(structure)];
    this.historyIndex = 0;
    this.setStatus('');
    this.render();

    return structure !== null;
  }

  /** Код chemfig текущей структуры; пустая строка, если структуры нет. */
  getCode(): string {
    return structureCode(this.structure);
  }

  focus(): void {
    this.stage.focus({ preventScroll: true });
  }

  destroy(): void {
    this.disposer.dispose();
    this.element.remove();
  }

  /**
   * Фиксирует правку модели: код в историю, перерисовка, уведомление. Код,
   * который не разбирается обратно, не принимается — модель возвращается к
   * последнему снимку. Так ни одно действие не даёт неразборчивого кода.
   */
  private commit(): void {
    const code = this.getCode();
    const current = this.history[this.historyIndex] ?? '';

    if (code === '' && this.structure) this.structure = null;

    // Код обязан разобраться в ту же структуру: запись разобранного кода даёт его же.
    if (code !== '' && structureCode(tryParseChemfig(code)) !== code) {
      this.restore(current);

      return;
    }

    if (code !== current) {
      this.history = [...this.history.slice(0, this.historyIndex + 1), code].slice(-HISTORY_LIMIT);
      this.historyIndex = this.history.length - 1;
    }

    this.setStatus('');
    this.render();

    if (code !== current) this.options.onChange?.();
  }

  /** Модель из снимка истории; выделение на старые объекты больше не указывает. */
  private restore(code: string): void {
    this.structure = code ? parseForEditing(code) : null;
    this.selection = null;
    this.render();
  }

  private stepHistory(step: number): void {
    const index = this.historyIndex + step;
    const code = this.history[index];

    if (code === undefined) return;

    this.historyIndex = index;
    this.restore(code);
    this.options.onChange?.();
  }

  private select(selection: Selection): void {
    this.selection = selection;
    this.render();
  }

  private get selectedAtom(): ChemAtom | null {
    return this.selection?.kind === 'atom' ? this.selection.atom : null;
  }

  /** Выделенная вершина кольца (атом без родителя в дереве вершины). */
  private isRingVertex(atom: ChemAtom): boolean {
    if (this.structure?.kind !== 'ring') return false;

    const place = locateAtom(this.structure, atom);

    return place !== null && place.vertex !== null && place.parent === null;
  }

  private render(): void {
    this.layout = this.structure ? layoutChemistry(this.structure) : null;
    this.renderStage();
    this.renderPanel();
  }

  /** Полотно: структура тем же рендером и поверх — области нажатия, подсветка, «плюсы». */
  private renderStage(): void {
    this.stage.replaceChildren();
    this.pluses = [];

    const { structure, layout } = this;

    if (!structure || !layout) {
      this.stage.appendChild(
        el('button', {
          class: 'rte-chem-builder__start',
          text: '+',
          attrs: { type: 'button', 'data-action': 'start', 'aria-label': this.t('chemistry_builder_start') },
        }),
      );

      return;
    }

    const atom = this.selectedAtom;

    if (atom) {
      this.pluses = freeDirections(structure, layout, atom).map((angle) => ({ atom, angle }));
    }

    const width = Math.max(layout.width + VIEW_MARGIN * 2, MIN_VIEW_WIDTH);
    const height = Math.max(layout.height + VIEW_MARGIN * 2, MIN_VIEW_HEIGHT);
    const canvas = svgElement('svg', {
      class: 'rte-chem-builder__canvas',
      viewBox: `${num(layout.width / 2 - width / 2)} ${num(layout.height / 2 - height / 2)} ${num(width)} ${num(height)}`,
      'aria-hidden': 'true',
      focusable: 'false',
    });

    // Структура — тем же путём, каким её вставлял предпросмотр: строка рендера
    // через санитайзер. Вложенный svg кладёт её viewBox в рамку 0…width раскладки.
    const holder = el('div', { html: sanitizeSvg(renderChemistrySvg(structure)) });
    const drawing = holder.querySelector('svg');

    if (drawing) {
      drawing.setAttribute('x', '0');
      drawing.setAttribute('y', '0');
      canvas.appendChild(drawing);
    }

    canvas.appendChild(this.renderOverlay(layout));
    this.stage.appendChild(canvas);
  }

  private renderOverlay(layout: ChemLayout): SVGElement {
    const overlay = svgElement('g', { class: 'rte-chem-builder__overlay' });
    const { selection } = this;

    layout.bonds.forEach((placed, index) => {
      const ref = placed.bond;
      const isSelected =
        'ring' in ref
          ? selection?.kind === 'ring-bond' && selection.index === ref.index
          : selection?.kind === 'bond' && selection.bond === ref;

      overlay.appendChild(
        svgElement('line', {
          class: isSelected ? 'rte-chem-builder__bond rte-chem-builder__bond--selected' : 'rte-chem-builder__bond',
          x1: placed.x1,
          y1: placed.y1,
          x2: placed.x2,
          y2: placed.y2,
          'stroke-width': BOND_HIT_WIDTH,
          'data-bond': String(index),
        }),
      );
    });

    layout.atoms.forEach((placed, index) => {
      const isSelected = selection?.kind === 'atom' && selection.atom === placed.atom;

      overlay.appendChild(
        svgElement('circle', {
          class: isSelected ? 'rte-chem-builder__atom rte-chem-builder__atom--selected' : 'rte-chem-builder__atom',
          cx: placed.x,
          cy: placed.y,
          r: isSelected ? SELECTED_RADIUS : ATOM_HIT_RADIUS,
          'data-atom': String(index),
        }),
      );
    });

    const origin = layout.atoms.find((placed) => placed.atom === this.selectedAtom);

    if (origin) {
      this.pluses.forEach(({ angle }, index) => {
        const radians = (angle * Math.PI) / 180;
        const cx = origin.x + PLUS_DISTANCE * Math.cos(radians);
        const cy = origin.y - PLUS_DISTANCE * Math.sin(radians);
        const plus = svgElement('g', {
          class: 'rte-chem-builder__plus',
          role: 'button',
          'aria-label': this.t('chemistry_builder_add'),
          'data-plus': String(index),
          'data-angle': String(angle),
        });

        plus.append(
          svgElement('circle', { class: 'rte-chem-builder__plus-hit', cx, cy, r: PLUS_HIT_RADIUS }),
          svgElement('circle', { cx, cy, r: PLUS_RADIUS }),
          svgElement('line', { x1: cx - PLUS_ARM, y1: cy, x2: cx + PLUS_ARM, y2: cy }),
          svgElement('line', { x1: cx, y1: cy - PLUS_ARM, x2: cx, y2: cy + PLUS_ARM }),
        );
        overlay.appendChild(plus);
      });
    }

    return overlay;
  }

  /** Состояние кнопок панели, подсказка и свойства выделенного. */
  private renderPanel(): void {
    const { t, structure, selection } = this;
    const atom = this.selectedAtom;
    const isPaletteGroup = GROUPS.includes(this.group);

    this.side.querySelectorAll<HTMLButtonElement>('button[data-group]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.group === this.group));
    });
    this.customInput.classList.toggle('rte-chem-builder__custom-input--active', !isPaletteGroup);

    this.side.querySelectorAll<HTMLButtonElement>('button[data-bond]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.bond === this.bondType));
    });

    const rings = ringAvailability(structure, atom);
    let ringReason = '';

    if (rings === 'has-ring') ringReason = t('chemistry_builder_ring_single');

    if (rings === 'not-root') ringReason = t('chemistry_builder_ring_start');

    this.side.querySelectorAll<HTMLButtonElement>('button[data-ring]').forEach((button) => {
      button.disabled = ringReason !== '';

      if (ringReason) button.title = ringReason;
      else button.removeAttribute('title');
    });

    this.props.hidden = selection === null;
    this.atomProps.hidden = atom === null;
    this.bondProps.hidden = selection === null || selection.kind === 'atom';
    this.clearLabelButton.hidden = !atom || !this.isRingVertex(atom) || atom.label === '';

    if (atom) {
      const label = formatChemLabel(atom.label);

      this.propsTitle.textContent = label
        ? `${t('chemistry_builder_selected_atom')}: ${label}`
        : t('chemistry_builder_selected_atom');
    } else if (selection) {
      this.propsTitle.textContent = t('chemistry_builder_selected_bond');
    }

    const selectedType = this.selectedBondType();

    this.bondProps.querySelectorAll<HTMLButtonElement>('button[data-set-bond]').forEach((button) => {
      const isTriple = button.dataset.setBond === '~';
      const isRingBond = selection?.kind === 'ring-bond';

      button.setAttribute('aria-pressed', String(button.dataset.setBond === selectedType));
      button.disabled = isTriple && isRingBond;

      if (isTriple && isRingBond) button.title = t('chemistry_builder_ring_triple');
      else button.removeAttribute('title');
    });
    this.bondDeleteButton.hidden = selection?.kind === 'ring-bond';

    this.undoButton.disabled = this.historyIndex === 0;
    this.redoButton.disabled = this.historyIndex >= this.history.length - 1;
    this.clearButton.disabled = structure === null;

    this.hint.textContent = this.hintText();
  }

  private hintText(): string {
    const { t, structure, selection } = this;

    if (!structure) return t('chemistry_builder_hint_empty');

    if (selection?.kind === 'atom') return t('chemistry_builder_hint_atom');

    if (selection) return t('chemistry_builder_hint_bond');

    return t('chemistry_builder_hint_idle');
  }

  private selectedBondType(): ChemBondType | null {
    const { selection, structure } = this;

    if (selection?.kind === 'bond') return selection.bond.type;

    if (selection?.kind === 'ring-bond' && structure?.kind === 'ring') return structure.bonds[selection.index] ?? null;

    return null;
  }

  private setStatus(text: string): void {
    this.status.textContent = text;
    this.status.hidden = text === '';
  }

  /** Первая группа на пустом полотне: цепочка из одного атома. */
  private start(): void {
    const chain = createChain(this.group);

    this.structure = chain;
    this.selection = { kind: 'atom', atom: chain.root };
    this.commit();
  }

  /** «Плюс»: выбранная группа выбранной связью под углом «плюса»; новый атом выделяется. */
  private addAtPlus(index: number): void {
    const plus = this.pluses[index];

    if (!plus || !this.structure) return;

    const atom = attachAtom(this.structure, plus.atom, plus.angle, this.bondType, this.group);

    if (atom) this.selection = { kind: 'atom', atom };

    this.commit();
  }

  private addRing(id: string): void {
    const spec = RINGS.find((ring) => ring.id === id);

    if (!spec) return;

    const ring = createRing(spec.size, spec.aromatic);
    const availability = ringAvailability(this.structure, this.selectedAtom);

    if (availability === 'empty') {
      this.structure = ring;
    } else if (availability === 'attach' && this.structure?.kind === 'chain' && this.layout) {
      this.structure = attachRing(this.structure, this.layout, ring);
    } else {
      return;
    }

    this.selection = null;
    this.commit();
  }

  /** Удаляет выделенное: атом с веткой, связь с веткой за ней. Связь кольца не удаляется. */
  private deleteSelection(): void {
    const { selection, structure } = this;

    if (!structure || !selection || selection.kind === 'ring-bond') return;

    const atom = selection.kind === 'atom' ? selection.atom : selection.bond.target;

    this.structure = removeAtom(structure, atom);
    this.selection = null;
    this.commit();
  }

  private setSelectedBondType(type: ChemBondType): void {
    const { selection, structure } = this;

    if (selection?.kind === 'bond') {
      selection.bond.type = type;
    } else if (selection?.kind === 'ring-bond' && structure?.kind === 'ring' && type !== '~') {
      structure.bonds[selection.index] = type;
    } else {
      return;
    }

    this.commit();
  }

  /** Выбор группы; при включённом «Заменить группу» она же становится подписью выделенного атома. */
  private chooseGroup(label: string): void {
    this.group = label;

    const atom = this.selectedAtom;

    if (atom && this.replaceToggle.checked) {
      atom.label = label;
      this.commit();

      return;
    }

    this.setStatus('');
    this.renderPanel();
  }

  private applyCustomGroup(): void {
    const label = normalizeGroupLabel(this.customInput.value);

    if (!label) {
      this.setStatus(this.t('chemistry_builder_custom_invalid'));

      return;
    }

    this.customInput.value = label;
    this.chooseGroup(label);
  }

  private clearVertexLabel(): void {
    const atom = this.selectedAtom;

    if (!atom || !this.isRingVertex(atom)) return;

    atom.label = '';
    this.commit();
  }

  private clear(): void {
    this.structure = null;
    this.selection = null;
    this.commit();
  }

  private readonly onStageClick = (event: MouseEvent): void => {
    const { target } = event;

    if (!(target instanceof Element)) return;

    const plus = target.closest('[data-plus]');
    const atomHit = target.closest('[data-atom]');
    const bondHit = target.closest('[data-bond]');

    if (target.closest('[data-action="start"]')) {
      this.start();
    } else if (plus) {
      this.addAtPlus(Number(plus.getAttribute('data-plus')));
    } else if (atomHit) {
      const placed = this.layout?.atoms[Number(atomHit.getAttribute('data-atom'))];

      this.select(placed ? { kind: 'atom', atom: placed.atom } : null);
    } else if (bondHit) {
      const ref = this.layout?.bonds[Number(bondHit.getAttribute('data-bond'))]?.bond;

      if (!ref) this.select(null);
      else this.select('ring' in ref ? { kind: 'ring-bond', index: ref.index } : { kind: 'bond', bond: ref });
    } else {
      this.select(null);
    }

    // Нажатые элементы полотна пересоздаются: фокус остаётся на полотне,
    // чтобы Delete, Escape и отмена работали дальше.
    this.focus();
  };

  private readonly onPanelClick = (event: MouseEvent): void => {
    const { target } = event;

    if (!(target instanceof Element) || this.stage.contains(target)) return;

    const button = target.closest('button');

    if (!button || button.disabled) return;

    const { group, bond, ring, setBond, code, action } = button.dataset;

    if (group) this.chooseGroup(group);
    else if (bond === '-' || bond === '=' || bond === '~') this.chooseBondType(bond);
    else if (setBond === '-' || setBond === '=' || setBond === '~') this.setSelectedBondType(setBond);
    else if (ring) this.addRing(ring);
    else if (code) this.applyTemplate(code);
    else if (action) this.runAction(action);
  };

  private chooseBondType(type: ChemBondType): void {
    this.bondType = type;
    this.renderPanel();
  }

  private applyTemplate(code: string): void {
    const structure = parseForEditing(code);

    if (!structure) return;

    this.structure = structure;
    this.selection = null;
    this.commit();
  }

  private runAction(action: string): void {
    if (action === 'undo') this.stepHistory(-1);
    else if (action === 'redo') this.stepHistory(1);
    else if (action === 'clear') this.clear();
    else if (action === 'delete') this.deleteSelection();
    else if (action === 'clear-label') this.clearVertexLabel();
    else if (action === 'custom') this.applyCustomGroup();
  }

  /**
   * Клавиши конструктора: отмена и повтор, Delete и Backspace для выделенного,
   * Escape снимает выделение и тогда диалог не закрывает. В полях ввода
   * клавиши остаются полю.
   */
  private readonly onKeydown = (event: KeyboardEvent): void => {
    if (isTextField(event.target)) return;

    const modifier = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();

    if (modifier && (key === 'z' || key === 'y')) {
      event.preventDefault();
      this.stepHistory(key === 'y' || event.shiftKey ? 1 : -1);

      return;
    }

    if ((event.key === 'Delete' || event.key === 'Backspace') && this.selection) {
      event.preventDefault();
      this.deleteSelection();

      return;
    }

    if (event.key === 'Escape' && this.selection) {
      event.preventDefault();
      event.stopPropagation();
      this.select(null);
    }
  };

  private readonly onCustomKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter') return;

    event.preventDefault();
    this.applyCustomGroup();
  };
}
