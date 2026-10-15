/**
 * Вход для вьюера: документная часть возможности без редактора.
 *
 * Сюда не попадают ни узлы TipTap, ни диалог, ни TikZ — только правила
 * санитайзера, гидрация, нормализация сцен и рендер в SVG. Подключается
 * `createRichContent({ features: [drawingsContent] })`; сборка проверяет,
 * что граф импортов не тянет редактор (scripts/check-dist.mjs).
 */
export {
  DRAWINGS_SANITIZER_RULES,
  createDrawingsContent,
  drawingsContent,
  hydrateDrawings,
  type DrawingsContentOptions,
} from './drawings-content';
export {
  PREVIEW_HEIGHT,
  PREVIEW_WIDTH,
  paintDrawingNode,
  readScene,
  renderDrawingPreview,
  sceneTitleKey,
  type PaintDrawingOptions,
} from './paint-drawing';
export { DRAWINGS_FEATURE_ID, GEOMETRY_NODE_NAME, PHYSICS_NODE_NAME, nodeNameFor } from './types';
export * from './scene';
export * from './render';
