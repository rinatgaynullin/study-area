# 11. Безопасность

## Назначение

Всё, что входит в документ — начальный `content`, `setHTML()`, вставка из
буфера, `v-model`, документ во вьюере, — проходит санитайзер DOMPurify с
allowlist тегов, атрибутов и схем URL. Те же списки повторяет серверный
санитайзер `django-rich-editor` (`nh3`), потому что браузер не граница
безопасности. MathML формул и SVG MathJax чистятся отдельными санитайзерами.

## Когда использовать

- Ничего включать не нужно: отдельного «небезопасного» пути входа нет.
- Экспорты `sanitizeHtml`, `sanitizeMathML`, `sanitizeSvg` и списки allowlist —
  для своих узлов, серверов на Node и проверок.

## Интерфейс

Сигнатуры — [14-api-reference.md](14-api-reference.md#контракт-документа-санитайзер).

| Функция | Вход | Что вырезает |
| --- | --- | --- |
| `sanitizeHtml(html)` | HTML документа | Всё вне `HTML_TAGS`/`HTML_ATTRS`; `script style iframe object embed form input link meta`; обработчики `on*`; неразрешённые `data-*` |
| `sanitizeMathML(mathml)` | Значение `data-mathml` | Всё вне `MATHML_TAGS`/`MATHML_ATTRS`; `annotation-xml` (mXSS), `mglyph`, `script`, любые `href`; `''`, если это не `<math>` |
| `sanitizeSvg(svg)` | Вывод MathJax | `script`, `foreignObject`, `a`, `image`; `use` только с локальным `#id` |

Правила для URL и стилей в `sanitizeHtml`:

| Атрибут | Разрешено |
| --- | --- |
| `href` | `http https mailto tel ftp blob` и относительные адреса; `data:` — никогда |
| `src` | `http https blob`, относительные, `data:image/*`, `data:audio/*`, `data:video/*` |
| `style` | Объявления без `url(`, `expression`, `javascript:` и не начинающиеся с `@` |
| `target="_blank"` | Принудительно `rel="noopener noreferrer"` |

Контракт документа экспортируется константами `HTML_TAGS`, `HTML_ATTRS`,
`MATHML_TAGS`, `MATHML_ATTRS`, `SVG_EXTRA_ATTRS`, `ALLOWED_URI_SCHEMES`
(`http https mailto tel ftp blob data`). Серверная копия —
`rich_editor/sanitize.py`; тест `sanitize-contract.test.ts` падает при
расхождении. Публичного API «добавить тег» нет: новая разметка либо
укладывается в allowlist (`div`, `span`, `class`, разрешённые `data-*`), либо
меняется в обоих файлах.

Отличия сервера: `data:` в `href` проходит (nh3 применяет схемы ко всем
атрибутам); `style` фильтруется позитивным списком `STYLE_PROPERTIES` —
строже клиента.

## Пример

```ts
import { sanitizeHtml, HTML_TAGS, normalizeMathML } from '@rich-editor/core';

const clean = sanitizeHtml(untrustedHtml);          // то же, что делает редактор на входе
const mathml = normalizeMathML(untrustedMathml);    // '' — непригодно
const allowed = HTML_TAGS.includes('iframe');       // false
```

## Ограничения

Что остаётся на хосте:

- CSP: ограничьте `img-src` и `media-src`; инлайновые `style`-атрибуты в
  контенте требуют `style-src 'unsafe-inline'` или хэшей.
- Содержимое загрузок: вьюхи Django проверяют только `content_type` и размер;
  права — `UploadView.has_permission` (по умолчанию аутентификация).
- Документы не из формы (импорт, миграции, API) — прогоняйте через
  `sanitize_html` на сервере.
- Размер документа не ограничивается.
- Санитайзер не проверяет, что лежит по внешнему URL: трекинг-пиксели
  `<img src="https://…">` проходят, если их не блокирует CSP.

## См. также

- [02-core.md](02-core.md#вход-документа-prepareincominghtml), [04-formulas.md](04-formulas.md).
- [10-standalone-and-django.md](10-standalone-and-django.md#контракт-клиент--сервер).
- `docs/adr/0004-formula-html-contract.md`.
