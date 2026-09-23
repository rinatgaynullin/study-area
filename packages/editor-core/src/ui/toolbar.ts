import { focusEditorView } from '../utils/focus-editor-view';
import { createDisposer, el, icon, on } from './dom';
import { createDropdown, createMenuItem, type Dropdown } from './dropdown';
import { ariaKeyshortcuts, formatShortcut } from './shortcuts';
import type { EditorUiContext, ToolbarItemDescriptor, UiComponent } from './types';

export interface ToolbarGroupConfig {
  id: string;
  items: string[];
  /** Уходит в меню «⋯», когда тулбару не хватает ширины. */
  collapsible?: boolean;
}

export interface ToolbarOptions {
  groups: ToolbarGroupConfig[];
  /** Дескрипторы по идентификатору пункта. */
  items: Record<string, ToolbarItemDescriptor>;
  /**
   * Ниже этой ширины все схлопываемые группы уходят в меню сразу. Выше —
   * по одной с конца, пока тулбар не поместится в одну строку.
   */
  collapseBelow?: number;
}

export interface Toolbar extends UiComponent {
  /** Перечитывает состояние документа и обновляет подсветку и доступность. */
  syncState(): void;
  setDisabled(disabled: boolean): void;
  /**
   * Пересобирает кнопки. Нужен при смене локали: подписи и подсказки берутся
   * из переводчика в момент отрисовки.
   */
  rebuild(): void;
  /**
   * Подбирает число схлопнутых групп под ширину. Наблюдатель размера зовёт
   * это сам; снаружи нужно тестам и хосту с собственной раскладкой.
   */
  layout(width: number): void;
  /**
   * Переводит фокус на текущую кнопку тулбара — ту, на которой он был в
   * прошлый раз, или первую доступную. Так из документа попадают в тулбар
   * по Alt+F10, не проходя Tab'ом через всё, что стоит между ними.
   */
  focus(): void;
}

interface RenderedItem {
  descriptor: ToolbarItemDescriptor;
  button: HTMLButtonElement;
  dropdown?: Dropdown;
}

/** Ширина по умолчанию, ниже которой схлопываемые группы уходят в меню сразу. */
const DEFAULT_COLLAPSE_BELOW = 760;

/** Размер иконок на кнопках тулбара. */
const ICON_SIZE = 20;

/**
 * Подменяет иконку обычной кнопки, если имя сменилось. Имя лежит на самом
 * узле (data-icon), поэтому ссылку на иконку держать отдельно не нужно.
 */
const refreshButtonIcon = (button: HTMLButtonElement, name: string): void => {
  const current = button.querySelector('.rte-icon');

  if (!current || current.getAttribute('data-icon') === name) return;

  current.replaceWith(icon(name, ICON_SIZE));
};

/**
 * Тулбар, собранный из дескрипторов возможностей.
 *
 * Пункты не зашиты в разметку: тулбар получает список идентификаторов и берёт
 * поведение из реестра. Поэтому набор кнопок задаётся конфигурацией, а не
 * правкой этого файла, и одна и та же возможность не описывается дважды.
 *
 * Класс, а не набор замыканий: пересборка, синхронизация состояния, раскладка
 * и roving tabindex делят одно состояние и зовут друг друга в любом порядке.
 */
class ToolbarController implements Toolbar {
  readonly element = el('div', { class: 'rte-toolbar', attrs: { role: 'toolbar' } });

  private readonly disposer = createDisposer();

  private readonly collapseBelow: number;

  /** Схлопываемые группы в порядке следования; в меню уходят с конца. */
  private readonly collapsibleGroups: ToolbarGroupConfig[];

  private readonly rendered: RenderedItem[] = [];

  private isDisabled = false;

  /** Сколько схлопываемых групп сейчас в меню «⋯», считая с конца. */
  private collapsedCount = 0;

  private lastWidth = 0;

  /**
   * Пункт, на котором стоит фокус тулбара. Тулбар — одна остановка Tab'а: в
   * него входят на этот пункт, а между кнопками ходят стрелками. Иначе до
   * документа пришлось бы пройти два десятка кнопок подряд.
   */
  private rovingId: string | null = null;

