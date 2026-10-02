# 10. Автономная сборка и интеграция в Django

Файлы: `packages/editor-standalone/*`, `packages/django-rich-editor/*`.

## 10.1. `@rich-editor/standalone`

`@rich-editor/core` собирается библиотекой и оставляет TipTap, MathJax,
MathLive и DOMPurify внешними — их ставит бандлер хоста. Хосту без бандлера
(Django-шаблон, статика на CDN) нужен готовый набор файлов. Автономная
сборка — те же исходники ядра (через alias на `packages/editor-core/src`),
собранные Vite в **ES-модули с чанками** (не один IIFE): MathLive и MathJax
остаются ленивыми и грузятся при первой формуле.

### Состав `dist/`

| Файл | Назначение |
| --- | --- |
| `editor.js` | всё API `@rich-editor/core` (`export * from '@rich-editor/core'`) плюс `MATHLIVE_FONTS_DIRECTORY` и своя `createRichEditor`, которая по умолчанию подставляет `mathliveFontsDirectory` = соседний `fonts/` |
| `viewer.js` | только вьюер: `createRichContent`, `applyTheme`, `DARK_THEME_CLASS`, `prepareIncomingHtml`, `upgradeLegacyHtml` + типы; без ProseMirror и MathLive |
| `chunks/[name]-[hash].js` | ленивые чанки: MathLive, MathJax, конвертеры формул; имена стабильны по содержимому |
| `styles.css` | один файл стилей на оба входа (`cssCodeSplit: false`) |
| `legacy.css` | compat-слой Froala; копируется скриптом, никем не импортируется |
| `fonts/` | шрифты MathLive, скопированные из `node_modules/mathlive/fonts` |
| `*.map` | sourcemap (в Django-пакет не копируются) |

`dist` нужно раздавать **целиком и с той же структурой**: чанки и шрифты
ищутся относительно `editor.js` (`new URL('fonts/', import.meta.url)`).

```ts
// packages/editor-standalone/src/editor.ts
export const MATHLIVE_FONTS_DIRECTORY = new URL('fonts/', import.meta.url).href;
export function createRichEditor(options: RichEditorUiOptions): RichEditorUi {
  return createCoreEditor({ mathliveFontsDirectory: MATHLIVE_FONTS_DIRECTORY, ...options });
}
```

Явная опция `mathliveFontsDirectory` главнее (включая `null`).

### Использование

```html
<link rel="stylesheet" href="/static/rich-editor/styles.css" />
<div id="editor"></div>
<script type="module">
  import { createRichEditor } from '/static/rich-editor/editor.js';
  const editor = createRichEditor({
    element: document.querySelector('#editor'),
    content: '<p>Привет</p>',
    onChange: (html) => console.log(html),
  });
</script>
```

Страница только для показа:

```html
<script type="module">
  import { createRichContent } from '/static/rich-editor/viewer.js';
  createRichContent({ element: document.querySelector('#article'), html });
</script>
```

### Сборка и проверка

```bash
npm run build -w @rich-editor/standalone   # vite build + scripts/copy-assets.mjs → dist/
npm run smoke:standalone                   # scripts/smoke.mjs
```

`smoke.mjs` поднимает статический сервер над `dist`, открывает страницу в
Chromium (Playwright) и проверяет: редактор смонтирован одним
module-скриптом (>10 кнопок в тулбаре), чанк MathLive доехал относительным
импортом (открывается диалог формул), шрифты MathLive взяты из `dist/fonts`
(`document.fonts` содержит загруженный `KaTeX_*`), вьюер дорисовал формулу
через ленивый MathJax, чанки грузятся из `dist/chunks`, в консоли нет
ошибок. Запускается в CI.

Демо-страница `apps/demo/standalone.html` подключает эту сборку из
`public/standalone/` одним `<script type="module">` без участия Vite
(`vite-ignore`); `apps/demo/scripts/sync-standalone.mjs` пересобирает и
копирует её перед `npm run dev` и `npm run build`.

## 10.2. `django-rich-editor`

Python-пакет (`pyproject.toml`, hatchling, `django>=4.2`, `nh3>=0.2.15`,
Python ≥ 3.10). Статика редактора не хранится в git: перед сборкой колеса
`scripts/sync-static.mjs` копирует `dist` автономной сборки в
`rich_editor/static/rich_editor/` (без `.map`). Руками написаны только
`rich_editor.js` и `rich_editor_viewer.js`.

