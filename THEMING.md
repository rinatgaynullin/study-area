# Theming

The editor and the read-only viewer are styled entirely through CSS custom
properties declared on `.rte-root` (the editor) and `.rte-content-root` (the
viewer). Every colour, font, radius, shadow and control size in the interface
resolves through one of them, so restyling the editor to match a design system
means overriding variables — never patching the stylesheet or forking the
package. A test (`packages/editor-core/tests/theme-tokens.test.ts`) keeps the
rules on the tokens and this document in sync with the declared list.

The defaults follow the umschool design language (Golos, 15 px body text,
8/10/12 px radii, orange accent). They are plain literals, so the editor looks
right on any page; a host that ships the same design system does not need to do
anything.

## Overriding

Set variables globally, per instance, or per theme. Include both selectors so
the viewer matches the editor:

```css
.rte-root,
.rte-content-root {
  --rte-color-primary: #396fdb;
  --rte-radius: 6px;
  --rte-font-family: Inter, sans-serif;
}
```

Per instance — the variables cascade, so a class on a wrapper is enough:

```css
.compact .rte-root {
  --rte-btn-size: 30px;
  --rte-content-padding: 8px 10px;
}
```

## Dark theme

A dark theme ships with the editor — the same tokens, re-valued with the
umschool dark palette, under the class `rte-theme-dark`. Three ways to turn it
on:

- **Option or prop.** `createRichEditor({ theme: 'dark' })`,
  `createRichContent({ theme: 'dark' })`, `<RichEditor theme="dark" />`,
  `<RichContent theme="dark" />`. `'auto'` follows `prefers-color-scheme` and
  switches with it; `setTheme()` / `update({ theme })` change it later.
- **A class on the element or any ancestor.** `rte-theme-dark` on `<html>` next
  to the host's own theme class is enough — the editor picks it up without a
  call. `applyTheme(element, theme)` is exported for hosts that want the
  `auto` logic on their own element.
- **Your own values.** Override the palette group and `--rte-shadow*` under
  any class, exactly like the built-in block in `styles.css` does; the demo's
  `theme` control and `.demo--dark` show the page side of that.

The dark block sets `color-scheme: dark` so native controls — the checkbox in
the link dialog, the colour input, scrollbars — follow.

## Palette

| Variable | Default | Controls |
| --- | --- | --- |
| `--rte-color-primary` | `#ff892e` | Accent: active toolbar items, primary buttons, active tab and category, focus ring, selected image handles |
| `--rte-color-primary-hover` | `#f56600` | Primary button on hover |
| `--rte-color-primary-soft` | `#fff1e0` | Soft accent surface; the default for `--rte-color-selection`, `--rte-color-formula-hover` and `--rte-btn-active-bg` |
| `--rte-color-on-primary` | `#ffffff` | Text and icons on the accent colour |
| `--rte-color-text` | `#221f2e` | Body text, toolbar icons, dialog text, input caret |
| `--rte-color-muted` | `#898794` | Secondary text: hints, section titles, blockquotes, status line, inactive tabs |
| `--rte-color-placeholder` | `#898794` | Empty-document hint and input placeholders |
| `--rte-color-link` | `#396fdb` | Links inside the document |
| `--rte-color-bg` | `#ffffff` | Editor and viewer surface, dialogs, popovers, inputs; the default for `--rte-toolbar-bg` |
| `--rte-color-subtle-bg` | `#f5f5f7` | Table headers, code blocks, read-only surface, formula preview box, recorder indicator; the default for hover backgrounds |
| `--rte-color-border` | `#dedce3` | Every hairline: editor frame, toolbar separators, inputs, dialogs, table cells, swatches |
| `--rte-color-border-hover` | `#afadb8` | Inputs, secondary buttons and category chips on hover |
| `--rte-color-danger` | `#f23e3e` | Errors, the delete buttons, the live recording indicator |
| `--rte-color-danger-soft` | `#ffebeb` | Delete button on hover |
| `--rte-color-code-bg` | `#f5f5f7` | Inline code |
| `--rte-color-code-block-bg` | `#f5f5f7` | Code blocks |
| `--rte-color-selection` | `var(--rte-color-primary-soft)` | Selected table cells, template hover, input focus ring when enabled |
| `--rte-color-formula-hover` | `var(--rte-color-primary-soft)` | Formula under the pointer and the selected formula |
| `--rte-color-waveform` | `#dedce3` | Unplayed part of the voice-message waveform |
| `--rte-color-overlay` | `rgb(34 31 46 / 45%)` | Dialog backdrop |
| `--rte-color-on-highlight` | `#221f2e` | Text over a highlight mark. Highlights are light pastel swatches, so this stays dark in the dark theme too |

## Typography

| Variable | Default | Controls |
| --- | --- | --- |
| `--rte-font-family` | `Golos, system-ui, …` | The document and the whole interface. Golos is used when the page has loaded it and falls through to the system stack otherwise |
| `--rte-font-mono` | `ui-monospace, …` | Inline code and code blocks |
| `--rte-font-size` | `15px` | Document text; headings are `em` multiples of it. `16px` on screens up to 640 px |
| `--rte-line-height` | `1.47` | Document line height (22 px at 15 px) |
| `--rte-ui-font-size` | `15px` | Inputs, dialog buttons, field labels |
| `--rte-ui-font-size-sm` | `14px` | Menu items, checkboxes, formula-dialog tabs |
| `--rte-ui-font-size-xs` | `13px` | Toolbar button text, hints, errors, status line, popovers, category chips |
| `--rte-ui-font-weight` | `500` | Dialog buttons and tabs |
| `--rte-title-font-size` | `18px` | Dialog titles |
| `--rte-title-font-weight` | `600` | Dialog titles, active menu item, active tab, section titles, toolbar text buttons |
| `--rte-display-font-size` | `24px` | The recorder's timer |
| `--rte-formula-input-font-size` | `20px` | The MathLive field in the formula dialog |

