/**
 * Точка входа вьюера: показать сохранённый документ без редактора.
 *
 * Ни ProseMirror, ни MathLive сюда не попадают — Rollup оставляет только то,
 * до чего дотягиваются эти экспорты. MathJax остаётся ленивым чанком и
 * грузится лишь для формул, пришедших без готового SVG.
 */
import '@rich-editor/core/styles.css';

export {
  createRichContent,
  applyTheme,
  DARK_THEME_CLASS,
  prepareIncomingHtml,
  upgradeLegacyHtml,
  type RichContent,
  type RichContentOptions,
  type RichContentUpdate,
  type EditorTheme,
} from '@rich-editor/core';
