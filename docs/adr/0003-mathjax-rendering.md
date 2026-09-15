# ADR 0003 — Rendering: MathJax 4 to SVG, through the lite adaptor

- Status: accepted
- Date: 2026-09-14

## Context

Formulas must render as MathJax output and appear in the document as a visual
representation. The render has to work in the editor, in the read-only viewer,
in exported HTML, and under jsdom so tests can assert on it.

## Decision

Use **`@mathjax/src` 4.x** (Apache-2.0) with:

- **MathML input jax** — our source of truth is MathML, so no TeX input is
  involved at render time.
- **SVG output jax** with `fontCache: 'local'` — every SVG inlines the glyph
  outlines it uses, so exported HTML renders standalone with no MathJax, no font
  files and no network.
- **`liteAdaptor`** — MathJax's DOM-free adaptor. The same code path runs in the
  browser, in Node and under jsdom; rendering is a pure `string → string`
  function with no document dependency. This is what lets the framework-agnostic
  core stay framework-agnostic and the tests stay fast.

We deliberately chose v4 (`@mathjax/src`) over v3 (`mathjax-full`), which is
deprecated and pulls in `@xmldom/xmldom` — a package with known security issues —
through its MathML parsing path.

### Three things v4 forced on us

1. **Fonts load asynchronously.** Glyphs outside the preloaded subset (Cyrillic
   text, rarer operators such as `⟂`) make MathJax *throw* a retry signal rather
   than return. Conversion goes through `mathjax.handleRetriesFor()`, which
   awaits the font load.
2. **Automatic line breaking is on.** With no layout to measure, MathJax guessed
   a narrow line and split one formula into several sibling `<svg>` roots. Since
   a formula is a single atomic inline node, breaking is disabled
   (`linebreaks: { inline: false }`). A test asserts one SVG root per formula.
3. **`scale` does not affect the SVG.** MathJax applies it to the
   `<mjx-container>` wrapper, which we drop. Because the SVG is sized in `ex`
   units, scaling is instead a `font-size` on the render host — which scales
   dimensions *and* baseline offset correctly, and lets one cached render serve
   every scale.

## Caching

Renders are cached by MathML source in `packages/editor-core/src/formula/mathjax.ts`.
This is what allows `getHTML()` to stay synchronous while still embedding the
SVG: node views populate the cache as they paint, and `whenFormulasReady()`
awaits any in-flight render for callers that need a guarantee.

A render that fails resolves to an empty string rather than rejecting, so one
unrenderable formula cannot break a document.

## Consequences

- The MathJax SVG output jax is a ~965 KB lazily-loaded chunk (~250 KB gzipped
  in practice). It loads on first formula render and never on documents without
  formulas.
- Exported HTML is larger — roughly 3–4 KB per distinct formula — in exchange
  for being self-contained.
- Rendered SVG is sanitized before insertion (see ADR 0004).
