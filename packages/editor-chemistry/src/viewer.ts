/**
 * Вход для вьюера: документная часть возможности без редактора.
 *
 * Сюда не попадают ни узел TipTap, ни диалог — только правила санитайзера,
 * гидрация и рендер chemfig в SVG. Подключается
 * `createRichContent({ features: [chemistryContent] })`; сборка проверяет,
 * что граф импортов не тянет редактор (scripts/check-dist.mjs).
 */
export {
  CHEMISTRY_NODE_SELECTOR,
  CHEMISTRY_SANITIZER_RULES,
  chemistryContent,
  hydrateChemistry,
} from './chemistry-content';
export { paintChemistryNode, type PaintChemistryOptions } from './paint-chemistry';
export { CHEMISTRY_NODE_NAME, type ChemistryType } from './types';
export * from './chemfig';
