# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
The packages are not published yet; everything below lands in the first release.

## Unreleased

### Added

- Built-in dark theme: `theme: 'light' | 'dark' | 'auto'` on `createRichEditor`,
  `createRichContent`, `<RichEditor />` and `<RichContent />`; `setTheme()` and
  `update({ theme })` switch it later; the class `rte-theme-dark` on the element
  or any ancestor works without a call. `applyTheme` and `DARK_THEME_CLASS` are
  exported.

- `createRichEditor()` in `@rich-editor/core`: the whole editor — toolbar,
  editing surface, dialogs, popovers — assembled on plain DOM with one call
  (ADR 0008). `@rich-editor/vue` is a thin wrapper over it.
- `createRichContent()` in `@rich-editor/core`: the read-only viewer without a
  framework; `<RichContent />` wraps it.
- Toolbar configuration: `toolbarItems` (extra or replacement items by id) and
  `features` (`EditorFeature`: schema extensions + toolbar items + dialogs in
  one declaration). Items a feature contributes appear as a trailing group
  unless the toolbar configuration places them.
- `ToolbarItemDescriptor.shortcut`, `text(context)` and `dynamicIcon(editor)`.
- `RichEditorUi.setLimits()`, `setMessages()`, `refreshLabels()`, `layout()`
  on the toolbar.
- A status line under the toolbar (uploads in flight, the last error);
  `statusLine: false` turns it off. `RichEditorCoreOptions.onUpload` and the
  Vue `upload` event report `start | done | failed` per adapter upload.
- `RichEditorCoreOptions.extensions` may be a function of the translator.
- `VoiceRecorderOptions.onLimit('duration' | 'size')`.
- Built-in English: `locale: 'en'` works without a `messages` table.
- Accessibility: `aria-pressed` on toggles, `aria-labelledby` on dialogs,
  `aria-label` on the toolbar, `aria-keyshortcuts` and shortcuts in tooltips,
  arrow-key navigation in menus.
- Keyboard model for the toolbar: a single Tab stop with `←` / `→` /
  `Home` / `End` between buttons, `Escape` back to the document, `Alt+F10`
  from the document into the toolbar (`Toolbar.focus()`); `Ctrl/Cmd+K` opens
  the link dialog. Menu buttons open on `↓` / `↑`; the colour palette is
  navigable as a grid.
- Screen readers: menus are labelled by their button (`aria-labelledby`,
  `aria-haspopup="menu"`); heading and alignment items are `menuitemradio`,
  toggles in the `⋯` menu are `menuitemcheckbox`, colour swatches are
  `menuitemradio` — all with `aria-checked`; the heading button's current
  value is its `aria-describedby`; the editing surface has `aria-placeholder`.
  `createMenuItem` takes `role`, `createPopover` takes `label` / `labelledBy`.
- A visible focus ring on every control of the editor and viewer, and on the
  editing surface while the caret is inside.
- The toolbar measures itself above `collapseBelow` and folds groups one by
  one into the `⋯` menu instead of wrapping.

### Changed

- Default theme re-based on the umschool design language: Golos, 15/22 text,
  8/10/12 px radii, orange accent, umschool shadows and overlay. The token
  contract grew to cover everything a design system changes — UI font sizes
  and weights, input and button heights, dialog widths and paddings, focus
  ring, overlay, link colour, hover borders — and is documented in
  `THEMING.md`; a test keeps the stylesheet on the tokens and the document in
  sync. Hosts that override a subset of the old tokens keep working; hosts
  that matched the old look pixel for pixel will see the new defaults.

- Toolbar button `title` now includes the keyboard shortcut
  («Полужирный · Ctrl+B»); the accessible name (`aria-label`) is still the
  bare label. Select buttons by `aria-label`, not `title`.
- Toolbar buttons and menu items no longer take focus from the document.
- Locale and message changes rebuild the toolbar **and** the dialogs.
- `ToolbarItemId` widened from a literal union to `string`; `ToolbarGroup` is
  a deprecated alias of `ToolbarGroupConfig`.
- Dropdown panels are `position: fixed` popovers (`.rte-popover.rte-dropdown__panel`).
- The size-limit error of the recorder uses `error_audio_too_large` with the
  byte limit instead of the duration message.

### Removed

- From `@rich-editor/vue`: `EditorToolbar`, `RteModal`, `RtePopover`,
  `LinkPopover`, `FormulaDialog`, `AudioRecorderDialog`, `RteDropdown`,
  `RteToolbarButton`, `ColorPanel`, `readToolbarState`, `emptyToolbarState`,
  `useEditorI18n`. Their replacements are the core factories (`createModal`,
  `createPopover`, `createDropdown`, `createToolbar`, …), re-exported from the
  Vue package.
- `createPanelToolbarItems` from both packages (unusable without the shell).
- Error codes `audio-too-long` and `formula-render-failed` (never emitted).
- Translation keys that no code read: `toolbar_group_*`, `toolbar_unlink`,
  `toolbar_formula`, `formula_title`, `formula_edit`, `color_title`, `image_*`,
  `file_title`, `file_choose`, `file_uploading`, `file_attachment_label`,
  `audio_recording`, `audio_uploading`, `error_audio_too_long`,
  `error_formula_render_failed`, `common_delete`, `common_ok`.
  Added: `toolbar_label`, `upload_image`, `upload_audio`, `upload_file`,
  `error_audio_too_large`.

### Fixed

- `hidden` elements really are hidden: one stylesheet rule beats every
  `display` the UI sets (read-only mode hid nothing, the recorder showed all
  phases at once).
- Modal backdrop restored; click on it closes the dialog.
- Recorder: no `InvalidStateError` when the browser ends the recording on its
  own; the size limit finalizes the take like the duration limit; recorder
  errors reach the host's `onError`.
- `v-model` no longer re-applies HTML the document already holds.
- The heading button keeps one width whatever it shows (`H1` or the paragraph
  label), so the toolbar no longer reflows when the caret moves between a
  heading and a paragraph; `--rte-btn-text-width` sets it, longer labels get
  an ellipsis.
- `<RichEditor />` and `<RichContent />` have a single root element again: a
  template comment made them fragments in development builds, so `class` and
  other attributes from the host were not applied to the root.
- Formula preview cache is bounded (shared LRU with the MathJax SVG cache).
- Template previews render on the second opening of the formula dialog.