## Shape, shadows, layers

| Variable | Default | Controls |
| --- | --- | --- |
| `--rte-radius-sm` | `4px` | Inline code, marks, menu items, swatches, image handles |
| `--rte-radius` | `8px` | Toolbar buttons, dialog buttons, code blocks, formula templates and preview, audio and attachment blocks |
| `--rte-radius-lg` | `12px` | Dialogs, popovers and menus |
| `--rte-radius-pill` | `999px` | Category chips in the formula dialog |
| `--rte-input-radius` | `10px` | Inputs, the formula field and the editor frame itself |
| `--rte-shadow` | two-layer, light | Popovers and menus |
| `--rte-shadow-lg` | two-layer, deep | Dialogs |
| `--rte-focus-ring` | `2px solid var(--rte-color-primary)` | Keyboard focus outline on toolbar buttons, menu items, dialog buttons and the close button |
| `--rte-z-modal` | `2000` | `z-index` of dialogs and popovers |

## Toolbar

| Variable | Default | Controls |
| --- | --- | --- |
| `--rte-toolbar-bg` | `var(--rte-color-bg)` | Toolbar background |
| `--rte-toolbar-gap` | `2px` | Gap between buttons and between groups |
| `--rte-toolbar-padding` | `4px 6px` | Toolbar padding |
| `--rte-btn-size` | `36px` | Toolbar button height and minimum width; `40px` on screens up to 640 px |
| `--rte-btn-text-width` | `9.5em` | Fixed width of a toolbar button's text label (the heading button shows `H1`…`H6` or the paragraph label), so the toolbar does not reflow when the caret moves; a longer label is cut with an ellipsis |
| `--rte-btn-hover-bg` | `var(--rte-color-subtle-bg)` | Toolbar buttons, menu items, colour reset and the dialog close button on hover |
| `--rte-btn-active-bg` | `var(--rte-color-primary-soft)` | Background of a toggled toolbar button |
| `--rte-btn-active-color` | `var(--rte-color-primary)` | Icon colour of a toggled toolbar button |

## Dialog controls

| Variable | Default | Controls |
| --- | --- | --- |
| `--rte-input-height` | `44px` | Text and number inputs |
| `--rte-input-padding-x` | `11px` | Horizontal padding of inputs |
| `--rte-input-focus-shadow` | `none` | Extra ring on a focused input; the border already turns `--rte-color-primary`. Set e.g. `0 0 0 3px var(--rte-color-selection)` for a visible ring |
| `--rte-button-height` | `44px` | Dialog and popover buttons |
| `--rte-button-padding-x` | `24px` | Horizontal padding of dialog buttons |
| `--rte-button-hover-bg` | `var(--rte-color-subtle-bg)` | Secondary dialog buttons on hover |

## Dialogs, popovers, menus

| Variable | Default | Controls |
| --- | --- | --- |
| `--rte-modal-width` | `480px` | Link, table and recorder dialogs |
| `--rte-modal-width-wide` | `860px` | The formula dialog |
| `--rte-modal-padding-x` | `32px` | Horizontal padding of dialog header, body and footer; `20px` on screens up to 640 px |
| `--rte-modal-padding-y` | `16px` | Vertical padding of dialog header, body and footer |
| `--rte-popover-padding` | `12px` | Link popover padding |
| `--rte-menu-item-padding` | `8px 12px` | Menu items in dropdowns |
| `--rte-menu-min-width` | `180px` | Minimum width of dropdown menus |

## Content and media

| Variable | Default | Controls |
| --- | --- | --- |
| `--rte-content-padding` | `12px 16px` | Padding of the editing surface; `10px 12px` on screens up to 640 px |
| `--rte-block-gap` | `0.75em` | Vertical gap between blocks in the document |
| `--rte-formula-padding` | `2px` | Horizontal padding around an inline formula |
| `--rte-audio-max-width` | `420px` | Maximum width of a voice message |
| `--rte-audio-padding` | `10px 12px` | Padding of a voice message |
| `--rte-resize-handle-size` | `10px` | Corner handles of a selected image |

## Legacy (Froala) content

`legacy.css` derives its `--rte-legacy-*` variables from the tokens above, so a
retheme reaches old content without extra work. The few literals that have no
counterpart in the new visual language are listed and explained in that file.

## Not tokens

- Spacing inside controls (gaps of 4–14 px, chip and swatch sizes) is the
  editor's own rhythm and stays literal; it does not change between design
  systems the way colour, type and radius do.
- Heading sizes in the document are `em` multiples of `--rte-font-size` so
  they scale with it.
- `--rte-level` is a runtime value the recorder writes for its indicator, not
  a theme token.
- Icons are inline SVG that inherit `currentColor`; there is no icon token.
