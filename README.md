# @rich-editor/vue

Rich text editor with **math and chemistry formulas** (MathML + MathJax), images,
voice messages, text attachments and i18n. A framework-free core with a Vue 3
wrapper. Toolbar and editing feel modelled on Quasar's QEditor; formula editing
modelled on Wiris MathType — built entirely on MIT / Apache-2.0 dependencies.

- **MathML is the canonical format.** Formulas are stored as MathML in the HTML,
  rendered by MathJax, reopened in a visual editor by clicking them, and deleted
  only as a whole.
- **HTML in, HTML out.** `v-model` is a plain HTML string.
- **Framework-free UI.** Toolbar, dialogs and popovers are plain DOM in the core;
  the Vue package is a thin wrapper, and another framework can wrap the same UI.
- **Assembled from features.** Presets, custom toolbar items, or whole features
  (extensions + toolbar items + dialogs) in one declaration.
- **Russian and English built in**, any other locale via a flat JSON table.
- **Restyle without forking** — every value is a CSS variable.

```
packages/editor-core   @rich-editor/core   the editor: engine, schema, plugins and the UI
packages/editor-vue    @rich-editor/vue    Vue 3 wrapper over the core UI  ← install this for Vue
apps/demo                                  runnable demo (Vue page + a no-framework page)
```

> The `@rich-editor` npm scope is a placeholder — rename it before publishing.

## Install

```bash
npm install @rich-editor/vue vue
```

## Quick start

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { RichEditor } from '@rich-editor/vue';
import '@rich-editor/vue/styles.css';

const html = ref('<p>Начните писать…</p>');
</script>

<template>
  <RichEditor v-model="html" />
</template>
```

That is the whole integration. The toolbar, formula editor, recorder and
dialogs come with it.

## Read-only viewer

Use `<RichContent />` to display a saved document. It loads **none** of the
editing stack — no ProseMirror, no MathLive — so it is a fraction of the weight
of the editor.

```vue
<script setup lang="ts">
import { RichContent } from '@rich-editor/vue';
import '@rich-editor/vue/styles.css';

const props = defineProps<{ html: string }>();
</script>

<template>
  <RichContent :html="props.html" />
</template>
```

Documents exported by `<RichEditor />` carry their formula SVG, so MathJax never
loads. Formulas that arrive with only `data-mathml` — for example from a backend
that stores just the source — are rendered on demand.

The viewer, like the editor, is built in the core; without Vue it is one call:

```ts
import { createRichContent } from '@rich-editor/core';

const viewer = createRichContent({ element: document.querySelector('#answer')!, html });
await viewer.update({ html: nextHtml });   // re-sanitizes and re-renders pending formulas
viewer.destroy();
```

| Prop | Type | Default | |
| --- | --- | --- | --- |
| `html` | `string` | `''` | Sanitized before rendering, always |
| `formulaScale` | `number` | `1` | Formula size relative to surrounding text |
| `theme` | `'light' \| 'dark' \| 'auto'` | `'light'` | Built-in dark theme; `auto` follows the system setting |

Emits `rendered` once pending formulas have been drawn.

## `<RichEditor />`

```vue
<RichEditor
  v-model="html"
  locale="ru"
  :messages="messages"
  :upload-image="uploadImage"
  :upload-audio="uploadAudio"
  :upload-file="uploadFile"
  :limits="{ maxAudioDurationSec: 120, maxImageSizeBytes: 5_000_000 }"
  :editable="true"
  toolbar="full"
  placeholder="Начните писать…"
  :formula-scale="1"
  min-height="320px"
  @change="onChange"
  @focus="onFocus"
  @blur="onBlur"
  @error="onError"
  @ready="onReady"
