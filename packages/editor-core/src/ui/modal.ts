import { createDisposer, el, icon, on, type Unsubscribe } from './dom';
import type { DialogComponent } from './types';

/**
 * Событие закрытия модалки. Всплывает до оболочки редактора, чтобы та решила,
 * куда вернуть фокус. `preventDefault()` в обработчике означает «фокусом
 * занялись»: тогда модалка не отдаёт его обратно тому, с кого её открыли.
 */
export const MODAL_CLOSE_EVENT = 'rte:modal-close';

/** Счётчик для уникальных id заголовков: на странице несколько диалогов. */
let modalCount = 0;

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

  modalCount += 1;
  const titleId = `rte-modal-title-${modalCount}`;
  const titleElement = el('h2', {
    class: 'rte-modal__title',
    text: options.title,
    attrs: { id: titleId },
  });
  const body = el('div', { class: 'rte-modal__body' });
  const footer = el('div', { class: 'rte-modal__footer' });

  const closeButton = el('button', {
    class: 'rte-modal__close',
    attrs: { type: 'button', 'aria-label': options.closeLabel, title: options.closeLabel },
    children: [icon('close', 18)],
  });

  const panel = el('div', {
    class: options.wide ? 'rte-modal__panel rte-modal__panel--wide' : 'rte-modal__panel',
    // Имя диалога — его заголовок: без него читалка объявляет просто «диалог».
    // tabindex −1 — чтобы панель можно было сфокусировать, когда в ней нет
    // ничего фокусируемого (например, пока грузится редактор формул).
    attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, tabindex: -1 },
    children: [
      el('header', { class: 'rte-modal__header', children: [titleElement, closeButton] }),
      body,
      footer,
    ],
  });

  // Подложка — отдельный элемент, а не фон оверлея: так клик по ней отличим
  // от клика по панели, а затемнение страницы не зависит от того, что ещё
  // лежит в контейнере.
  const backdrop = el('div', { class: 'rte-modal__backdrop' });
  const element = el('div', { class: 'rte-modal', children: [backdrop, panel] });
  element.hidden = true;

  let isVisible = false;
  /** Куда вернуть фокус после закрытия — обычно кнопка, открывшая диалог. */
  let lastFocused: HTMLElement | null = null;
  /** Escape и кольцо фокуса слушаются на документе только пока диалог открыт. */
  let releaseDocument: Unsubscribe | null = null;
  /** Видимая область окна отслеживается только пока диалог открыт. */
  let releaseViewport: Unsubscribe | null = null;
  /** Отложенный автофокус: диалог могли закрыть раньше, чем кадр наступил. */
  let focusFrame = 0;

  /**
   * Подгоняет оверлей под видимую часть окна.
   *
   * `position: fixed; inset: 0` растягивает его на layout-вьюпорт, а на
   * телефоне видно меньше: часть уходит под адресную строку Safari, а с
   * открытой клавиатурой — половина экрана. Диалог выше видимой области не
   * прокрутить: пальцем едет страница под оверлеем, а подвал с кнопками
   * остаётся за клавиатурой. visualViewport знает настоящие размеры и
   * смещение; панель берёт от оверлея долю, тело прокручивается внутри.
   */
  function fitViewport(): void {
    const viewport = window.visualViewport;
    if (!viewport) return;
    element.style.top = `${viewport.offsetTop}px`;
    element.style.left = `${viewport.offsetLeft}px`;
    element.style.width = `${viewport.width}px`;
    element.style.height = `${viewport.height}px`;
  }

  function followViewport(): Unsubscribe | null {
    const viewport = window.visualViewport;
    if (!viewport) return null;
    fitViewport();
    viewport.addEventListener('resize', fitViewport);
    viewport.addEventListener('scroll', fitViewport);
    return () => {
      viewport.removeEventListener('resize', fitViewport);
      viewport.removeEventListener('scroll', fitViewport);
      for (const property of ['top', 'left', 'width', 'height'] as const) {
        element.style[property] = '';
      }
    };
  }

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
    releaseDocument = on(document, 'keydown', onKeydown);
    releaseViewport = followViewport();

    // Ждём кадр: до отрисовки элементы ещё не фокусируемы.
    focusFrame = requestAnimationFrame(() => {
      if (!isVisible) return;
      const preferred = panel.querySelector<HTMLElement>('[data-autofocus]');
      (preferred ?? focusableItems()[0] ?? panel).focus();
    });
  }

  function close(): void {
    if (!isVisible) return;
    isVisible = false;
    element.hidden = true;
    // Закрыли до первого кадра — автофокус не должен перетянуть фокус на
    // уже скрытый диалог у того, кому его только что вернули.
    cancelAnimationFrame(focusFrame);
    releaseDocument?.();
    releaseDocument = null;
    releaseViewport?.();
    releaseViewport = null;

    const restoreLastFocused = element.dispatchEvent(
      new CustomEvent(MODAL_CLOSE_EVENT, { bubbles: true, cancelable: true }),
    );
    if (restoreLastFocused) lastFocused?.focus();

    options.onClose?.();
  }

  disposer.add(on(closeButton, 'click', close));
  // Клик по подложке закрывает, клик по панели — нет.
  disposer.add(
    on(element, 'mousedown', (event) => {
      if (event.target === element || event.target === backdrop) close();
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
      cancelAnimationFrame(focusFrame);
      releaseDocument?.();
      releaseViewport?.();
      disposer.dispose();
      element.remove();
    },
  };
}
