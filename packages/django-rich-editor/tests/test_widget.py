import json

from django import forms
from django.utils import translation

from rich_editor.forms import RichTextFormField
from rich_editor.widgets import ModuleScript, RichEditorWidget

from .models import Article


def render(widget: RichEditorWidget, value: str = '') -> str:
    return widget.render('body', value, attrs={'id': 'id_body'})


def config_of(html: str) -> dict:
    start = html.index('data-rich-editor="') + len('data-rich-editor="')
    end = html.index('"', start)
    # Атрибут заэскейплен шаблоном; браузер вернёт скрипту исходный JSON.
    return json.loads(html[start:end].replace('&quot;', '"').replace('&#x27;', "'"))


def test_widget_renders_textarea_with_config():
    html = render(RichEditorWidget(toolbar='standard', min_height='300px'), '<p>привет</p>')

    assert html.startswith('<textarea')
    assert 'class="rich-editor"' in html
    assert '&lt;p&gt;привет&lt;/p&gt;' in html

    config = config_of(html)
    assert config['toolbar'] == 'standard'
    assert config['minHeight'] == '300px'
    assert config['legacy'] is False
    assert config['theme'] == 'auto'
    assert config['csrfCookie'] == 'csrftoken'
    # Адреса встроенных вьюх: URLconf тестов подключает rich_editor.urls.
    assert config['uploads'] == {
        'image': '/rich-editor/upload/image/',
        'audio': '/rich-editor/upload/audio/',
        'file': '/rich-editor/upload/file/',
    }


def test_widget_locale_follows_django_language():
    with translation.override('en-us'):
        assert config_of(render(RichEditorWidget()))['locale'] == 'en'
    with translation.override('ru'):
        assert config_of(render(RichEditorWidget()))['locale'] == 'ru'
    assert config_of(render(RichEditorWidget(locale='en')))['locale'] == 'en'


def test_widget_uploads_can_point_at_host_views():
    config = config_of(render(RichEditorWidget(uploads={'image': '/froala_editor/image_upload/'})))
    assert config['uploads']['image'] == '/froala_editor/image_upload/'
    assert config['uploads']['file'] == '/rich-editor/upload/file/'


def test_widget_media_is_a_module_script_and_legacy_css_on_demand():
    media = RichEditorWidget().media
    assert media._css['all'] == ['rich_editor/styles.css']
    assert media._js == [ModuleScript('rich_editor/rich_editor.js')]
    assert str(media) == (
        '<link href="/static/rich_editor/styles.css" media="all" rel="stylesheet">\n'
        '<script type="module" src="/static/rich_editor/rich_editor.js"></script>'
    )

    legacy = RichEditorWidget(legacy=True).media
    assert legacy._css['all'] == ['rich_editor/styles.css', 'rich_editor/legacy.css']


def test_settings_override_defaults(settings):
    settings.RICH_EDITOR = {'TOOLBAR': 'minimal', 'THEME': 'dark', 'LEGACY': True}
    config = config_of(render(RichEditorWidget()))
    assert config['toolbar'] == 'minimal'
    assert config['theme'] == 'dark'
    assert config['legacy'] is True


class NoteForm(forms.Form):
    text = RichTextFormField(required=False)


def test_form_field_sanitizes_on_clean():
    form = NoteForm(
        data={
            'text': '<p onclick="x()">ok</p><script>alert(1)</script>'
            '<a href="javascript:alert(1)">bad</a><a href="https://a.example" rel="noopener">good</a>',
        },
    )
    assert form.is_valid()
    cleaned = form.cleaned_data['text']
    assert '<script' not in cleaned
    assert 'onclick' not in cleaned
    assert 'javascript:' not in cleaned
    assert '<a href="https://a.example" rel="noopener">good</a>' in cleaned
    assert '<p>ok</p>' in cleaned


def test_form_field_can_skip_sanitizing():
    class RawForm(forms.Form):
        text = RichTextFormField(sanitize=False)

    form = RawForm(data={'text': '<p onclick="x()">ok</p>'})
    assert form.is_valid()
    assert form.cleaned_data['text'] == '<p onclick="x()">ok</p>'


def test_model_field_uses_editor_widget_and_keeps_legacy_flag():
    body = Article._meta.get_field('body').formfield()
    assert isinstance(body, RichTextFormField)
    assert isinstance(body.widget, RichEditorWidget)
    assert body.widget.legacy is False

    old = Article._meta.get_field('old_body').formfield()
    assert old.widget.legacy is True

    _, _, _, kwargs = Article._meta.get_field('old_body').deconstruct()
    assert kwargs['legacy'] is True
    _, _, _, kwargs = Article._meta.get_field('body').deconstruct()
    assert 'legacy' not in kwargs
