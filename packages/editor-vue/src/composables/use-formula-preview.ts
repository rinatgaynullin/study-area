import {
  DEFAULT_FORMULA_FONT_SIZE_PX,
  latexToMathML,
  renderMathML,
} from '@rich-editor/core';
import type { FormulaType } from '@rich-editor/core';

const cache = new Map<string, string>();

/**
 * Renders LaTeX to the same MathJax SVG the document uses, so gallery previews
 * and the live preview match what will actually be inserted.
 */
export async function renderLatexPreview(
  latex: string,
  type: FormulaType = 'math',
  scale = 1,
): Promise<string> {
  const key = `${type}\u0000${scale}\u0000${latex}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  // Unfilled template slots read as "??" once converted; an empty box says
  // "type here", which is what the author actually needs to see.
  const previewLatex = latex.replace(/\\placeholder\{\}/g, '\\square');

  const mathml = await latexToMathML(previewLatex, type);
  if (!mathml) return '';

  const svg = await renderMathML(mathml, {
    fontSizePx: DEFAULT_FORMULA_FONT_SIZE_PX * scale,
  });
  cache.set(key, svg);
  return svg;
}

export function clearPreviewCache(): void {
  cache.clear();
}
