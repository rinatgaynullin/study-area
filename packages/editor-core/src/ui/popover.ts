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
 *
 * Видимость, текущий якорь и подписки на документ и окно — поля; обработчики
 * закрывают панель через `this`, поэтому порядок объявлений не важен.
 */
class PopoverController implements Popover {
  readonly element: HTMLElement;

  readonly body: HTMLElement;

  private readonly disposer = createDisposer();

  private readonly offset: number;

  private isOpen = false;

  private currentAnchor: DOMRect | null = null;

  /** Документ и окно слушаются только пока панель видна. */
  private releaseDocument: Unsubscribe | null = null;

  constructor(private readonly options: PopoverOptions) {
    this.offset = options.offset ?? 8;

    this.body = el('div', { class: 'rte-popover__body' });

    this.element = el('div', {
      class: 'rte-popover',
      attrs: {
        role: options.role ?? 'dialog',
        'aria-labelledby': options.labelledBy ?? null,
        'aria-label': options.label ?? null,
      },
      children: [this.body],
    });

    if (options.className) this.element.classList.add(options.className);

    this.element.hidden = true;
  }

  get isVisible(): boolean {
    return this.isOpen;
  }

  /** Показывает панель у якоря и начинает слушать документ и окно. */
  open(anchor: DOMRect): void {
    this.currentAnchor = anchor;

    if (!this.isOpen) {
      this.isOpen = true;
      this.element.hidden = false;
      this.listenDocument();
    }

    // Сразу — чтобы панель не мелькнула в углу; и ещё раз через кадр, когда
    // подгрузится содержимое, от которого зависит её размер.
    this.reposition(anchor);
    requestAnimationFrame(() => this.reposition(anchor));
  }

  /** Скрывает панель, отпускает документ и окно и сообщает причину наружу. */
  close(reason: PopoverCloseReason = 'api'): void {
    if (!this.isOpen) return;

    this.isOpen = false;
    this.element.hidden = true;
    this.releaseDocument?.();
    this.releaseDocument = null;
    this.options.onClose?.(reason);
  }

  /** Ставит панель под якорь (или над ним), не давая вылезти за края окна. */
  reposition(anchor: DOMRect): void {
    this.currentAnchor = anchor;

    if (!this.isOpen) return;

    const { width, height } = this.element.getBoundingClientRect();

    // По горизонтали центрируем по якорю, но не даём вылезти за края окна.
    const preferred =
      this.options.align === 'start' ? anchor.left : anchor.left + anchor.width / 2 - width / 2;

    const maxLeft = Math.max(window.innerWidth - width - VIEWPORT_MARGIN, VIEWPORT_MARGIN);

    this.element.style.left = `${Math.min(Math.max(preferred, VIEWPORT_MARGIN), maxLeft)}px`;

    // Снизу, если там есть место; иначе сверху — иначе панель уедет под экран.
    const below = anchor.bottom + this.offset;
    const fitsBelow = below + height + VIEWPORT_MARGIN <= window.innerHeight;

    this.element.style.top = `${
      fitsBelow ? below : Math.max(anchor.top - height - this.offset, VIEWPORT_MARGIN)
    }px`;
  }

  destroy(): void {
    this.releaseDocument?.();
    this.disposer.dispose();
    this.element.remove();
  }

  /** Вешает слушатели на документ и окно; снять их — `releaseDocument`. */
  private listenDocument(): void {
    const subscriptions = [
      on(document, 'mousedown', this.onDocumentMousedown),
      on(document, 'keydown', this.onDocumentKeydown),
      on(window, 'scroll', this.onViewportChange, { capture: true }),
      on(window, 'resize', this.onViewportChange),
    ];

    this.releaseDocument = () => {
      subscriptions.forEach((unsubscribe) => unsubscribe());
    };
  }

  /** Клик мимо панели (и мимо того, что опции считают «внутри») закрывает её. */
  private readonly onDocumentMousedown = (event: MouseEvent): void => {
    const target = event.target as Node | null;

    if (target && (this.options.isInside?.(target) ?? this.element.contains(target))) return;

    this.close('outside');
  };

  private readonly onDocumentKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;

    event.stopPropagation();
    this.close('escape');
  };

  /** Якорь двигается вместе с текстом — при скролле и смене размера окна. */
  private readonly onViewportChange = (): void => {
    if (this.currentAnchor) this.reposition(this.currentAnchor);
  };
}

/** Создаёт поповер. Тонкая обёртка над контроллером ради прежнего API. */
export const createPopover = (options: PopoverOptions = {}): Popover =>
  new PopoverController(options);
