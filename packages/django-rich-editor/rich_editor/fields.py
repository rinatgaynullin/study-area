"""Поле модели: `TextField`, которое в формах и админке становится редактором."""

from __future__ import annotations

from typing import Any

from django.db import models

from .forms import RichTextFormField


class RichTextField(models.TextField):
    def __init__(self, *args: Any, legacy: bool | None = None, **kwargs: Any) -> None:
        self.legacy = legacy
        super().__init__(*args, **kwargs)

    def deconstruct(self) -> tuple[Any, ...]:
        name, path, args, kwargs = super().deconstruct()
        if self.legacy is not None:
            kwargs['legacy'] = self.legacy
        return name, path, args, kwargs

    def formfield(self, **kwargs: Any) -> Any:
        from .widgets import RichEditorWidget

        defaults: dict[str, Any] = {
            'form_class': RichTextFormField,
            'widget': RichEditorWidget(legacy=self.legacy),
        }
        defaults.update(kwargs)
        # `max_length` от TextField сюда не приходит; `widget` из админки
        # (formfield_overrides) главнее нашего.
        return super().formfield(**defaults)
