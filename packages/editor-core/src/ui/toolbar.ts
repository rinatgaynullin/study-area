import { createDisposer, el, icon, on } from './dom';
import { createDropdown, createMenuItem, type Dropdown } from './dropdown';
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
  /** Ниже этой ширины схлопываемые группы уезжают в меню. */
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
}

interface RenderedItem {
  descriptor: ToolbarItemDescriptor;
  button: HTMLButtonElement;
  dropdown?: Dropdown;
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

  let isDisabled = false;
  let isNarrow = false;

  function buildButton(descriptor: ToolbarItemDescriptor): HTMLButtonElement {
    const label = context.t(descriptor.labelKey);
    const button = el('button', {
      class: 'rte-btn',
      attrs: { type: 'button', title: label, 'aria-label': label },
      children: [icon(descriptor.icon ?? 'more', 20)],
    });

    disposer.add(
      on(button, 'click', (event) => {
        event.preventDefault();
        descriptor.run?.(context);
      }),
    );

    return button;
  }

  function buildItem(id: string): HTMLElement | null {
    const descriptor = options.items[id];
    // Неизвестный пункт — не повод падать: набор возможностей задаёт хост, и
    // опечатка в конфиге не должна ломать весь тулбар.
    if (!descriptor) return null;

    if (descriptor.kind === 'dropdown' && descriptor.renderPanel) {
      const dropdown = createDropdown({
        label: context.t(descriptor.labelKey),
        iconName: descriptor.icon,
        renderPanel: (close) => descriptor.renderPanel!(context, close),
      });
      rendered.push({ descriptor, button: dropdown.button, dropdown });
      return dropdown.element;
    }

    const button = buildButton(descriptor);
    rendered.push({ descriptor, button });
    return button;
  }

  /** Схлопывать можно только группы из обычных кнопок: панель в меню не влезет. */
  function isCollapsible(group: ToolbarGroupConfig): boolean {
    return (
      group.collapsible === true &&
      group.items.every((id) => options.items[id]?.kind !== 'dropdown')
    );
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
                iconName: descriptor.icon,
                active: descriptor.isActive?.(context.editor) ?? false,
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

    rendered.push({ descriptor: { id: 'more', labelKey: 'toolbar_more' }, button: dropdown.button, dropdown });
    return dropdown.element;
  }

  function render(): void {
    // Дропдауны держат слушатели на документе — снимаем их перед пересборкой.
    for (const item of rendered) item.dropdown?.destroy();
    rendered.length = 0;
    element.replaceChildren();

    const collapsed = isNarrow ? options.groups.filter(isCollapsible) : [];
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
        continue;
      }

      item.button.classList.toggle('rte-btn--active', active);
      item.button.disabled = disabled;
    }
  }

  let observer: ResizeObserver | null = null;
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(([entry]) => {
      const next = entry.contentRect.width < collapseBelow;
      // Пересобираем только на смене режима: перестройка на каждый пиксель
      // ресайза дёргала бы фокус и закрывала открытые панели.
      if (next === isNarrow) return;
      isNarrow = next;
      render();
    });
    observer.observe(element);
  }

  render();

  return {
    element,
    syncState,
    rebuild: render,
    setDisabled: (disabled: boolean) => {
      isDisabled = disabled;
      syncState();
    },
    destroy: () => {
      observer?.disconnect();
      for (const item of rendered) item.dropdown?.destroy();
      disposer.dispose();
      element.remove();
    },
  };
}
