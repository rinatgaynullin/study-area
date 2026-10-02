# 10. Автономная сборка и Django

## Назначение

`@rich-editor/standalone` — та же библиотека, собранная в ES-модули со всеми
зависимостями внутри, для страниц без бандлера. `django-rich-editor` кладёт
эту сборку в статику и добавляет виджет формы, поля формы и модели, серверный
санитайзер с тем же allowlist, вьюхи загрузок и теги шаблонов.

## Когда использовать

- Standalone — Django-шаблон, CDN, любая страница с одним
  `<script type="module">`.
- `django-rich-editor` — проект на Django ≥ 4.2 (Python ≥ 3.10, `nh3`); npm в
  проекте не нужен.

## Интерфейс

### Standalone: состав `dist/`

| Файл | Что даёт |
| --- | --- |
| `editor.js` | Всё API `@rich-editor/core` плюс `MATHLIVE_FONTS_DIRECTORY`; `createRichEditor` сам берёт шрифты из соседнего `fonts/` |
| `viewer.js` | Только вьюер: `createRichContent`, `applyTheme`, `DARK_THEME_CLASS`, `prepareIncomingHtml`, `upgradeLegacyHtml` |
| `chunks/` | Ленивые чанки: MathLive и MathJax грузятся при первой формуле |
| `styles.css`, `legacy.css` | Стили редактора и вьюера; compat-слой Froala |
| `fonts/` | Шрифты MathLive |

Каталог раздаётся целиком и с той же структурой: чанки и шрифты ищутся
относительно `editor.js`. Сборка и проверка: `npm run build -w @rich-editor/standalone`,
`npm run smoke:standalone`.

### Django: установка

```python
INSTALLED_APPS = [..., 'rich_editor']
urlpatterns = [..., path('rich-editor/', include('rich_editor.urls'))]
```

### Настройки `settings.RICH_EDITOR`

Один словарь; хост переопределяет только нужные ключи.

| Ключ | По умолчанию | Что делает |
| --- | --- | --- |
| `TOOLBAR` | `'full'` | Пресет или список групп, как в `createRichEditor` |
| `THEME` | `'auto'` | `light`, `dark`, `auto`; в админке виджет следует за её переключателем темы |
| `MIN_HEIGHT` | `'220px'` | Минимальная высота области ввода |
| `LEGACY` | `False` | Разбор разметки Froala + Wiris по умолчанию |
| `UPLOAD_TO` | `'rich_editor/'` | Подкаталог в `MEDIA_ROOT` |
| `IMAGE_MAX_BYTES`, `AUDIO_MAX_BYTES`, `FILE_MAX_BYTES` | 10, 20, 20 МБ | Пределы размера на сервере |
| `IMAGE_TYPES` | `jpeg png gif webp svg+xml` | Допустимые `content_type` картинок |
| `AUDIO_TYPES` | `webm ogg mpeg mp4 wav x-wav` | Допустимые `content_type` аудио |
| `FILE_TYPES` | `text/plain text/markdown text/csv` | Допустимые `content_type` текстовых файлов |
| `CSRF_COOKIE_NAME` | `settings.CSRF_COOKIE_NAME` | Cookie, которую скрипт виджета шлёт заголовком `X-CSRFToken` |

### Виджет, поля, вьюхи, теги

`RichEditorWidget` — `forms.Textarea` с конфигурацией в атрибуте
`data-rich-editor`; скрипт `rich_editor.js` ставит рядом редактор, прячет
`textarea` и пишет HTML обратно на каждое изменение, так что форма
отправляется как обычно (инлайны админки подхватываются сами).

| Параметр виджета | Тип | Что делает |
| --- | --- | --- |
| `toolbar` | `str` или `list[dict]` | Пресет или группы; иначе `RICH_EDITOR['TOOLBAR']` |
| `theme`, `legacy`, `min_height`, `placeholder` | `str`, `bool`, `str`, `str` | Как одноимённые опции редактора; иначе из настроек |
| `locale` | `str` | Иначе язык Django (`get_language()`, `ru-ru` → `ru`) |
| `uploads` | `dict[str, str]` | Адреса вьюх по видам `image`, `audio`, `file`; по умолчанию встроенные, если подключён `rich_editor.urls` |
| `limits` | `dict[str, int]` | Клиентские пределы: `maxAudioDurationSec`, `maxAudioSizeBytes`, `maxImageSizeBytes`, `maxFileSizeBytes` |

`attrs['aria-label']` или `attrs['data-label']` становится именем области ввода
для читалки. `widget.media` отдаёт `styles.css` (+ `legacy.css`) и
`<script type="module">`.

