/** Видимая область доски в пользовательских координатах: левая, верхняя, правая, нижняя границы. */
export type BoundingBox = [left: number, top: number, right: number, bottom: number];

/**
 * Состояние одного подвижного элемента: значение слайдера или координаты точки.
 * Для глайдера координаты проецируются на его кривую при восстановлении.
 */
export type GeometryElementState = { value: number } | { coords: [number, number] };

/** Положения подвижных элементов по именам из скрипта — слой поверх построения. */
export type GeometryState = Record<string, GeometryElementState>;

export interface GeometryAttributes {
  /** Построение на JessieCode — источник истины узла. */
  script: string;
  bbox: BoundingBox;
  /** Высота доски в пикселях; ширина — по контейнеру. */
  height: number;
  /** Куда пользователь сдвинул точки и слайдеры; скрипт при этом не меняется. */
  state: GeometryState;
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

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isElementState = (value: unknown): value is GeometryElementState => {
  if (typeof value !== 'object' || value === null) return false;

  const candidate = value as { value?: unknown; coords?: unknown };

  if (isFiniteNumber(candidate.value)) return true;

  return (
    Array.isArray(candidate.coords)
    && candidate.coords.length === 2
    && candidate.coords.every(isFiniteNumber)
  );
};

/** Разбирает JSON состояния; всё, что не похоже на состояние, отбрасывается. */
export const parseGeometryState = (raw: string | null): GeometryState => {
  if (!raw) return {};

  try {
    const parsed: unknown = JSON.parse(raw);

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};

    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(([, value]) => isElementState(value)),
    ) as GeometryState;
  } catch {
    return {};
  }
};

export const formatGeometryState = (state: GeometryState): string => JSON.stringify(state);

export const isSameGeometryState = (left: GeometryState, right: GeometryState): boolean =>
  formatGeometryState(left) === formatGeometryState(right);
