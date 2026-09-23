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

/** Сколько диалогов открыто на странице: замок с документа снимает последний. */
let openModals = 0;
let savedOverflow = '';
let savedPaddingRight = '';

/**
 * Запирает прокрутку документа, пока открыт хоть один диалог.
 *
 * `overscroll-behavior` на оверлее гасит цепочку прокрутки не везде: в
 * Chromium на Linux остаток колеса, не поместившийся в тело диалога, всё
 * равно уезжает на страницу. Документ без прокрутки не уедет. Ширину
 * пропавшего скроллбара добираем отступом, чтобы страница не дёргалась.
 */
const lockDocumentScroll = (): void => {
  openModals += 1;

  if (openModals > 1) return;

  const html = document.documentElement;

  savedOverflow = html.style.overflow;
  savedPaddingRight = html.style.paddingRight;

  const scrollbarWidth = window.innerWidth - html.clientWidth;

  html.style.overflow = 'hidden';

  if (scrollbarWidth > 0) html.style.paddingRight = `${scrollbarWidth}px`;
};

const unlockDocumentScroll = (): void => {
  openModals = Math.max(0, openModals - 1);

  if (openModals > 0) return;

  const html = document.documentElement;

  html.style.overflow = savedOverflow;
  html.style.paddingRight = savedPaddingRight;
};

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
 *
 * Состояние диалога — видимость, подписки на документ и visualViewport,
 * отложенный автофокус — живёт в полях, а операции открытия и закрытия
 * ссылаются друг на друга через `this`.
 */
class ModalController implements Modal {
  readonly element: HTMLElement;

  readonly body: HTMLElement;

  readonly footer: HTMLElement;

  private readonly disposer = createDisposer();

  private readonly panel: HTMLElement;

  private readonly backdrop: HTMLElement;

  private readonly titleElement: HTMLElement;

  private isOpen = false;

  /** Куда вернуть фокус после закрытия — обычно кнопка, открывшая диалог. */
  private lastFocused: HTMLElement | null = null;

  /** Escape и кольцо фокуса слушаются на документе только пока диалог открыт. */
  private releaseDocument: Unsubscribe | null = null;

  /** Видимая область окна отслеживается только пока диалог открыт. */
  private releaseViewport: Unsubscribe | null = null;

  /** Отложенный автофокус: диалог могли закрыть раньше, чем кадр наступил. */
  private focusFrame = 0;

  constructor(private readonly options: ModalOptions) {
    modalCount += 1;

    const titleId = `rte-modal-title-${modalCount}`;

    this.titleElement = el('h2', {
      class: 'rte-modal__title',
      text: options.title,
      attrs: { id: titleId },
    });

    this.body = el('div', { class: 'rte-modal__body' });
    this.footer = el('div', { class: 'rte-modal__footer' });

    const closeButton = el('button', {
      class: 'rte-modal__close',
      attrs: { type: 'button', 'aria-label': options.closeLabel, title: options.closeLabel },
      children: [icon('close', 18)],
    });

    this.panel = el('div', {
      class: options.wide ? 'rte-modal__panel rte-modal__panel--wide' : 'rte-modal__panel',
      // Имя диалога — его заголовок: без него читалка объявляет просто «диалог».
      // tabindex −1 — чтобы панель можно было сфокусировать, когда в ней нет
      // ничего фокусируемого (например, пока грузится редактор формул).
      attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, tabindex: -1 },
      children: [
        el('header', { class: 'rte-modal__header', children: [this.titleElement, closeButton] }),
        this.body,
        this.footer,
      ],
    });

    // Подложка — отдельный элемент, а не фон оверлея: так клик по ней отличим
    // от клика по панели, а затемнение страницы не зависит от того, что ещё
    // лежит в контейнере.
    this.backdrop = el('div', { class: 'rte-modal__backdrop' });
    this.element = el('div', { class: 'rte-modal', children: [this.backdrop, this.panel] });

    this.element.hidden = true;

