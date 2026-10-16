/** Имя узла в схеме и идентификатор возможности. */
export const CHEMISTRY_NODE_NAME = 'chemistry';

/** Язык записи структуры. Пока один: chemfig. */
export type ChemistryType = 'chemfig';

/** То, с чем открывается диалог: структура из документа или `pos: null` для новой. */
export interface ChemistryPayload {
  code: string;
  type: ChemistryType;
  pos: number | null;
}
