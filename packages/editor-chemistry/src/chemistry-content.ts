// Стили узла едут вместе с документной частью: нужны и вьюеру, и редактору.
import './content.css';
import type { ContentFeature, ContentHydrateContext, SanitizerRules } from '@rich-editor/core/viewer';
import { paintChemistryNode } from './paint-chemistry';
import { CHEMISTRY_NODE_NAME } from './types';

/**
 * Разметка узла, которую должен пропускать санитайзер. Серверная копия —
 * `CHEMISTRY_ATTRS` в `rich_editor/sanitize.py`; тест контракта сверяет.
 */
export const CHEMISTRY_SANITIZER_RULES: SanitizerRules = {
  attributes: ['data-chemistry', 'data-chemistry-code', 'data-chemistry-type'],
};

/** Селектор узлов структуры: наш экспорт и разметка PinQueen (`span` или `div`). */
export const CHEMISTRY_NODE_SELECTOR = '[data-chemistry-code]';

/**
 * Оживляет структуры в отрисованном документе: SVG рисуется по коду на месте,
 * в HTML он не хранится. Ничего не вешает, поэтому снимать нечего.
 */
export const hydrateChemistry = (root: HTMLElement, context: ContentHydrateContext): void => {
  root.querySelectorAll<HTMLElement>(CHEMISTRY_NODE_SELECTOR).forEach((element) => {
    paintChemistryNode(element, element.getAttribute('data-chemistry-code') ?? '', {
      scale: context.formulaScale,
    });
  });
};

/** Документная часть возможности — для `createRichContent({ features })` и `<RichContent :features>`. */
export const chemistryContent: ContentFeature = {
  id: CHEMISTRY_NODE_NAME,
  sanitize: CHEMISTRY_SANITIZER_RULES,
  hydrate: hydrateChemistry,
};
