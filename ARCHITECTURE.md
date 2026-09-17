# Architecture

## Packages

```
packages/editor-core   @rich-editor/core   the editor: engine, schema, plugins and the UI
packages/editor-vue    @rich-editor/vue    thin Vue 3 wrapper: props, v-model, events
apps/demo              demo SPA (Vue) plus vanilla.html, which loads only the core
tests/e2e              Playwright specs for both pages
```

`@rich-editor/core` is the editor. It contains no framework code and assembles
the whole thing — toolbar, editing surface, dialogs, popovers — with one call,
`createRichEditor`. `@rich-editor/vue` is what Vue applications install: a
component that mounts that call and adds what only a framework can, reactive
props, `v-model` and events (ADR 0008).

The split follows one rule: **the UI is built once, on plain DOM, in the core.**
A wrapper for another framework is the same few dozen lines as the Vue one and
cannot drift from it, because it does not rebuild the interface.

```
┌──────────────────────── @rich-editor/vue ────────────────────────┐
│  rich-editor.vue   mounts createRichEditor · props · v-model     │
│  rich-content.vue  read-only viewer                              │
│  styles/index.css  re-exports the core stylesheet                │
└───────────────────────────────┬──────────────────────────────────┘
                                │ createRichEditor
┌───────────────────────────────▼──────────────────────────────────┐
│                       @rich-editor/core                          │
│  ui/              shell · toolbar · dialogs · popovers · presets │
│  editor.ts        TipTap wiring, commands, file routing          │
│  nodes/           formula · audio · attachment (DOM node views)  │
│  formula/         MathML ⇄ LaTeX · MathJax renderer · templates  │
│  media/           upload pipeline · MediaRecorder · text files   │
│  security/        HTML · MathML · SVG sanitizers                 │
│  legacy/          Froala import · Wiris decoder (opt-in)         │
│  i18n/            ru (default) + en, flat lower_snake tables     │
│  styles.css       content styles, theme variables, UI chrome     │
└──────────────────────────────────────────────────────────────────┘
```

## Data flow

### Content in

```
host HTML
  → upgradeLegacyHtml()            Froala/Wiris markup, only when `legacy`
  → inlineMathMLToFormulaNodes()   raw <math> becomes a formula node
  → sanitizeHtml()                 allowlist, schemes, CSS, event handlers
  → ProseMirror parse              node views mount, formulas render
```

