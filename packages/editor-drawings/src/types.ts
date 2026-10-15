import type { DrawingKind } from './scene/types';

/** Имена узлов в схеме: по одному на вид чертежа. */
export const GEOMETRY_NODE_NAME = 'geometry';
export const PHYSICS_NODE_NAME = 'physics';

/** Идентификатор возможности и группы её кнопок в тулбаре. */
export const DRAWINGS_FEATURE_ID = 'drawings';

export const nodeNameFor = (kind: DrawingKind): string =>
  kind === 'physics' ? PHYSICS_NODE_NAME : GEOMETRY_NODE_NAME;

/** То, с чем открывается диалог: чертёж из документа или `pos: null` для нового. */
export interface DrawingPayload {
  kind: DrawingKind;
  /** JSON-сцена как строка — ровно то, что лежит в атрибуте узла. */
  data: string;
  tikz: string;
  pos: number | null;
}
