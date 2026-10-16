export type { RawScene, SceneEditor, SceneEditorContext, SceneEditorFactory } from './types';
export { HistoryStack, cloneScene } from './history';
export { ChangeEmitter, HIT_RADIUS_PX, SketchCanvas, type PointerInfo, type SketchCanvasOptions } from './sketch-canvas';
export { ToolBar, actionButton, propertyField, selectControl, type ToolButton, type ToolBarOptions } from './tool-bar';
export {
  angleBetween,
  angleDegrees,
  distance,
  distanceToSegment,
  fitCircle,
  fitLine,
  fitParabola,
  midpoint,
  nearestOnCircle,
  projectOnSegment,
  recognizeStroke,
  roundPoint,
  roundTo,
  snapToGrid,
  type CircleFit,
  type LineFit,
  type ParabolaFit,
  type RecognizedShape,
} from './geometry-utils';
export { BUILDER_MESSAGES } from './messages';
export { planimetryEditorFactory } from './planimetry-editor';
export { stereometryEditorFactory, projectVertex, unprojectToGround, parseAngleVertices } from './stereometry-editor';
export { STEREOMETRY_MESSAGES } from './stereometry-messages';
export { plotsEditorFactory } from './plots-editor';
export { PLOTS_MESSAGES } from './plots-messages';
export { physicsEditorFactory } from './physics-editor';
export { PHYSICS_BUILDER_MESSAGES } from './physics-messages';