/>
```

### Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `modelValue` | `string` | `''` | Document HTML. Sanitized on the way in |
| `locale` | `string` | `'ru'` | Active locale |
| `messages` | `Record<string, Messages>` | — | Translations by locale |
| `linkStyles` | `LinkStyle[]` | three built-ins | Style choices offered in the link popover |
| `uploadImage` / `uploadAudio` / `uploadFile` | `UploadAdapter` | — | Omit for the local blob-URL pipeline |
| `limits` | `Partial<EditorLimits>` | see below | Size and duration caps |
| `editable` | `boolean` | `true` | `false` hides the toolbar and locks the document |
| `toolbar` | `'full' \| 'standard' \| 'minimal' \| ToolbarGroupConfig[]` | `'full'` | Preset or explicit configuration |
| `toolbarItems` | `Record<string, ToolbarItemDescriptor>` | — | Extra toolbar items on top of the built-in set; read once at creation |
| `features` | `EditorFeature[]` | — | Extra features — extensions, toolbar items, dialogs; read once at creation |
| `placeholder` | `string` | localized | Empty-document hint |
| `formulaScale` | `number` | `1` | Formula size relative to the text |
| `mathliveFontsDirectory` | `string \| null` | `null` | See *Formula fonts* |
| `minHeight` | `string` | `'220px'` | Minimum height of the editing surface |
| `statusLine` | `boolean` | `true` | Line under the toolbar showing uploads in progress and the last error; `false` if the host shows its own notifications |
| `theme` | `'light' \| 'dark' \| 'auto'` | `'light'` | Built-in dark theme; `auto` follows the system setting. See [THEMING.md](THEMING.md) |

### Events

`update:modelValue` · `change` · `focus` · `blur` · `error` (a `RichEditorError`) ·
`upload` (an `UploadEvent`: `kind`, `file`, `phase: 'start' | 'done' | 'failed'`) ·
`ready` (the `RichEditorCore` instance)

### Exposed methods

```ts
const editor = ref<InstanceType<typeof RichEditor>>();

editor.value.getHTML();
editor.value.setHTML('<p>…</p>');
editor.value.getJSON();
editor.value.getText();
editor.value.isEmpty();
editor.value.focus();
editor.value.insertFormula(mathml, 'chem');
await editor.value.whenFormulasReady();  // resolves once formula SVGs are cached
editor.value.editor;                     // the underlying TipTap editor
editor.value.core;                        // the RichEditorCore instance
```

`getHTML()` is synchronous and includes the rendered SVG for every formula that
has been drawn. Await `whenFormulasReady()` first if you are exporting a document
immediately after loading it.

## Toolbar

Everything below is available in v1: **bold, italic, underline, strike,
headings (H1–H6), ordered and unordered lists, blockquote, inline code, code
block, links, tables, text alignment, text colour, highlight, undo/redo, clear
formatting, horizontal rule, subscript, superscript**, plus image, voice message,
text file and formula insertion.

Standard hotkeys come from TipTap: `Ctrl/Cmd+B`, `I`, `U`, `Shift+Ctrl+S`,
`Ctrl+Z` / `Shift+Ctrl+Z`, `Ctrl+Alt+1…6`, `Shift+Ctrl+7/8`, `Shift+Ctrl+B`,
`Ctrl+E`, and so on; `Ctrl/Cmd+K` opens the link dialog. Each button's tooltip
shows its shortcut (`⌘B` on a Mac, `Ctrl+B` elsewhere) and exposes it through
`aria-keyshortcuts`. See [Accessibility](#accessibility) for the keyboard model.

Build a custom toolbar from groups:

```ts
const toolbar = [
  { id: 'format', items: ['bold', 'italic', 'underline'] },
  { id: 'insert', items: ['link', 'image', 'formulaMath'], collapsible: true },
];
```

A `collapsible` group made only of plain buttons folds into a `⋯` menu when the
toolbar is too narrow. Below `collapseBelow` (760 px by default) every such
group folds at once; above it the toolbar measures itself and folds groups one
by one, from the end, until it fits on a single row — so a wide toolbar never
wraps just because a locale has longer labels or a host added a few items.

### Custom items

Item ids are open: the built-in ones are listed above, and you can add your own.
An item is one descriptor — icon, label key, command, active state — so adding a
button does not mean editing several maps:

```ts
import type { ToolbarItemDescriptor } from '@rich-editor/vue';

