/**
 * Мелкие помощники для сборки разметки на голом DOM.
 *
 * UI редактора написан без фреймворка, чтобы им можно было пользоваться из
 * любого окружения, а обёртки под фреймворки оставались тонкими. Эти функции
 * убирают многословность `createElement` + присваивания свойств, не заводя
 * собственного слоя абстракции поверх DOM.
 */
import { ICONS } from './icons';

export interface ElementOptions {
  class?: string;
  text?: string;
  html?: string;
  attrs?: Record<string, string | number | boolean | null | undefined>;
  children?: Array<Node | null | undefined>;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElementOptions = {},
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);

  if (options.class) element.className = options.class;
  if (options.text !== undefined) element.textContent = options.text;
  if (options.html !== undefined) element.innerHTML = options.html;

  for (const [name, value] of Object.entries(options.attrs ?? {})) {
    // false и null означают «атрибута нет», а не «атрибут со строкой false».
    if (value === null || value === undefined || value === false) continue;
    element.setAttribute(name, value === true ? '' : String(value));
  }

  for (const child of options.children ?? []) {
    if (child) element.appendChild(child);
  }

  return element;
}

/** Иконка из собственного набора. Разметка своя, не пользовательская. */
export function icon(name: string, size = 20): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'rte-icon');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  // Имя иконки на элементе: так её можно не пересоздавать, если не менялась.
  svg.setAttribute('data-icon', name);
  svg.innerHTML = ICONS[name] ?? '';
  return svg;
}

/** Функция снятия слушателя — так подписки удобно складывать в один список. */
export type Unsubscribe = () => void;

export function on<K extends keyof HTMLElementEventMap>(
  target: HTMLElement | Document | Window,
  type: K,
  listener: (event: HTMLElementEventMap[K]) => void,
  options?: AddEventListenerOptions,
): Unsubscribe;
/** Перегрузка для собственных событий компонентов — их нет в карте DOM. */
export function on(
  target: HTMLElement | Document | Window,
  type: string,
  listener: (event: Event) => void,
  options?: AddEventListenerOptions,
): Unsubscribe;
export function on(
  target: HTMLElement | Document | Window,
  type: string,
  listener: (event: never) => void,
  options?: AddEventListenerOptions,
): Unsubscribe {
  target.addEventListener(type, listener as EventListener, options);
  return () => target.removeEventListener(type, listener as EventListener, options);
}

/** Собирает отписки, чтобы уничтожение компонента было одной строкой. */
export function createDisposer(): { add: (off: Unsubscribe) => void; dispose: () => void } {
  const items: Unsubscribe[] = [];
  return {
    add: (off) => items.push(off),
    dispose: () => {
      while (items.length > 0) items.pop()?.();
    },
  };
}
