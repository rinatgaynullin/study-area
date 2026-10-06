/**
 * Точка входа вьюера: `<RichContent />` и ванильный вьюер без редактора.
 * Не тянет ни `<RichEditor />`, ни TipTap. Стили — `@rich-editor/vue/viewer.css`.
 */
export { default as RichContent } from './components/rich-content.vue';

export {
  createRichContent,
  applyTheme,
  DARK_THEME_CLASS,
  prepareIncomingHtml,
  upgradeLegacyHtml,
  type RichContent as RichContentViewer,
  type RichContentOptions,
  type RichContentUpdate,
  type EditorTheme,
} from '@rich-editor/core/viewer';
