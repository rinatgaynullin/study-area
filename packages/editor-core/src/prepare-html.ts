import { inlineMathMLToFormulaNodes } from './formula/inline-mathml-to-formula-nodes';
import { upgradeLegacyHtml } from './legacy/upgrade-legacy-html';
import { sanitizeHtml } from './security/sanitize';

export interface PrepareIncomingHtmlOptions {
  /** Разбирать разметку старого редактора (Froala + Wiris). */
  legacy?: boolean;
}

/**
 * Санитизирует и поднимает до контрактов узлов HTML, пришедший снаружи.
 *
 * Живёт отдельно от движка: этим же путём входит документ во вьюер, которому
 * ни TipTap, ни ProseMirror не нужны, — и он не должен их тянуть.
 */
export const prepareIncomingHtml = (
  html: string,
  options: PrepareIncomingHtmlOptions = {},
): string => {
  // Legacy-разбор идёт первым: он восстанавливает MathML из `data-mathml`, а
  // дальше формула проходит общий путь `<math>` вместе с остальными.
  const upgraded = options.legacy ? upgradeLegacyHtml(html) : html;

  return sanitizeHtml(inlineMathMLToFormulaNodes(upgraded));
};
