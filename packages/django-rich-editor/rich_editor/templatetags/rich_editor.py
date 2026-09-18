"""
Теги шаблонов.

`{% rich_editor_assets %}` — стили и скрипт редактора для страниц, где
виджет рендерится не через `form.media`. `{% rich_viewer_assets %}` — стили
и лёгкий скрипт вьюера для страниц, показывающих сохранённый документ.
`{% rich_content html %}` — сам документ в обёртке с классами редактора.
"""

from __future__ import annotations

from django import template
from django.utils.html import format_html
from django.utils.safestring import SafeString, mark_safe

from ..sanitize import sanitize_html

register = template.Library()


@register.inclusion_tag('rich_editor/assets.html')
def rich_editor_assets(legacy: bool = False) -> dict[str, bool]:
    return {'legacy': legacy}


@register.inclusion_tag('rich_editor/viewer_assets.html')
def rich_viewer_assets(legacy: bool = False) -> dict[str, bool]:
    return {'legacy': legacy}


@register.simple_tag
def rich_content(html: str, legacy: bool = False, sanitize: bool = False) -> SafeString:
    """
    Документ для показа. Сохранённый через поле формы HTML уже чист, поэтому
    по умолчанию не чистится повторно; `sanitize=True` — для данных из
    других источников.
    """
    body = sanitize_html(html) if sanitize else (html or '')
    classes = 'rte-content-root rte-content rte-legacy' if legacy else 'rte-content-root rte-content'
    return format_html(
        '<div class="{}" data-rich-content{}>{}</div>',
        classes,
        mark_safe(' data-legacy') if legacy else '',
        mark_safe(body),
    )
