import './styles.css';
import { GeometryBoard } from './geometry-board';
import { parseBoundingBox, parseGeometryState } from './types';

const MOUNTED_ATTRIBUTE = 'data-geometry-mounted';

export interface HydrateGeometryOptions {
  onError?(error: unknown): void;
}

/**
 * Оживляет построения в HTML, показанном без редактора: находит
 * `div[data-geometry]` и поднимает в каждом доску с сохранённым состоянием.
 * Точки можно двигать, но документ при этом не меняется. Возвращает функцию,
 * освобождающую доски.
 */
export const hydrateGeometry = (
  root: ParentNode,
  options: HydrateGeometryOptions = {},
): (() => void) => {
  const boards = [
    ...root.querySelectorAll<HTMLElement>(`div[data-geometry]:not([${MOUNTED_ATTRIBUTE}])`),
  ].map((element) => {
    element.setAttribute(MOUNTED_ATTRIBUTE, 'true');
    element.classList.add('rte-geometry');

    const height = Number.parseInt(element.getAttribute('data-height') ?? '', 10);
    const host = document.createElement('div');

    host.className = 'rte-geometry__board jxgbox';
    host.style.height = `${Number.isFinite(height) && height > 0 ? height : 320}px`;
    element.replaceChildren(host);

    return new GeometryBoard({
      element: host,
      script: element.getAttribute('data-geometry') ?? '',
      bbox: parseBoundingBox(element.getAttribute('data-bbox')),
      state: parseGeometryState(element.getAttribute('data-geometry-state')),
      interactive: true,
      onError: options.onError,
    });
  });

  return () => boards.forEach((board) => board.destroy());
};
