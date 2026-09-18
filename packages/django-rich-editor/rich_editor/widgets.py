"""
Виджет формы: `<textarea>` с конфигурацией в data-атрибуте.

Скрипт `rich_editor.js` находит такие поля, ставит рядом редактор и пишет
HTML обратно в textarea на каждое изменение — форма отправляется как обычно,
без JavaScript-обвязки на стороне хоста. Так же устроен django-froala-editor,
на месте которого этот виджет и встаёт.
"""

from __future__ import annotations

import json
from typing import Any

from django import forms
from django.templatetags.static import static
from django.urls import NoReverseMatch, reverse
from django.utils.html import html_safe
from django.utils.translation import get_language

from .conf import get_setting

UPLOAD_KINDS = ('image', 'audio', 'file')


@html_safe
class ModuleScript:
    """
    `<script type="module">` для `Media`.

    Сборка редактора — ES-модули с чанками, обычный `<script src>` её не
    исполнит. Django с 4.1 принимает в `Media.js` объекты с `__html__`.
    """

    def __init__(self, path: str) -> None:
        self.path = path

    def __str__(self) -> str:
        return f'<script type="module" src="{static(self.path)}"></script>'

    def __eq__(self, other: object) -> bool:
        return isinstance(other, ModuleScript) and other.path == self.path

    def __hash__(self) -> int:
        return hash(self.path)


def default_upload_urls() -> dict[str, str]:
    """Адреса встроенных вьюх загрузки, если хост подключил `rich_editor.urls`."""
    urls: dict[str, str] = {}
    for kind in UPLOAD_KINDS:
        try:
            urls[kind] = reverse(f'rich_editor:upload_{kind}')
        except NoReverseMatch:
            continue
    return urls


def editor_locale() -> str:
    """`ru-ru` → `ru`: у редактора таблицы по языку, не по региону."""
    language = get_language() or 'ru'
    return language.split('-')[0].lower()


class RichEditorWidget(forms.Textarea):
    """Обычный textarea Django: конфигурация редактора едет в data-атрибуте."""

    def __init__(
        self,
        attrs: dict[str, Any] | None = None,
        *,
        toolbar: str | list[dict[str, Any]] | None = None,
        theme: str | None = None,
        legacy: bool | None = None,
        min_height: str | None = None,
        placeholder: str | None = None,
        locale: str | None = None,
        uploads: dict[str, str] | None = None,
        limits: dict[str, int] | None = None,
    ) -> None:
        super().__init__(attrs)
        self.toolbar = toolbar
        self.theme = theme
        self.legacy = get_setting('LEGACY') if legacy is None else legacy
        self.min_height = min_height
        self.placeholder = placeholder
        self.locale = locale
        self.uploads = uploads
        self.limits = limits

    def editor_config(self, name: str, attrs: dict[str, Any]) -> dict[str, Any]:
        """Всё, что скрипт передаст в `createRichEditor`."""
        uploads = default_upload_urls()
        if self.uploads:
            uploads.update(self.uploads)
        return {
            'toolbar': self.toolbar or get_setting('TOOLBAR'),
            'theme': self.theme or get_setting('THEME'),
            'legacy': bool(self.legacy),
            'minHeight': self.min_height or get_setting('MIN_HEIGHT'),
            'placeholder': self.placeholder,
            'locale': self.locale or editor_locale(),
            'uploads': uploads,
            'limits': self.limits or {},
            'csrfCookie': get_setting('CSRF_COOKIE_NAME'),
            # Имя поля для читалки — подпись поля формы, если хост её передал.
            'ariaLabel': attrs.get('aria-label') or attrs.get('data-label'),
        }

    def get_context(self, name: str, value: Any, attrs: dict[str, Any] | None) -> dict[str, Any]:
        context = super().get_context(name, value, attrs)
        widget = context['widget']
        widget['attrs']['data-rich-editor'] = json.dumps(
            self.editor_config(name, widget['attrs']),
            ensure_ascii=False,
        )
        widget['attrs'].setdefault('class', '')
        widget['attrs']['class'] = (widget['attrs']['class'] + ' rich-editor').strip()
        return context

    @property
    def media(self) -> forms.Media:
        css = ['rich_editor/styles.css']
        if self.legacy:
            css.append('rich_editor/legacy.css')
        return forms.Media(css={'all': css}, js=[ModuleScript('rich_editor/rich_editor.js')])