Both upgrade steps run **before** sanitization: the MathML they recover has to be
sanitized itself, and some of the source markup would otherwise be stripped
before it could be read.

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
  → onFormulaEdit({ mathml, type, pos })        node view → shell (and the host's callback)
  → ui/dialogs/formula-dialog: mathmlToLatex() → MathLive
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
| Froala compatibility | `legacy/*` + `nodes/legacy-embed.ts` + `legacy.css` | unchanged legacy markup (ADR 0007) |

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

## The UI layer

`ui/` is the editor's interface on plain DOM, with no framework and no
abstraction over the DOM beyond a handful of helpers (`el`, `on`, `icon`).

- **One descriptor per toolbar item.** `ToolbarItemDescriptor` holds the icon,
  label key, command, active and disabled state of an item. The toolbar is
  rendered from a registry of descriptors and a list of ids, so a button is
  defined in one place and the set of buttons is configuration: a preset, an
  explicit group list, extra items, or replacements for built-in ones.
- **Features.** `EditorFeature` bundles schema extensions, toolbar items and
  dialogs for one capability. `createRichEditor` installs the extensions into
  the engine, merges the items into the registry, appends unmentioned items as
  a trailing group, and mounts the dialogs next to the built-in ones.
- **The toolbar measures itself.** Below `collapseBelow` every collapsible group
  goes into the `⋯` menu at once; above it the toolbar folds groups from the
  end one at a time until it no longer wraps, and unfolds them when width
  returns. Buttons prevent `mousedown` default so the document never loses
  focus or selection while the toolbar is used.
- **A status line under the toolbar** shows uploads in flight (from the
  pipeline's `onUpload` events) and the last error for a few seconds, so the
  user learns why a file did not land without the host wiring notifications.
  Hosts with their own notifications pass `statusLine: false`.
- **Dropdown panels are popovers.** A menu is positioned `fixed` next to its
  button, so neither the editor root's `overflow: hidden` nor a short document
  can clip it, and the popover's outside-click, Escape and scroll handling is
  shared rather than duplicated.
- **Overlays stay in the DOM.** Dialogs and popovers are created once and hidden
  with the `hidden` attribute rather than re-created, so they keep no framework
  state and cost nothing while closed. The stylesheet has an explicit rule for
  hidden overlays, because `hidden` alone does not beat `display: flex`.
- **Focus goes back to the document.** A closing modal dispatches
  `rte:modal-close`; the shell handles it and focuses the editor, so keyboard
  actions on the selection keep working after a dialog. A host dialog built
  with `createModal` gets the same behaviour.
- **Labels are read when built.** A locale or message change rebuilds the
  toolbar and the overlays (`setLocale`, `setMessages`, `refreshLabels`);
  closed overlays hold no state, so rebuilding them is cheaper than a reactive
  layer. Dropdown panels are rebuilt on every open so they reflect the current
  selection without tracking state.
- **Hidden means hidden.** Visibility is toggled with the `hidden` attribute,
  and one stylesheet rule (`.rte-root [hidden] { display: none !important }`)
  makes it win over every `display` the UI sets — the browser's own
  `[hidden]` rule would lose to them.

## Upload adapters

`UploadPipeline` validates (kind, size), then either calls the host's adapter or
falls back to `URL.createObjectURL`. Object URLs it creates are tracked and
revoked on `destroy()`, and an in-flight upload is aborted through an
`AbortSignal` when the editor unmounts.

The adapter contract is deliberately minimal — `(file, ctx) => Promise<{ url }>` —
so any storage backend fits without the editor knowing anything about it.

## i18n

A translator over flat `lower_snake` tables. Lookup order: the host's table for
the requested locale → the built-in table for it → the host's Russian → built-in
Russian → the key itself. A partial translation JSON therefore degrades to a
built-in translation rather than to blanks. Keys carry their context as a prefix
(`toolbar_bold`, `formula_title_math`) instead of nesting, so the table stays
flat and hard to duplicate into. Russian and English are bundled;
`apps/demo/src/locales/en.json` demonstrates the file format for another locale.

## Read-only rendering

`createRichContent` (core) loads none of the editing stack: `prepareIncomingHtml`
lives in its own module so the viewer never imports TipTap. It sanitizes the
HTML, renders it, and fills in formulas that arrived with MathML but no SVG. For
documents exported by this editor — which carry their SVG — MathJax never loads
at all. `<RichContent />` is the Vue wrapper: props in, `rendered` out.

## Testing

| Layer | Tool | Covers |
| --- | --- | --- |
| Unit / integration | Vitest + jsdom | MathML round-trip, sanitization, uploads, recorder limits with a mocked `MediaRecorder`, i18n, the whole template catalogue |
| UI shell | Vitest + jsdom | assembly without a framework, read-only mode, locale switching, focus return, features, the recorder dialog at its limits |
| Vue wrapper | Vitest + `@vue/test-utils` | toolbar commands through the component, `v-model`, dialogs, locale switching, read-only viewer |
| End to end | Playwright, desktop + mobile | formula click-to-edit, atomic deletion, export, responsive toolbar; `vanilla.html` proves the core runs with no framework at all |

`npm test` runs the first three; `npm run test:e2e` runs Playwright against the
demo. `npm run ci` runs typecheck, tests and build.

The template test is worth singling out: it renders **every** catalogue entry
through the real MathLive → MathML → MathJax pipeline. It is what caught the
broken arrow commands, the isotope arity bug, the async font loading and the
line-breaking issue described in ADR 0002 and ADR 0003.
