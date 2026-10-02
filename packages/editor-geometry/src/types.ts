/** Видимая область доски в пользовательских координатах: левая, верхняя, правая, нижняя границы. */
export type BoundingBox = [left: number, top: number, right: number, bottom: number];

export interface GeometryAttributes {
  /** Построение на JessieCode — источник истины узла. */
  script: string;
  bbox: BoundingBox;
  /** Высота доски в пикселях; ширина — по контейнеру. */
  height: number;
}

/** С чем открывается диалог: `pos: null` — новая доска, иначе правка существующей. */
export interface GeometryPayload extends GeometryAttributes {
  pos: number | null;
}

export const DEFAULT_BBOX: BoundingBox = [-6, 5, 6, -5];

export const DEFAULT_HEIGHT = 320;

export const parseBoundingBox = (raw: string | null): BoundingBox => {
  const parts = (raw ?? '')
    .split(/[\s,]+/)
    .map(Number)
    .filter((value) => Number.isFinite(value));

  return parts.length === 4 ? (parts as BoundingBox) : [...DEFAULT_BBOX];
};

export const formatBoundingBox = (bbox: BoundingBox): string => bbox.join(' ');
