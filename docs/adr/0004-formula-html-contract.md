# ADR 0004 — Formula node contract in HTML, and its security model

- Status: accepted
- Date: 2026-09-14

## The stored shape

```html
<span data-formula="true"
      data-formula-type="math"
      data-mathml="&lt;math xmlns=&quot;…&quot;&gt;…&lt;/math&gt;"
      contenteditable="false"
      class="rte-formula">
  <span class="rte-formula__render" data-render-host="true">
    <svg …>…</svg>
  </span>
</span>
```

- `data-mathml` holds the **escaped MathML** and is the source of truth.
- The render host holds the **MathJax SVG projection**, so the document displays
  correctly anywhere — an email, a CMS, the read-only viewer — without the editor
  or MathJax.
- `data-formula-type` records `math` or `chem` so re-editing opens the right
  template set. It is recorded on the `<math>` element too, so the MathML alone
  carries the distinction.

### Why an attribute rather than `<script type="math/mml">`

The requirements allow either. A `<script>` element inside user-editable content
is an element we would otherwise forbid everywhere, and would have to carve an
exception for in the sanitizer. An attribute carries the same data with no such
exception, so it is the safer half of the choice offered.

## Rules

- **MathML is authoritative.** On import, whatever is in the render host is
  parsed away (the node is an atom, so ProseMirror keeps no children) and the
  visual is rebuilt from `data-mathml`. A tampered SVG cannot survive a round
  trip through the editor.
- **Click opens the editor** with the current MathML, and saving replaces the
  attribute and repaints.
- **Deletion is whole-node only.** `atom: true` means ProseMirror has no
  position inside the node, so Backspace, Delete and selection all operate on
  the formula as one object. There is no way to "eat into" it.

## Security model

Three sanitizers, each with the narrowest job:

| Function | Input | Guards |
| --- | --- | --- |
| `sanitizeHtml` | document HTML (`setHTML`, paste) | tag/attribute allowlist, no `script`/`iframe`/`form`, no `on*`, scheme checks per element, CSS `url()`/`expression()` stripped |
| `sanitizeMathML` | the `data-mathml` value | MathML allowlist; `annotation-xml` and `mglyph` forbidden; `href`/`xlink:href` removed |
| `sanitizeSvg` | MathJax output | SVG profile; `<use>` restricted to local `#id` fragments; no `foreignObject`, `<a>`, `<image>` |

Specific decisions worth recording:

- **`annotation-xml` is never allowed.** With `encoding="text/html"` it is the
  classic MathML mXSS vector. `<annotation>` (plain text, TeX) is allowed because
  it is what makes re-editing work.
- **MathML is parsed as HTML, not XHTML.** MathLive emits named entities such as
  `&ne;`, which are undefined in XML and would fail the entire parse.
- **`<use>` is explicitly re-allowed.** DOMPurify drops it by default because it
  can reference external documents; MathJax needs it for its own inlined glyphs,
  so a hook restricts it to same-document `#` fragments instead.
- **`blob:` is added to the URI allowlist.** DOMPurify's default rejects it,
  which would have silently broken the local (no-adapter) pipeline for images,
  audio and attachments. `data:` is permitted on media elements only, never on
  `href`.
- **SVG is allowed inside document HTML** so a saved formula keeps its rendered
  form on the way back in — restricted to the element and attribute set MathJax
  actually emits.

Every one of these rules has a test in `packages/editor-core/tests/sanitize.test.ts`.
