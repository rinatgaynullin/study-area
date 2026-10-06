/**
 * Точка входа вьюера: показать сохранённый документ без редактора.
 *
 * Сюда не попадают ни TipTap, ни MathLive — только вьюер, тема, подготовка
 * HTML, санитайзер и рендер формул (MathJax остаётся ленивым чанком). Стили
 * документа — `@rich-editor/core/viewer.css`; сборка проверяет, что граф
 * импортов этого входа не тянет редактор (scripts/check-viewer.mjs).
 */
import './content.css';

export { createRichContent } from './ui/rich-content';
export type { RichContent, RichContentOptions, RichContentUpdate } from './ui/rich-content';
export { applyTheme, DARK_THEME_CLASS, type EditorTheme } from './ui/theme';
export { prepareIncomingHtml, type PrepareIncomingHtmlOptions } from './prepare-html';
export { upgradeLegacyHtml } from './legacy/upgrade-legacy-html';
export { decodeWirisMathml } from './legacy/decode-wiris-mathml';
export { sanitizeHtml, sanitizeMathML, sanitizeSvg } from './security/sanitize';
export {
  DEFAULT_FORMULA_FONT_SIZE_PX,
  renderMathML,
  whenFormulasReady,
  type RenderOptions,
} from './formula/mathjax';
export { extractFormulaType, isMathMLEmpty, normalizeMathML } from './formula/mathml';
