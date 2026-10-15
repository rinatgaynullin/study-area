export { createDrawingsFeature, type DrawingsFeatureOptions } from './drawings-feature';
export { GeometryNode, PhysicsNode, createDrawingNode, type DrawingOptions } from './drawing-node';
export { DEFAULT_SCENE_EDITORS, createDrawingDialog, type DrawingDialogOptions } from './drawing-dialog';
export * from './builders';
export { DRAWINGS_MESSAGES } from './messages';
export { DRAWING_TEMPLATES, type DrawingTemplate } from './templates';
export {
  DRAWINGS_FEATURE_ID,
  GEOMETRY_NODE_NAME,
  PHYSICS_NODE_NAME,
  nodeNameFor,
  type DrawingPayload,
} from './types';
export * from './tikz';

// Документная часть и рендер — то же, что отдаёт вход `./viewer`.
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
export * from './scene';
export * from './render';
