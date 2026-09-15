import { normalizeMathML } from './mathml';
import { extractFormulaType } from './mathml';

/**
 * Rewrites raw `<math>` elements in incoming HTML into the editor's formula
 * node contract, so MathML pasted from another tool survives as an editable
 * formula instead of being stripped by the HTML sanitizer.
 *
 * Runs before `sanitizeHtml`; the MathML itself is sanitized here.
 */
export function inlineMathMLToFormulaNodes(html: string): string {
  if (!html || !/<math[\s>]/i.test(html)) return html;
  if (typeof DOMParser === 'undefined') return html;

  const doc = new DOMParser().parseFromString(html, 'text/html');
  const mathElements = Array.from(doc.querySelectorAll('math'));
  if (mathElements.length === 0) return html;

  for (const element of mathElements) {
    // A nested <math> is already covered by its ancestor's serialization.
    if (element.closest('span[data-formula]')) continue;

    const mathml = normalizeMathML(element.outerHTML);
    const span = doc.createElement('span');

    if (mathml) {
      span.setAttribute('data-formula', 'true');
      span.setAttribute('data-formula-type', extractFormulaType(mathml));
      span.setAttribute('data-mathml', mathml);
      span.setAttribute('contenteditable', 'false');
      span.className = 'rte-formula';
    }

    element.replaceWith(span);
  }

  return doc.body.innerHTML;
}
