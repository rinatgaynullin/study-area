// Стили карточки едут вместе с документной частью: нужны и вьюеру, и редактору.
import './content.css';
import type { ContentFeature, ContentHydrateContext, SanitizerRules } from '@rich-editor/core/viewer';
import { DRAWINGS_MESSAGES } from './messages';
import { paintDrawingNode } from './paint-drawing';
import { DRAWINGS_FEATURE_ID } from './types';

/**
 * Разметка узлов, которую должен пропускать санитайзер. Серверная копия —
 * `DRAWINGS_ATTRS` в `rich_editor/sanitize.py`; тест контракта сверяет.
 */
export const DRAWINGS_SANITIZER_RULES: SanitizerRules = {
  attributes: ['data-geometry', 'data-geometry-data', 'data-physics', 'data-physics-data', 'data-tikz-code'],
};

export interface DrawingsContentOptions {
  /** Язык заголовков карточек во вьюере: у него нет переводчика редактора. */
  locale?: string;
}

/** Переводчик по таблицам возможности: нужный язык, затем русский, затем ключ. */
const translatorFor = (locale: string) => (key: string): string =>
  DRAWINGS_MESSAGES[locale]?.[key] ?? DRAWINGS_MESSAGES.ru[key] ?? key;

/**
 * Оживляет чертежи в отрисованном документе: SVG рисуется по JSON на месте,
 * в HTML он не хранится. Ничего не вешает, поэтому снимать нечего.
 */
export const hydrateDrawings = (root: HTMLElement, context: ContentHydrateContext, locale = 'ru'): void => {
  const t = translatorFor(locale);

  root.querySelectorAll<HTMLElement>('[data-geometry-data]').forEach((element) => {
    paintDrawingNode(element, 'geometry', element.getAttribute('data-geometry-data') ?? '', {
      scale: context.formulaScale,
      t,
    });
  });

  root.querySelectorAll<HTMLElement>('[data-physics-data]').forEach((element) => {
    paintDrawingNode(element, 'physics', element.getAttribute('data-physics-data') ?? '', {
      scale: context.formulaScale,
      t,
    });
  });
};

/** Документная часть возможности для `createRichContent({ features })` и `<RichContent :features>`. */
export const createDrawingsContent = (options: DrawingsContentOptions = {}): ContentFeature => ({
  id: DRAWINGS_FEATURE_ID,
  sanitize: DRAWINGS_SANITIZER_RULES,
  hydrate: (root, context) => hydrateDrawings(root, context, options.locale ?? 'ru'),
});

/** То же с русскими заголовками. */
export const drawingsContent: ContentFeature = createDrawingsContent();
