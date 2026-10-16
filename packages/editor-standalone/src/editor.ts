/**
 * Точка входа автономной сборки редактора.
 *
 * Отдаёт то же API, что `@rich-editor/core`, плюс возможности PinQueen
 * (`@rich-editor/chemistry`, `@rich-editor/drawings`) и конвертер текста
 * распознавания (`@rich-editor/ocr`). Два отличия от ядра: шрифты MathLive по
 * умолчанию ищутся в каталоге `fonts/` рядом с этим файлом, а структурные
 * формулы и чертежи включены по умолчанию — хост без бандлера подключает один
 * файл и получает всё.
 */
import {
  createRichEditor as createCoreEditor,
  type RichEditorUi,
  type RichEditorUiOptions,
} from '@rich-editor/core';
import { createChemistryFeature } from '@rich-editor/chemistry';
import { createDrawingsFeature } from '@rich-editor/drawings';

export * from '@rich-editor/core';
export * from '@rich-editor/chemistry';
export * from '@rich-editor/drawings';
export * from '@rich-editor/ocr';

/** Каталог шрифтов MathLive, положенный рядом со сборкой. */
export const MATHLIVE_FONTS_DIRECTORY = new URL(/* @vite-ignore */ 'fonts/', import.meta.url).href;

/** Возможности, включённые в автономную сборку по умолчанию. */
export const defaultFeatures = () => [createChemistryFeature(), createDrawingsFeature()];

/**
 * Редактор с шрифтами MathLive из соседнего каталога и возможностями PinQueen.
 * Явное значение опции главнее: хост, раздающий шрифты сам, передаёт свой путь
 * или `null`; хост, которому нужен только текст, передаёт `features: []`.
 */
export function createRichEditor(options: RichEditorUiOptions): RichEditorUi {
  return createCoreEditor({
    mathliveFontsDirectory: MATHLIVE_FONTS_DIRECTORY,
    features: defaultFeatures(),
    ...options,
  });
}