| Класс | Что делает |
| --- | --- |
| `RichTextFormField(*, sanitize=True)` | `forms.CharField` с виджетом редактора; `clean()` чистит HTML на сервере (`sanitize_html`) |
| `RichTextField(*, legacy=None)` | `models.TextField`; в формах и админке становится редактором, `legacy` уходит в виджет и в миграции |
| `sanitize_html(html)` | `nh3` с тем же allowlist, что у клиента; позитивный список CSS-свойств `STYLE_PROPERTIES` |
| `UploadView` и наследники `ImageUploadView`, `AudioUploadView`, `FileUploadView` | `POST`, поле `file`; проверяют `content_type` и размер, сохраняют в `default_storage` |
| `UploadView.has_permission(request)` | По умолчанию `is_authenticated`; переопределяется наследованием |

Вьюхи: `upload/image/`, `upload/audio/`, `upload/file/` (имена
`rich_editor:upload_image` и т. д.). Ответы: `200 {"url", "name", "size", "mime"}`,
`400 {"error": …}` (нет файла, тип, размер), `403` без прав, `405` не `POST`.
Скрипт виджета принимает и ответ `{"link": …}` старых вьюх
`django-froala-editor`.

### Теги шаблонов

| Тег | Что делает |
| --- | --- |
| `{% rich_editor_assets legacy=False %}` | Стили и скрипт редактора для страниц, где виджет не через `form.media` |
| `{% rich_viewer_assets legacy=False %}` | Стили и лёгкий скрипт вьюера |
| `{% rich_content html legacy=False sanitize=False %}` | Контейнер с документом; `sanitize=True` — чистить повторно (данные не из формы) |

### Контракт клиент — сервер

| Аспект | Клиент (`@rich-editor/core`) | Сервер (`django-rich-editor`) |
| --- | --- | --- |
| Allowlist | `HTML_TAGS`, `HTML_ATTRS`, `MATHML_*`, `ALLOWED_URI_SCHEMES` | Копия тех же списков; тест сверяет |
| `data:` в `href` | Запрещён | Проходит (nh3 применяет схемы ко всем атрибутам) — сервер мягче |
| `style` | Вырезаются `url(`, `expression`, `javascript:`, `@` | Позитивный список свойств — сервер строже |
| Пределы | `DEFAULT_LIMITS`: аудио 300 с / 10 МБ, картинка 10 МБ, файл 5 МБ | 10 / 20 / 20 МБ — не синхронизированы |
| Типы текстовых файлов | `text/*`, `application/json`, расширения `.txt .md … .yaml` | Только `FILE_TYPES`; `.json`, `.xml`, `.yaml`, `.log` получат `400` |
| Ответ загрузки | `UploadResult { url, name?, mime?, size? }` | `{"url", "name", "size", "mime"}` |

Нужны другие типы или пределы — задайте их в обоих местах
(`settings.RICH_EDITOR` и `limits` виджета).

## Пример

```python
from django.contrib import admin
from django.db import models
from rich_editor.fields import RichTextField
from rich_editor.forms import RichTextFormField
from rich_editor.widgets import RichEditorWidget

class Article(models.Model):
    body = RichTextField(blank=True)
    old_body = RichTextField(blank=True, legacy=True)

class NoteForm(forms.Form):
    text = RichTextFormField(widget=RichEditorWidget(toolbar='standard', locale='en'))

@admin.register(Article)
class ArticleAdmin(admin.ModelAdmin):
    formfield_overrides = {models.TextField: {'widget': RichEditorWidget}}
```

```django
{% load rich_editor %}
{% rich_viewer_assets %}
{% rich_content article.body %}
{% rich_content article.old_body legacy=True %}
```

Без Django — одна страница на standalone:

```html
<link rel="stylesheet" href="/static/rich-editor/styles.css" />
<div id="editor"></div>
<script type="module">
  import { createRichEditor } from '/static/rich-editor/editor.js';
  createRichEditor({ element: document.querySelector('#editor'), onChange: (html) => save(html) });
</script>
```

## Ограничения

- Статика редактора не хранится в git: перед сборкой колеса выполните
  `npm run build -w @rich-editor/standalone` и
  `node packages/django-rich-editor/scripts/sync-static.mjs`.
- Вьюхи не проверяют содержимое файла (только `content_type` из запроса) и не
  перекодируют его; для публичного приложения добавьте свою проверку.
- `rich_content` без `sanitize=True` доверяет тому, что хранится.

## См. также

- [11-security.md](11-security.md), [05-media-and-uploads.md](05-media-and-uploads.md).
- `packages/editor-standalone/README.md`, `packages/django-rich-editor/README.md`.
