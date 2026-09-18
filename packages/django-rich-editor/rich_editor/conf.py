"""
Настройки пакета: всё читается из `settings.RICH_EDITOR` с умолчаниями здесь.

Один словарь вместо россыпи `RICH_EDITOR_*`: так видно весь набор сразу, а
хост переопределяет только то, что ему нужно.
"""

from __future__ import annotations

from typing import Any

from django.conf import settings

DEFAULTS: dict[str, Any] = {
    # Пресет тулбара или список групп — как в `createRichEditor`.
    'TOOLBAR': 'full',
    # Тема интерфейса: light, dark или auto. В админке Django виджет сам следует
    # за переключателем темы.
    'THEME': 'auto',
    'MIN_HEIGHT': '220px',
    # Разбирать разметку старого редактора (Froala + Wiris) по умолчанию.
    'LEGACY': False,
    # Куда складывать загрузки относительно MEDIA_ROOT.
    'UPLOAD_TO': 'rich_editor/',
    'IMAGE_MAX_BYTES': 10 * 1024 * 1024,
    'AUDIO_MAX_BYTES': 20 * 1024 * 1024,
    'FILE_MAX_BYTES': 20 * 1024 * 1024,
    'IMAGE_TYPES': ('image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'),
    'AUDIO_TYPES': ('audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/x-wav'),
    'FILE_TYPES': ('text/plain', 'text/markdown', 'text/csv'),
    # Имя cookie с CSRF-токеном: скрипт виджета шлёт его заголовком.
    'CSRF_COOKIE_NAME': None,
}


def get_setting(name: str) -> Any:
    overrides = getattr(settings, 'RICH_EDITOR', {})
    if name in overrides:
        return overrides[name]
    if name == 'CSRF_COOKIE_NAME':
        return getattr(settings, 'CSRF_COOKIE_NAME', 'csrftoken')
    return DEFAULTS[name]
