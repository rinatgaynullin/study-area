import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDropdown, createModal, createPopover } from '../src';

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