### Установка

```python
INSTALLED_APPS = [..., 'rich_editor']

urlpatterns = [..., path('rich-editor/', include('rich_editor.urls'))]
```

```bash
pip install django-rich-editor
```

### Настройки `settings.RICH_EDITOR` (`conf.py`)

Один словарь; хост переопределяет только нужное. `get_setting(name)` читает
`settings.RICH_EDITOR[name]`, иначе умолчание (для `CSRF_COOKIE_NAME` —
`settings.CSRF_COOKIE_NAME` или `'csrftoken'`).

| Ключ | Умолчание | Смысл |
| --- | --- | --- |
| `TOOLBAR` | `'full'` | пресет или список групп — как в `createRichEditor` |
| `THEME` | `'auto'` | `light` / `dark` / `auto`; в админке виджет следует за её переключателем |
| `MIN_HEIGHT` | `'220px'` | |
| `LEGACY` | `False` | разбор разметки Froala + Wiris по умолчанию |
| `UPLOAD_TO` | `'rich_editor/'` | подкаталог в `MEDIA_ROOT` |
| `IMAGE_MAX_BYTES` | 10 МБ | |
| `AUDIO_MAX_BYTES` | 20 МБ | |
| `FILE_MAX_BYTES` | 20 МБ | |
| `IMAGE_TYPES` | `image/jpeg, image/png, image/gif, image/webp, image/svg+xml` | допустимые `content_type` |
| `AUDIO_TYPES` | `audio/webm, audio/ogg, audio/mpeg, audio/mp4, audio/wav, audio/x-wav` | |
| `FILE_TYPES` | `text/plain, text/markdown, text/csv` | |
| `CSRF_COOKIE_NAME` | `settings.CSRF_COOKIE_NAME` | имя cookie, которое скрипт шлёт заголовком `X-CSRFToken` |

### Виджет `RichEditorWidget` (`widgets.py`)

`forms.Textarea` с конфигурацией в `data-rich-editor` (JSON) и классом
`rich-editor`.

```python
RichEditorWidget(
    attrs=None, *,
    toolbar=None,          # str | list[dict]; иначе RICH_EDITOR['TOOLBAR']
    theme=None,            # иначе RICH_EDITOR['THEME']
    legacy=None,           # иначе RICH_EDITOR['LEGACY']
    min_height=None,
    placeholder=None,
    locale=None,           # иначе язык Django: 'ru-ru' → 'ru'
    uploads=None,          # {'image': '/my/upload/', ...} поверх встроенных вьюх
    limits=None,           # dict с ключами клиента: maxAudioDurationSec, maxAudioSizeBytes, maxImageSizeBytes, maxFileSizeBytes
)
```

`editor_config(name, attrs)` → `{toolbar, theme, legacy, minHeight,
placeholder, locale, uploads, limits, csrfCookie, ariaLabel}`; `ariaLabel`
берётся из `attrs['aria-label']` или `attrs['data-label']`. `uploads` по
умолчанию — `reverse('rich_editor:upload_image|audio|file')`, если
`rich_editor.urls` подключён (`NoReverseMatch` пропускается).

`widget.media` → `rich_editor/styles.css` (+ `legacy.css` при `legacy`) и
`ModuleScript('rich_editor/rich_editor.js')` — объект с `__html__`, который
рендерится как `<script type="module" src="…">` (обычный `<script src>` не
исполнит ES-модуль; Django ≥ 4.1 принимает такие объекты в `Media.js`).

### Поле формы и поле модели

```python
from rich_editor.forms import RichTextFormField     # forms.CharField; widget = RichEditorWidget
from rich_editor.fields import RichTextField        # models.TextField

class RichTextFormField(forms.CharField):
    def __init__(self, *args, sanitize: bool = True, **kwargs): ...
    def clean(self, value) -> str:   # sanitize_html(cleaned), если sanitize и значение непустое

class RichTextField(models.TextField):
    def __init__(self, *args, legacy: bool | None = None, **kwargs): ...   # legacy попадает в deconstruct() и в виджет
    def formfield(self, **kwargs): ...   # form_class=RichTextFormField, widget=RichEditorWidget(legacy=self.legacy); formfield_overrides админки главнее
```

```python
class Article(models.Model):
    body = RichTextField(blank=True)
    old_body = RichTextField(blank=True, legacy=True)

@admin.register(Article)
class ArticleAdmin(admin.ModelAdmin):
    formfield_overrides = {models.TextField: {'widget': RichEditorWidget}}
```

