/**
 * Точка входа вьюера: показать сохранённый документ без редактора.
 *
 * Ни ProseMirror, ни MathLive сюда не попадают — Rollup оставляет только то,
 * до чего дотягиваются эти экспорты. MathJax остаётся ленивым чанком и
 * грузится лишь для формул, пришедших без готового SVG. Документные части
 * химии и чертежей включены по умолчанию: структуры и карточки чертежей
 * дорисовываются по своим данным.
 */
import { createRichContent as createCoreContent, type RichContent, type RichContentOptions } from '@rich-editor/core/viewer';
import { chemistryContent } from '@rich-editor/chemistry/viewer';
import { drawingsContent } from '@rich-editor/drawings/viewer';

export {
  applyTheme,
  DARK_THEME_CLASS,
  prepareIncomingHtml,
  upgradeLegacyHtml,
  type RichContent,
  type RichContentOptions,
  type RichContentUpdate,
  type ContentFeature,
  type ContentHydrateContext,
  type SanitizerRules,
  type EditorTheme,
} from '@rich-editor/core/viewer';
export * from '@rich-editor/chemistry/viewer';
export * from '@rich-editor/drawings/viewer';

/** Документные части, включённые во вьюер по умолчанию. */
export const defaultContentFeatures = () => [chemistryContent, drawingsContent];

/** Вьюер с документными частями PinQueen; `features: []` — только документ. */
export function createRichContent(options: RichContentOptions): RichContent {
  return createCoreContent({ features: defaultContentFeatures(), ...options });
}
