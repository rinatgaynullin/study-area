import { createDisposer, el, on } from './dom';
import type { UiComponent } from './types';

export interface Popover extends UiComponent {
  /** Показывает панель у прямоугольника в координатах вьюпорта. */
  open(anchor: DOMRect): void;
  close(): void;
  readonly isVisible: boolean;
  /** Содержимое панели. Наполняет тот, кто её создал. */
  readonly body: HTMLElement;
  /** Пересчитывает положение — например, после правки текста под ней. */
  reposition(anchor: DOMRect): void;
}

export interface PopoverOptions {
  /** Зазор между якорем и панелью. */
  offset?: number;
  onClose?(): void;
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
    attrs: { role: 'dialog' },
    children: [body],
  });
  element.hidden = true;

  let isVisible = false;
  let currentAnchor: DOMRect | null = null;

  function reposition(anchor: DOMRect): void {
    currentAnchor = anchor;
    if (!isVisible) return;

    const { width, height } = element.getBoundingClientRect();

    // По горизонтали центрируем по якорю, но не даём вылезти за края окна.
    const centred = anchor.left + anchor.width / 2 - width / 2;
    const maxLeft = Math.max(window.innerWidth - width - VIEWPORT_MARGIN, VIEWPORT_MARGIN);
    element.style.left = `${Math.min(Math.max(centred, VIEWPORT_MARGIN), maxLeft)}px`;

    // Снизу, если там есть место; иначе сверху — иначе панель уедет под экран.
    const below = anchor.bottom + offset;
    const fitsBelow = below + height + VIEWPORT_MARGIN <= window.innerHeight;
    element.style.top = `${
      fitsBelow ? below : Math.max(anchor.top - height - offset, VIEWPORT_MARGIN)
    }px`;
  }

  function open(anchor: DOMRect): void {
    currentAnchor = anchor;
    if (!isVisible) {
      isVisible = true;
      element.hidden = false;
    }
    // Ждём кадр: до отрисовки у панели нет размеров, а они нужны для раскладки.
    requestAnimationFrame(() => reposition(anchor));
  }

  function close(): void {
    if (!isVisible) return;
    isVisible = false;
    element.hidden = true;
    options.onClose?.();
  }

  disposer.add(
    on(document, 'mousedown', (event) => {
      const target = event.target as Node | null;
      if (!isVisible || (target && element.contains(target))) return;
      close();
    }),
  );

  disposer.add(
    on(document, 'keydown', (event) => {
      if (!isVisible || event.key !== 'Escape') return;
      event.stopPropagation();
      close();
    }),
  );

  // Якорь двигается вместе с текстом — при скролле и смене размера окна.
  const follow = (): void => {
    if (isVisible && currentAnchor) reposition(currentAnchor);
  };
  disposer.add(on(window, 'scroll', follow, { capture: true }));
  disposer.add(on(window, 'resize', follow));

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
      disposer.dispose();
      element.remove();
    },
  };
}
