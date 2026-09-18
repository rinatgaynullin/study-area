import { createDisposer, el, on, type Unsubscribe } from './dom';
import type { UiComponent } from './types';

/**
 * Почему панель закрылась: по Escape, по клику мимо или по вызову снаружи.
 * Поповер ссылки по Escape не показывается снова, пока каретка в той же
 * ссылке, — а после клика мимо или применения правок показывается как обычно.
 */
export type PopoverCloseReason = 'escape' | 'outside' | 'api';

export interface Popover extends UiComponent {
  /** Показывает панель у прямоугольника в координатах вьюпорта. */
  open(anchor: DOMRect): void;
  close(reason?: PopoverCloseReason): void;
  readonly isVisible: boolean;
  /** Содержимое панели. Наполняет тот, кто её создал. */
  readonly body: HTMLElement;
  /** Пересчитывает положение — например, после правки текста под ней. */
  reposition(anchor: DOMRect): void;
}

export interface PopoverOptions {
  /** Зазор между якорем и панелью. */
  offset?: number;
  /** Роль панели для читалки: диалог по умолчанию, меню — у дропдауна. */
  role?: string;
  /** Дополнительный класс на элементе панели — под собственное оформление. */
  className?: string;
  /** Имя панели для читалки: id элемента с подписью или сама строка. */
  labelledBy?: string;
  label?: string;
  /** По горизонтали: центр под якорем или от его левого края (меню). */
  align?: 'center' | 'start';
  /**
   * Что считать «внутри» при клике мимо панели. По умолчанию — сама панель;
   * дропдаун добавляет свою кнопку, иначе клик по ней закрыл бы панель по
   * mousedown, а следом открыл бы заново по click.
   */
  isInside?(target: Node): boolean;
  onClose?(reason: PopoverCloseReason): void;
}

/** Отступ от края окна, ближе которого панель прижимать некрасиво. */
const VIEWPORT_MARGIN = 8;

/**
 * Панель, привязанная к прямоугольнику в документе.
 *
 * В отличие от модалки не забирает фокус: поповер сопровождает то, что
 * пользователь правит сейчас, и каретка должна оставаться в тексте.
 */
export function createPopover(options: PopoverOptions = {}): Popover {
  const disposer = createDisposer();
  const offset = options.offset ?? 8;

  const body = el('div', { class: 'rte-popover__body' });
  const element = el('div', {
    class: 'rte-popover',
    attrs: {
      role: options.role ?? 'dialog',
      'aria-labelledby': options.labelledBy ?? null,
      'aria-label': options.label ?? null,
    },
    children: [body],
  });
  if (options.className) element.classList.add(options.className);
  element.hidden = true;

  let isVisible = false;
  let currentAnchor: DOMRect | null = null;
  /** Документ и окно слушаются только пока панель видна. */
  let releaseDocument: Unsubscribe | null = null;

  function reposition(anchor: DOMRect): void {
    currentAnchor = anchor;
    if (!isVisible) return;

    const { width, height } = element.getBoundingClientRect();

    // По горизонтали центрируем по якорю, но не даём вылезти за края окна.
    const preferred =
      options.align === 'start' ? anchor.left : anchor.left + anchor.width / 2 - width / 2;
    const maxLeft = Math.max(window.innerWidth - width - VIEWPORT_MARGIN, VIEWPORT_MARGIN);
    element.style.left = `${Math.min(Math.max(preferred, VIEWPORT_MARGIN), maxLeft)}px`;

    // Снизу, если там есть место; иначе сверху — иначе панель уедет под экран.
    const below = anchor.bottom + offset;
    const fitsBelow = below + height + VIEWPORT_MARGIN <= window.innerHeight;
    element.style.top = `${
      fitsBelow ? below : Math.max(anchor.top - height - offset, VIEWPORT_MARGIN)
    }px`;
  }

  // Якорь двигается вместе с текстом — при скролле и смене размера окна.
  const follow = (): void => {
    if (currentAnchor) reposition(currentAnchor);
  };

  function listenDocument(): void {
    const offs = [
      on(document, 'mousedown', (event) => {
        const target = event.target as Node | null;
        if (target && (options.isInside?.(target) ?? element.contains(target))) return;
        close('outside');
      }),
      on(document, 'keydown', (event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        close('escape');
      }),
      on(window, 'scroll', follow, { capture: true }),
      on(window, 'resize', follow),
    ];
    releaseDocument = () => {
      for (const off of offs) off();
    };
  }

  function open(anchor: DOMRect): void {
    currentAnchor = anchor;
    if (!isVisible) {
      isVisible = true;
      element.hidden = false;
      listenDocument();
    }
    // Сразу — чтобы панель не мелькнула в углу; и ещё раз через кадр, когда
    // подгрузится содержимое, от которого зависит её размер.
    reposition(anchor);
    requestAnimationFrame(() => reposition(anchor));
  }

  function close(reason: PopoverCloseReason = 'api'): void {
    if (!isVisible) return;
    isVisible = false;
    element.hidden = true;
    releaseDocument?.();
    releaseDocument = null;
    options.onClose?.(reason);
  }

  return {
    element,
    body,
    open,
    close,
    reposition,
    get isVisible() {
      return isVisible;
    },
    destroy: () => {
      releaseDocument?.();
      disposer.dispose();
      element.remove();
    },
  };
}
