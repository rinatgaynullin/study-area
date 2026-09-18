# @rich-editor/standalone

Автономная сборка редактора для хостов без бандлера: Django-шаблоны, статика
на CDN, любая страница с одним `<script type="module">`.

`@rich-editor/core` собирается библиотекой и оставляет TipTap, MathJax,
MathLive и DOMPurify внешними — их ставит хост с бандлером. Здесь всё
внутри. Формат — ES-модули с чанками, а не один IIFE: MathLive и MathJax
остаются ленивыми и грузятся при первой формуле.

## Что в dist

| Файл | Назначение |
| --- | --- |
| `editor.js` | всё API `@rich-editor/core`; `createRichEditor` по умолчанию берёт шрифты MathLive из соседнего `fonts/` |
| `viewer.js` | только вьюер: `createRichContent`, `applyTheme`; без ProseMirror и MathLive |
| `chunks/` | ленивые чанки: MathLive, MathJax, конвертеры формул |
| `styles.css`, `legacy.css` | стили редактора и compat-слой для разметки Froala |
| `fonts/` | шрифты MathLive |

Каталог `dist` нужно раздавать целиком и с той же структурой: чанки и шрифты
ищутся относительно `editor.js`.

## Использование

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

Свой каталог шрифтов — опцией `mathliveFontsDirectory`; `null` — если
`mathlive/fonts.css` уже подключён.

## Сборка и проверка

```bash
npm run build -w @rich-editor/standalone   # dist/
npm run smoke -w @rich-editor/standalone   # dist как статика в браузере
```

Дымовая проверка поднимает статический сервер над `dist`, открывает страницу
в Chromium и проверяет: редактор смонтирован, чанк MathLive доехал, шрифты
взяты из `fonts/`, вьюер дорисовал формулу через MathJax, ошибок в консоли
нет. Django-обвязка этой сборки — `packages/django-rich-editor`.
