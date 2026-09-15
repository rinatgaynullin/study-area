# ADR 0001 — Editor engine: TipTap 3 on ProseMirror

- Status: accepted
- Date: 2026-09-14

## Context

We need a rich text editor that supports an **atomic formula node**: a formula
must behave as a single indivisible object that cannot be partially deleted or
have text typed into the middle of it, while still flowing inline with the
surrounding text. We also need node views with custom DOM (audio player,
formula render host), a schema we control, and HTML in/out.

`contenteditable` on its own does not give us that. A document-model editor
does.

Candidates considered:

| Option | Licence | Atomic inline nodes | Vue support | Notes |
| --- | --- | --- | --- | --- |
| ProseMirror directly | MIT | yes | manual | Most control, most boilerplate |
| TipTap 3 (ProseMirror) | MIT | yes | first-class | Extension API, commands, `@tiptap/vue-3` |
| Quill | BSD-3 | limited (blots) | community | Weaker schema control, embeds are awkward |
| Lexical | MIT | yes | no official Vue | React-oriented ecosystem |
| Slate | MIT | yes | React only | Not applicable |

## Decision

Use **TipTap 3** (`@tiptap/core` + `@tiptap/pm`, MIT) as the engine.

- ProseMirror's schema gives us `atom: true, inline: true` for free, which is
  exactly the formula contract the requirements demand.
- TipTap's extension API keeps each feature (image, audio, attachment, formula)
  in its own module, which maps directly onto the required plugin boundaries.
- `StarterKit` already covers bold/italic/underline/strike, headings, lists,
  blockquote, code, code block, links, horizontal rule and undo/redo, so the
  toolbar requirements are mostly configuration rather than new code.

We do **not** use `@tiptap/vue-3`. Node views are written as plain DOM node
views in `@rich-editor/core` instead, which:

- keeps the core package usable without Vue, as required;
- avoids forcing consumers to register custom elements or extra plugins;
- costs us nothing, because the interactive parts that really benefit from Vue
  (toolbar, dialogs) live in the Vue package anyway.

## Consequences

- The core package depends on ProseMirror through TipTap. That is a real
  dependency weight (~170 KB minified in the demo build), but it is the price
  of a correct document model.
- Commands are typed through TipTap's module augmentation. A published package
  must re-export a type from every extension it installs, or the augmentations
  do not reach consumers — see the re-export block at the end of
  `packages/editor-core/src/index.ts`.
- If TipTap were ever abandoned, the schema and node views port to plain
  ProseMirror without a rewrite, since that is what they already are underneath.

## Addendum — licence audit, 2026-09-15

The question "is TipTap paid?" was raised, so the dependency was audited rather
than argued about. Findings, against the versions in the lockfile:

- All **32** installed `@tiptap/*` packages (v3.31.3) declare `MIT`, and
  `@tiptap/core/LICENSE.md` and `@tiptap/starter-kit/LICENSE.md` carry the full
  MIT text, © Tiptap GmbH 2025.
- None of them contains a licence-key check or any Pro gating.
- The extensions this project installs — StarterKit, table, image, text-align,
  text-style/color, highlight, subscript, superscript, placeholder — are all in
  that MIT set.
- What Tiptap charges for is its **hosted platform**: Collaboration, Comments,
  Snapshots/version history, AI and the conversion services. In 2025 they moved
  in the open-source direction, relicensing ten formerly-Pro extensions as MIT.
  This project uses none of the paid products and makes no network calls to
  Tiptap.

So the MIT-only constraint in the brief is satisfied, and no migration is
required on licensing grounds.

Had one been required, the target would be **plain ProseMirror**, not another
wrapper: every `prosemirror-*` package is already in the tree (MIT, pulled in
through `@tiptap/pm`), so it adds no new dependency surface. The cost is not
trivial, and is recorded here so it need not be re-derived:

- ~1,060 lines across six core files to rewrite, plus ~510 lines of Vue to
  re-point (~50 command call sites in `rich-editor.vue` and `toolbar-state.ts`).
- The three node views port nearly verbatim — they are already plain DOM
  ProseMirror node views — but StarterKit's 22 built-ins would be hand-rolled,
  and `ListKeymap` and `TrailingNode` have no `prosemirror-*` equivalent.
- Two unavoidable public API breaks: the `Editor` type re-export chain at the
  end of `packages/editor-core/src/index.ts`, and the
  `RichEditorCoreOptions.extensions` escape hatch that lets hosts inject their
  own TipTap extensions.