const toolbarItems: Record<string, ToolbarItemDescriptor> = {
  stamp: {
    id: 'stamp',
    icon: 'check',                 // any name from the built-in icon set
    labelKey: 'my_stamp',          // resolved through the same translator as the rest
    kind: 'button',
    run: ({ editor }) => editor.chain().focus().insertContent('✔ ').run(),
  },
};
```

```vue
<RichEditor :toolbar="[{ id: 'mine', items: ['bold', 'stamp'] }]" :toolbar-items="toolbarItems" />
```

An entry in `toolbarItems` with a built-in id replaces that built-in item, so
the same mechanism re-wires an existing button.

### Features

A feature bundles what one capability needs — schema extensions, toolbar items
and dialogs — in a single declaration, so the editor is assembled from a list of
capabilities rather than patched in several places:

```ts
import type { EditorFeature } from '@rich-editor/vue';

const callout: EditorFeature = {
  id: 'callout',
  // `t` is the editor's translator, available already while extensions are built.
  extensions: ({ t }) => [CalloutNode.configure({ label: t('callout_label') })],
  toolbarItems: () => [
    {
      id: 'callout',
      icon: 'blockquote',
      labelKey: 'callout_label',
      kind: 'button',
      isActive: (editor) => editor.isActive('callout'),
      run: ({ editor }) => editor.chain().focus().toggleCallout().run(),
    },
  ],
};
```

```vue
<RichEditor :features="[callout]" />
```

Items a feature contributes appear as their own group at the end of the toolbar
unless your toolbar configuration places them explicitly. `dialogs(context)` may
return components built with `createModal` or `createPopover`; they are mounted
next to the built-in dialogs and destroyed with the editor. `toolbarItems`
entries take precedence over feature items, so a host can still re-wire a single
button of a feature it did not write.

## Accessibility

The editor is usable with a keyboard alone and announces its state to screen
readers.

**Keyboard.** The toolbar is a single Tab stop, as the ARIA toolbar pattern
prescribes: `Tab` lands on the current button, `←` / `→` move between buttons
(disabled ones are skipped), `Home` / `End` jump to the edges, `Enter` or
`Space` activates a button and returns the caret to the document, `Escape`
returns without doing anything. From the document, `Alt+F10` moves focus into
the toolbar, so you never have to Tab through the page to reach it.

A menu button (heading, alignment, colours, table, file, `⋯`) opens with
`Enter`, `Space` or `↓` (`↑` opens on the last item); inside, `↑` / `↓` move
between items, `Home` / `End` jump to the edges, `Enter` picks, `Escape` closes
and returns focus to the button. The colour palette is a grid: `←` / `→` move
between swatches, `↑` / `↓` between rows.

Inside the document, a formula is selected as a node by the arrow keys and
`Enter` opens its editor. A voice message is a group: `Tab` reaches its play
button and the waveform, which is a slider — `←` / `→` seek by five seconds,
`Home` / `End` jump to the edges, `Escape` returns the caret to the text.

Dialogs trap focus, close on `Escape` and return focus to the document. Text
fields submit on `Enter`. In the formula editor the math/chemistry tabs and the
template categories are ARIA tab lists: `←` / `→` switch them. In the voice
recorder, when the button you pressed gives way to the next phase (`Record` →
`Stop` → `Record again`), focus moves with it. The link popover that follows
the caret does not take focus; `Tab` reaches its fields, `Escape` from a field
returns the caret to the text and keeps the popover away until the caret leaves
the link — `Ctrl/Cmd+K` opens the link dialog instead.

**Screen readers.** The editing surface is a labelled multiline `textbox` with
`aria-placeholder`; pass `ariaLabel` (the `aria-label` prop in Vue) to name it
after the form field it stands for. The toolbar has a name. A formula is an
image named by its LaTeX, in the editor, in the exported HTML and in the
viewer; a voice message is a named group with a slider that reports its
position; an attachment link names both the action and the file. Toggle buttons report their state
through `aria-pressed`; the heading button's current value (`H2`, “Normal
text”) is exposed as its description. Menus are named after their button;
items that reflect the document state are `menuitemradio` (heading level,
alignment, colour) or `menuitemcheckbox` (toggles in the `⋯` menu) with
`aria-checked`. Dialogs are `aria-modal` and labelled by their title; the link
popover is a named dialog. Validation errors are alerts and mark the field
`aria-invalid`. Formula templates are named by their LaTeX; the formula field
is labelled and described by its hint; loading and parse errors are announced.
Uploads and errors are announced through a polite live region (the status
line), which stays in the tree while empty so that announcements are not lost.

Focus is always visible: every control shows a ring (`--rte-focus-ring`). The
editing surface itself shows no ring — the caret is the indicator there.

## Images and links

**Images resize by dragging** any of the four corner handles. The aspect ratio is
always preserved — a picture stretched on one axis is almost always a slipped
mouse rather than an intention. The result is stored as `width`/`height` on the
`<img>`, so it survives export and renders the same in the read-only viewer.

**Links get a popover** when the caret lands inside one: edit the URL, edit the
visible text, pick a style, open the link, or unlink. A popover rather than a
modal, because working on a link is several small edits in a row and the
surrounding paragraph has to stay visible.

Style choices are configurable; each writes a class onto the link mark, so it
survives export and needs no editor to render:

```ts
import type { LinkStyle } from '@rich-editor/vue';

