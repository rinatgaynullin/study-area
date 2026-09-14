# ADR 0002 — Visual formula editor: MathLive, with LaTeX carried inside the MathML

- Status: accepted
- Date: 2026-09-14

## Context

The requirements are explicit:

- MathML is the canonical storage format in the document.
- Clicking a formula must reopen **the same visual editor** with that formula.
- The editor must be MIT/Apache-2.0 compatible; the commercial Wiris SDK is out.

The only mature, MIT-licensed, WYSIWYG math input widget is
[MathLive](https://cortexjs.io/mathlive) (`mathlive`, MIT).

## The problem MathLive creates

MathLive **exports** MathML (`getValue('math-ml')`) but has **no MathML
parser**. Its source tree contains `formats/atom-to-math-ml.ts` and nothing in
the other direction; `setValue(value, { format: 'math-ml' })` type-checks but
silently falls through to LaTeX parsing and produces garbage.

So MathML alone cannot round-trip back into the editing widget.

## Decision

Store MathML that carries its own LaTeX, using the standard mechanism for
exactly this — `<semantics>` with an `<annotation>`:

```xml
<math xmlns="http://www.w3.org/1998/Math/MathML" display="inline" data-formula-type="math">
  <semantics>
    <mrow><mfrac><mi>a</mi><mi>b</mi></mfrac></mrow>
    <annotation encoding="application/x-tex">\frac{a}{b}</annotation>
  </semantics>
</math>
```

- **MathML stays the source of truth.** It is what is stored, exported, and
  rendered. Anything that understands MathML understands this document.
- **Re-editing reads the annotation**, so a formula authored here reopens
  losslessly, character for character.
- **Foreign MathML still opens**: when there is no annotation (MathML pasted
  from another tool, or written by a backend), we fall back to
  `mathml-to-latex` (MIT) for a structural conversion.

This is implemented in `latexToMathML()` / `mathmlToLatex()` in
`packages/editor-core/src/formula/mathml.ts`.

## Repairing MathLive's output

MathLive's MathML export is not always valid. Two failures are handled
explicitly, because MathJax throws on both:

1. `\longrightarrow` and `\xrightarrow{...}` emit `<munder>→</munder>` — a bare
   text node where MathML requires an element — and swallow the following term
   as a script.
2. `{}^{14}_{6}\mathrm{C}` drops the empty base, leaving `<msubsup>` with two
   children instead of three.

`repairMathML()` wraps stray operator text in `<mo>` and pads script elements to
their required arity, so a bad formula degrades to something renderable instead
of breaking the document. The shipped templates avoid the broken commands
outright (`\rightarrow`, `\overset{…}{\rightarrow}`, `{\,}^{14}_{6}\mathrm{C}`),
and a test renders **every** catalogue entry through the real pipeline so a
regression cannot ship silently.

## Consequences

- A formula authored in this editor round-trips exactly. One authored elsewhere
  round-trips as well as `mathml-to-latex` manages — good for common notation,
  lossy for exotic markup.
- The annotation adds a small amount of bytes per formula. That is the cost of
  making re-editing work at all.
- MathLive is loaded lazily, only when the formula dialog first opens, and only
  in the Vue package. `@rich-editor/core` uses `mathlive/ssr`, the conversion-only
  entry point, which does not pull in the web component.
- See LIMITATIONS.md for the LaTeX commands MathLive cannot export.
