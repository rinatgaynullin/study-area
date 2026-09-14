import createDOMPurify from 'dompurify';

type Purifier = ReturnType<typeof createDOMPurify>;

let htmlPurifier: Purifier | null = null;
let mathmlPurifier: Purifier | null = null;
let svgPurifier: Purifier | null = null;

const HTML_TAGS = [
  'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'strong', 'b', 'em', 'i', 'u', 's', 'del', 'ins', 'mark', 'small',
  'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'a', 'span', 'div',
  'img', 'figure', 'figcaption', 'audio', 'source',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
  'sub', 'sup',
  // MathJax output embedded in the document, so a saved formula keeps its
  // rendered form instead of needing MathJax again on the way back in.
  'svg', 'g', 'defs', 'path', 'use', 'rect', 'line', 'circle', 'ellipse',
  'polygon', 'polyline', 'text', 'tspan', 'title',
];

const HTML_ATTRS = [
  'href', 'target', 'rel', 'download', 'src', 'alt', 'title', 'class', 'style',
  'colspan', 'rowspan', 'colwidth', 'span', 'width', 'height',
  'controls', 'preload', 'type', 'lang', 'dir', 'start', 'reversed', 'value',
  // Editor node contracts.
  'data-formula', 'data-formula-type', 'data-mathml',
  'data-audio', 'data-duration', 'data-peaks', 'data-name', 'data-mime',
  'data-attachment', 'data-size', 'data-text-align', 'data-render-host',
  // Attributes carried by the embedded MathJax SVG.
  'viewBox', 'viewbox', 'xmlns', 'xmlns:xlink', 'xlink:href', 'd', 'transform',
  'fill', 'stroke', 'stroke-width', 'focusable', 'role', 'aria-hidden',
  'data-c', 'data-mml-node', 'x', 'y', 'rx', 'ry', 'text-anchor',
  'font-family', 'font-size', 'id',
];

/**
 * MathML element allowlist. `annotation-xml` is deliberately excluded: it can
 * carry `encoding="text/html"` and is the classic MathML mXSS vector. `mglyph`
 * is excluded because it can load external resources.
 */
const MATHML_TAGS = [
  'math', 'semantics', 'annotation',
  'mrow', 'mi', 'mn', 'mo', 'ms', 'mtext', 'mspace',
  'mfrac', 'msqrt', 'mroot', 'mstyle', 'merror', 'mpadded', 'mphantom', 'menclose',
  'msub', 'msup', 'msubsup', 'munder', 'mover', 'munderover', 'mmultiscripts', 'mprescripts', 'none',
  'mtable', 'mtr', 'mtd', 'mlabeledtr', 'maligngroup', 'malignmark', 'mfenced', 'maction',
];

const MATHML_ATTRS = [
  'xmlns', 'display', 'displaystyle', 'scriptlevel', 'mathvariant', 'mathsize',
  'mathcolor', 'mathbackground', 'dir', 'encoding', 'linethickness',
  'stretchy', 'fence', 'separator', 'accent', 'accentunder', 'largeop',
  'movablelimits', 'symmetric', 'minsize', 'maxsize', 'form', 'lspace', 'rspace',
  'width', 'height', 'depth', 'voffset', 'notation', 'open', 'close', 'separators',
  'columnalign', 'rowalign', 'columnlines', 'rowlines', 'columnspacing', 'rowspacing',
  'frame', 'framespacing', 'align', 'columnspan', 'rowspan', 'actiontype', 'selection',
  // Records whether the formula is math or chemistry inside the MathML itself.
  'data-formula-type',
];

const SVG_EXTRA_ATTRS = [
  'viewbox', 'xmlns', 'xmlns:xlink', 'xlink:href', 'href', 'd', 'transform',
  'focusable', 'role', 'aria-hidden', 'data-c', 'data-mml-node', 'data-variant',
  'stroke-width', 'stroke', 'fill', 'font-family', 'font-size', 'text-anchor',
  'x', 'y', 'width', 'height', 'rx', 'ry', 'id', 'class', 'style',
];

/**
 * DOMPurify's default URI allowlist has no `blob:`, which the local (no-adapter)
 * pipeline relies on for images, audio and attachments. Widen it here and let
 * the per-element hook below apply the stricter, element-aware rules.
 */
