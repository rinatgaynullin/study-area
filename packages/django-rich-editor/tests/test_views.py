import json

import pytest
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile

pytestmark = pytest.mark.django_db


@pytest.fixture
def media_root(settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path)
    return tmp_path


@pytest.fixture
def user(django_user_model):
    return django_user_model.objects.create_user('editor', password='x')


def test_anonymous_cannot_upload(client, media_root):
    response = client.post(
        '/rich-editor/upload/image/',
        {'file': SimpleUploadedFile('a.png', b'png', content_type='image/png')},
    )
    assert response.status_code == 403


def test_rejects_wrong_type_and_size(client, user, media_root, settings):
    client.force_login(user)

    response = client.post(
        '/rich-editor/upload/image/',
        {'file': SimpleUploadedFile('a.exe', b'MZ', content_type='application/octet-stream')},
    )
    assert response.status_code == 400
    assert 'error' in json.loads(response.content)

    settings.RICH_EDITOR = {'IMAGE_MAX_BYTES': 2}
    response = client.post(
        '/rich-editor/upload/image/',
        {'file': SimpleUploadedFile('a.png', b'png', content_type='image/png')},
    )
    assert response.status_code == 400


def test_stores_file_and_answers_with_upload_result(client, user, media_root):
    client.force_login(user)

    response = client.post(
        '/rich-editor/upload/image/',
        {'file': SimpleUploadedFile('../../photo.png', b'png', content_type='image/png')},
    )
    assert response.status_code == 200
    data = json.loads(response.content)

    assert data['name'] == 'photo.png'
    assert data['size'] == 3
    assert data['mime'] == 'image/png'
    assert data['url'].startswith('http://testserver/media/rich_editor/image/')
    assert data['url'].endswith('_photo.png')

    stored = list((media_root / 'rich_editor' / 'image').iterdir())
    assert len(stored) == 1 and stored[0].read_bytes() == b'png'


def test_only_post(client, user):
    client.force_login(user)
    assert client.get('/rich-editor/upload/file/').status_code == 405


def test_permission_hook_can_be_tightened(client, user, media_root, rf):
    from rich_editor.views import ImageUploadView

    class StaffOnly(ImageUploadView):
        def has_permission(self, request):
            return request.user.is_staff

    request = rf.post(
        '/upload/',
        {'file': SimpleUploadedFile('a.png', b'png', content_type='image/png')},
    )
    request.user = user
    assert StaffOnly.as_view()(request).status_code == 403
