# Limitations of v1

What this release does not do, and why. Everything here is a deliberate scope
decision or a documented upstream constraint — not an unknown.

## Chemistry: equations, not structures

**Shipped:** element symbols, counts, charges, states `(s)/(l)/(g)/(aq)`,
isotopes with prescripts, reaction arrows (including `→` with a label above),
and a catalogue of common formulas. All stored as MathML, all rendered by
MathJax, all re-editable.

**Not shipped:** structural drawing — benzene rings, bond lines,
stereochemistry. The credible open-source options (Ketcher, JSME, RDKit.js)
model molecules as MOL or SMILES, which MathML cannot express and MathJax cannot
render. Supporting it means a second storage format, a second editor and a
second render path — a separate feature, not a variation on this one.

An extension point is described in
[ADR 0005](docs/adr/0005-chemistry-scope.md): add a sibling node type storing
SMILES/MOL. The formula node, sanitizer, uploads and i18n need no changes.

## LaTeX commands MathLive cannot export to MathML

MathLive's MathML export drops the body of several "stretchy over/under"
commands, emitting a bare operator with no content. These are excluded from the
template catalogue:

| Command | What MathLive produces | Use instead |
| --- | --- | --- |
| `\overline{x}` | empty output | `\bar{x}` |
| `\underline{x}` | empty output | — |
| `\overbrace{x}^{n}` | `<mover>⏞</mover>` — body lost | — |
| `\underbrace{x}_{n}` | `<munder>⏟</munder>` — body lost | — |
| `\overrightarrow{AB}` | `<mover>→</mover>` — body lost | `\vec{AB}` |
| `\longrightarrow` | invalid `<munder>`, swallows the next term | `\rightarrow` |
| `\xrightarrow{t}` | invalid `<munderover>` | `\overset{t}{\rightarrow}` |
| `\iff` | operator silently dropped | `\Longleftrightarrow` |
| `{}^{14}_{6}\mathrm{C}` | `<msubsup>` missing its base | `{\,}^{14}_{6}\mathrm{C}` |

A user can still type these into the formula field by hand. `repairMathML()`
then keeps the document renderable — stray operator text is wrapped in `<mo>`
and script elements are padded to their required arity — but content the
converter dropped cannot be recovered. Every shipped template is verified
against the real pipeline by an automated test.

## MathLive's own UI is only partly translatable

MathLive bundles translations for de, en, es, fr, it, ja and pl — not Russian.
`packages/editor-core/src/i18n/mathlive.ts` supplies the missing Russian table
and merges it in via `MathfieldElement.strings`, covering all 83 prose keys of
MathLive's context menu and tooltips. Two consequences:

- The 13 `menu.insert.*-template` entries are LaTeX fragments rather than prose,
  so they stay as MathLive ships them.
- The table is pinned to MathLive's key names by a test. If an upgrade renames a
  key, that test fails rather than the menu silently reverting to English.

The on-screen keyboard is switched off in the formula dialog
(`mathVirtualKeyboardPolicy: 'manual'`, plus the toggle hidden through
`::part(virtual-keyboard-toggle)`), because the dialog's own template gallery
covers the same ground and the keyboard obscures the preview.

## Formula round-trip fidelity

Formulas authored here round-trip exactly: the LaTeX travels inside the MathML
as a `<semantics>/<annotation>` pair ([ADR 0002](docs/adr/0002-math-editor-and-mathml.md)).

Formulas that arrive as MathML from elsewhere are converted structurally by
`mathml-to-latex` when reopened. Common notation converts faithfully; unusual
markup (heavy `<mstyle>`, `<maction>`, `<mmultiscripts>` beyond simple
prescripts) may reopen in a simplified form. Such a formula still **renders**
from its original MathML — the loss only appears if it is edited and saved.

## Images

No crop, resize, caption or alt-text UI. `alt` is set from the file name.
Images are inserted at natural size and constrained to the container width by
CSS. Out of scope for v1 by the specification.

## Audio

- Recording depends on `MediaRecorder` and microphone permission. Where either
  is missing, the dialog says so instead of offering a broken control.
- The container is whatever the browser supports (WebM/Opus, Ogg, MP4/AAC, MP3).
  There is **no transcoding** — a recording made in Safari and one made in
  Firefox can be different formats. Normalize server-side if you need one.
