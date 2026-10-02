# 11. Безопасность

Файлы: `packages/editor-core/src/security/sanitize.ts`,
`formula/mathml.ts`, `formula/mathjax.ts`, `nodes/*`,
`ui/normalize-href.ts`, `packages/django-rich-editor/rich_editor/sanitize.py`,
`views.py`. Решения — ADR 0004. Тесты — `sanitize.test.ts`,
`sanitize-contract.test.ts`, `formula.test.ts` («MathML sanitization»),
`test_sanitize.py`, e2e «strips everything executable from hostile markup».

## 11.1. Модель угроз

Редактор работает с HTML, который:

- хранится в базе и может быть написан другим пользователем (ученик →
  преподаватель, тьютор → ученик) или унаследован от Froala/Wiris;
- вставляется из буфера обмена (Word, веб-страницы, другие редакторы);
- приходит от хоста программно (`content`, `setHTML`, `v-model`) — хост может
  доверять ему меньше, чем себе;
- возвращается на сервер, где браузер не является границей безопасности —
  запрос можно собрать руками.

Основные векторы и где они закрываются:

| Вектор | Где закрыт |
| --- | --- |
| `<script>`, `on*`-обработчики, `javascript:` в `href`/`src`, `<iframe>`/`<object>`/`<embed>`/`<form>`/`<input>`/`<link>`/`<meta>` | `sanitizeHtml` (`FORBID_TAGS`, allowlist атрибутов, хук схем) |
| CSS с загрузкой/исполнением (`background: url(…)`, `expression()`, `@import`, `javascript:` в стиле) | `sanitizeStyleValue` на клиенте; `filter_style_properties` на сервере |
| `data:` URL как ссылка (фишинг через `data:text/html`) | `href` принимает только `http https mailto tel ftp blob` и относительные; `data:` только на `src` медиа и только `image|audio|video` |
| Tab-nabbing через `target="_blank"` | `rel="noopener noreferrer"` принудительно; StarterKit ставит его на новые ссылки; попover открывает ссылку с `noopener,noreferrer` |
| MathML mXSS (`<annotation-xml encoding="text/html">`), `mglyph` с внешним ресурсом, `href` в MathML | `sanitizeMathML`: отдельный allowlist, `annotation-xml`/`mglyph`/`script` запрещены, любые `href`/`xlink:href` снимаются |
| Опасный SVG (скрипты, `foreignObject`, `<a>`, `<image>`, внешние `<use href>`) | `sanitizeSvg` на выводе MathJax **до** кэша; в документе SVG ограничен набором тегов/атрибутов MathJax, `<use>` — только `#id` |
| Подменённый SVG в `data-render-host` сохранённого документа | при импорте атом не хранит детей — SVG выбрасывается и перерисовывается из MathML; при показе во вьюере SVG проходит `sanitizeHtml` |
| Непригодный/вредоносный `data-mathml` | `normalizeMathML` при разборе узла (узел отвергается), при `insertFormula`, при рендере (`renderMathML` санитизирует вход) |
| Неизвестные `data-*` атрибуты | `ALLOW_DATA_ATTR: false` — только перечисленные контракты узлов |
| Произвольный HTML внутри `legacyEmbed` | содержимое проходит `sanitizeHtml` при разборе и при программном наполнении; node view `ignoreMutation` |
| Адрес ссылки из диалога/поповера | `normalizeHref`: только `http https mailto tel`, без схемы → `https://` |
| Обход клиентской очистки | `RichTextFormField.clean` → `nh3` с тем же контрактом на сервере |
| Загрузка файлов: путь, тип, размер | сервер даёт своё имя (`uuid_basename`), отбрасывает путь, проверяет `content_type` и размер; доступ только аутентифицированным (`has_permission`) |

## 11.2. Что делает санитайзер на клиенте

