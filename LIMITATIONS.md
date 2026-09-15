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

## Bundle size

The editor is not small, and the heavy parts are lazy:

| Chunk | Size (raw) | Loads when |
| --- | --- | --- |
| Editor + TipTap + Vue | ~615 KB | Always |
| MathJax SVG output | ~965 KB | First formula renders |
| MathLive | ~780 KB | Formula dialog first opens |

A document with no formulas never loads MathJax or MathLive. `<RichContent />`
on an exported document loads neither, because the SVG travels with the HTML.

## Not implemented by design

Per the specification's non-goals: no physics mode, no user-built template
editor (the catalogue is fixed), no collaboration, no built-in file storage
backend, and no PWA/offline support.
