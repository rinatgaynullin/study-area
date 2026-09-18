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
  /** Иконка обычной кнопки — чтобы подменять её при смене состояния. */
  iconNode?: SVGElement;
}

/**
 * Тулбар, собранный из дескрипторов возможностей.
 *
 * Пункты не зашиты в разметку: тулбар получает список идентификаторов и берёт
 * поведение из реестра. Поэтому набор кнопок задаётся конфигурацией, а не
 * правкой этого файла, и одна и та же возможность не описывается дважды.
 */
export function createToolbar(context: EditorUiContext, options: ToolbarOptions): Toolbar {
  const disposer = createDisposer();
  const collapseBelow = options.collapseBelow ?? 760;

  const element = el('div', { class: 'rte-toolbar', attrs: { role: 'toolbar' } });
  const rendered: RenderedItem[] = [];

  /** Схлопывать можно только группы из обычных кнопок: панель в меню не влезет. */
  function isCollapsible(group: ToolbarGroupConfig): boolean {
    return (
      group.collapsible === true &&
      group.items.every((id) => options.items[id]?.kind !== 'dropdown')
    );
  }

  /** Схлопываемые группы в порядке следования; в меню уходят с конца. */
  const collapsibleGroups = options.groups.filter(isCollapsible);

  let isDisabled = false;
  /** Сколько схлопываемых групп сейчас в меню «⋯», считая с конца. */
  let collapsedCount = 0;
  let lastWidth = 0;
  /**
   * Пункт, на котором стоит фокус тулбара. Тулбар — одна остановка Tab'а: в
   * него входят на этот пункт, а между кнопками ходят стрелками. Иначе до
   * документа пришлось бы пройти два десятка кнопок подряд.
   */
  let rovingId: string | null = null;

  function iconNameFor(descriptor: ToolbarItemDescriptor): string {
    return descriptor.dynamicIcon?.(context.editor) ?? descriptor.icon ?? 'more';
  }

  function buildButton(descriptor: ToolbarItemDescriptor): RenderedItem {
    const label = context.t(descriptor.labelKey);
    const shortcut = descriptor.shortcut ? formatShortcut(descriptor.shortcut) : '';
    const iconNode = icon(iconNameFor(descriptor), 20);

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
      children: [iconNode],
    });

    // Кнопка не забирает фокус у документа: иначе каждый клик — потеря
    // выделения, возврат фокуса в следующем кадре и гонка с набором.
    disposer.add(on(button, 'mousedown', (event) => event.preventDefault()));
    disposer.add(
      on(button, 'click', (event) => {
        event.preventDefault();
        descriptor.run?.(context);
      }),
    );

    return { descriptor, button, iconNode };
  }

  function buildItem(id: string): HTMLElement | null {
    const descriptor = options.items[id];
    // Неизвестный пункт — не повод падать: набор возможностей задаёт хост, и
    // опечатка в конфиге не должна ломать весь тулбар.
    if (!descriptor) return null;

    if (descriptor.kind === 'dropdown' && descriptor.renderPanel) {
      const dropdown = createDropdown({
        label: context.t(descriptor.labelKey),
        iconName: iconNameFor(descriptor),
        text: descriptor.text?.(context),
        renderPanel: (close) => descriptor.renderPanel!(context, close),
      });
      dropdown.button.dataset.itemId = descriptor.id;
      rendered.push({ descriptor, button: dropdown.button, dropdown });
      return dropdown.element;
    }

    const item = buildButton(descriptor);
    rendered.push(item);
    return item.button;
  }

  function buildOverflow(groups: ToolbarGroupConfig[]): HTMLElement {
    const dropdown = createDropdown({
      label: context.t('toolbar_more'),
      iconName: 'more',
      renderPanel: (close) => {
        const panel = el('div');
        for (const group of groups) {
          for (const id of group.items) {
            const descriptor = options.items[id];
            if (!descriptor) continue;
            panel.appendChild(
              createMenuItem({
                label: context.t(descriptor.labelKey),
                iconName: iconNameFor(descriptor),
                // Переключатель и в меню остаётся переключателем: пункт
                // сообщает своё состояние, а не только подсвечивается.
                role: descriptor.isActive ? 'menuitemcheckbox' : 'menuitem',
                active: descriptor.isActive?.(context.editor),
                disabled: isDisabled || (descriptor.isDisabled?.(context.editor) ?? false),
                onSelect: () => {
                  descriptor.run?.(context);
                  close();
                },
              }),
            );
          }
        }
        return panel;
      },
    });

    dropdown.button.dataset.itemId = 'more';
    rendered.push({
      descriptor: { id: 'more', labelKey: 'toolbar_more' },
      button: dropdown.button,
      dropdown,
    });
    return dropdown.element;
  }

  /** Кнопки, на которые можно встать: отключённые стрелки пропускают. */
  function focusableButtons(): HTMLButtonElement[] {
    return rendered.map((item) => item.button).filter((button) => !button.disabled);
  }

  /**
   * Раздаёт tabindex: 0 — у текущего пункта, −1 — у остальных. Зовётся после
   * каждой пересборки и синхронизации: пункт мог уехать в меню «⋯» или стать
   * недоступным, и тогда остановка Tab'а переходит к первой доступной кнопке —
   * иначе Tab перешагнул бы тулбар целиком.
   */
  function applyRoving(): void {
    const buttons = focusableButtons();
    const current = buttons.find((button) => button.dataset.itemId === rovingId) ?? buttons[0];
    rovingId = current?.dataset.itemId ?? null;
    for (const item of rendered) item.button.tabIndex = item.button === current ? 0 : -1;
  }

  function moveFocus(button: HTMLButtonElement): void {
    rovingId = button.dataset.itemId ?? null;
    applyRoving();
    button.focus();
  }

  function render(): void {
    // Дропдауны держат слушатели на документе — снимаем их перед пересборкой.
    for (const item of rendered) item.dropdown?.destroy();
    rendered.length = 0;
    element.replaceChildren();
    element.setAttribute('aria-label', context.t('toolbar_label'));

    const collapsed = collapsibleGroups.slice(collapsibleGroups.length - collapsedCount);
    const visible = options.groups.filter((group) => !collapsed.includes(group));

    for (const group of visible) {
      const groupElement = el('div', { class: 'rte-toolbar__group' });
      for (const id of group.items) {
        const node = buildItem(id);
        if (node) groupElement.appendChild(node);
      }
      // Пустая группа оставила бы висеть разделитель.
      if (groupElement.childElementCount > 0) element.appendChild(groupElement);
    }

    if (collapsed.length > 0) {
      element.appendChild(
        el('div', { class: 'rte-toolbar__group', children: [buildOverflow(collapsed)] }),
      );
    }

    syncState();
  }

  function syncState(): void {
    for (const item of rendered) {
      const active = item.descriptor.isActive?.(context.editor) ?? false;
      const disabled = isDisabled || (item.descriptor.isDisabled?.(context.editor) ?? false);

      if (item.dropdown) {
        item.dropdown.setActive(active);
        item.dropdown.setDisabled(disabled);
        if (item.descriptor.text) item.dropdown.setText(item.descriptor.text(context));
        if (item.descriptor.dynamicIcon) {
          item.dropdown.setIcon(item.descriptor.dynamicIcon(context.editor));
        }
        continue;
      }

      item.button.classList.toggle('rte-btn--active', active);
      if (item.descriptor.isActive) item.button.setAttribute('aria-pressed', String(active));
      item.button.disabled = disabled;

      if (item.descriptor.dynamicIcon && item.iconNode) {
        const next = item.descriptor.dynamicIcon(context.editor);
        if (item.iconNode.getAttribute('data-icon') !== next) {
          const fresh = icon(next, 20);
          item.iconNode.replaceWith(fresh);
          item.iconNode = fresh;
        }
      }
    }

    applyRoving();
  }

  // Стрелки ходят по кнопкам, Home/End — к краям, Escape возвращает каретку
  // в документ. Открытое меню лежит внутри тулбара, но клавиши в нём свои.
  disposer.add(
    on(element, 'keydown', (event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('.rte-popover')) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        // Без прокрутки: выделение было на виду, когда уходили в тулбар.
        context.editor.commands.focus(null, { scrollIntoView: false });
        return;
      }

      const buttons = focusableButtons();
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
      moveFocus(buttons[(next + buttons.length) % buttons.length]);
    }),
  );

  // Пришли Tab'ом или щелчком на другую кнопку — она и становится остановкой:
  // выйдя и вернувшись, пользователь попадает туда же, где был.
  disposer.add(
    on(element, 'focusin', (event) => {
      const target = event.target as HTMLElement | null;
      const id = target?.closest<HTMLElement>('.rte-toolbar__group > .rte-btn, .rte-dropdown > .rte-btn')
        ?.dataset.itemId;
      if (id && id !== rovingId) {
        rovingId = id;
        applyRoving();
      }
    }),
  );

  /** Переносится ли тулбар на вторую строку. */
  function isWrapped(): boolean {
    const groups = [...element.children] as HTMLElement[];
    if (groups.length < 2) return false;
    const firstTop = groups[0].offsetTop;
    return groups.some((group) => group.offsetTop > firstTop);
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
  function layout(width: number): void {
    lastWidth = width;

    if (width < collapseBelow) {
      if (collapsedCount !== collapsibleGroups.length) {
        collapsedCount = collapsibleGroups.length;
        render();
      }
      return;
    }

    if (isWrapped()) {
      while (isWrapped() && collapsedCount < collapsibleGroups.length) {
        collapsedCount += 1;
        render();
      }
      return;
    }

    while (collapsedCount > 0) {
      collapsedCount -= 1;
      render();
      if (isWrapped()) {
        collapsedCount += 1;
        render();
        return;
      }
    }
  }

  let observer: ResizeObserver | null = null;
  let frame = 0;
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(([entry]) => {
      // Один подбор на кадр: события ресайза идут на каждый пиксель.
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => layout(entry.contentRect.width));
    });
    observer.observe(element);
  }

  render();

  return {
    element,
    syncState,
    layout,
    focus: () => {
      applyRoving();
      focusableButtons()
        .find((button) => button.dataset.itemId === rovingId)
        ?.focus();
    },
    rebuild: () => {
      // Подписи сменились — ширины тоже: подбираем заново с полного тулбара.
      collapsedCount = 0;
      render();
      layout(lastWidth);
    },
    setDisabled: (disabled: boolean) => {
      isDisabled = disabled;
      syncState();
    },
    destroy: () => {
      observer?.disconnect();
      cancelAnimationFrame(frame);
      for (const item of rendered) item.dropdown?.destroy();
      disposer.dispose();
      element.remove();
    },
  };
}
