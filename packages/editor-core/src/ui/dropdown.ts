import { createDisposer, el, icon, on } from './dom';
import { createPopover } from './popover';
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
  /** Меняет иконку на кнопке — для пунктов, показывающих текущее состояние. */
  setIcon(name: string): void;
}

/** Счётчик для уникальных id кнопок: панель ссылается на свою кнопку по id. */
let dropdownCount = 0;

/** Пункты открытой панели, по которым ходят стрелки, в порядке разметки. */
function menuItemsOf(panel: HTMLElement): HTMLButtonElement[] {
  return [
    ...panel.querySelectorAll<HTMLButtonElement>(
      ':is([role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]):not(:disabled)',
    ),
  ];
}

/**
 * Кнопка с выпадающей панелью.
 *
 * Панель пересобирается на каждом открытии: её содержимое зависит от текущего
 * выделения (какой цвет активен, какой уровень заголовка), а держать её в
 * актуальном состоянии при закрытом виде — лишняя работа на каждое нажатие
 * клавиши.
 *
 * Сама панель — поповер с фиксированным позиционированием: её не обрежет ни
 * `overflow: hidden` у корня редактора, ни низкий редактор под коротким
 * документом, а слушатели документа, закрытие по клику мимо и Escape,
 * удержание в границах окна — у поповера уже есть.
 */
export function createDropdown(options: DropdownOptions): Dropdown {
  const disposer = createDisposer();

  const caret = icon('chevronDown', 14);
  caret.classList.add('rte-btn__caret');

  dropdownCount += 1;
  const buttonId = `rte-dropdown-${dropdownCount}`;
  const valueId = `${buttonId}-value`;

  let label: Element =
    options.text === undefined
      ? icon(options.iconName ?? 'more', 20)
      : el('span', { class: 'rte-btn__text', text: options.text, attrs: { id: valueId } });

  const button = el('button', {
    class: 'rte-btn',
    attrs: {
      type: 'button',
      id: buttonId,
      title: options.label,
      'aria-label': options.label,
      // Подпись на кнопке — текущее значение («H2», «Обычный текст»): имя
      // кнопки остаётся постоянным, а значение читалка объявляет описанием.
      'aria-describedby': options.text === undefined ? null : valueId,
      'aria-haspopup': 'menu',
      'aria-expanded': 'false',
    },
    children: [label, caret],
  });

  const element = el('div', { class: 'rte-dropdown', children: [button] });

  const popover = createPopover({
    role: 'menu',
    className: 'rte-dropdown__panel',
    align: 'start',
    offset: 4,
    // Меню названо своей кнопкой: без имени читалка объявляет просто «меню».
    labelledBy: buttonId,
    // Кнопка — «внутри»: иначе клик по ней закрыл бы панель по mousedown и
    // тут же открыл заново по click.
    isInside: (target) => element.contains(target),
    onClose: () => {
      popover.body.replaceChildren();
      button.setAttribute('aria-expanded', 'false');
      button.classList.remove('rte-btn--active');
    },
  });
  element.appendChild(popover.element);

  function close(): void {
    popover.close();
  }

  function open(): void {
    if (popover.isVisible) return;
    popover.body.replaceChildren(options.renderPanel(close));
    button.setAttribute('aria-expanded', 'true');
    button.classList.add('rte-btn--active');
    popover.open(button.getBoundingClientRect());
  }

  disposer.add(
    on(popover.element, 'keydown', (event) => {
      // Escape из меню: фокус был в нём — вернуть на кнопку, иначе он
      // провалится в никуда. Escape из документа обрабатывает сам поповер.
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
        button.focus();
        return;
      }

      // Стрелки ходят по пунктам по кругу, Home/End — к краям: меню без этого
      // читалке и клавиатуре доступно только через Tab по всем пунктам подряд.
      const items = menuItemsOf(popover.body);
      if (items.length === 0) return;

      const active = document.activeElement as HTMLElement | null;
      const current = items.indexOf(active as HTMLButtonElement);

      // Сетка (палитра цветов) объявляет число колонок: вверх и вниз ходят
      // по строкам, влево и вправо — по соседям, и упираются в края, а не
      // перескакивают на другую колонку.
      const columns = Number(
        active?.closest<HTMLElement>('[data-menu-columns]')?.dataset.menuColumns ?? 1,
      );
      const isGrid = columns > 1;

      const moves: Record<string, number | undefined> = {
        ArrowDown: current + columns,
        ArrowUp: current - columns,
        ArrowRight: isGrid ? current + 1 : undefined,
        ArrowLeft: isGrid ? current - 1 : undefined,
        Home: 0,
        End: items.length - 1,
      };
      const next = moves[event.key];
      if (next === undefined) return;

      event.preventDefault();
      const index = isGrid
        ? Math.max(0, Math.min(items.length - 1, next))
        : (next + items.length) % items.length;
      items[index].focus();
    }),
  );

  // Стрелка вниз на закрытой кнопке открывает меню и встаёт на первый пункт,
  // вверх — на последний: так ведут себя кнопки меню везде, где они есть.
  disposer.add(
    on(button, 'keydown', (event) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      if (!popover.isVisible) open();
      const items = menuItemsOf(popover.body);
      (event.key === 'ArrowDown' ? items[0] : items[items.length - 1])?.focus();
    }),
  );

  // Кнопка и пункты не забирают фокус у документа: команда применится к
  // живому выделению, а не к восстановленному в следующем кадре.
  disposer.add(on(button, 'mousedown', (event) => event.preventDefault()));
  disposer.add(
    on(button, 'click', (event) => {
      event.preventDefault();
      if (popover.isVisible) {
        close();
        return;
      }
      open();
      // Открыли с клавиатуры (у синтетического клика detail = 0) — фокус
      // должен оказаться в меню, а не остаться на кнопке.
      if (event.detail === 0) menuItemsOf(popover.body)[0]?.focus();
    }),
  );

  return {
    element,
    button,
    close,
    setActive: (active: boolean) => {
      // Открытая панель и так подсвечена: не даём состоянию её погасить.
      if (!popover.isVisible) button.classList.toggle('rte-btn--active', active);
    },
    setDisabled: (disabled: boolean) => {
      button.disabled = disabled;
    },
    setText: (text: string) => {
      if (options.text !== undefined) label.textContent = text;
    },
    setIcon: (name: string) => {
      if (options.text !== undefined || label.getAttribute('data-icon') === name) return;
      const fresh = icon(name, 20);
      label.replaceWith(fresh);
      label = fresh;
    },
    destroy: () => {
      popover.destroy();
      disposer.dispose();
      element.remove();
    },
  };
}

