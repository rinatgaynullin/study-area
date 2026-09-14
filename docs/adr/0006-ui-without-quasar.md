# ADR 0006 — Quasar-like UI without depending on Quasar

- Status: accepted
- Date: 2026-09-14

## Context

The requirement is that the toolbar and editor **look and feel like Quasar's
QEditor** — a dense toolbar, familiar icon grouping, a clean utility look — and
that styles are fully customizable through CSS variables without forking. It
also says not to take Quasar as a hard dependency if a comparable result is
achievable more cheaply, and to justify the choice either way.

## Decision

**Do not depend on Quasar.** Reimplement the look with plain CSS and inline SVG
icons.

Reasons:

- Quasar is a full framework — its own build plugin, theme system, icon sets and
  global styles. Pulling it into a reusable component would force every consumer
  to adopt it, including consumers already using Vuetify, PrimeVue, Tailwind or
  nothing at all. For an embeddable npm component that is a serious imposition.
- We need roughly a dozen UI primitives: a button, a dropdown, a modal, a few
  form controls. That is a few hundred lines of CSS, against a framework-sized
  dependency.
- Theming is a hard requirement. Owning the stylesheet means every colour,
  radius, size and font is already a CSS variable, with no fight against a
  framework's own cascade or specificity.

### What we kept from QEditor

- A dense toolbar with 32 px flat buttons, grouped, with hairline separators.
- Familiar grouping order: history, heading, formatting, alignment, lists,
  blocks, insert.
- Toggled buttons tinted with the primary colour rather than outlined.
- Dropdowns for heading level, alignment, colours and table operations.

### Icons

Icons are inline SVG built from primitives (`packages/editor-vue/src/components/icons.ts`),
inheriting `currentColor`. No icon font, no external asset, no network request,
and nothing for the consumer to install or configure.

## Theming contract

Everything resolves through CSS variables declared on `.rte-root` (the editor)
and `.rte-content-root` (the read-only viewer). A consumer overrides them at any
level:

```css
.rte-root { --rte-color-primary: #6750a4; --rte-radius: 10px; }
```

Class hooks (`.rte-toolbar`, `.rte-btn`, `.rte-modal__panel`, …) are stable and
documented, so a host that needs more than variables can target them without
patching the package.

## Consequences

- No dependency on any UI framework; the Vue package's only runtime dependencies
  are the core package and MathLive.
- The full stylesheet, including content styles, is 16.5 KB (3.6 KB gzipped) in
  a single file.
- Matching QEditor is by eye, not by import — a future Quasar restyle would not
  follow automatically. Given the goal is "familiar and clean" rather than
  pixel-identical, that is an acceptable trade.
