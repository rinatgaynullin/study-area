"""Поле формы: виджет редактора и серверная чистка значения."""

from __future__ import annotations

from typing import Any

from django import forms

from .sanitize import sanitize_html
from .widgets import RichEditorWidget


class RichTextFormField(forms.CharField):
    widget = RichEditorWidget

    def __init__(self, *args: Any, sanitize: bool = True, **kwargs: Any) -> None:
        self.sanitize = sanitize
        super().__init__(*args, **kwargs)

    def clean(self, value: Any) -> str:
        cleaned = super().clean(value)
        if not self.sanitize or not cleaned:
            return cleaned
        return sanitize_html(cleaned)
