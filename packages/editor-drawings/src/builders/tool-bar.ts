import { el, on, type Translate, type Unsubscribe } from '@rich-editor/core';
import { createBuilderIcon, type BuilderIconId } from './builder-icons';

export interface ToolButton<TId extends string = string> {
  id: TId;
  labelKey: string;
  /** Значок кнопки из набора `builder-icons`. */
  icon: BuilderIconId;
}

export interface ToolBarOptions<TId extends string> {
  t: Translate;
  tools: ToolButton<TId>[];
  onSelect(id: TId): void;
}

/**
 * Панель инструментов конструктора: кнопки-режимы с подсветкой активного.
 *
 * Активный режим — общее состояние кнопок, поэтому класс.
 */
export class ToolBar<TId extends string> {
  readonly element: HTMLElement;

  private readonly buttons = new Map<TId, HTMLButtonElement>();

  private readonly release: Unsubscribe;

  constructor(private readonly options: ToolBarOptions<TId>) {
    this.element = el('div', { class: 'rte-builder__tools', attrs: { role: 'toolbar' } });

    options.tools.forEach((tool) => {
      const label = options.t(tool.labelKey);
      const button = el('button', {
        class: 'rte-builder__tool',
        attrs: { type: 'button', title: label, 'aria-label': label, 'aria-pressed': 'false', 'data-tool': tool.id },
        children: [toolIcon(tool.icon), el('span', { class: 'rte-builder__tool-label', text: label })],
      });

      this.buttons.set(tool.id, button);
      this.element.appendChild(button);
    });

    this.release = on(this.element, 'click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-tool]');

      if (button) this.options.onSelect(button.dataset.tool as TId);
    });
  }

  setActive(id: TId | null): void {
    this.buttons.forEach((button, key) => {
      const active = key === id;

      button.classList.toggle('rte-builder__tool--active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  setEnabled(id: TId, enabled: boolean): void {
    const button = this.buttons.get(id);

    if (button) button.disabled = !enabled;
  }

  destroy(): void {
    this.release();
    this.element.remove();
  }
}

/** Значок в кнопке конструктора: 20px, цвет — от кнопки, для скринридера скрыт. */
export const toolIcon = (id: BuilderIconId): SVGSVGElement => {
  const icon = createBuilderIcon(id);

  icon.classList.add('rte-builder__tool-icon');

  return icon;
};

/** Кнопка действия (отмена, зум) — без режима: квадрат со значком, подпись в title и aria-label. */
export const actionButton = (label: string, icon: BuilderIconId, onClick: () => void): HTMLButtonElement => {
  const button = el('button', {
    class: 'rte-builder__tool rte-builder__tool--action rte-builder__tool--icon',
    attrs: { type: 'button', title: label, 'aria-label': label },
    children: [toolIcon(icon)],
  });

  button.addEventListener('click', onClick);

  return button;
};

/** Поле панели свойств: подпись и элемент управления. */
export const propertyField = (label: string, control: HTMLElement): HTMLElement =>
  el('label', { class: 'rte-builder__prop', children: [el('span', { class: 'rte-builder__prop-label', text: label }), control] });

export const selectControl = (options: Array<{ value: string; label: string }>, value: string): HTMLSelectElement => {
  const select = el('select', { class: 'rte-input rte-builder__select' });

  options.forEach((option) => {
    const item = el('option', { text: option.label, attrs: { value: option.value } });

    if (option.value === value) item.selected = true;

    select.appendChild(item);
  });

  return select;
};
