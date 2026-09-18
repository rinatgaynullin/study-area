"""
Вьюхи загрузок: картинка, голосовое сообщение, текстовый файл.

Скрипт виджета шлёт `multipart/form-data` с полем `file` и CSRF-токеном в
заголовке; в ответ ждёт `{"url": ..., "name": ..., "size": ..., "mime": ...}` —
контракт `UploadResult` редактора. Хост со своими вьюхами (например, старыми
Froala) передаёт их адреса виджету: скрипт принимает и `link` вместо `url`.
"""

from __future__ import annotations

import posixpath
import uuid
from typing import ClassVar

from django.core.files.storage import default_storage
from django.core.files.uploadedfile import UploadedFile
from django.http import HttpRequest, HttpResponseForbidden, JsonResponse
from django.utils.decorators import method_decorator
from django.utils.translation import gettext as _
from django.views import View
from django.views.decorators.http import require_POST

from .conf import get_setting


@method_decorator(require_POST, name='dispatch')
class UploadView(View):
    kind: ClassVar[str] = 'file'
    types_setting: ClassVar[str] = 'FILE_TYPES'
    max_bytes_setting: ClassVar[str] = 'FILE_MAX_BYTES'

    def has_permission(self, request: HttpRequest) -> bool:
        """Кто может грузить. По умолчанию — любой вошедший; хост уточняет."""
        return request.user.is_authenticated

    def get_storage(self):
        return default_storage

    def get_upload_path(self, uploaded: UploadedFile) -> str:
        # Своё имя вместо пользовательского: без коллизий и без путей внутри.
        name = posixpath.basename(uploaded.name or 'file')
        return posixpath.join(get_setting('UPLOAD_TO'), self.kind, f'{uuid.uuid4().hex}_{name}')

    def post(self, request: HttpRequest) -> JsonResponse | HttpResponseForbidden:
        if not self.has_permission(request):
            return HttpResponseForbidden()

        uploaded = request.FILES.get('file')
        if uploaded is None:
            return JsonResponse({'error': _('Файл не передан.')}, status=400)

        allowed = tuple(get_setting(self.types_setting))
        if uploaded.content_type not in allowed:
            return JsonResponse({'error': _('Этот тип файла не поддерживается.')}, status=400)

        max_bytes = get_setting(self.max_bytes_setting)
        if uploaded.size > max_bytes:
            return JsonResponse({'error': _('Файл слишком большой.')}, status=400)

        storage = self.get_storage()
        path = storage.save(self.get_upload_path(uploaded), uploaded)
        return JsonResponse({
            'url': request.build_absolute_uri(storage.url(path)),
            'name': posixpath.basename(uploaded.name or path),
            'size': uploaded.size,
            'mime': uploaded.content_type,
        })


class ImageUploadView(UploadView):
    kind = 'image'
    types_setting = 'IMAGE_TYPES'
    max_bytes_setting = 'IMAGE_MAX_BYTES'


class AudioUploadView(UploadView):
    kind = 'audio'
    types_setting = 'AUDIO_TYPES'
    max_bytes_setting = 'AUDIO_MAX_BYTES'


class FileUploadView(UploadView):
    kind = 'file'
    types_setting = 'FILE_TYPES'
    max_bytes_setting = 'FILE_MAX_BYTES'
