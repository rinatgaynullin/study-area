import { sanitizeSvg } from '../security/sanitize';
import { LruCache } from '../utils/lru-cache';
import { normalizeMathML } from './mathml';

interface MathJaxDocument {
  convert(input: string, options?: { display?: boolean }): unknown;
}

interface Engine {
  doc: MathJaxDocument;
  outerHTML(node: unknown): string;
  /** Переводит ex-размеры готового SVG в пиксели. */
  freezeSizeInPixels(node: unknown, pxPerEm: number): void;
  /** Resolves MathJax's dynamic font loading, which it signals by throwing. */
  handleRetriesFor<T>(action: () => T): Promise<T>;
}

/**
 * Отношение x-height к кеглю у шрифта, относительно которого фиксируется
 * размер формулы.
 *
 * Именно так браузер и разрешает `ex`: 1ex — это x-height унаследованного
 * шрифта. Значение измерено у шрифта контента по умолчанию (`--rte-font-family`
 * при `--rte-font-size: 15px`): 1ex = 9px, то есть ровно 0.6.
 *
 * Опция `exFactor` у SVG-вывода тут не помощник: проверено, что она не меняет
 * выдаваемое значение — одна и та же формула отдаёт `1.842ex` и при 0.5, и при
 * 0.7, и при 1.0. Пересчитывать нужно по реальной метрике шрифта.
 */
const REFERENCE_EX_RATIO = 0.6;

/**
 * Кегль, относительно которого фиксируется размер формулы. Совпадает со
 * значением `--rte-font-size` по умолчанию: формула должна читаться вровень с
 * окружающим текстом.
 */
export const DEFAULT_FORMULA_FONT_SIZE_PX = 15;

/**
 * Переводит ex в пиксели тем же способом, каким MathJax их и получил.
 *
 * Это и есть суть правки. MathJax размечает SVG в ex, но браузерный ex
 * считается по x-height унаследованного шрифта и от локального кегля — в
 * ячейке таблицы, в списке, в заголовке он разный. Из-за этого одна и та же
 * формула визуально скачет: измерено 16.6px в абзаце против 29.5px в h1.
 *
 * Коэффициент подобран так, чтобы в обычном абзаце формула осталась ровно
 * того же размера, что и раньше: меняется только независимость от окружения,
 * а не привычный вид. Так же ведёт себя картинка-формула Wiris, у которой px
 * зашиты при генерации.
 */
const exToPx = (ex: number, pxPerEm: number): string =>
  `${Math.round(ex * REFERENCE_EX_RATIO * pxPerEm * 100) / 100}px`;

let engine: Promise<Engine> | null = null;

const MAX_CACHE_ENTRIES = 500;

/** Rendered SVG by MathML source. Lets `getHTML()` stay synchronous. */
const svgCache = new LruCache<string, string>(MAX_CACHE_ENTRIES);
const pending = new Set<Promise<unknown>>();

/**
 * Builds a MathJax document with the lite adaptor, which has no DOM dependency
 * at all: the same code path runs in the browser, in Node and under jsdom.
 */
const createEngine = async (): Promise<Engine> => {
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
    freezeSizeInPixels: (node: unknown, pxPerEm: number) => {
      adaptor.tags(node as never, 'svg').forEach((svg) => {
        (['width', 'height'] as const).forEach((attribute) => {
          const value = String(adaptor.getAttribute(svg, attribute) ?? '');

          if (value.endsWith('ex')) {
            adaptor.setAttribute(svg, attribute, exToPx(Number.parseFloat(value), pxPerEm));
          }
        });

        // Смещение базовой линии живёт в style и страдает ровно так же.
        const verticalAlign = String(adaptor.getStyle(svg, 'vertical-align') ?? '');

        if (verticalAlign.endsWith('ex')) {
          adaptor.setStyle(
            svg,
            'vertical-align',
            exToPx(Number.parseFloat(verticalAlign), pxPerEm),
          );
        }
      });
    },
    handleRetriesFor: <T>(action: () => T) =>
      mathjax.handleRetriesFor(action) as unknown as Promise<T>,
  };
};

const getEngine = (): Promise<Engine> => {
  engine ??= createEngine();

  return engine;
};

/**
 * MathJax wraps its SVG in a custom `<mjx-container>` element. We keep only the
 * `<svg>` (which already carries the vertical-align style) so the result needs
 * no custom-element allowlisting downstream.
 */
const extractSvg = (html: string): string => {
  const start = html.indexOf('<svg');

  if (start === -1) return '';

  const end = html.lastIndexOf('</svg>');

  if (end === -1) return '';

  return html.slice(start, end + '</svg>'.length);
};

export interface RenderOptions {
  display?: boolean;
  /**
   * Кегль в пикселях, относительно которого фиксируется размер формулы.
   * По умолчанию `DEFAULT_FORMULA_FONT_SIZE_PX`.
   */
  fontSizePx?: number;
}

/**
 * Размер запечён в самом SVG, поэтому он часть результата — и часть ключа.
 * Иначе формула, отрисованная для одного кегля, досталась бы другому.
 */
const cacheKey = (mathml: string, fontSizePx: number): string => `${fontSizePx}|${mathml}`;

/** Synchronous cache read used during HTML serialization. */
export const getCachedFormulaSvg = (
  mathml: string,
  fontSizePx: number = DEFAULT_FORMULA_FONT_SIZE_PX,
): string | undefined => svgCache.get(cacheKey(normalizeMathML(mathml) || mathml, fontSizePx));

/**
 * Renders MathML to a sanitized, self-contained SVG string. The input is
 * sanitized first, so a hostile `data-mathml` attribute can never reach MathJax.
 *
 * Размер запекается в SVG в пикселях, поэтому формула выглядит одинаково в
 * абзаце, в ячейке таблицы и в заголовке. Масштаб задаётся `fontSizePx` при
 * рендере, а не кеглем элемента-хоста: пиксели на него не реагируют.
 */
export const renderMathML = async (
  mathml: string,
  options: RenderOptions = {},
): Promise<string> => {
  const safeMathml = normalizeMathML(mathml);

  if (!safeMathml) return '';

  const fontSizePx = options.fontSizePx ?? DEFAULT_FORMULA_FONT_SIZE_PX;
  const key = cacheKey(safeMathml, fontSizePx);

  const cached = svgCache.get(key);

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

      instance.freezeSizeInPixels(node, fontSizePx);
      svg = sanitizeSvg(extractSvg(instance.outerHTML(node)));
    } catch {
      // A failed render (e.g. a dynamic font chunk that will not load) must not
      // reject: callers show a fallback marker instead of breaking the document.
      return '';
    }

    svgCache.set(key, svg);

    return svg;
  })();

  pending.add(task);

  try {
    return await task;
  } finally {
    pending.delete(task);
  }
};

/** Resolves once every in-flight render has settled, so `getHTML()` sees warm cache. */
export const whenFormulasReady = async (): Promise<void> => {
  if (pending.size === 0) return;

  // Ждём текущую партию целиком, а не по одному: пока она рендерится, могут
  // стартовать новые рендеры, поэтому после ожидания множество проверяется заново.
  await Promise.allSettled([...pending]);
  await whenFormulasReady();
};

/** Test seam. */
export const resetMathJax = (): void => {
  engine = null;
  svgCache.clear();
  pending.clear();
};
