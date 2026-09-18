"""
Серверный санитайзер документа.

Редактор чистит HTML в браузере, но браузер — не граница безопасности:
запрос можно собрать руками. Здесь тот же контракт, что в
`packages/editor-core/src/security/sanitize.ts`: те же теги, атрибуты и
схемы ссылок. Списки ниже — копия; тест `sanitize-contract` в монорепе
сверяет её с исходником и падает, если они разошлись.
"""

from __future__ import annotations

from collections.abc import Iterable

import nh3

HTML_TAGS = [
    'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'strong', 'b', 'em', 'i', 'u', 's', 'del', 'ins', 'mark', 'small',
    'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'a', 'span', 'div',
    'img', 'figure', 'figcaption', 'audio', 'source',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
    'sub', 'sup',
    'svg', 'g', 'defs', 'path', 'use', 'rect', 'line', 'circle', 'ellipse',
    'polygon', 'polyline', 'text', 'tspan', 'title',
]

HTML_ATTRS = [
    'href', 'target', 'rel', 'download', 'src', 'alt', 'title', 'class', 'style',
    'colspan', 'rowspan', 'colwidth', 'span', 'width', 'height',
    'controls', 'preload', 'type', 'lang', 'dir', 'start', 'reversed', 'value',
    'data-formula', 'data-formula-type', 'data-mathml', 'aria-label',
    'data-audio', 'data-duration', 'data-peaks', 'data-name', 'data-mime',
    'data-attachment', 'data-size', 'data-text-align', 'data-render-host',
    'data-legacy-embed', 'data-color',
    'viewBox', 'viewbox', 'xmlns', 'xmlns:xlink', 'xlink:href', 'd', 'transform',
    'fill', 'stroke', 'stroke-width', 'focusable', 'role', 'aria-hidden',
    'data-c', 'data-mml-node', 'x', 'y', 'rx', 'ry', 'text-anchor',
    'font-family', 'font-size', 'id',
]

MATHML_TAGS = [
    'math', 'semantics', 'annotation',
    'mrow', 'mi', 'mn', 'mo', 'ms', 'mtext', 'mspace',
    'mfrac', 'msqrt', 'mroot', 'mstyle', 'merror', 'mpadded', 'mphantom', 'menclose',
    'msub', 'msup', 'msubsup', 'munder', 'mover', 'munderover', 'mmultiscripts', 'mprescripts', 'none',
    'mtable', 'mtr', 'mtd', 'mlabeledtr', 'maligngroup', 'malignmark', 'mfenced', 'maction',
]

MATHML_ATTRS = [
    'xmlns', 'display', 'displaystyle', 'scriptlevel', 'mathvariant', 'mathsize',
    'mathcolor', 'mathbackground', 'dir', 'encoding', 'linethickness',
    'stretchy', 'fence', 'separator', 'accent', 'accentunder', 'largeop',
    'movablelimits', 'symmetric', 'minsize', 'maxsize', 'form', 'lspace', 'rspace',
    'width', 'height', 'depth', 'voffset', 'notation', 'open', 'close', 'separators',
    'columnalign', 'rowalign', 'columnlines', 'rowlines', 'columnspacing', 'rowspacing',
    'frame', 'framespacing', 'align', 'columnspan', 'rowspan', 'actiontype', 'selection',
    'data-formula-type',
]

ALLOWED_URI_SCHEMES = ['http', 'https', 'mailto', 'tel', 'ftp', 'blob', 'data']

# Инлайновые стили, которые редактор пишет сам: цвет, кегль, выравнивание,
# размер картинки. Остальное вырезается — `style` без фильтра оставил бы
# `position: fixed` поверх страницы или `background: url(...)` с утечкой.
STYLE_PROPERTIES = [
    'color', 'background-color', 'font-size', 'font-family', 'font-weight',
    'font-style', 'text-decoration', 'text-align', 'vertical-align',
    'width', 'height', 'max-width', 'margin', 'margin-left', 'margin-right',
    'padding', 'display', 'float', 'line-height', 'white-space',
]

# Раскрытая MathML в документе (старая разметка Wiris до апгрейда) тоже
# должна пройти, поэтому HTML- и MathML-списки объединяются.
ALL_TAGS = frozenset(HTML_TAGS) | frozenset(MATHML_TAGS)
ALL_ATTRS = frozenset(HTML_ATTRS) | frozenset(MATHML_ATTRS)


def _attributes(tags: Iterable[str], attrs: Iterable[str]) -> dict[str, set[str]]:
    allowed = set(attrs)
    return {tag: set(allowed) for tag in tags}


def sanitize_html(html: str) -> str:
    """Чистит документ по контракту редактора; пустая строка остаётся пустой."""
    if not html:
        return ''
    return nh3.clean(
        html,
        tags=set(ALL_TAGS),
        attributes=_attributes(ALL_TAGS, ALL_ATTRS),
        url_schemes=set(ALLOWED_URI_SCHEMES),
        # rel ставит сам редактор (noopener noreferrer); nh3 не должен его
        # перезаписывать.
        link_rel=None,
        strip_comments=True,
        filter_style_properties=set(STYLE_PROPERTIES),
    )
