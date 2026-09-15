import type { FormulaType } from '../types';
import { sanitizeMathML } from '../security/sanitize';

export const MATHML_NS = 'http://www.w3.org/1998/Math/MathML';
export const TEX_ANNOTATION_ENCODING = 'application/x-tex';

const ANNOTATION_RE =
  /<annotation\b[^>]*encoding\s*=\s*["']application\/x-tex["'][^>]*>([\s\S]*?)<\/annotation>/i;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, '&');
}

/**
 * Wraps MathML body markup into a complete `<math>` document carrying a TeX
 * annotation. The annotation is what makes re-editing lossless: MathLive can
 * export MathML but cannot parse it back, so the LaTeX travels inside the
 * MathML itself, which is exactly what `<semantics>`/`<annotation>` is for.
 */
export function buildMathML(body: string, latex: string, type: FormulaType): string {
  const inner = body.trim().startsWith('<mrow') ? body.trim() : `<mrow>${body.trim()}</mrow>`;
  return (
    `<math xmlns="${MATHML_NS}" display="inline" data-formula-type="${type}">` +
    `<semantics>${inner}` +
    `<annotation encoding="${TEX_ANNOTATION_ENCODING}">${escapeXml(latex)}</annotation>` +
    `</semantics></math>`
  );
}

/** Reads the embedded TeX annotation, if the MathML carries one. */
export function extractTexAnnotation(mathml: string): string | null {
  const match = ANNOTATION_RE.exec(mathml);
  return match ? unescapeXml(match[1]).trim() : null;
}

/** Reads the formula kind recorded on the `<math>` element; defaults to `math`. */
export function extractFormulaType(mathml: string): FormulaType {
  return /data-formula-type\s*=\s*["']chem["']/i.test(mathml) ? 'chem' : 'math';
}

/** Converts LaTeX to a complete annotated MathML document. */
export async function latexToMathML(latex: string, type: FormulaType = 'math'): Promise<string> {
  const trimmed = latex.trim();
  if (!trimmed) return '';
  const { convertLatexToMathMl } = await import('mathlive/ssr');
  const body = convertLatexToMathMl(trimmed);
  if (!body) return '';
  return buildMathML(body, trimmed, type);
}

/**
 * Converts MathML back to LaTeX for the visual editor. Uses the embedded TeX
 * annotation when present (lossless) and falls back to structural conversion
 * for MathML produced elsewhere.
 */
export async function mathmlToLatex(mathml: string): Promise<string> {
  const annotation = extractTexAnnotation(mathml);
  if (annotation) return annotation;

  const { MathMLToLaTeX } = await import('mathml-to-latex');
  try {
    return MathMLToLaTeX.convert(mathml).trim();
  } catch {
    return '';
  }
}

/** Token elements may legitimately contain text; everything else may not. */
const TOKEN_ELEMENTS = new Set(['mi', 'mn', 'mo', 'ms', 'mtext', 'mspace', 'annotation']);

/** Required child counts for MathML layout schemata. */
const ARITY: Record<string, number> = {
  msub: 2,
  msup: 2,
  munder: 2,
  mover: 2,
  mfrac: 2,
  mroot: 2,
  msubsup: 3,
  munderover: 3,
};

function repairElement(element: Element, doc: Document): void {
  if (!TOKEN_ELEMENTS.has(element.localName)) {
    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType !== 3) continue; // not a text node
      const text = (child.textContent ?? '').trim();
      if (!text) {
        child.remove();
        continue;
      }
      // MathLive emits bare operator text inside script elements for some
      // commands (e.g. \longrightarrow); MathJax rejects that outright.
      const operator = doc.createElementNS(MATHML_NS, 'mo');
      operator.textContent = text;
      element.replaceChild(operator, child);
    }
  }

  const arity = ARITY[element.localName];
  if (arity !== undefined) {
    while (element.children.length < arity) {
      element.appendChild(doc.createElementNS(MATHML_NS, 'mrow'));
    }
  }

  for (const child of Array.from(element.children)) repairElement(child, doc);
}

/**
 * Repairs structurally invalid MathML so a bad formula degrades into something
 * renderable instead of throwing inside MathJax. Two real cases this covers:
 * bare operator text nodes inside `<munder>`/`<munderover>`, and script
 * elements that are missing their base.
 */
export function repairMathML(mathml: string): string {
  if (!mathml || typeof DOMParser === 'undefined') return mathml;

  const doc = new DOMParser().parseFromString(mathml, 'text/html');
  const root = doc.querySelector('math');
  if (!root) return mathml;

  repairElement(root, doc);
  return root.outerHTML;
}

/** True when the MathML has no visible content worth inserting. */
export function isMathMLEmpty(mathml: string): boolean {
  if (!mathml.trim()) return true;
  const withoutAnnotation = mathml.replace(ANNOTATION_RE, '');
  const text = withoutAnnotation.replace(/<[^>]*>/g, '').trim();
  return text.length === 0;
}

/**
 * Validates and normalizes MathML arriving from outside (imported HTML, host
 * `insertFormula()` calls). Returns an empty string when it is not usable.
 */
export function normalizeMathML(mathml: string): string {
  const safe = sanitizeMathML(mathml);
  if (!safe || isMathMLEmpty(safe)) return '';
  return repairMathML(safe);
}