const linkStyles: LinkStyle[] = [
  { labelKey: 'link_style_default', className: '' },
  { labelKey: 'link_style_strong', className: 'rte-link--strong' },
  { labelKey: 'my_brand_style', className: 'brand-link' },
];
```

`labelKey` is resolved through the same translator as the rest of the UI, so a
custom entry needs a matching key in your locale table.

## Upload adapters

Without an adapter, files stay local as object URLs — good for prototypes, gone
on reload. Pass an adapter and the editor hands you the `File`, waits, and
inserts whatever URL you return.

```ts
import type { UploadAdapter } from '@rich-editor/vue';

const uploadImage: UploadAdapter = async (file, ctx) => {
  const body = new FormData();
  body.append('file', file);

  const response = await fetch('/api/uploads', { method: 'POST', body, signal: ctx.signal });
  if (!response.ok) throw new Error('Upload failed');

  const { url } = await response.json();
  return { url, name: file.name, mime: file.type, size: file.size };
};
```

```ts
type UploadAdapter = (file: File, ctx: UploadContext) => Promise<UploadResult>;

interface UploadContext {
  kind: 'image' | 'audio' | 'file';
  signal: AbortSignal;   // aborted if the editor unmounts mid-upload
  t: Translate;          // to localize your own errors
}

interface UploadResult {
  url: string;
  name?: string;
  mime?: string;
  size?: number;
  meta?: Record<string, unknown>;
}
```

Throwing surfaces a localized `upload-failed` error through `@error` and inserts
nothing.

### Limits

```ts
{
  maxAudioDurationSec: 300,
  maxAudioSizeBytes:   10 * 1024 * 1024,
  maxImageSizeBytes:   10 * 1024 * 1024,
  maxFileSizeBytes:     5 * 1024 * 1024,
}
```

A file over the limit is rejected before the adapter is called. The recorder
stops itself at the duration cap.

## Media behaviour

**Images** — file picker, drag & drop, or paste. Inserted as `<img src alt>`.
Resize, crop and caption UI are out of scope for v1.

**Voice messages** — recorded with `MediaRecorder`, with container detection
across WebM/Opus, Ogg, MP4/AAC and MP3. The editor shows a waveform player
(peaks computed live through the Web Audio API, stored in `data-peaks`);
exported HTML carries a native `<audio controls>` so the recording plays
anywhere.

**Text files** — the documented default is an **attachment chip**: the file is
uploaded and inserted as a downloadable `<a download>`. The toolbar's file menu
also offers *«Вставить содержимое как текст»*, which inserts the file's contents
as plain paragraphs. Markdown is **never parsed** — a `.md` file is inserted
exactly as written, `#` and `**` included.

