# ADR 0007 — Rendering content saved by Froala

- Status: accepted
- Date: 2026-09-15

## Context

This editor replaces Froala 4 in umschool. The database holds a large body of
HTML that Froala wrote — task statements, solutions, self-check criteria, tutor
comments, student answers, exam instructions. It has to render correctly here,
with no migration and no visual regressions.

Two things make that harder than adding a stylesheet.

**The two rendering paths behave differently.** `<RichContent />` sanitizes and
drops the HTML into `v-html`, so every class survives to the DOM. The editor
parses the same HTML into the ProseMirror schema, which keeps only what the node
and mark attributes model. An audit through the real code measured the gap: of
24 decoration classes, the viewer keeps all 24 and the editor keeps 3 — and only
those because TipTap's link mark passes `class` through.

**The editor did not merely drop classes, it destroyed content.** Before this
work, opening a legacy document for editing and saving it silently lost:

| Construct | Result |
| --- | --- |
| `<img class="Wirisformula" data-mathml="…">` | plain `<img>`, MathML gone |
| `.formula-rendered > svg` (MathJax output) | empty paragraph |
| `.formula-chemistry-structure` (JSME) | empty paragraph |
| `<span style="background-color: …">` | colour gone |
| any inline `<img>` | paragraph split in three |

A student opening last year's solution would lose its formulas without being
told.

## Decision

### Opt in, twice

Compatibility is off by default. A host enables it with the `legacy` prop, and
imports the compat stylesheet separately:

```ts
import '@rich-editor/vue/legacy.css';
```

```vue
<RichContent :html="html" legacy />
```

Two gates rather than one, because they answer different questions. The
stylesheet is a separate file so a host without legacy data does not download
rules it will never match; the prop gates the parsing work and the schema
changes, which cost something on every `setHTML`.

`legacy` on `RichEditor` is read once, at construction. The mode changes the
document schema, and ProseMirror cannot swap a schema under a live editor.

### Recover what can be recovered, preserve the rest

`upgradeLegacyHtml()` runs **before** the sanitizer, alongside the existing
`<math>` conversion, and does two different things:

- **Wiris formulas become real formula nodes.** The MathML is decoded out of
  `data-mathml` and handed to the existing formula node, so it re-opens in the
  formula editor like any other. This is the outcome worth having: legacy markup
  becomes first-class model state rather than a preserved corpse.
- **MathJax output and JSME structures become a `legacyEmbed` node.** These carry
  no source data — no MathML, no SMILES — so there is nothing to recover. The
  node stores the markup and gives it back unchanged. It cannot be edited; it
  survives, which was the point.

The decoder handles two encodings: HTML escaping, often doubled, and Wiris's
"safe XML" (`«`, `»`, `¨`). Which one appears depends on Wiris's configuration,
there is nothing to branch on, and a misread attribute turns a formula into
garbage silently.

### Translate to model state, do not carry dead classes

Where a legacy class maps onto something the model already expresses, it is
translated rather than preserved:

- `<span style="background-color">` → the `highlight` mark, colour unchanged.
- In legacy mode images are **inline** nodes, because Froala always puts an image
  inside a paragraph and a block node splits that paragraph. Block layout stays a
  CSS question, exactly as it was in Froala.

The alternative — a global attribute that whitelists `fr-*` classes onto nodes —
was rejected. It would carry markup the editor does not understand, which the
toolbar cannot change and the user cannot remove.

### Reimplement the stylesheet, never copy it

Froala is commercial and this package is MIT. `froala_style.css` was read as a
description of behaviour; every rule here is written from scratch. No file, no
fragment, no licence header is copied.

## Theming contract

Compat rules resolve through the same `--rte-*` tokens as the rest of the
editor, so changing `--rte-color-border` restyles new and legacy tables in one
edit. Sixteen `--rte-legacy-*` variables exist only where a Froala construct has
no counterpart in the new visual language; ten of them default to a base token,
and the six literals are commented individually at their declaration.

A unit test enforces this: it fails on hard-coded colours or sizes in rule
bodies, on variables used but not declared, on legacy variables not linked to a
base token, and on rules that escape the `.rte-content.rte-legacy` scope.

## Consequences

- Legacy content renders correctly in the viewer, which is where it is read.
- Editing a legacy document still drops decoration classes. Formulas, highlight,
  alignment and structure survive; `fr-rounded` on an image does not. Full
  fidelity would mean modelling every Froala class as node attributes — a much
  larger change, worth doing only if editing legacy documents turns out to be
  common rather than rare.
- The sanitizer allowlist grew by `data-legacy-embed` and `data-color`. The
  second fixed a pre-existing bug outside legacy content: without it the
  highlight colour was re-resolved from `style` on every import and drifted from
  `#hex` to `rgb()`, so a document was never a fixed point.
- `LIMITATIONS.md` lists what does not reproduce at all.
