import { sanitizeSvg } from '@rich-editor/core/viewer';
import { chemfigToSvg } from './chemfig';

export interface PaintChemistryOptions {
  /** Масштаб картинки; совпадает с масштабом формул редактора. */
  scale: number;
  /**
   * Имя для читалки. Без него остаётся имя из разметки, а если нет и его —
   * сам код: лучше код, чем «изображение».
   */
  accessibleName?: string;
}

const createRenderHost = (): HTMLElement => {
  const host = document.createElement('span');

  host.className = 'rte-chemistry__render';
  host.setAttribute('data-render-host', 'true');

  return host;
};

/**
 * Рисует структуру внутри элемента узла — одинаково в редакторе и во вьюере.
 *
 * SVG собирается из чисел и экранированных подписей и всё равно проходит
 * `sanitizeSvg`: один путь для всего, что попадает в `innerHTML`. Код, который
 * не разобрать, показывается как есть и помечается классом — документ при
 * этом не теряет ни знака.
 */
export const paintChemistryNode = (
  element: HTMLElement,
  code: string,
  options: PaintChemistryOptions,
): void => {
  element.classList.add('rte-chemistry');

  if (!element.hasAttribute('role')) element.setAttribute('role', 'img');

  if (options.accessibleName !== undefined) {
    element.setAttribute('aria-label', options.accessibleName);
  } else if (!element.hasAttribute('aria-label')) {
    element.setAttribute('aria-label', code);
  }

  const host =
    element.querySelector<HTMLElement>('[data-render-host]') ?? element.appendChild(createRenderHost());

  const svg = chemfigToSvg(code, { scale: options.scale });

  element.classList.toggle('rte-chemistry--invalid', svg === null);

  if (svg === null) host.textContent = code;
  else host.innerHTML = sanitizeSvg(svg);
};