/**
 * Роль пункта. Обычное действие — `menuitem`; пункт, отражающий состояние
 * документа, — переключатель: `menuitemradio`, если из группы выбран ровно
 * один (уровень заголовка, выравнивание), `menuitemcheckbox` — если пункты
 * независимы (полужирный и курсив в меню «⋯»). Тогда `active` уходит и в
 * `aria-checked`, а не только в подсветку.
 */
export type MenuItemRole = 'menuitem' | 'menuitemradio' | 'menuitemcheckbox';

export interface MenuItemOptions {
  label: string;
  iconName?: string;
  active?: boolean;
  disabled?: boolean;
  role?: MenuItemRole;
  /** Класс для подписи — например, чтобы показать уровень заголовка его кеглем. */
  labelClass?: string;
  onSelect(): void;
}

/** Пункт выпадающего меню. Вынесен, потому что нужен каждой панели. */
export function createMenuItem(options: MenuItemOptions): HTMLButtonElement {
  const role = options.role ?? 'menuitem';
  const button = el('button', {
    class: options.active ? 'rte-menu__item rte-menu__item--active' : 'rte-menu__item',
    attrs: {
      type: 'button',
      role,
      'aria-checked': role === 'menuitem' ? null : String(options.active ?? false),
    },
    children: [
      options.iconName ? icon(options.iconName, 18) : null,
      el('span', { class: options.labelClass ?? '', text: options.label }),
    ],
  });

  button.disabled = options.disabled ?? false;
  button.addEventListener('mousedown', (event) => event.preventDefault());
  button.addEventListener('click', options.onSelect);
  return button;
}

/** Разделитель между смысловыми группами пунктов. */
export function createMenuSeparator(): HTMLElement {
  return el('div', { class: 'rte-menu__separator' });
}
