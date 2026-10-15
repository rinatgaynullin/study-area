export { createChemistryFeature, type ChemistryFeatureOptions } from './chemistry-feature';
export { ChemistryNode, type ChemistryOptions } from './chemistry-node';
export { createChemistryDialog, type ChemistryDialogOptions } from './chemistry-dialog';
export { CHEMISTRY_MESSAGES } from './messages';
export { CHEMISTRY_TEMPLATES, type ChemistryTemplate } from './templates';
export { CHEMISTRY_NODE_NAME, type ChemistryPayload, type ChemistryType } from './types';

// Документная часть и рендер — то же, что отдаёт вход `./viewer`.
export {
  CHEMISTRY_NODE_SELECTOR,
  CHEMISTRY_SANITIZER_RULES,
  chemistryContent,
  hydrateChemistry,
} from './chemistry-content';
export { paintChemistryNode, type PaintChemistryOptions } from './paint-chemistry';
export * from './chemfig';
