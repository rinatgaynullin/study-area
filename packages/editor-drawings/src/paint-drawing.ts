import { sanitizeSvg } from '@rich-editor/core/viewer';
import { renderGeometrySvg } from './render/geometry-svg';
import { renderPhysicsSvg } from './render/physics-svg';
import { parseSceneJson } from './scene/json';
import { hasDrawableContent, normalizeGeometryScene, normalizePhysicsScene } from './scene/normalize';
import type { DrawingKind, GeometryScene, PhysicsScene } from './scene/types';

/** Размер превью в узле и во вьюере — как карточка PinQueen. */
export const PREVIEW_WIDTH = 340;
export const PREVIEW_HEIGHT = 300;

/** Подписи, которые нужны отрисовке узла: заголовок по типу сцены и плейсхолдер. */
export interface DrawingLabels {
  (key: string): string;
}

export interface PaintDrawingOptions {
  /** Масштаб превью; совпадает с масштабом формул редактора. */
  scale: number;
  /** Переводчик; без него заголовки берутся из русской таблицы. */
  t?: DrawingLabels;
  /** Имя для читалки; без него остаётся имя из разметки, а если нет и его — заголовок. */
  accessibleName?: string;
}

/** Ключ заголовка карточки по содержимому сцены. */
export const sceneTitleKey = (kind: DrawingKind, scene: GeometryScene | PhysicsScene): string => {
  if (scene.type === 'physics') {
    const types = new Set(scene.elements.map((element) => element.type));
    const has = (...names: string[]): boolean => names.some((name) => types.has(name as never));

    if (has('thermo_axes', 'thermo_point', 'thermo_process', 'piston_vessel')) return 'drawings_scene_thermo';

    if (has('circuit_component', 'charge', 'field_line', 'capacitor_plate', 'current_conductor')) {
      return 'drawings_scene_circuit';
    }

    if (has('lens', 'mirror', 'ray', 'optics_arrow', 'prism', 'glass_slab')) return 'drawings_scene_optics';

    if (has('surface', 'block', 'spring', 'rope', 'vector', 'stickman', 'balloon')) return 'drawings_scene_mechanics';

    return 'drawings_scene_physics';
  }

  if (kind === 'physics') return 'drawings_scene_physics';

  if (scene.type === '3d') return 'drawings_scene_3d';

  return scene.type === 'plot_2d' ? 'drawings_scene_plot' : 'drawings_scene_2d';
};

/** Разбирает и нормализует сцену нужного вида; `null`, если это не JSON. */
export const readScene = (kind: DrawingKind, data: string): GeometryScene | PhysicsScene | null => {
  const raw = parseSceneJson(data);

  if (raw === null) return null;

  return kind === 'physics' ? normalizePhysicsScene(raw) : normalizeGeometryScene(raw);
};

/** SVG превью сцены или `null`, если рисовать нечего. */
export const renderDrawingPreview = (
  kind: DrawingKind,
  scene: GeometryScene | PhysicsScene,
  scale = 1,
): string | null => {
  if (!hasDrawableContent(scene)) return null;

  const width = Math.round(PREVIEW_WIDTH * scale);
  const height = Math.round(PREVIEW_HEIGHT * scale);

  return scene.type === 'physics'
    ? renderPhysicsSvg(scene, { width, height, autoFit: true })
    : renderGeometrySvg(scene, { width, height, autoFit: true });
};

const ensureChild = (element: HTMLElement, className: string, tag: 'div' | 'span' = 'div'): HTMLElement => {
  const existing = element.querySelector<HTMLElement>(`:scope > .${className}`);

  if (existing) return existing;

  const child = document.createElement(tag);

  child.className = className;
  element.appendChild(child);

  return child;
};

/**
 * Рисует карточку чертежа внутри элемента узла — одинаково в редакторе и во
 * вьюере: заголовок по типу сцены и превью. SVG собран из чисел и
 * экранированных подписей и всё равно проходит `sanitizeSvg`. Битый JSON
 * или пустая сцена — плейсхолдер, документ при этом не теряет ни байта.
 */
export const paintDrawingNode = (
  element: HTMLElement,
  kind: DrawingKind,
  data: string,
  options: PaintDrawingOptions,
): void => {
  const t = options.t ?? ((key: string) => key);

  element.classList.add('rte-drawing', `rte-drawing--${kind}`);

  if (!element.hasAttribute('role')) element.setAttribute('role', 'img');

  const scene = readScene(kind, data);
  const titleKey = scene ? sceneTitleKey(kind, scene) : kind === 'physics' ? 'drawings_scene_physics' : 'drawings_scene_2d';
  const title = t(titleKey);

  if (options.accessibleName !== undefined) {
    element.setAttribute('aria-label', options.accessibleName);
  } else if (!element.hasAttribute('aria-label')) {
    element.setAttribute('aria-label', title);
  }

  const header = ensureChild(element, 'rte-drawing__title');
  const preview = ensureChild(element, 'rte-drawing__preview');

  header.textContent = title;
  preview.setAttribute('data-render-host', 'true');

  const svg = scene ? renderDrawingPreview(kind, scene, options.scale) : null;

  element.classList.toggle('rte-drawing--empty', svg === null);
  element.classList.toggle('rte-drawing--invalid', scene === null);

  if (svg === null) {
    preview.textContent = t(scene === null ? 'drawings_invalid' : 'drawings_placeholder');
  } else {
    preview.innerHTML = sanitizeSvg(svg);
  }
};
