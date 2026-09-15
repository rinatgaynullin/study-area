# ADR 0005 — Chemistry: equations and notation, not structural drawing

- Status: accepted
- Date: 2026-09-14

## Context

The requirement asks for chemical formulas alongside mathematical ones, and
explicitly says to pick the level that is genuinely deliverable on an MIT stack,
implement that, and document what was left out.

Two levels exist:

1. **Equations and notation** — element symbols, counts, charges, states,
   isotopes, reaction arrows. `H₂SO₄`, `2H₂ + O₂ → 2H₂O`, `²³⁸₉₂U`, `SO₄²⁻`.
2. **Structural drawing** — benzene rings, bonds, stereochemistry. What
   ChemDraw and Wiris ChemType do.

## Decision

**Ship level 1.** Chemistry reuses the exact same pipeline as mathematics —
MathLive for input, MathML for storage, MathJax for rendering — and differs only
in its template catalogue and the `chem` marker on the node.

That marker is not cosmetic: it selects the chemistry template set when the
formula is reopened, and it travels inside the MathML, so the distinction
survives export and re-import.

Four chemistry categories ship: reactions, states, isotopes, and common
formulas — around 35 templates.

### Why not structural drawing

There is no mature MIT-licensed structural editor that round-trips through
**MathML**. The credible open options (Ketcher, JSME, RDKit.js) model molecules
as MOL/SMILES — a completely different data model that MathML cannot express and
MathJax cannot render. Supporting it means a second storage format, a second
editor, and a second render path.

That is a feature in its own right, not a variation on this one. Claiming it
here would mean either shipping something that does not actually work or
silently redefining "MathML is the canonical format".

## Extension point

A structural editor would slot in as a **sibling node type**, not as a variation
of the formula node:

1. Add a node (for example `chemStructure`) storing SMILES or MOL in a data
   attribute, following the same atomic-node contract as `FormulaNode`.
2. Render it to an image or inline SVG through the chosen library.
3. Add a toolbar entry and a dialog next to the existing formula dialog.

The formula node, sanitizer, upload adapters and i18n layer need no changes —
the plugin boundaries already allow for it.

## Consequences

- Everything a chemistry teacher or student writes *as an equation* works today.
- Drawing a molecule does not, and LIMITATIONS.md says so plainly rather than
  leaving a user to discover it.
