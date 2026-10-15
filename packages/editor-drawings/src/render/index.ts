export {
  DEFAULT_GEOMETRY_SCALE,
  DEFAULT_PHYSICS_SCALE,
  DEFAULT_PLOT_SCALE,
  boundsOf,
  fitViewport,
  project3dToPlane,
  projectOblique,
  rotatePoint3d,
  svgToWorld,
  worldToSvg,
  type Bounds,
  type FitOptions,
  type SvgPoint,
  type Viewport,
} from './coords';
export { latexToPlainText, latexToSvgTspans } from './latex-label';
export { HIGHLIGHT_COLOR, SvgBuilder, escapeXml, fmt, wrapSvg } from './svg-builder';
export {
  collectGeometryPoints,
  renderGeometrySvg,
  resolveGeometryViewport,
  type GeometryRenderOptions,
} from './geometry-svg';
export { collectPhysicsPoints, renderPhysicsSvg, type PhysicsRenderOptions } from './physics-svg';
export { parsePgfplotsTikz } from './pgfplots';