### Серверный санитайзер (`sanitize.py`)

```python
def sanitize_html(html: str) -> str
```

`nh3.clean(html, tags=HTML_TAGS ∪ MATHML_TAGS, attributes={tag: HTML_ATTRS ∪ MATHML_ATTRS},
url_schemes=ALLOWED_URI_SCHEMES, link_rel=None, strip_comments=True,
filter_style_properties=STYLE_PROPERTIES)`.

- Списки `HTML_TAGS`, `HTML_ATTRS`, `MATHML_TAGS`, `MATHML_ATTRS`,
  `ALLOWED_URI_SCHEMES` — копия TypeScript-источника; тест
  `packages/editor-core/tests/sanitize-contract.test.ts` читает python-файл и
  падает при расхождении.
- MathML-теги объединены с HTML, чтобы сырой `<math>` (старые документы Wiris
  до апгрейда) проходил; клиент такой `<math>` поднимает до узла формулы.
- `link_rel=None` — `rel="noopener noreferrer"` ставит редактор, nh3 его не
  перезаписывает.
- `STYLE_PROPERTIES` — **позитивный** список CSS-свойств (`color
  background-color font-size font-family font-weight font-style
  text-decoration text-align vertical-align width height max-width margin
  margin-left margin-right padding display float line-height white-space`);
  клиент, напротив, вырезает опасные конструкции (`url(`, `expression`,
  `javascript:`, `@`) и пропускает всё остальное.

### Вьюхи загрузок (`views.py`, `urls.py`)

```
POST /rich-editor/upload/image/   name='rich_editor:upload_image'
POST /rich-editor/upload/audio/   name='rich_editor:upload_audio'
POST /rich-editor/upload/file/    name='rich_editor:upload_file'
```

```python
@method_decorator(require_POST, name='dispatch')
class UploadView(View):
    kind: ClassVar[str] = 'file'
    types_setting: ClassVar[str] = 'FILE_TYPES'
    max_bytes_setting: ClassVar[str] = 'FILE_MAX_BYTES'

    def has_permission(self, request) -> bool: return request.user.is_authenticated   # хост уточняет наследованием
    def get_storage(self): return default_storage
    def get_upload_path(self, uploaded) -> str: ...   # UPLOAD_TO/<kind>/<uuid4>_<basename>; путь пользователя обрезается
    def post(self, request): ...

class ImageUploadView(UploadView): kind='image'; types_setting='IMAGE_TYPES'; max_bytes_setting='IMAGE_MAX_BYTES'
class AudioUploadView(UploadView): ...
class FileUploadView(UploadView): ...
```

Ответы: `403` без прав; `400 {"error": …}` если нет поля `file`, `content_type`
не в списке или размер больше предела; `405` не-POST; `200 {"url", "name",
"size", "mime"}` — абсолютный URL через `request.build_absolute_uri(storage.url(path))`.

### Теги шаблонов (`templatetags/rich_editor.py`)

```django
{% load rich_editor %}
{% rich_editor_assets legacy=True %}      {# styles.css [+ legacy.css] + <script type="module" src="rich_editor.js"> #}
{% rich_viewer_assets %}                  {# styles.css [+ legacy.css] + rich_editor_viewer.js #}
{% rich_content article.body %}           {# <div class="rte-content-root rte-content" data-rich-content>…</div> #}
{% rich_content old_text legacy=True sanitize=True %}
```

`rich_content` **не чистит** документ повторно по умолчанию: сохранённый
через `RichTextFormField` HTML уже чист. Для данных из других источников —
`sanitize=True`. `None` рендерится как пустой контейнер.

### Скрипт виджета `rich_editor.js`

```js
import { createRichEditor } from './editor.js';
export function mount(textarea): RichEditorUi | null
export function unmount(textarea): void
export function mountAll(root = document): void
window.richEditor = { mount, unmount, mountAll, mounted };
```

- Находит `textarea[data-rich-editor]`, ставит после него `<div class="rich-editor__host">`,
  прячет textarea, создаёт редактор с `content = textarea.value`,
  `editable = !disabled && !readOnly`, параметрами из конфига и адаптерами
  загрузки для каждого вида, у которого есть URL.
- На каждый `onChange` пишет HTML в `textarea.value` и диспатчит `change`
  (bubbles) — форма отправляется как обычно, админка видит правку.
