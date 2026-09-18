import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDropdown, createModal, createPopover } from '../src';
import { createMenuItem } from '../src/ui/dropdown';

/**
 * Примитивы интерфейса и документ: слушатели на `document`/`window` должны
 * появляться при открытии и исчезать при закрытии. На странице бывает
 * несколько редакторов, у каждого — с десяток оверлеев; закрытые не должны
 * стоить ей ничего.
 */
let added: ReturnType<typeof vi.spyOn>;
let removed: ReturnType<typeof vi.spyOn>;

function watchDocument(): void {
  added = vi.spyOn(document, 'addEventListener');
  removed = vi.spyOn(document, 'removeEventListener');
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('клавиатура в меню', () => {
  it('стрелки ходят по пунктам по кругу, Home и End — к краям', () => {
    const dropdown = createDropdown({
      label: 'Меню',
      renderPanel: () => {
        const panel = document.createElement('div');
        for (const text of ['один', 'два', 'три']) {
          const item = document.createElement('button');
          item.setAttribute('role', 'menuitem');
          item.textContent = text;
          panel.appendChild(item);
        }
        return panel;
      },
    });
    document.body.appendChild(dropdown.element);

    // Синтетический клик — как с клавиатуры: фокус уходит в меню.
    dropdown.button.click();
    const items = [...dropdown.element.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    expect(document.activeElement).toBe(items[0]);

    const press = (key: string) =>
      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

    press('ArrowDown');
    expect(document.activeElement).toBe(items[1]);
    press('End');
    expect(document.activeElement).toBe(items[2]);
    press('ArrowDown');
    expect(document.activeElement).toBe(items[0]);
    press('ArrowUp');
    expect(document.activeElement).toBe(items[2]);
    press('Home');
    expect(document.activeElement).toBe(items[0]);

    dropdown.destroy();
  });
});

describe('панель дропдауна', () => {
  it('это поповер с ролью меню: фиксированное позиционирование не обрежет её', () => {
    const dropdown = createDropdown({
      label: 'Меню',
      renderPanel: () => document.createElement('div'),
    });
    document.body.appendChild(dropdown.element);

    const panel = dropdown.element.querySelector('.rte-dropdown__panel')!;
    expect(panel.classList.contains('rte-popover')).toBe(true);
    expect(panel.getAttribute('role')).toBe('menu');
    expect(panel.hasAttribute('hidden')).toBe(true);

    dropdown.button.click();
    expect(panel.hasAttribute('hidden')).toBe(false);
    expect(dropdown.button.getAttribute('aria-expanded')).toBe('true');

    // Клик по собственной кнопке — не «мимо панели»: он закрывает, а не
    // закрывает-и-открывает.
    dropdown.button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(panel.hasAttribute('hidden')).toBe(false);
    dropdown.button.click();
    expect(panel.hasAttribute('hidden')).toBe(true);
    dropdown.destroy();
  });
});

describe('слушатели документа у оверлеев', () => {
  it('дропдаун слушает документ только пока открыт', () => {
    watchDocument();
    const dropdown = createDropdown({
      label: 'Меню',
      renderPanel: () => document.createElement('div'),
    });
    document.body.appendChild(dropdown.element);
    expect(added).not.toHaveBeenCalled();

    dropdown.button.click();
    expect(added).toHaveBeenCalledTimes(2);

    dropdown.close();
    expect(removed).toHaveBeenCalledTimes(2);
    dropdown.destroy();
  });

  it('модалка слушает Escape только пока открыта', () => {
    watchDocument();
    const modal = createModal({ title: 'Диалог', closeLabel: 'Закрыть' });
    document.body.appendChild(modal.element);
    expect(added).not.toHaveBeenCalled();

    modal.open();
    expect(added).toHaveBeenCalledTimes(1);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(modal.isVisible).toBe(false);
    expect(removed).toHaveBeenCalledTimes(1);
    modal.destroy();
  });

  it('поповер отпускает документ и окно при закрытии', () => {
    watchDocument();
    const windowAdded = vi.spyOn(window, 'addEventListener');
    const windowRemoved = vi.spyOn(window, 'removeEventListener');

    const popover = createPopover();
    document.body.appendChild(popover.element);
    expect(added).not.toHaveBeenCalled();
    expect(windowAdded).not.toHaveBeenCalled();

    popover.open(new DOMRect(0, 0, 10, 10));
    expect(added).toHaveBeenCalledTimes(2);
    expect(windowAdded).toHaveBeenCalledTimes(2);

    popover.close();
    expect(removed).toHaveBeenCalledTimes(2);
    expect(windowRemoved).toHaveBeenCalledTimes(2);
    popover.destroy();
  });
});

describe('доступность меню', () => {
  const press = (key: string): void => {
    document.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    );
  };

  function menuWith(items: HTMLElement[]) {
    return createDropdown({
      label: 'Меню',
      renderPanel: () => {
        const panel = document.createElement('div');
        panel.append(...items);
        return panel;
      },
    });
  }

  it('переключатели сообщают состояние через aria-checked, действия — нет', () => {
    const radio = createMenuItem({ label: 'H1', role: 'menuitemradio', active: true, onSelect: () => {} });
    const box = createMenuItem({ label: 'Курсив', role: 'menuitemcheckbox', onSelect: () => {} });
    const plain = createMenuItem({ label: 'Вставить', onSelect: () => {} });

    expect(radio.getAttribute('role')).toBe('menuitemradio');
    expect(radio.getAttribute('aria-checked')).toBe('true');
    expect(box.getAttribute('aria-checked')).toBe('false');
    expect(plain.getAttribute('role')).toBe('menuitem');
    expect(plain.hasAttribute('aria-checked')).toBe(false);
  });

  it('меню названо своей кнопкой, а кнопка с подписью описывается ею', () => {
    const dropdown = createDropdown({
      label: 'Заголовок',
      text: 'H2',
      renderPanel: () => document.createElement('div'),
    });
    document.body.appendChild(dropdown.element);

    const panel = dropdown.element.querySelector('[role="menu"]')!;
    expect(dropdown.button.id).not.toBe('');
    expect(panel.getAttribute('aria-labelledby')).toBe(dropdown.button.id);
    expect(dropdown.button.getAttribute('aria-haspopup')).toBe('menu');

    const value = document.getElementById(dropdown.button.getAttribute('aria-describedby')!)!;
    expect(value.textContent).toBe('H2');
    dropdown.setText('Обычный текст');
    expect(value.textContent).toBe('Обычный текст');
    dropdown.destroy();
  });

  it('стрелка вниз на кнопке открывает меню и встаёт на первый пункт, вверх — на последний', () => {
    const items = ['один', 'два', 'три'].map((label) =>
      createMenuItem({ label, onSelect: () => {} }),
    );
    const dropdown = menuWith(items);
    document.body.appendChild(dropdown.element);

    dropdown.button.focus();
    press('ArrowDown');
    expect(dropdown.button.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement?.textContent).toBe('один');

    press('Escape');
    expect(document.activeElement).toBe(dropdown.button);

    press('ArrowUp');
    expect(document.activeElement?.textContent).toBe('три');
    dropdown.destroy();
  });

  it('в сетке стрелки вверх и вниз ходят по строкам и упираются в края', () => {
    const grid = document.createElement('div');
    grid.dataset.menuColumns = '3';
    grid.append(
      ...['1', '2', '3', '4', '5', '6'].map((label) =>
        createMenuItem({ label, role: 'menuitemradio', active: false, onSelect: () => {} }),
      ),
    );
    const reset = createMenuItem({ label: 'сброс', onSelect: () => {} });
    const dropdown = menuWith([grid, reset]);
    document.body.appendChild(dropdown.element);

    dropdown.button.click();
    expect(document.activeElement?.textContent).toBe('1');

    press('ArrowDown');
    expect(document.activeElement?.textContent).toBe('4');
    press('ArrowRight');
    expect(document.activeElement?.textContent).toBe('5');
    // Ниже сетки — кнопка сброса, а не перескок на первую строку.
    press('ArrowDown');
    expect(document.activeElement?.textContent).toBe('сброс');
    press('ArrowUp');
    expect(document.activeElement?.textContent).toBe('6');
    press('ArrowUp');
    expect(document.activeElement?.textContent).toBe('3');
    press('ArrowUp');
    expect(document.activeElement?.textContent).toBe('1');
    dropdown.destroy();
  });
});
