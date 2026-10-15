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