- Шаблон пустой формы инлайна (`__prefix__` в имени) пропускается; новые
  инлайны подхватываются по событию `formset:added`.
- Тема: явная из конфига (не `auto`) → `data-theme` админки на `<html>`
  (`dark`/`light`) → `auto`. `MutationObserver` на `data-theme` вызывает
  `editor.setTheme()` у всех смонтированных.
- `mounted: Map<textarea, { editor, config, host }>` защищает от повторного
  монтирования.

Адаптер загрузки:

```js
POST <url>, FormData { file }, credentials: 'same-origin', headers: { 'X-CSRFToken': cookie }
→ { url | link, name?, size?, mime? }      // `link` — формат ответа старых вьюх django-froala-editor
→ при !ok или без url/link → throw new Error(data.error || `${status} ${statusText}`)
```

### Скрипт вьюера `rich_editor_viewer.js`

`render(root = document)` — для каждого `[data-rich-content]` без
`data-rich-content-ready` вызывает `createRichContent({ element, html:
element.innerHTML, legacy: hasAttribute('data-legacy'), theme })`; тема — из
`data-theme` админки или `auto`. `window.richContent = { render }`.

### Тесты

```bash
cd packages/django-rich-editor && pip install -e '.[test]' && pytest
```

`tests/`: `test_sanitize.py` (контракт, вырезание опасного, сырой MathML,
пустая строка), `test_views.py` (анонимный 403, тип/размер 400, сохранение и
формат ответа, только POST, переопределение `has_permission`),
`test_widget.py` (конфиг, локаль из Django, `uploads` хоста, `media`,
`settings.RICH_EDITOR`, санитизация в `clean`, `sanitize=False`, поле
модели с `legacy`), `test_templatetags.py`. Запускаются в CI отдельной job.

## 10.3. Контракт клиент ↔ сервер

| Аспект | Клиент (`@rich-editor/core`) | Сервер (`django-rich-editor`) |
| --- | --- | --- |
| Формат документа | HTML по контрактам узлов ([02-core.md](02-core.md#23-формат-сохраняемого-html)) | тот же HTML в `TextField`; чистится в `RichTextFormField.clean` |
| Allowlist | `HTML_TAGS/ATTRS`, `MATHML_TAGS/ATTRS`, `ALLOWED_URI_SCHEMES` | копия тех же списков (тест сверяет) |
| `data:` в `href` | запрещён (хук per-element) | nh3 `url_schemes` включает `data` для всех URL-атрибутов — **сервер мягче** |
| `style` | негативный фильтр (`url(`, `expression`, `javascript:`, `@`) | позитивный список `STYLE_PROPERTIES` — **сервер строже** (например, `background` с градиентом вырезается) |
| Сырой `<math>` | поднимается до `span[data-formula]` | пропускается как есть |
| Загрузка | `multipart/form-data`, поле `file`, `signal` для отмены | `request.FILES['file']`, проверка `content_type` (из запроса, без сниффинга) и размера |
| Ответ загрузки | `UploadResult { url, name?, mime?, size? }`; скрипт также принимает `link` | `{"url", "name", "size", "mime"}` |
| CSRF | заголовок `X-CSRFToken` из cookie `csrfCookie` | стандартный middleware Django |
| Права | — | `has_permission` → `is_authenticated` по умолчанию |
| Пределы | `DEFAULT_LIMITS`: аудио 300 с / 10 МБ, картинка 10 МБ, файл 5 МБ; `limits` виджета передаются клиенту | `IMAGE_MAX_BYTES` 10 МБ, `AUDIO_MAX_BYTES` 20 МБ, `FILE_MAX_BYTES` 20 МБ — **не синхронизированы автоматически** |
| Типы файлов | `isTextFile`: `text/*`, `application/json`, расширения `.txt .md .markdown .csv .tsv .json .log .xml .yml .yaml` | `FILE_TYPES` по умолчанию только `text/plain text/markdown text/csv` — `.json`, `.xml`, `.yaml`, `.log` будут отвергнуты сервером (клиент покажет `upload-failed`) |

Рекомендации: если нужны другие типы или пределы, задайте их **в обоих
местах** (`settings.RICH_EDITOR` и `limits` виджета); если документы
приходят не только из формы редактора (импорт, API), чистите их
`sanitize_html` на сервере и рендерите через `rich_content … sanitize=True`.
