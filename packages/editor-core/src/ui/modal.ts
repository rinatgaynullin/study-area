import { createDisposer, el, icon, on } from './dom';
import type { DialogComponent } from './types';

/**
 * Событие закрытия модалки. Всплывает до оболочки редактора, чтобы та решила,
 * куда вернуть фокус. `preventDefault()` в обработчике означает «фокусом
 * занялись»: тогда модалка не отдаёт его обратно тому, с кого её открыли.
 */
export const MODAL_CLOSE_EVENT = 'rte:modal-close';

export interface ModalOptions {
  title: string;
  closeLabel: string;
  /** Широкая раскладка для редактора формул с галереей шаблонов. */
  wide?: boolean;
  onClose?(): void;
}

export interface Modal extends DialogComponent {
  /** Тело диалога. Наполняет тот, кто его создал. */
  readonly body: HTMLElement;
  /** Нижняя панель с кнопками. */
  readonly footer: HTMLElement;
  setTitle(title: string): void;
}

/**
 * Модальное окно на голом DOM.
 *
 * Держит фокус внутри, пока открыто: иначе Tab уводит на страницу под
 * оверлеем, а для пользователя с клавиатурой диалог перестаёт существовать.
 */
export function createModal(options: ModalOptions): Modal {
  const disposer = createDisposer();

  const titleElement = el('h2', { class: 'rte-modal__title', text: options.title });
  const body = el('div', { class: 'rte-modal__body' });
  const footer = el('div', { class: 'rte-modal__footer' });

  const closeButton = el('button', {
    class: 'rte-modal__close',
    attrs: { type: 'button', 'aria-label': options.closeLabel, title: options.closeLabel },
    children: [icon('close', 18)],
  });

  const panel = el('div', {
    class: options.wide ? 'rte-modal__panel rte-modal__panel--wide' : 'rte-modal__panel',
    attrs: { role: 'dialog', 'aria-modal': 'true' },
    children: [
      el('header', { class: 'rte-modal__header', children: [titleElement, closeButton] }),
      body,
      footer,
    ],
  });

  const element = el('div', { class: 'rte-modal', children: [panel] });
  element.hidden = true;

  let isVisible = false;
  /** Куда вернуть фокус после закрытия — обычно кнопка, открывшая диалог. */
  let lastFocused: HTMLElement | null = null;

  function focusableItems(): HTMLElement[] {
    return [
      ...panel.querySelectorAll<HTMLElement>(
        'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ),
    ].filter((item) => item.offsetParent !== null || item === document.activeElement);
  }

  function onKeydown(event: KeyboardEvent): void {
    if (!isVisible) return;

    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
      return;
    }

    if (event.key !== 'Tab') return;

    const items = focusableItems();
    if (items.length === 0) return;

    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;

    // Замыкаем обход в кольцо: с последнего элемента — на первый и обратно.
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function open(): void {
    if (isVisible) return;
    lastFocused = document.activeElement as HTMLElement | null;
    isVisible = true;
    element.hidden = false;

    // Ждём кадр: до отрисовки элементы ещё не фокусируемы.
    requestAnimationFrame(() => {
      const preferred = panel.querySelector<HTMLElement>('[data-autofocus]');
      (preferred ?? focusableItems()[0] ?? panel).focus();
    });
  }

  function close(): void {
    if (!isVisible) return;
    isVisible = false;
    element.hidden = true;

    const restoreLastFocused = element.dispatchEvent(
      new CustomEvent(MODAL_CLOSE_EVENT, { bubbles: true, cancelable: true }),
    );
    if (restoreLastFocused) lastFocused?.focus();

    options.onClose?.();
  }

  disposer.add(on(closeButton, 'click', close));
  disposer.add(on(document, 'keydown', onKeydown));
  // Клик по подложке закрывает, клик по панели — нет.
  disposer.add(
    on(element, 'mousedown', (event) => {
      if (event.target === element) close();
    }),
  );

  return {
    element,
    body,
    footer,
    open,
    close,
    get isVisible() {
      return isVisible;
    },
    setTitle: (title: string) => {
      titleElement.textContent = title;
    },
    destroy: () => {
      disposer.dispose();
      element.remove();
    },
  };
}
