# Architecture

## Packages

```
packages/editor-core   @rich-editor/core   framework-agnostic engine, schema, plugins
packages/editor-vue    @rich-editor/vue    the public Vue 3 components (main entry point)
apps/demo              demo SPA
tests/e2e              Playwright specs
```

`@rich-editor/vue` is what applications install. `@rich-editor/core` is a real
package, not an internal folder: it contains no Vue and can drive an editor on
its own.

The split follows one rule: **anything that must work without Vue lives in the
core.** That includes the document schema, the node views, sanitization, the
MathML/MathJax pipeline, upload handling, the recorder and i18n. Vue owns the
toolbar, the dialogs and the reactive bindings.

```
┌──────────────────────── @rich-editor/vue ────────────────────────┐
│  RichEditor.vue          RichContent.vue     (public components) │
│  EditorToolbar  dialogs (link, table, formula, recorder)         │
│  composables: i18n binding, toolbar state, formula previews      │
│  styles/index.css — the single stylesheet, theme variables       │
└───────────────────────────────┬──────────────────────────────────┘
                                │ RichEditorCore
┌───────────────────────────────▼──────────────────────────────────┐
│                       @rich-editor/core                          │
│  editor.ts        TipTap wiring, commands, file routing          │
│  nodes/           formula · audio · attachment (DOM node views)  │
│  formula/         MathML ⇄ LaTeX · MathJax renderer · templates  │
│  media/           upload pipeline · MediaRecorder · text files   │
│  security/        HTML · MathML · SVG sanitizers                 │
│  i18n/            ru (default) + en, dot-path translator         │
└──────────────────────────────────────────────────────────────────┘
```

## Data flow

### Content in

```
host HTML
  → inlineMathMLToFormulaNodes()   raw <math> becomes a formula node
  → sanitizeHtml()                 allowlist, schemes, CSS, event handlers
  → ProseMirror parse              node views mount, formulas render
```

The same path runs for `setHTML()`, for the initial `content`, and for
`transformPastedHTML`, so there is exactly one way content enters the document.

### Content out

```
ProseMirror serialize
  → formula renderHTML reads the SVG cache
  → HTML string with MathML in data-mathml and SVG in the render host
```

`getHTML()` is synchronous. The SVG comes from a module-level cache that node
views populate as they paint; `whenFormulasReady()` awaits any in-flight render
for callers that need the guarantee (an export button, a save handler).

### A formula, end to end

```
toolbar / click on formula
  → onFormulaEdit({ mathml, type, pos })        core → host
  → FormulaDialog: mathmlToLatex() → MathLive
  → save: latexToMathML() → annotated MathML
  → insertFormula() / updateFormulaAt()
  → node view: renderMathML() → sanitized SVG → render host
```

## Plugin boundaries

| Plugin | Module | Document shape |
| --- | --- | --- |
| Text formatting | TipTap StarterKit + text-style, highlight, sub/superscript, text-align | standard HTML |
| Table | `@tiptap/extension-table` | `<table>` |
| Link | StarterKit link | `<a href rel>` |
| Image | `@tiptap/extension-image` | `<img src alt>` |
| Audio recorder | `nodes/audio.ts` + `media/recorder.ts` | `div[data-audio] > audio[controls]` |
| Text attachment | `nodes/attachment.ts` | `div[data-attachment] > a[download]` |
| Formula | `nodes/formula.ts` + `formula/*` | `span[data-formula]` (ADR 0004) |

Every media node exports markup that still works outside the editor: the audio
block carries a native `<audio controls>`, the attachment a real `<a download>`.
Inside the editor, node views replace them with richer UI.

## Node views are plain DOM

The formula and audio node views are written with `document.createElement`, not
Vue. This keeps the core usable without Vue, avoids making consumers register
custom elements, and sidesteps the lifecycle mismatch between a framework's
renderer and ProseMirror's.

They are also where two browser realities are handled:

- The formula opens on **`mousedown`**, not `click`. ProseMirror re-renders the
  node view when the atom becomes selected, so `mouseup` can land on a different
  element and no `click` event is dispatched at all.
- `ignoreMutation: () => true`, because the asynchronously injected SVG is not
  part of the ProseMirror document and must not be read back as an edit.

## Upload adapters

`UploadPipeline` validates (kind, size), then either calls the host's adapter or
falls back to `URL.createObjectURL`. Object URLs it creates are tracked and
revoked on `destroy()`, and an in-flight upload is aborted through an
`AbortSignal` when the editor unmounts.

The adapter contract is deliberately minimal — `(file, ctx) => Promise<{ url }>` —
so any storage backend fits without the editor knowing anything about it.

## i18n

A dot-path translator with a three-step fallback: requested locale → built-in
Russian → the key itself. A partial translation JSON therefore degrades to
Russian rather than to blanks. Russian is bundled; English ships as an optional
export and as `apps/demo/src/locales/en.json` demonstrating the file format.

## Read-only rendering

`<RichContent />` loads none of the editing stack. It sanitizes the HTML,
renders it, and fills in formulas that arrived with MathML but no SVG. For
documents exported by this editor — which carry their SVG — MathJax never
loads at all.

## Testing

| Layer | Tool | Covers |
| --- | --- | --- |
| Unit / integration | Vitest + jsdom | MathML round-trip, sanitization, uploads, recorder limits with a mocked `MediaRecorder`, i18n, the whole template catalogue |
| Component | Vitest + `@vue/test-utils` | toolbar commands, `v-model`, dialogs, locale switching, read-only viewer |
| End to end | Playwright, desktop + mobile | formula click-to-edit, atomic deletion, export, responsive toolbar |

`npm test` runs the first three; `npm run test:e2e` runs Playwright against the
demo. `npm run ci` runs typecheck, tests and build.

The template test is worth singling out: it renders **every** catalogue entry
through the real MathLive → MathML → MathJax pipeline. It is what caught the
broken arrow commands, the isotope arity bug, the async font loading and the
line-breaking issue described in ADR 0002 and ADR 0003.