- The waveform is computed live from the input signal while recording. Audio
  inserted from an existing file or a remote URL has no waveform; the player
  falls back to a flat bar pattern and a working progress indicator.
- The duration cap pauses the recorder rather than discarding the take.

## Accessibility

Toolbar buttons, dialogs and the editing surface carry labels, roles and
keyboard handling. **Formula accessibility is explicitly out of scope for v1**
as the specification states: no speech text, no MathML exposed to screen
readers, no expression navigation. The rendered SVG is `aria-hidden` in effect.

Adding it means enabling MathJax's speech-rule-engine output — already a
transitive dependency of `@mathjax/src`, so no new licence surface.

## SSR

The editor initializes on the client only: ProseMirror, DOMPurify and MathLive
all need a DOM. Wrap it in `<ClientOnly>` under Nuxt.

`<RichContent />` can be placed anywhere, but it too renders on the client —
sanitization needs a DOM, and sanitizing on the server would mean adding jsdom.
Server-rendered read-only output is therefore not available in v1.

## Collaboration and history

No realtime collaboration, no presence, no comments, no version history. Undo
and redo are local to the session. TipTap supports Y.js collaboration, so the
extension point exists, but nothing here is wired for it.

## Content saved by Froala

Legacy markup renders through an opt-in compatibility layer
([ADR 0007](docs/adr/0007-froala-compatibility.md)). What it does **not**
reproduce:

**Video is dropped entirely.** `<video>` and `<iframe>` are outside the
sanitizer's allowlist, so `.fr-video` arrives as an empty wrapper and `.fr-rv`
has nothing to size. Admitting either tag would widen the attack surface the
sanitizer exists to narrow. Confirmed with the data owner that video does not
occur in the stored content; if that changes, it needs its own decision rather
than a loosened allowlist.

**Emoticons do not render.** Froala stores them as a `<span>` whose image is a
`background: url(…)` in the style attribute, and the CSS sanitizer strips `url()`
values. The image reference is removed before any stylesheet could act on it, so
this is not fixable in the compat CSS.

**Editing drops decoration classes.** The viewer keeps all 24 decoration classes;
the editor keeps the three that sit on links (`fr-file`, `fr-green`,
`fr-strong`), because TipTap's link mark passes `class` through. Everything else
— `fr-rounded`, `fr-bordered`, `fr-shadow`, the table and text classes — is gone
once a document is edited and saved.

What does survive editing: formulas (recovered into real formula nodes),
highlight colour, text alignment, font size, and the document structure.

**Image captions lose their structure.** Froala's three-level
`fr-img-caption > fr-img-wrap > fr-inner` wrapper has no counterpart in the
schema. In the viewer it renders correctly; in the editor the caption text merges
into the paragraph holding the image.

**`legacyEmbed` content is preserved, not editable.** MathJax output and JSME
chemistry structures carry no source data, so the node stores the rendered markup
and returns it unchanged. Selecting and deleting it works; editing it does not.

**`legacy` is read once on `RichEditor`.** The mode changes the document schema,
which ProseMirror cannot swap under a live editor. Re-key the component to switch
modes.

**Unverified: project-specific classes.** The Froala config was reported to carry
no custom `imageStyles`, `paragraphStyles` or `inlineClass`, which would mean the
vendor class list is exhaustive. That could not be confirmed from this
environment — the GitLab host holding the project is outside the egress policy.
If custom classes do exist, the compat layer will not cover them, and it will
show up in production rather than in tests.

## Bundle size

The editor is not small, and the heavy parts are lazy:

| Chunk | Size (raw) | Loads when |
| --- | --- | --- |
| Editor + TipTap + Vue | ~615 KB | Always |
| MathJax SVG output | ~965 KB | First formula renders |
| MathLive | ~780 KB | Formula dialog first opens |
| Froala compat CSS | ~10 KB | Only if imported explicitly |

A document with no formulas never loads MathJax or MathLive. `<RichContent />`
on an exported document loads neither, because the SVG travels with the HTML.

The compat stylesheet is built outside the library bundle, so `styles.css` is
byte-for-byte the same whether or not legacy support exists. A host that never
imports `legacy.css` pays nothing for it.

## Not implemented by design

Per the specification's non-goals: no physics mode, no user-built template
editor (the catalogue is fixed), no collaboration, no built-in file storage
backend, and no PWA/offline support.
