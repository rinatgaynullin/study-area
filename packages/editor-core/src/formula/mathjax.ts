import { sanitizeSvg } from '../security/sanitize';
import { normalizeMathML } from './mathml';

interface MathJaxDocument {
  convert(input: string, options?: { display?: boolean }): unknown;
}

interface Engine {
  doc: MathJaxDocument;
  outerHTML(node: unknown): string;
  /** Resolves MathJax's dynamic font loading, which it signals by throwing. */
  handleRetriesFor<T>(action: () => T): Promise<T>;
}

let engine: Promise<Engine> | null = null;

/** Rendered SVG by MathML source. Lets `getHTML()` stay synchronous. */
const svgCache = new Map<string, string>();
const pending = new Set<Promise<unknown>>();

const MAX_CACHE_ENTRIES = 500;

/**
 * Builds a MathJax document with the lite adaptor, which has no DOM dependency
 * at all: the same code path runs in the browser, in Node and under jsdom.
 */
async function createEngine(): Promise<Engine> {
  const [{ mathjax }, { MathML }, { SVG }, { liteAdaptor }, { RegisterHTMLHandler }, fontModule] =
    await Promise.all([
      import('@mathjax/src/js/mathjax.js'),
      import('@mathjax/src/js/input/mathml.js'),
      import('@mathjax/src/js/output/svg.js'),
      import('@mathjax/src/js/adaptors/liteAdaptor.js'),
      import('@mathjax/src/js/handlers/html.js'),
      import('@mathjax/mathjax-newcm-font/js/svg.js'),
    ]);

  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);

  const FontClass = (fontModule as Record<string, unknown>).MathJaxNewcmFont as
    | (new () => unknown)
    | undefined;

  const doc = mathjax.document('', {
    InputJax: new MathML({ parseAs: 'html' }),
    OutputJax: new SVG({
      // Inlines glyph paths into every SVG so exported HTML renders standalone.
      fontCache: 'local',
      // A formula is one atomic inline node, so MathJax must not split it into
      // several <svg> roots at its own guessed line width.
      linebreaks: { inline: false, width: '100000em' },
      ...(FontClass ? { font: new FontClass() } : {}),
    }),
  }) as MathJaxDocument;

  return {
    doc,
    outerHTML: (node: unknown) => adaptor.outerHTML(node as never),
    handleRetriesFor: <T,>(action: () => T) =>
      mathjax.handleRetriesFor(action) as unknown as Promise<T>,
  };
}

function getEngine(): Promise<Engine> {
  engine ??= createEngine();
  return engine;
}

/**
 * MathJax wraps its SVG in a custom `<mjx-container>` element. We keep only the
 * `<svg>` (which already carries the vertical-align style) so the result needs
 * no custom-element allowlisting downstream.
 */
function extractSvg(html: string): string {
  const start = html.indexOf('<svg');
  if (start === -1) return '';
  const end = html.lastIndexOf('</svg>');
  if (end === -1) return '';
  return html.slice(start, end + '</svg>'.length);
}

export interface RenderOptions {
  display?: boolean;
}

/** Synchronous cache read used during HTML serialization. */
export function getCachedFormulaSvg(mathml: string): string | undefined {
  return svgCache.get(normalizeMathML(mathml) || mathml);
}

/**
 * Renders MathML to a sanitized, self-contained SVG string. The input is
 * sanitized first, so a hostile `data-mathml` attribute can never reach MathJax.
 *
 * The SVG is sized in `ex` units, so callers scale a formula by changing the
 * font size of its host element rather than re-rendering it.
 */
export async function renderMathML(mathml: string, options: RenderOptions = {}): Promise<string> {
  const safeMathml = normalizeMathML(mathml);
  if (!safeMathml) return '';

  const cached = svgCache.get(safeMathml);
  if (cached !== undefined) return cached;

  const task = (async (): Promise<string> => {
    const instance = await getEngine();

    let svg: string;
    try {
      // Glyphs outside the preloaded font subset (Cyrillic text, rarer
      // operators) make MathJax request an async font load.
      const node = await instance.handleRetriesFor(() =>
        instance.doc.convert(safeMathml, { display: options.display ?? false }),
      );
      svg = sanitizeSvg(extractSvg(instance.outerHTML(node)));
    } catch {
      // A failed render (e.g. a dynamic font chunk that will not load) must not
      // reject: callers show a fallback marker instead of breaking the document.
      return '';
    }

    if (svgCache.size >= MAX_CACHE_ENTRIES) {
      const oldest = svgCache.keys().next();
      if (!oldest.done) svgCache.delete(oldest.value);
    }
    svgCache.set(safeMathml, svg);
    return svg;
  })();

  pending.add(task);
  try {
    return await task;
  } finally {
    pending.delete(task);
  }
}

/** Resolves once every in-flight render has settled, so `getHTML()` sees warm cache. */
export async function whenFormulasReady(): Promise<void> {
  while (pending.size > 0) {
    await Promise.allSettled([...pending]);
  }
}

/** Test seam. */
export function resetMathJax(): void {
  engine = null;
  svgCache.clear();
  pending.clear();
}