const ALLOWED_URI_REGEXP =
  /^(?:(?:https?|mailto|tel|ftp|blob|data):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;

/**
 * Schemes accepted in `href`. `data:` is never navigable; `blob:` is, because
 * attachments link to locally created blobs, and blob URLs only ever resolve
 * for the origin that created them.
 */
const SAFE_LINK_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:', 'ftp:', 'blob:']);
/** Schemes we accept in `src` on media elements. */
const SAFE_MEDIA_SCHEMES = new Set(['http:', 'https:', 'blob:']);
const MEDIA_DATA_PREFIX = /^data:(image|audio|video)\//i;

function requireDom(): Window & typeof globalThis {
  if (typeof window === 'undefined' || typeof window.document === 'undefined') {
    throw new Error(
      '[rich-editor] HTML sanitization requires a DOM. Initialize the editor on the client only.',
    );
  }
  return window;
}

function schemeOf(value: string): string | null {
  const match = /^\s*([a-z][a-z0-9+.-]*):/i.exec(value);
  return match ? `${match[1].toLowerCase()}:` : null;
}

function isSafeMediaUrl(value: string): boolean {
  const scheme = schemeOf(value);
  if (scheme === null) return true; // relative URL
  if (SAFE_MEDIA_SCHEMES.has(scheme)) return true;
  return scheme === 'data:' && MEDIA_DATA_PREFIX.test(value.trim());
}

function isSafeLinkUrl(value: string): boolean {
  const scheme = schemeOf(value);
  if (scheme === null) return true; // relative URL or fragment
  return SAFE_LINK_SCHEMES.has(scheme);
}

/** Strips CSS constructs that can fetch or execute (`url()`, `expression()`, `@import`). */
function sanitizeStyleValue(style: string): string {
  return style
    .split(';')
    .map((decl) => decl.trim())
    .filter((decl) => {
      if (!decl) return false;
      const lower = decl.toLowerCase();
      return (
        !lower.includes('url(') &&
        !lower.includes('expression') &&
        !lower.includes('javascript:') &&
        !lower.startsWith('@')
      );
    })
    .join('; ');
}

function getHtmlPurifier(): Purifier {
  if (htmlPurifier) return htmlPurifier;
  const purifier = createDOMPurify(requireDom());
  if (!purifier.isSupported) {
    throw new Error('[rich-editor] DOMPurify is not supported in this environment.');
  }

  purifier.addHook('afterSanitizeAttributes', (node) => {
    if (!(node instanceof Element)) return;

    const href = node.getAttribute('href');
    if (href !== null && !isSafeLinkUrl(href)) node.removeAttribute('href');

    const src = node.getAttribute('src');
    if (src !== null && !isSafeMediaUrl(src)) node.removeAttribute('src');

    const style = node.getAttribute('style');
    if (style !== null) {
      const safe = sanitizeStyleValue(style);
      if (safe) node.setAttribute('style', safe);
      else node.removeAttribute('style');
    }

    // Anchors opening a new tab must not hand the opener over.
    if (node.tagName === 'A' && node.getAttribute('target') === '_blank') {
      node.setAttribute('rel', 'noopener noreferrer');
    }

    // `<use>` may only reference glyphs inside the same SVG, never a document
    // elsewhere — that is the reason DOMPurify excludes the element by default.
    if (node.localName === 'use') {
      for (const attr of ['href', 'xlink:href']) {
        const value = node.getAttribute(attr);
        if (value !== null && !value.startsWith('#')) node.removeAttribute(attr);
      }
    }
  });

  htmlPurifier = purifier;
  return purifier;
}

function getMathmlPurifier(): Purifier {
  if (mathmlPurifier) return mathmlPurifier;
  const purifier = createDOMPurify(requireDom());
  purifier.addHook('afterSanitizeAttributes', (node) => {
    if (node instanceof Element) {
      node.removeAttribute('href');
      node.removeAttribute('xlink:href');
    }
  });
  mathmlPurifier = purifier;
  return purifier;
}

function getSvgPurifier(): Purifier {
  if (svgPurifier) return svgPurifier;
  const purifier = createDOMPurify(requireDom());
  purifier.addHook('afterSanitizeAttributes', (node) => {
    if (!(node instanceof Element)) return;
    for (const attr of ['href', 'xlink:href']) {
      const value = node.getAttribute(attr);
      // MathJax only ever references glyphs inside the same SVG.
      if (value !== null && !value.startsWith('#')) node.removeAttribute(attr);
    }
  });
  svgPurifier = purifier;
  return purifier;
}

/**
 * Sanitizes document HTML on `setHTML` and on paste. Everything outside the
 * editor's own schema allowlist is dropped, including `<script>`, event
 * handlers and non-navigable URL schemes.
 */
export function sanitizeHtml(html: string): string {
  if (!html) return '';
  return getHtmlPurifier().sanitize(html, {
    ALLOWED_TAGS: HTML_TAGS,
    ALLOWED_ATTR: HTML_ATTRS,
    ALLOWED_URI_REGEXP,
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'link', 'meta'],
    KEEP_CONTENT: true,
  });
}

/**
 * Sanitizes a MathML source string. Returns an empty string when the input is
 * not a usable `<math>` document, so callers can reject it as invalid.
 */
export function sanitizeMathML(mathml: string): string {
  if (!mathml) return '';

  // The XHTML parser resolves elements by namespace, so a bare `<math>` would
  // be dropped as an unknown element. Declare the namespace before parsing.
  const namespaced = /^\s*<math\b(?![^>]*\bxmlns=)/i.test(mathml)
    ? mathml.replace(/^\s*<math\b/i, `<math xmlns="http://www.w3.org/1998/Math/MathML"`)
    : mathml;

  // Parsed as HTML, not XHTML: MathLive emits named entities such as `&ne;`,
  // which are undefined in XML and would fail the whole parse.
  const cleaned = getMathmlPurifier().sanitize(namespaced, {
    ALLOWED_TAGS: MATHML_TAGS,
    ALLOWED_ATTR: MATHML_ATTRS,
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['script', 'annotation-xml', 'mglyph'],
  });

  const trimmed = cleaned.trim();
  if (!trimmed.startsWith('<math')) return '';
  return trimmed;
}

/** Sanitizes MathJax SVG output before it is inserted into the document. */
export function sanitizeSvg(svg: string): string {
  if (!svg) return '';
  return getSvgPurifier().sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: false },
    // DOMPurify excludes <use> by default because it can pull in external
    // documents. MathJax needs it to reference its own inlined glyph paths, and
    // the hook above drops any reference that is not a local `#id` fragment.
    ADD_TAGS: ['use'],
    ADD_ATTR: SVG_EXTRA_ATTRS,
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['script', 'foreignObject', 'a', 'image'],
  });
}

/** Test seam: drops cached purifier instances so hooks are re-registered. */
export function resetSanitizers(): void {
  htmlPurifier = null;
  mathmlPurifier = null;
  svgPurifier = null;
}