Accepted text types: `.txt`, `.md`, `.markdown`, `.csv`, `.tsv`, `.json`,
`.log`, `.xml`, `.yml`, `.yaml`, plus any `text/*` MIME type.

## Formulas

Insert from the toolbar (math or chemistry), or click any formula to reopen it.
The dialog offers a visual MathLive field, a template gallery organized by
category, and a live preview rendered exactly as it will appear.

Categories: fractions, roots, scripts, sums and products, integrals, limits,
matrices, Greek letters, relations, functions — and for chemistry: reactions,
states, isotopes, common formulas.

Insert programmatically:

```ts
import { latexToMathML } from '@rich-editor/vue';

const mathml = await latexToMathML('2\\mathrm{H}_2+\\mathrm{O}_2\\rightarrow 2\\mathrm{H}_2\\mathrm{O}', 'chem');
editor.value.insertFormula(mathml, 'chem');
```

The stored HTML looks like this — MathML is authoritative, the SVG is the
portable projection:

```html
<span data-formula="true" data-formula-type="chem"
      data-mathml="&lt;math …&gt;…&lt;/math&gt;" contenteditable="false" class="rte-formula">
  <span class="rte-formula__render" data-render-host="true"><svg …>…</svg></span>
</span>
```

### Formula fonts

MathLive needs its fonts. Either let your bundler handle them:

```ts
import 'mathlive/fonts.css';   // Vite/webpack emit the font files
```

or serve them yourself and point the editor at them:

```vue
<RichEditor v-model="html" mathlive-fonts-directory="/fonts/mathlive" />
```

MathJax needs nothing: glyph outlines are inlined into every rendered SVG.

## i18n

Russian and English are built in: `locale="en"` switches the whole UI without any
table. Add another locale by passing a flat JSON table — a **partial** table is
fine, missing keys fall back to Russian.

```vue
<script setup lang="ts">
import en from './locales/en.json';
</script>

<template>
  <RichEditor v-model="html" locale="en" :messages="{ en }" />
</template>
```

```jsonc
{
  "toolbar_bold": "Bold",
  "toolbar_italic": "Italic",
  "toolbar_heading_level": "Heading {level}",
  "formula_title_math": "Math formula",
  "formula_categories_fractions": "Fractions",
  "error_file_too_large": "File “{name}” is too large: {size}. Maximum is {max}."
}
```

`{name}`-style placeholders are interpolated. A table passed for a built-in
locale is merged over it key by key, so `messages: { en: { toolbar_bold: 'Heavy' } }`
changes one string and keeps the rest English. The English bundle is also
exported, as a starting point for another language:

```ts
import { enMessages } from '@rich-editor/vue';
```

Keys are flat and `lower_snake`, prefixed by context: `toolbar_`, `table_`,
`link_`, `color_`, `image_`, `audio_`, `file_`, `formula_`, `error_`, `common_`,
`editor_`. See `apps/demo/src/locales/en.json` for a full example.

## Theming