    this.disposer.add(on(closeButton, 'click', this.onCloseButtonClick));
    // Клик по подложке закрывает, клик по панели — нет.
    this.disposer.add(on(this.element, 'mousedown', this.onOverlayMousedown));
  }

  get isVisible(): boolean {
    return this.isOpen;
  }

  /** Показывает диалог, запирает документ и переводит фокус внутрь. */
  open(): void {
    if (this.isOpen) return;

    this.lastFocused = document.activeElement as HTMLElement | null;
    this.isOpen = true;
    this.element.hidden = false;
    this.releaseDocument = on(document, 'keydown', this.onDocumentKeydown);
    this.releaseViewport = this.followViewport();
    lockDocumentScroll();

    // Ждём кадр: до отрисовки элементы ещё не фокусируемы.
    this.focusFrame = requestAnimationFrame(() => {
      if (!this.isOpen) return;

      const preferred = this.panel.querySelector<HTMLElement>('[data-autofocus]');

      (preferred ?? this.getFocusableItems()[0] ?? this.panel).focus();
    });
  }

  /** Скрывает диалог, отпускает документ и возвращает фокус, откуда его взяли. */
  close(): void {
    if (!this.isOpen) return;

    this.isOpen = false;
    this.element.hidden = true;
    // Закрыли до первого кадра — автофокус не должен перетянуть фокус на
    // уже скрытый диалог у того, кому его только что вернули.
    cancelAnimationFrame(this.focusFrame);
    this.releaseDocument?.();
    this.releaseDocument = null;
    this.releaseViewport?.();
    this.releaseViewport = null;
    unlockDocumentScroll();

    const restoreLastFocused = this.element.dispatchEvent(
      new CustomEvent(MODAL_CLOSE_EVENT, { bubbles: true, cancelable: true }),
    );

    if (restoreLastFocused) this.lastFocused?.focus();

    this.options.onClose?.();
  }

  setTitle(title: string): void {
    this.titleElement.textContent = title;
  }

  destroy(): void {
    // Уничтожили открытым — замок с документа всё равно снимаем.
    if (this.isOpen) unlockDocumentScroll();

    this.isOpen = false;
    cancelAnimationFrame(this.focusFrame);
    this.releaseDocument?.();
    this.releaseViewport?.();
    this.disposer.dispose();
    this.element.remove();
  }

  /**
   * Подписывает оверлей на visualViewport. Возвращает отписку, которая ещё и
   * сбрасывает подогнанные размеры, или null, если visualViewport нет.
   */
  private followViewport(): Unsubscribe | null {
    const viewport = window.visualViewport;

    if (!viewport) return null;

    this.fitViewport();
    viewport.addEventListener('resize', this.fitViewport);
    viewport.addEventListener('scroll', this.fitViewport);

    return () => {
      viewport.removeEventListener('resize', this.fitViewport);
      viewport.removeEventListener('scroll', this.fitViewport);

      (['top', 'left', 'width', 'height'] as const).forEach((property) => {
        this.element.style[property] = '';
      });
    };
  }

  /** Элементы панели, по которым ходит Tab: видимые или уже в фокусе. */
  private getFocusableItems(): HTMLElement[] {
    return [
      ...this.panel.querySelectorAll<HTMLElement>(
        'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ),
    ].filter((item) => item.offsetParent !== null || item === document.activeElement);
  }

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
  private readonly fitViewport = (): void => {
    const viewport = window.visualViewport;

    if (!viewport) return;

    this.element.style.top = `${viewport.offsetTop}px`;
    this.element.style.left = `${viewport.offsetLeft}px`;
    this.element.style.width = `${viewport.width}px`;
    this.element.style.height = `${viewport.height}px`;
  };

  /** Escape закрывает диалог, Tab ходит по панели по кольцу. */
  private readonly onDocumentKeydown = (event: KeyboardEvent): void => {
    if (!this.isOpen) return;

    if (event.key === 'Escape') {
      event.stopPropagation();
      this.close();

      return;
    }

    if (event.key !== 'Tab') return;

    const items = this.getFocusableItems();
    const first = items[0];
    const last = items[items.length - 1];

    if (!first || !last) return;

    const active = document.activeElement;

    // Замыкаем обход в кольцо: с последнего элемента — на первый и обратно.
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  private readonly onCloseButtonClick = (): void => {
    this.close();
  };

  /** Клик по подложке или самому оверлею закрывает, клик по панели — нет. */
  private readonly onOverlayMousedown = (event: MouseEvent): void => {
    if (event.target === this.element || event.target === this.backdrop) this.close();
  };
}

/** Создаёт модальное окно. Тонкая обёртка над контроллером ради прежнего API. */
export const createModal = (options: ModalOptions): Modal => new ModalController(options);
