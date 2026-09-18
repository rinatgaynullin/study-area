/**
 * Точка входа автономной сборки редактора.
 *
 * Отдаёт то же API, что `@rich-editor/core`, но с одним отличием: шрифты
 * MathLive по умолчанию ищутся в каталоге `fonts/` рядом с этим файлом. Хост
 * без бандлера не подключает `mathlive/fonts.css`, а сами шрифты кладутся в
 * dist скриптом сборки — значит, редактор знает, где они, лучше хоста.
 */
import {
  createRichEditor as createCoreEditor,
  type RichEditorUi,
  type RichEditorUiOptions,
} from '@rich-editor/core';
import '@rich-editor/core/styles.css';

export * from '@rich-editor/core';

/** Каталог шрифтов MathLive, положенный рядом со сборкой. */
export const MATHLIVE_FONTS_DIRECTORY = new URL(/* @vite-ignore */ 'fonts/', import.meta.url).href;

/**
 * Редактор с шрифтами MathLive из соседнего каталога. Явное значение опции
 * главнее: хост, раздающий шрифты сам, передаёт свой путь или `null`.
 */
export function createRichEditor(options: RichEditorUiOptions): RichEditorUi {
  return createCoreEditor({
    mathliveFontsDirectory: MATHLIVE_FONTS_DIRECTORY,
    ...options,
  });
}