Every colour, font, radius, shadow and control size resolves through a CSS
variable on `.rte-root` and `.rte-content-root`, so restyling the editor to a
design system is a matter of overriding variables — the stylesheet is never
patched. The defaults follow the umschool design language; a dark theme is the
same variables under a class the host toggles (see the demo's `.demo--dark`).

```css
.rte-root,
.rte-content-root {
  --rte-color-primary: #396fdb;
  --rte-color-bg: #1e1e21;
  --rte-color-text: #eceff4;
  --rte-radius: 6px;
  --rte-font-family: Inter, sans-serif;
}
```

A dark theme is built in: `theme="dark"` (or `'auto'` to follow the system),
or the class `rte-theme-dark` on any ancestor. The full list — what each
variable controls and its default — is in [THEMING.md](THEMING.md). Class hooks
(`.rte-toolbar`, `.rte-btn`, `.rte-modal__panel`, …) are stable for hosts that
need more than variables.

### Legacy content (Froala)

Content saved by a Froala-based editor renders through an opt-in compatibility
layer. It is a separate stylesheet, so a host without legacy data never
downloads it:

```ts
import '@rich-editor/vue/legacy.css';
```

```vue
<RichContent :html="html" legacy />
<RichEditor v-model="html" legacy />
```

`legacy` on `RichEditor` is read once, at construction: the mode changes the
document schema, which cannot be swapped on a live editor. Re-key the component
to switch modes.

Compat rules resolve through the same tokens as everything else — changing
`--rte-color-border` restyles new and legacy tables alike. The variables below
exist only where a Froala construct has no counterpart in the new visual
language; each defaults to a base token unless noted.

| Variable | Default |
| --- | --- |
| `--rte-legacy-image-gap` | `5px` — literal; the new editor has no image gutter |
| `--rte-legacy-image-border-width` | `5px` — literal, same reason |
| `--rte-legacy-image-border-color` | `var(--rte-color-border)` |
| `--rte-legacy-image-shadow` | `var(--rte-shadow)` |
| `--rte-legacy-image-radius` | `var(--rte-radius-lg)` |
| `--rte-legacy-table-header-bg` | `var(--rte-color-subtle-bg)` |
| `--rte-legacy-table-border-color` | `var(--rte-color-border)` |
| `--rte-legacy-table-accent-color` | `var(--rte-color-danger)` |
| `--rte-legacy-table-thick-width` | `2px` — literal; no border-weight scale exists |
| `--rte-legacy-code-bg` | `var(--rte-color-code-bg)` |
| `--rte-legacy-code-border-color` | `var(--rte-color-border)` |
| `--rte-legacy-muted-color` | `var(--rte-color-muted)` |
| `--rte-legacy-rule-color` | `var(--rte-color-text)` |
| `--rte-legacy-marker-bg` | `#ffff00` — literal; Froala's fixed marker colour |
| `--rte-legacy-transparency-opacity` | `0.5` — literal; no counterpart |
| `--rte-legacy-text-spacing` | `1px` — literal; no counterpart |

Stable class hooks for anything variables cannot reach: `.rte-root`,
`.rte-content-root`, `.rte-toolbar`, `.rte-toolbar__group`, `.rte-btn`,
`.rte-btn--active`, `.rte-dropdown__panel`, `.rte-menu__item`,
`.rte-modal__panel`, `.rte-content`, `.rte-formula`, `.rte-audio`,
`.rte-attachment`, `.rte-legacy`, `.rte-legacy-embed`.

## Nuxt / SSR

The editor is client-only: it needs a DOM for ProseMirror, for sanitization and
for MathLive.

```vue
<template>
  <ClientOnly>
    <RichEditor v-model="html" />
  </ClientOnly>
</template>
```

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  css: ['@rich-editor/vue/styles.css'],
  vite: { optimizeDeps: { include: ['mathlive'] } },
});
```

`<RichContent />` is safe to place anywhere: it renders an empty shell on the
server and fills it on hydration.

## Security

All content entering the document is sanitized — `setHTML`, the initial value,
`v-model` updates and paste alike. `<script>`, event handlers, `javascript:`,
`iframe`/`object`/`form`, and CSS `url()` / `expression()` are removed.
`data:` URLs are accepted on media elements only, never on links. Formula MathML
is sanitized separately, with `annotation-xml` — the classic MathML mXSS vector —
forbidden outright, and MathJax's SVG output is sanitized before insertion.

Details and rationale: [ADR 0004](docs/adr/0004-formula-html-contract.md).

## Using the core without Vue

The whole editor — toolbar, dialogs, popovers — is built in `@rich-editor/core`
on plain DOM. Any page or framework can mount it:

```ts
import { createRichEditor } from '@rich-editor/core';
import '@rich-editor/core/styles.css';