Подробная таблица — [02-core.md](02-core.md#25-санитайзер). Ключевые свойства:

- **Единая точка входа.** Всё, что входит в документ, — начальный
  `content`, `setHTML`, вставка из буфера (`transformPastedHTML`), документ
  во вьюере — проходит `prepareIncomingHtml` → `sanitizeHtml`. Отдельного
  «небезопасного» пути нет.
- **Три узких санитайзера**, у каждого своя задача (HTML документа,
  значение `data-mathml`, вывод MathJax). MathML и SVG санитизируются
  независимо от HTML, потому что HTML-allowlist их бы вырезал целиком или
  пропустил лишнее.
- **Allowlist, не blocklist.** Разрешено только перечисленное; `KEEP_CONTENT:
  true` оставляет текст из запрещённых обёрток (например, из `<font>`).
- **Хуки per-element.** Схема URL проверяется с учётом атрибута (`href` vs
  `src`), а не одним regexp на всё.
- **Санитизация до кэша.** SVG попадает в LRU-кэш MathJax уже чистым;
  `renderHTML` узла формулы и node view вставляют его через `innerHTML`
  только из кэша.
- **Иконки интерфейса** (`ICONS`) — собственная константа, не
  пользовательские данные; `v-html`/`innerHTML` с ними безопасны.
- **`blob:` разрешён** и в `href`, и в `src`: без него локальный режим
  (без адаптера) не работал бы; blob-URL резолвятся только в создавшем их
  origin.

Что клиентский санитайзер **не** делает: не проверяет содержимое по URL
(изображение с `https://` может быть чем угодно — это задача CSP хоста), не
ограничивает размер документа, не защищает от утечек через внешние
`<img src="https://…">` (трекинг-пиксели проходят, если хост их не блокирует
CSP `img-src`).

## 11.3. Что делает санитайзер на сервере

`rich_editor.sanitize.sanitize_html` (nh3/ammonia) применяется в
`RichTextFormField.clean()` (кроме `sanitize=False`) и в теге
`{% rich_content … sanitize=True %}`.

- Те же списки тегов, атрибутов и схем, что на клиенте (контракт
  закреплён тестом).
- `strip_comments=True`.
- `style` фильтруется позитивным списком свойств (`STYLE_PROPERTIES`) —
  `position`, `background: url(…)`, `z-index` и т. п. не проходят.
- Сырой MathML в теле документа разрешён (`ALL_TAGS` включает MathML), чтобы
  старые документы Wiris до апгрейда не ломались.

Различия с клиентом, которые стоит знать:

- nh3 применяет `url_schemes` ко всем URL-атрибутам одинаково — `data:` в
  `href` пройдёт на сервере, хотя клиент его вырежет при следующем открытии.
- Сервер не различает `src` на медиа и вне медиа.
- Клиент мягче к `style` (пропускает любое свойство без `url(`/`expression`),
  сервер — строже. Документ, сохранённый через форму, после сервера может
  потерять часть инлайновых стилей, которые редактор пропустил бы.

## 11.4. Что остаётся на хосте

- **CSP.** Редактор не требует `unsafe-inline` для скриптов. Стили — внешние
  файлы плюс инлайновые `style`-атрибуты в контенте (нужен `style-src
  'unsafe-inline'` или хэши, если CSP ограничивает атрибуты стилей);
  MathLive и MathJax — ES-модули того же origin (standalone) или бандла.
  Ограничьте `img-src`/`media-src` своими хранилищами.
- **Хранилище загрузок.** Вьюхи Django складывают файлы в `default_storage`
  как есть; валидации содержимого (magic bytes, перекодирование) нет —
  `content_type` берётся из запроса. Для публичного приложения добавьте
  проверку содержимого и отдачу с `Content-Disposition`/отдельного домена.
- **Права.** `UploadView.has_permission` — переопределите под роли; вьюхи
  требуют только аутентификацию.
- **Документы не из формы.** API-импорт, миграции, старые данные —
  прогоняйте через `sanitize_html` на сервере; `rich_content` без
  `sanitize=True` доверяет тому, что хранится.
- **Размер документа и DoS.** Лимитов на длину HTML нет; кэши MathJax и
  превью ограничены LRU (500 и 300 записей).
- **`sanitize=False`** у `RichTextFormField` — только для доверенных
  источников.

## 11.5. Проверки, которые есть в тестах

- `sanitize.test.ts`: `<script>`, `on*`, опасные схемы в ссылках, безопасные
  схемы и `rel` на `_blank`, `blob:`/`data:` только на медиа, `iframe`/`object`/
  формы, CSS с `url()`/`expression`, SVG MathJax с вырезанием опасного,
  скрипт через SVG-обработчики, форма mXSS-пэйлоада MathML, `setHTML` и
  начальный `content`.
- `formula.test.ts`: `<script>` внутри MathML, `annotation-xml`, обработчики
  и ссылки в MathML, сохранение TeX-аннотации.
- `sanitize-contract.test.ts`: python-копия списков совпадает с TypeScript.
- e2e `editor.spec.ts`: образец «Небезопасный HTML» — ни одного `dialog`
  (alert) не сработало, `script`/`iframe`/`form`/`javascript:`/`annotation-xml`
  отсутствуют, безопасная ссылка получила `noopener noreferrer`.
- `test_sanitize.py`, `test_views.py`, `test_widget.py` на стороне Django.
