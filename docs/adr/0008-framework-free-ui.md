# ADR 0008 — The UI is built once, on plain DOM, in the core

- Status: accepted
- Date: 2026-09-17

## Context

Until now the split was "engine in the core, interface in Vue": `@rich-editor/core`
owned the schema, node views, sanitization, formulas, uploads and i18n, and
`@rich-editor/vue` owned the toolbar, the dialogs and the popovers as Vue
components. The requirement that prompted this decision is that the editor
must be **vanilla at its base** and *portable* to Vue — and later to whatever
else the platform adopts — and that the set of capabilities must be
**configurable**: an application should assemble the editor it needs rather
than pick one of three presets.

Two problems with the old split made that hard.

**Every wrapper would carry its own interface.** A React or Svelte port would
have to re-implement the toolbar, four dialogs and two popovers, and the copies
would drift. The Vue interface was ~1 700 lines; that is the price of every
additional framework, paid again with every change.

**A capability was spread over five places.** Adding a toolbar button meant
editing the extension list, a command table, the toolbar presets, an icon map
and the label map, in different files. The set of buttons was a closed union of
literals, so a host could neither add an item nor replace one.

## Decision

**The whole interface lives in `@rich-editor/core`, written on plain DOM.**
`createRichEditor` assembles the editor — toolbar, editing surface, dialogs,
popovers — with one call. A framework wrapper mounts that call and adds only
what a framework is for: reactive props, `v-model`, events. `rich-editor.vue`
is now ~170 lines, and a wrapper for another framework is the same size.

**A capability is one declaration.** A toolbar item is a `ToolbarItemDescriptor`
(icon, label key, command, active and disabled state). The toolbar renders a
registry of descriptors by a list of ids, so the set of buttons is
configuration: a preset, an explicit list of groups, extra items through
`toolbarItems`, or a replacement for a built-in id. An `EditorFeature` bundles
schema extensions, toolbar items and dialogs for one capability;
`createRichEditor({ features })` installs all three.

Supporting choices:

- **Overlays are created once and hidden**, not re-created per open. They hold
  no framework state, so there is nothing to reset; a hidden overlay costs
  nothing. The stylesheet explicitly hides `.rte-modal[hidden]`, because the
  `hidden` attribute does not beat `display: flex`.
- **Focus returns to the document.** A closing modal dispatches
  `rte:modal-close`; the shell handles it and focuses the editor. Host dialogs
  built with `createModal` inherit the behaviour.
- **Labels are read at build time.** A locale or message change rebuilds the
  toolbar and the overlays; dropdown panels are rebuilt on every open. No
  reactive state to keep in sync.
- **Styles ship with the UI.** The stylesheet moved to the core; the Vue
  package's `styles.css` re-exports it so hosts keep their import.
- **`vanilla.html` in the demo loads only the core** and is covered by e2e
  tests, so "works without a framework" is a tested property, not a promise.

### Alternatives considered

- *Keep the Vue interface, add a copy per framework.* Rejected: that is the
  drift problem, made permanent.
- *Web components.* A custom element would give the same portability, but at
  the cost of registering elements in the host page and of shadow DOM getting
  in the way of the CSS-variable theming contract from ADR 0006. Plain DOM
  inside an ordinary element keeps theming as it is; a custom-element wrapper
  can still be added on top later.
- *Headless core, each framework builds its own UI.* That was the previous
  state. It suits libraries whose consumers want a bespoke interface; here the
  interface is a product requirement and must look the same everywhere.

## Consequences

- One interface, tested once. The shell has its own jsdom tests
  (`vanilla-ui.test.ts`); the Vue wrapper tests only what it adds.
- `@rich-editor/vue` lost its UI components (`EditorToolbar`, `RteModal`,
  `RtePopover`, `LinkPopover`, the dialogs) and `readToolbarState`. Their
  replacements are the core factories, re-exported from the Vue package.
  `ToolbarItemId` widened from a literal union to `string`; `ToolbarGroup` is
  a deprecated alias of `ToolbarGroupConfig`.
- `toolbarItems` and `features` are read once at creation, like `legacy`: they
  shape the schema, and a schema cannot change under a live editor. Recreate
  the editor to change them.
- The interface is imperative DOM. Rebuilding on locale change and on dropdown
  open is the cost of having no reactive layer; it is cheap at this size, and
  it is the reason no framework is needed.
- The read-only viewer moved to the core the same day (`createRichContent`);
  `rich-content.vue` is now a wrapper like `rich-editor.vue`. For that,
  `prepareIncomingHtml` left `editor.ts` for its own module, so the viewer
  does not import the editing stack.