const editor = createRichEditor({
  element: document.querySelector('#editor')!,
  content: '<p>Привет</p>',
  toolbar: 'standard',
  onChange: (html) => console.log(html),
});

editor.core.getHTML();
editor.setLocale('en');
editor.destroy();
```

`createRichEditor` takes the same options as the Vue component's props —
`toolbar`, `toolbarItems`, `features`, `linkStyles`, `limits`, the upload
adapters — plus the core callbacks (`onChange`, `onError`, …). The Vue package is
exactly this call wrapped in a component; a wrapper for another framework is the
same few dozen lines. `npm run dev` serves it at `/vanilla.html`.

For a headless integration — your own UI on top of the engine — use
`RichEditorCore` directly:

```ts
import { RichEditorCore } from '@rich-editor/core';

const core = new RichEditorCore({
  element: document.querySelector('#editor')!,
  content: '<p>Привет</p>',
  onChange: (html) => console.log(html),
  onFormulaEdit: (payload) => openYourOwnDialog(payload),
});
```

The schema, node views, sanitization, formula pipeline, uploads and recorder work
the same either way.

## Development

```bash
npm install
npm run dev          # demo at http://localhost:5173, no-framework page at /vanilla.html
npm test             # unit, integration and component tests
npm run test:e2e     # Playwright, desktop + mobile
npm run build        # build both packages
npm run ci           # typecheck + test + build
```

CI runs typecheck, the tests and both Playwright projects on every pull request
(`.github/workflows/ci.yml`).

### Publishing the demo

`.github/workflows/pages.yml` builds `apps/demo` and publishes it to GitHub
Pages on every push to `main`, or on demand through *Run workflow*. Two
prerequisites: **Settings → Pages → Source: GitHub Actions**, and — for a
private repository — a plan that includes Pages (Pro, Team or Enterprise).
Note that a published Pages site is publicly reachable.

A project site is served from `/<repo>/`, so the workflow passes that prefix to
the build as `DEMO_BASE`, which the demo's Vite config maps to `base`. It is
unset locally, which keeps `npm run dev` and the Playwright suite on `/`.

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) — package split, data flow, plugin boundaries
- [THEMING.md](THEMING.md) — every CSS variable, what it controls, its default
- [LIMITATIONS.md](LIMITATIONS.md) — what v1 does not do, and why
- [CHANGELOG.md](CHANGELOG.md) — what changed, including breaking changes
- [docs/adr/](docs/adr/) — the decisions and their trade-offs

## Dependencies and licences

| Package | Licence | Why |
| --- | --- | --- |
| `@tiptap/*`, `prosemirror-*` | MIT | Editor engine and schema |
| `mathlive` | MIT | Visual formula input, LaTeX → MathML |
| `mathml-to-latex` | MIT | MathML → LaTeX for formulas authored elsewhere |
| `@mathjax/src`, `@mathjax/mathjax-newcm-font` | Apache-2.0 | MathML → SVG rendering |
| `dompurify` | MPL-2.0 OR Apache-2.0 | Sanitization |
| `vue` | MIT | Peer dependency |

All MIT/Apache-2.0 compatible. The commercial Wiris SDK is not used.

## Licence

MIT