  private observer: ResizeObserver | null = null;

  private frame = 0;

  constructor(
    private readonly context: EditorUiContext,
    private readonly options: ToolbarOptions,
  ) {
    this.collapseBelow = options.collapseBelow ?? DEFAULT_COLLAPSE_BELOW;
    this.collapsibleGroups = options.groups.filter((group) => this.isCollapsible(group));

    // Стрелки ходят по кнопкам, Home/End — к краям, Escape возвращает каретку
    // в документ. Открытое меню лежит внутри тулбара, но клавиши в нём свои.
    this.disposer.add(on(this.element, 'keydown', this.onKeydown));

    // Пришли Tab'ом или щелчком на другую кнопку — она и становится остановкой:
    // выйдя и вернувшись, пользователь попадает туда же, где был.
    this.disposer.add(on(this.element, 'focusin', this.onFocusIn));

    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(this.onResize);
      this.observer.observe(this.element);
    }

    this.render();
  }

  /** Перечитывает состояние документа и обновляет подсветку и доступность. */
  syncState(): void {
    this.rendered.forEach((item) => {
      const { descriptor, button, dropdown } = item;
      const active = descriptor.isActive?.(this.context.editor) ?? false;
      const disabled = this.isDisabled || (descriptor.isDisabled?.(this.context.editor) ?? false);

      if (dropdown) {
        dropdown.setActive(active);
        dropdown.setDisabled(disabled);

        if (descriptor.text) dropdown.setText(descriptor.text(this.context));

        if (descriptor.dynamicIcon) dropdown.setIcon(descriptor.dynamicIcon(this.context.editor));

        return;
      }

      button.classList.toggle('rte-btn--active', active);

      if (descriptor.isActive) button.setAttribute('aria-pressed', String(active));

      button.disabled = disabled;

      if (descriptor.dynamicIcon) {
        refreshButtonIcon(button, descriptor.dynamicIcon(this.context.editor));
      }
    });

    this.applyRoving();
  }

  /** Блокирует или разблокирует все кнопки разом (режим «только чтение»). */
  setDisabled(disabled: boolean): void {
    this.isDisabled = disabled;
    this.syncState();
  }

  /** Пересобирает кнопки: подписи и подсказки берутся из переводчика заново. */
  rebuild(): void {
    // Подписи сменились — ширины тоже: подбираем заново с полного тулбара.
    this.collapsedCount = 0;
    this.render();
    this.layout(this.lastWidth);
  }

  /**
   * Подбирает число схлопнутых групп под ширину.
   *
   * Ниже collapseBelow все схлопываемые группы уходят в меню сразу: на
   * телефоне в одну строку они не встанут при любом переборе. Выше порога
   * фиксированное правило не работает — ширина тулбара зависит от набора
   * пунктов и языка подписей, — поэтому измеряем: если тулбар переносится,
   * убираем группы по одной с конца, пока не перестанет; если места стало
   * больше, пробуем вернуть одну и откатываемся, когда перенос вернулся.
   */
  layout(width: number): void {
    this.lastWidth = width;

    if (width < this.collapseBelow) {
      if (this.collapsedCount !== this.collapsibleGroups.length) {
        this.collapsedCount = this.collapsibleGroups.length;
        this.render();
      }

      return;
    }

    if (this.isWrapped()) {
      while (this.isWrapped() && this.collapsedCount < this.collapsibleGroups.length) {
        this.collapsedCount += 1;
        this.render();
      }

      return;
    }

    while (this.collapsedCount > 0) {
      this.collapsedCount -= 1;
      this.render();

      if (this.isWrapped()) {
        this.collapsedCount += 1;
        this.render();

        return;
      }
    }
  }

  /** Переводит фокус на текущую кнопку тулбара или первую доступную. */
  focus(): void {
    this.applyRoving();

    this.getFocusableButtons()
      .find((button) => button.dataset.itemId === this.rovingId)
      ?.focus();
  }

  /** Снимает наблюдатель размера и слушатели, убирает тулбар из документа. */
  destroy(): void {
    this.observer?.disconnect();
    cancelAnimationFrame(this.frame);
    this.rendered.forEach((item) => item.dropdown?.destroy());
    this.disposer.dispose();
    this.element.remove();
  }

  /** Схлопывать можно только группы из обычных кнопок: панель в меню не влезет. */
  private isCollapsible(group: ToolbarGroupConfig): boolean {
    return (
      group.collapsible === true
      && group.items.every((id) => this.options.items[id]?.kind !== 'dropdown')
    );
  }

  private getIconName(descriptor: ToolbarItemDescriptor): string {
    return descriptor.dynamicIcon?.(this.context.editor) ?? descriptor.icon ?? 'more';
  }

  private buildButton(descriptor: ToolbarItemDescriptor): RenderedItem {
    const label = this.context.t(descriptor.labelKey);
    const shortcut = descriptor.shortcut ? formatShortcut(descriptor.shortcut) : '';

    const button = el('button', {
      class: 'rte-btn',
      attrs: {
        type: 'button',
        'data-item-id': descriptor.id,
        // Подсказка — с сочетанием клавиш, доступное имя — без него: читалке
        // сочетание сообщает aria-keyshortcuts.
        title: shortcut ? `${label} · ${shortcut}` : label,
        'aria-label': label,
        'aria-keyshortcuts': descriptor.shortcut ? ariaKeyshortcuts(descriptor.shortcut) : null,
        // Переключатель сообщает состояние, а не только подсвечивается.
        'aria-pressed': descriptor.isActive ? 'false' : null,
      },
      children: [icon(this.getIconName(descriptor), ICON_SIZE)],
    });

    // Кнопка не забирает фокус у документа: иначе каждый клик — потеря
    // выделения, возврат фокуса в следующем кадре и гонка с набором.
    this.disposer.add(on(button, 'mousedown', (event) => event.preventDefault()));

    this.disposer.add(
      on(button, 'click', (event) => {
        event.preventDefault();
        descriptor.run?.(this.context);
      }),
    );

    return { descriptor, button };
  }

  private buildItem(id: string): HTMLElement | null {
    const descriptor = this.options.items[id];

    // Неизвестный пункт — не повод падать: набор возможностей задаёт хост, и
    // опечатка в конфиге не должна ломать весь тулбар.
    if (!descriptor) return null;

    if (descriptor.kind === 'dropdown' && descriptor.renderPanel) {
      const { renderPanel } = descriptor;

      const dropdown = createDropdown({
        label: this.context.t(descriptor.labelKey),
        iconName: this.getIconName(descriptor),
        text: descriptor.text?.(this.context),
        renderPanel: (close) => renderPanel(this.context, close),
      });

      dropdown.button.dataset.itemId = descriptor.id;
      this.rendered.push({ descriptor, button: dropdown.button, dropdown });

      return dropdown.element;
    }

    const item = this.buildButton(descriptor);

    this.rendered.push(item);

    return item.button;
  }

  private buildOverflow(groups: ToolbarGroupConfig[]): HTMLElement {
    const dropdown = createDropdown({
      label: this.context.t('toolbar_more'),
      iconName: 'more',
      renderPanel: (close) => {
        const panel = el('div');

        groups.forEach((group) => {
          group.items.forEach((id) => {
            const descriptor = this.options.items[id];

            if (!descriptor) return;

            panel.appendChild(
              createMenuItem({
                label: this.context.t(descriptor.labelKey),
                iconName: this.getIconName(descriptor),
                // Переключатель и в меню остаётся переключателем: пункт
                // сообщает своё состояние, а не только подсвечивается.
                role: descriptor.isActive ? 'menuitemcheckbox' : 'menuitem',
                active: descriptor.isActive?.(this.context.editor),
                disabled:
                  this.isDisabled || (descriptor.isDisabled?.(this.context.editor) ?? false),
                onSelect: () => {
                  descriptor.run?.(this.context);
                  close();
                },
              }),
            );
          });
        });

        return panel;
      },
    });

    dropdown.button.dataset.itemId = 'more';

    this.rendered.push({
      descriptor: { id: 'more', labelKey: 'toolbar_more' },
      button: dropdown.button,
      dropdown,
    });

    return dropdown.element;
  }

  /** Кнопки, на которые можно встать: отключённые стрелки пропускают. */
  private getFocusableButtons(): HTMLButtonElement[] {
    return this.rendered.map((item) => item.button).filter((button) => !button.disabled);
  }

  /**
   * Раздаёт tabindex: 0 — у текущего пункта, −1 — у остальных. Зовётся после
   * каждой пересборки и синхронизации: пункт мог уехать в меню «⋯» или стать
   * недоступным, и тогда остановка Tab'а переходит к первой доступной кнопке —
   * иначе Tab перешагнул бы тулбар целиком.
   */
  private applyRoving(): void {
    const buttons = this.getFocusableButtons();
    const current = buttons.find((button) => button.dataset.itemId === this.rovingId) ?? buttons[0];

    this.rovingId = current?.dataset.itemId ?? null;

    this.rendered.forEach((item) => {
      const { button } = item;

      button.tabIndex = button === current ? 0 : -1;
    });
  }

  private moveFocus(button: HTMLButtonElement): void {
    this.rovingId = button.dataset.itemId ?? null;
    this.applyRoving();
    button.focus();
  }

  private render(): void {
    // Дропдауны держат слушатели на документе — снимаем их перед пересборкой.
    this.rendered.forEach((item) => item.dropdown?.destroy());
    this.rendered.length = 0;
    this.element.replaceChildren();
    this.element.setAttribute('aria-label', this.context.t('toolbar_label'));

    const collapsed = this.collapsibleGroups.slice(
      this.collapsibleGroups.length - this.collapsedCount,
    );

    const visible = this.options.groups.filter((group) => !collapsed.includes(group));

    visible.forEach((group) => {
      const groupElement = el('div', { class: 'rte-toolbar__group' });

      group.items.forEach((id) => {
        const node = this.buildItem(id);

        if (node) groupElement.appendChild(node);
      });

      // Пустая группа оставила бы висеть разделитель.
      if (groupElement.childElementCount > 0) this.element.appendChild(groupElement);
    });

    if (collapsed.length > 0) {
      this.element.appendChild(
        el('div', { class: 'rte-toolbar__group', children: [this.buildOverflow(collapsed)] }),
      );
    }

    this.syncState();
  }

  /** Переносится ли тулбар на вторую строку. */
  private isWrapped(): boolean {
    const groups = [...this.element.children] as HTMLElement[];

    if (groups.length < 2) return false;

    const firstTop = groups[0]?.offsetTop ?? 0;

    return groups.some((group) => group.offsetTop > firstTop);
  }

  private readonly onKeydown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null;

    if (target?.closest('.rte-popover')) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      focusEditorView(this.context.editor);

      return;
    }

    const buttons = this.getFocusableButtons();

    if (buttons.length === 0) return;

    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);

    const moves: Record<string, number> = {
      ArrowRight: current + 1,
      ArrowLeft: current - 1,
      Home: 0,
      End: buttons.length - 1,
    };

    const next = moves[event.key];

    if (next === undefined) return;

    event.preventDefault();

    const nextButton = buttons[(next + buttons.length) % buttons.length];

    if (nextButton) this.moveFocus(nextButton);
  };

  private readonly onFocusIn = (event: FocusEvent): void => {
    const target = event.target as HTMLElement | null;

    const id = target?.closest<HTMLElement>(
      '.rte-toolbar__group > .rte-btn, .rte-dropdown > .rte-btn',
    )?.dataset.itemId;

    if (id && id !== this.rovingId) {
      this.rovingId = id;
      this.applyRoving();
    }
  };

  /** Один подбор на кадр: события ресайза идут на каждый пиксель. */
  private readonly onResize = ([entry]: ResizeObserverEntry[]): void => {
    if (!entry) return;

    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.layout(entry.contentRect.width));
  };
}

/** Собирает тулбар; тонкая обёртка над `ToolbarController` с прежней сигнатурой. */
export const createToolbar = (context: EditorUiContext, options: ToolbarOptions): Toolbar =>
  new ToolbarController(context, options);
