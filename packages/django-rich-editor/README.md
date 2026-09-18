# django-rich-editor

Django-обвязка редактора из этого монорепозитория: виджет формы, поле формы с
серверной санитизацией, поле модели, вьюхи загрузок и теги шаблонов. Сборка
самого редактора (`@rich-editor/standalone`) лежит в статике пакета, поэтому
проекту не нужен npm.

## Установка

```bash
pip install django-rich-editor
```

```python
INSTALLED_APPS = [..., 'rich_editor']

urlpatterns = [..., path('rich-editor/', include('rich_editor.urls'))]
```

Вьюхи загрузок отдают `{"url", "name", "size", "mime"}` и требуют вошедшего
пользователя; права уточняются наследованием от `rich_editor.views.UploadView`.
Хост со своими вьюхами передаёт их адреса виджету (`uploads={'image': '/my/upload/'}`);
скрипт принимает и ответ вида `{"link": ...}`, как у django-froala-editor.

## Формы и админка

```python
from rich_editor.fields import RichTextField          # поле модели
from rich_editor.forms import RichTextFormField       # поле формы
from rich_editor.widgets import RichEditorWidget      # только виджет

class Article(models.Model):
    body = RichTextField(blank=True)

class ArticleForm(forms.ModelForm):
    class Meta:
        model = Article
        fields = ['body']

class NoteForm(forms.Form):
    text = RichTextFormField(widget=RichEditorWidget(toolbar='standard', legacy=True))

@admin.register(Article)
class ArticleAdmin(admin.ModelAdmin):
    formfield_overrides = {models.TextField: {'widget': RichEditorWidget}}
```

Поле формы чистит HTML на сервере (`nh3`) по тому же контракту, что и
редактор в браузере: `rich_editor.sanitize.sanitize_html`. Виджет отдаёт
стили и скрипт через `form.media`; инлайны админки и её переключатель темы
подхватываются сами.

Параметры виджета: `toolbar` (пресет или список групп), `theme`
(`light` / `dark` / `auto`), `legacy` (разметка Froala + Wiris), `min_height`,
`placeholder`, `locale`, `uploads`, `limits`. Умолчания — в `settings.RICH_EDITOR`
(см. `rich_editor/conf.py`).

## Шаблоны

```django
{% load rich_editor %}

{# страница с формой, где виджет не через form.media #}
{% rich_editor_assets legacy=True %}

{# страница просмотра #}
{% rich_viewer_assets %}
{% rich_content article.body %}
{% rich_content old_text legacy=True sanitize=True %}
```

`rich_content` не чистит документ повторно: сохранённый через поле формы
HTML уже чист. Для данных из других источников — `sanitize=True`.

## Сборка пакета

Статика редактора не хранится в git. Перед сборкой колеса:

```bash
npm run build -w @rich-editor/standalone
node packages/django-rich-editor/scripts/sync-static.mjs
cd packages/django-rich-editor && python -m build
```

## Тесты

```bash
cd packages/django-rich-editor
pip install -e '.[test]'
pytest
```
