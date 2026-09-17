import { createDisposer, el, icon, on } from './dom';
import type { UiComponent } from './types';

export interface DropdownOptions {
  label: string;
  /** Имя иконки на кнопке. Без неё кнопка показывает текст. */
  iconName?: string;
  /** Короткая подпись вместо иконки — например, уровень заголовка. */
  text?: string;
  /** Наполняет панель. Вызывается при каждом открытии, чтобы состояние было свежим. */
  renderPanel(close: () => void): HTMLElement;
}

export interface Dropdown extends UiComponent {
  readonly button: HTMLButtonElement;
  close(): void;
  setActive(active: boolean): void;
  setDisabled(disabled: boolean): void;
  setText(text: string): void;
}

/**
 * Кнопка с выпадающей панелью.
 *
 * Панель пересобирается на каждом открытии: её содержимое зависит от текущего
 * выделения (какой цвет активен, какой уровень заголовка), а держать её в
 * актуальном состоянии при закрытом виде — лишняя работа на каждое нажатие
 * клавиши.
 */
export function createDropdown(options: DropdownOptions): Dropdown {
  const disposer = createDisposer();

  const caret = icon('chevronDown', 14);
  caret.classList.add('rte-btn__caret');

  const label = options.text === undefined
    ? icon(options.iconName ?? 'more', 20)
    : el('span', { class: 'rte-btn__text', text: options.text });

  const button = el('button', {
    class: 'rte-btn',
    attrs: {
      type: 'button',
      title: options.label,
      'aria-label': options.label,
      'aria-haspopup': 'true',
      'aria-expanded': 'false',
    },
    children: [label, caret],
  });

  const panel = el('div', { class: 'rte-dropdown__panel', attrs: { role: 'menu' } });
  panel.hidden = true;

  const element = el('div', { class: 'rte-dropdown', children: [button, panel] });

  let isVisible = false;

  function close(): void {
    if (!isVisible) return;
    isVisible = false;
    panel.hidden = true;
    panel.replaceChildren();
    button.setAttribute('aria-expanded', 'false');
    button.classList.remove('rte-btn--active');
  }

  function open(): void {
    if (isVisible) return;
    isVisible = true;
    panel.replaceChildren(options.renderPanel(close));
    panel.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    button.classList.add('rte-btn--active');
  }

  disposer.add(
    on(button, 'click', (event) => {
      event.preventDefault();
      if (isVisible) close();
      else open();
    }),
  );

  disposer.add(
    on(document, 'mousedown', (event) => {
      const target = event.target as Node | null;
      if (!isVisible || (target && element.contains(target))) return;
      close();
    }),
  );

  disposer.add(
    on(document, 'keydown', (event) => {
      if (!isVisible || event.key !== 'Escape') return;
      event.stopPropagation();
      close();
      button.focus();
    }),
  );

  return {
    element,
    button,
    close,
    setActive: (active: boolean) => {
      // Открытая панель и так подсвечена: не даём состоянию её погасить.
      if (!isVisible) button.classList.toggle('rte-btn--active', active);
    },
    setDisabled: (disabled: boolean) => {
      button.disabled = disabled;
    },
    setText: (text: string) => {
      if (options.text !== undefined) label.textContent = text;
    },
    destroy: () => {
      disposer.dispose();
      element.remove();
    },
  };
}

export interface MenuItemOptions {
  label: string;
  iconName?: string;
  active?: boolean;
  disabled?: boolean;
  /** Класс для подписи — например, чтобы показать уровень заголовка его кеглем. */
  labelClass?: string;
  onSelect(): void;
}

/** Пункт выпадающего меню. Вынесен, потому что нужен каждой панели. */
export function createMenuItem(options: MenuItemOptions): HTMLButtonElement {
  const button = el('button', {
    class: options.active ? 'rte-menu__item rte-menu__item--active' : 'rte-menu__item',
    attrs: { type: 'button', role: 'menuitem' },
    children: [
      options.iconName ? icon(options.iconName, 18) : null,
      el('span', { class: options.labelClass ?? '', text: options.label }),
    ],
  });

  button.disabled = options.disabled ?? false;
  button.addEventListener('click', options.onSelect);
  return button;
}

/** Разделитель между смысловыми группами пунктов. */
export function createMenuSeparator(): HTMLElement {
  return el('div', { class: 'rte-menu__separator' });
}
