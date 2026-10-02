# ADR 0009 — Interactive geometry and function graphs are built on JSXGraph

- Status: proposed
- Date: 2026-10-02

## Context

Tasks on the platform need geometric drawings that the reader can act on, not
pictures of them: a function graph that is re-plotted when its formula changes,
points that can be put on the graph or on a figure and dragged along it, and
constructions (segments, circles, polygons, intersections) that stay consistent
while a point moves. The editor today has formulas (ADR 0002–0004), audio and
attachments; it has nothing for a drawing.

The requirements that shape the choice:

- **Points on curves and figures.** A point placed on a graph or on a circle
  must stay on it when dragged and when the underlying object changes.
- **Function-driven graphs.** The graph is described by a formula; editing the
  formula re-plots the graph. Parameters (sliders) must feed into the formula.
- **The core is framework-free.** The interface lives in `@rich-editor/core`
  on plain DOM (ADR 0008); a React-only or Vue-only library would force a
  second implementation of the drawing surface per wrapper.
- **Commercial use.** The platform is a paid product, so the licence must
  permit it without a separate agreement.
- **The HTML contract.** Saved documents are plain HTML that the viewer and the
  Django side read without the editor (ADR 0004). A drawing must be stored as
  data inside that HTML and rendered back from it, and the sanitizer must be
  able to let it through.
- **Accessibility.** The editor is keyboard- and screen-reader-operable; a
  drawing must at least expose its points to the keyboard and name them.
- **Formulas typed by users are untrusted.** The formula of a graph is user
  input; it must never reach `eval` or the DOM.

## Options considered

**JSXGraph** (University of Bayreuth; MIT or LGPL-3.0, dual). A dynamic
geometry and plotting library on plain SVG or canvas with no dependencies,
released regularly (1.13 in 2026). A `glider` is a point bound to a line,
circle, polygon or any curve, including a function graph; it is re-projected
onto the object whenever the object changes. `functiongraph` takes a JavaScript
function or a formula string; the string is parsed by **JessieCode**, the
library's own sandboxed language, where slider names become variables and the
graph is re-plotted on `board.update()`. `JXG.Dump` serializes a construction
to JSON, JavaScript or JessieCode and `board.jc.parse` restores it. Elements
accept `tabIndex` and `aria.label` / `aria.live`, and a focused point moves with
the arrow keys. Ships ESM and TypeScript typings. Reads GeoGebra, Cinderella and
Intergeo files. Cost: about 970 KB of minified JavaScript plus a 5 KB stylesheet.

**CindyJS** (Apache-2.0). Dynamic geometry compatible with Cinderella, driven by
its own CindyScript, with WebGL effects and physics. Strong mathematically, but
the npm package is at 0.0.5 with a 15 MB footprint, the API is script-first
rather than element-first, and the project has far fewer integrators than
JSXGraph; building a node view on it would mean living inside CindyScript.

**Mafs** (MIT). Declarative React components: `Plot.OfX`, `MovablePoint` with a
`constrain` function, transforms, LaTeX labels. Clean and well tested, but it
requires React 18, which the core does not have and the Vue wrapper cannot
provide; there is no notion of "a point on this figure" beyond a hand-written
constraint function.

**function-plot** (MIT, d3). Plots functions, derivatives and secants and
re-plots on new data, but has no draggable or constrained points and no
geometry; it covers one of the two requirements.

**euclid.js** (Mathigon, MIT). Geometry primitives, intersections and SVG or
canvas drawing helpers. A toolkit for writing a geometry engine, not an engine:
interaction, dependency updates, gliders and graphs would be ours to build.

**GeoGebra** and **Desmos**. Both are the richest tools available and both are
excluded on licence grounds: GeoGebra's product is non-commercial unless a
licence is bought (the EUPL covers only the code, not the shipped product),
and the Desmos API is free for non-commercial use only, with the geometry tool
limited to the Enterprise plan.

## Decision

**Geometry and function graphs are implemented on JSXGraph**, as a core
capability alongside formulas, with the same shape as the formula feature:

- **A `geometry` atom node** in the schema. Its source of truth is a
  **JessieCode script** stored in a `data-geometry` attribute of the node's
  `<div>`, together with the viewport (`data-bbox`) and the size. JessieCode is
  chosen over `JXG.Dump` JSON because the dump drops functions, while the
  script keeps a graph's formula as text, is human-readable, and is what the
  library itself can both parse and emit (`Dump.toJessie`).
- **The node view mounts a board lazily.** JSXGraph is loaded on first use, as
  MathJax is (ADR 0003), so documents without drawings pay nothing. The board
  is created with the script, in read-only mode in the viewer and in the
  editor's document, and in interactive mode inside the dialog.
- **Editing happens in a dialog**, as formulas do: a toolbox of constructions
  (point, glider, segment, line, circle, polygon, function graph, slider), a
  formula field for graphs parsed with `board.jc.snippet`, and a live board.
  Saving writes the script back to the node; cancelling discards the board.
- **Exported HTML stays self-contained.** The node also carries the last
  rendered board as a static `<svg>` child, the way formula nodes carry their
  SVG next to the MathML (ADR 0004), so a page without JSXGraph still shows the
  drawing and a page with it replaces the picture by a live board.
- **Untrusted input stays inside JessieCode.** Formulas and scripts are parsed
  by JessieCode only, which has no access to the DOM or to JavaScript globals.
  The sanitizer admits `data-geometry` and `data-bbox` on the node wrapper and
  nothing else; the script length is capped and parse errors are reported
  through `RichEditorError` with a new `invalid-geometry` code, never thrown
  into the document.
- **Accessibility is configured, not added later.** Every user-placed point
  gets `tabIndex` and an `aria.label` that reads its name and coordinates with
  `aria.live: 'polite'`; the board gets a text description (`aria-label` from
  the dialog's caption field). This matches the editor's existing keyboard
  model (roving focus in the toolbar, Enter to edit a node).
- **Styling goes through tokens.** JSXGraph's stylesheet is scoped under
  `.rte-geometry` and its colours are mapped to `--rte-*` tokens so the dark
  theme and forced-colors mode (THEMING.md) apply.

## Consequences

- One more lazy chunk of about 1 MB. Acceptable for the same reason the
  MathJax chunk is: it loads only for documents that contain a drawing, and it
  is cached by the browser.
- A drawing is text in the HTML, so it survives copy-paste between documents,
  diffs well, and can be produced by scripts. The Django package needs no new
  server-side rendering; the sanitizer there must learn the two attributes.
- The dependency is dual-licensed MIT/LGPL; we take it under MIT and record it
  in the third-party notices.
- JSXGraph measures the DOM to lay out text and ticks, so unit tests under jsdom
  can cover the node, the attribute contract, the sanitizer and the dialog's
  state machine, while dragging gliders and keyboard movement are covered by
  Playwright, as the formula dialog already is.
- Authoring is limited to what JessieCode expresses. That is the whole dynamic
  geometry model of the library and more than the tasks require; if a
  construction ever needs plain JavaScript, it does not belong in a document.
- The decision is reversible at the node boundary: the stored script is the
  library's own format, and the viewer's static SVG fallback does not depend on
  the library at all.
