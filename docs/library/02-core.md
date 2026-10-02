# 2. Ядро: `RichEditorCore`, схема документа, формат HTML, санитайзер, legacy

Файлы: `packages/editor-core/src/rich-editor-core.ts`, `types.ts`,
`prepare-html.ts`, `security/sanitize.ts`, `nodes/*`, `extensions/*`,
`legacy/*`.

## 2.1. `RichEditorCore`

Класс, который собирает TipTap `Editor` с набором расширений пакета и даёт
хосту единый API для контента, формул и медиа. Это «headless»-уровень: без
тулбара и диалогов. На нём построены `createRichEditor` (ядро + интерфейс) и
Vue-обёртка.

```ts
import { RichEditorCore } from '@rich-editor/core';

const core = new RichEditorCore({
  element: document.querySelector('#editor')!,
  content: '<p>Привет</p>',
  onChange: (html) => save(html),
  onFormulaEdit: (payload) => openOwnFormulaDialog(payload),
});
```

### Опции (`RichEditorCoreOptions`)

```ts
interface RichEditorCoreOptions {
  element: HTMLElement;                 // куда монтировать; только на клиенте
  content?: string;                     // начальный HTML (проходит prepareIncomingHtml)
  editable?: boolean;                   // по умолчанию true
  placeholder?: string;                 // по умолчанию t('editor_placeholder')
  ariaLabel?: string;                   // имя области ввода для читалки; по умолчанию t('editor_aria_label')
  locale?: string;                      // по умолчанию 'ru'
  messages?: Record<string, Messages>;  // таблицы переводов хоста
  limits?: Partial<EditorLimits>;       // поверх DEFAULT_LIMITS
  uploadImage?: UploadAdapter;
  uploadAudio?: UploadAdapter;
  uploadFile?: UploadAdapter;
  formulaScale?: number;                // масштаб формул; 1 по умолчанию
  extensions?: unknown[] | ((context: { t: Translate }) => unknown[]);
  legacy?: boolean;                     // разбор разметки Froala + Wiris; false по умолчанию
  onChange?: (html: string) => void;
  onSelectionUpdate?: (editor: Editor) => void;
  onTransaction?: (editor: Editor) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onUpload?: (event: UploadEvent) => void;
  onFormulaEdit?: (payload: FormulaPayload) => void;
  onError?: (error: RichEditorError) => void;
}
```

`extensions` может быть функцией: она вызывается при сборке и получает
переводчик `t` — для расширений, которым нужны локализованные подписи.

### Публичные поля и методы

| Член | Сигнатура | Поведение |
| --- | --- | --- |
| `editor` | `readonly editor: Editor` | TipTap-редактор; через него доступны `chain()`, `commands`, `state`, `view` |
| `uploads` | `readonly uploads: UploadPipeline` | Пайплайн загрузок (см. [05](05-media-and-uploads.md)) |
| `getHTML()` | `(): string` | Синхронно сериализует документ. SVG формул берётся из кэша MathJax |
| `getJSON()` | `(): Record<string, unknown>` | ProseMirror JSON |
| `getText()` | `(): string` | Текст без разметки |
| `setHTML(html, options?)` | `(html: string, options?: { emitUpdate?: boolean }): void` | Заменяет документ через `prepareIncomingHtml`. **`emitUpdate` по умолчанию `false`** — `onChange` не вызывается |
| `isEmpty()` | `(): boolean` | `editor.isEmpty` |
| `focus()` | `(): void` | `editor.commands.focus()` |
| `setEditable(editable)` | `(editable: boolean): void` | Переключает режим чтения у движка (тулбар прячет оболочка) |
| `whenFormulasReady()` | `(): Promise<void>` | Ждёт все незавершённые рендеры MathJax; у уничтоженного редактора резолвится сразу |
| `setLocale(locale)` | `(locale: string): void` | Меняет язык переводчика ядра (подписи уже созданных node view не пересобираются) |
| `setMessages(messages)` | `(messages: Record<string, Messages> \| undefined): void` | Заменяет таблицы хоста |
| `t(key, params?)` | `Translate` | Переводчик, привязанный к текущей локали |
| `setLimits(limits)` / `getLimits()` | `(limits: Partial<EditorLimits>): void` / `(): EditorLimits` | Меняет пределы у живого редактора и у пайплайна |
| `insertFormula(mathml, type?)` | `(mathml: string, type: FormulaType = 'math'): boolean` | Нормализует MathML (`normalizeMathML`); пустой результат → ошибка `invalid-mathml` и `false` |
| `updateFormulaAt(pos, mathml, type?)` | `(pos: number, mathml: string, type?: FormulaType): boolean` | Меняет атрибуты узла формулы по позиции |
| `deleteFormulaAt(pos)` | `(pos: number): boolean` | Удаляет узел формулы |
| `insertImageFile(file, at?)` | `(file: File, at?: number): Promise<boolean>` | `uploads.upload('image')` → `insertImageUrl` |
| `insertImageUrl(result, at?)` | `(result: UploadResult, at?: number): boolean` | `setImage({ src: result.url, alt: result.name ?? '' })` |
| `insertRecording(blob, meta)` | `(blob: Blob, meta: { duration: number; peaks?: string; name?: string }): Promise<boolean>` | Оборачивает blob в `File` с именем `voice-<timestamp>.<ext>` (расширение по MIME: webm/ogg/m4a/mp3/wav); при наличии `uploadAudio` грузит через пайплайн, иначе — `toObjectUrl` напрямую (без проверки размера) |
| `insertAudio(attributes)` | `(attributes: AudioAttributes): boolean` | Вставляет узел голосового сообщения |
| `attachTextFile(file)` | `(file: File): Promise<boolean>` | `uploads.upload('file')` → чип-вложение |
| `insertAttachment(attributes)` | `(attributes: AttachmentAttributes): boolean` | Вставляет узел вложения |
| `insertTextFileContent(file)` | `(file: File): Promise<boolean>` | Читает файл как UTF-8 и вставляет абзацами; Markdown **не разбирается**; размер сверяется с `maxFileSizeBytes` |
| `destroy()` | `(): void` | `uploads.destroy()` (abort + revoke blob) и `editor.destroy()` |

### Что делает конструктор

1. Создаёт переводчик (`createI18n`) и пределы `{ ...DEFAULT_LIMITS, ...limits }`.
2. Создаёт `UploadPipeline` с адаптерами по видам и колбэками `onError`/`onUpload`.
3. Создаёт TipTap `Editor`:
   - `content` проходит `prepareIncomingHtml(content, { legacy })`;
   - атрибуты области: `class="rte-content"` (+ `rte-legacy`), `role="textbox"`,
     `aria-multiline="true"`, `aria-label`, `aria-placeholder`;
   - `transformPastedHTML` → `prepareIncomingHtml` (вставка из буфера идёт тем
     же путём, что и `setHTML`);
   - `handlePaste` / `handleDrop` → маршрутизация файлов (см. ниже);
   - `onUpdate` → `onChange(getHTML())`; `onSelectionUpdate`, `onTransaction`,
     `onFocus`, `onBlur` пробрасываются.

### Маршрутизация файлов при вставке и перетаскивании

`insertFiles()` берёт из `FileList` файлы, которые подходят под картинку
(`image/*`), текстовый файл (`isTextFile`) или аудио (`audio/*`); остальные
игнорируются (ProseMirror обрабатывает событие сам). Файлы вставляются
**строго по очереди** (каждая вставка двигает курсор):

- картинка → `insertImageFile(file, pos)`;
- `audio/*` → загрузка через `uploads.upload('audio')` и `insertAudio` с
  `duration: null`, `peaks: null` (осциллограммы у внешнего файла нет);
- текстовый файл → `attachTextFile(file)` (всегда как вложение, не как текст).

Ответ ProseMirror синхронный (`true`, если хоть один файл принят), сами
загрузки не ожидаются — ошибки идут в `onError`.

## 2.2. Набор расширений и схема документа

`buildExtensions()` собирает (в этом порядке):

| Расширение | Настройки | Что даёт в схеме |
| --- | --- | --- |
| `StarterKit` (`@tiptap/starter-kit`) | заголовки 1–6; `link`: `openOnClick: false`, `autolink: true`, `protocols: ['http','https','mailto','tel']`, `rel="noopener noreferrer"`; `codeBlock` с классом `rte-code-block` | абзацы, заголовки, списки, цитата, код, блок кода, `hr`, жирный/курсив/подчёркнутый/зачёркнутый, ссылки, undo/redo, placeholder-инфраструктура и т. д. |
| `StrictTextStyle` (`extensions/strict-text-style.ts`) | — | Марка `textStyle`, которая разбирает **только** `<span>` со `style` `color` или `font-size`. Штатное правило цеплялось к любому `span[style]` и порождало пустые марки в разметке Froala, ломая идемпотентность |
| `Color`, `FontSize` (`@tiptap/extension-text-style`) | — | `style="color: …"`, `style="font-size: …"`. `FontSize` не привязан к legacy-режиму намеренно: один документ должен выглядеть одинаково с флагом и без |
| `Highlight` или `LegacyHighlight` | `multicolor: true` | `<mark data-color style="background-color">`; в legacy-режиме дополнительно разбирается `span[style*="background-color"]` |
| `Subscript`, `Superscript` | — | `<sub>`, `<sup>` |
| `TextAlign` | `types: ['heading', 'paragraph']` | `style="text-align: …"` |
| `TableKit` (`@tiptap/extension-table`) | `resizable: true`, класс `rte-table` | `table/tableRow/tableHeader/tableCell`, `colwidth` |
| `Image` | `inline: legacy` (блочная в обычном режиме, инлайновая в legacy), `allowBase64: true`, класс `rte-image`, `resize: { enabled, alwaysPreserveAspectRatio, minWidth: 40, minHeight: 40 }` | `<img src alt width height>`; ручки по четырём углам, пропорции сохраняются всегда |
| `Placeholder` | `placeholder ?? t('editor_placeholder')` | подсказка пустого документа |
| `FormulaNode` | `onEdit`, `scale` | атомарный инлайновый узел `formula` |
| `AudioNode` | `t` | блочный атомарный узел `audioMessage` |
| `AttachmentNode` | `t` | блочный атомарный узел `attachment` |
| `LegacyEmbedNode` | только при `legacy` | инлайновый атомарный узел `legacyEmbed` |
| расширения хоста / features | `options.extensions` | — |

### Узел формулы (`nodes/formula.ts`)

- `name: 'formula'` (`FORMULA_NODE_NAME`), `inline: true`, `group: 'inline'`,
  `atom: true`, `selectable: true`, `draggable: false`.
- Атрибуты: `mathml` (из `data-mathml`, при разборе проходит `normalizeMathML`;
  узел **отвергается**, если MathML не восстановился), `formulaType`
  (`'math' | 'chem'` из `data-formula-type`).
- `renderHTML` пишет `role="img"`, `aria-label` = LaTeX из аннотации (или
  текст MathML), и подставляет SVG из кэша MathJax для `fontSizePx = 15 * scale`.
- Node view: рисует `…` пока рендер идёт, `⚠` если рендер не удался; клик
  (`mousedown`, не `click` — ProseMirror перерисовывает node view при выделении
  атома) выделяет узел и зовёт `onEdit({ mathml, type, pos })`. В режиме
  чтения клик ничего не делает.
- Клавиатура: `Enter` на выделенной формуле открывает редактор.
- Команды: `insertFormula({ mathml, type? })`, `updateFormula({ pos, mathml, type? })`,
  `deleteFormulaAt(pos)`.

Атомарность — главный контракт: у ProseMirror нет позиций внутри узла,
поэтому Backspace/Delete/выделение всегда работают с формулой целиком
(ADR 0004).

### Узел голосового сообщения (`nodes/audio.ts`)

- `name: 'audioMessage'` (`AUDIO_NODE_NAME`), `group: 'block'`, `atom`,
  `draggable`, `selectable`.
- Атрибуты (`AudioAttributes`): `src`, `name`, `mime`, `duration` (секунды или
  `null`), `peaks` (строка целых 0..99 через запятую).
- Разбор: `div[data-audio]` с `data-src` или вложенным `<audio src>`.
- Экспорт: `<div data-audio data-src class="rte-audio"><audio controls preload="metadata" src class="rte-audio__native">` —
  документ воспроизводится и без редактора.
- Node view: плеер с осциллограммой (`role="group"` с именем, кнопка
  play/pause, осциллограмма — `role="slider"` с `aria-valuenow/max/text`,
  `←/→/↑/↓` перематывают на 5 секунд, `Home/End` — к краям, `Escape`
  возвращает каретку в документ). Без `peaks` рисуется 40 одинаковых столбиков.
- Команда: `insertAudio(attributes)` (отвергает пустой `src`).

### Узел вложения (`nodes/attachment.ts`)

- `name: 'attachment'` (`ATTACHMENT_NODE_NAME`), `group: 'block'`, `atom`,
  `draggable`, `selectable`.
- Атрибуты (`AttachmentAttributes`): `href`, `name`, `size`, `mime`.
- Разбор: `div[data-attachment]` с `data-href` или вложенным `<a href>`.
- Экспорт: `<div data-attachment data-href data-name data-size class="rte-attachment"><a href download rel="noopener noreferrer" class="rte-attachment__link">имя (размер)</a></div>`.
- Node view: иконка, ссылка с `aria-label="Скачать: имя"`, размер.
- Команда: `insertAttachment(attributes)` (отвергает пустой `href`).

### Узел `legacyEmbed` (`nodes/legacy-embed-node.ts`)

Инлайновый атом для фрагментов Froala, которые нечем смоделировать: готовый
вывод MathJax (`.formula-rendered`) и структурные формулы химии из JSME
(`.formula-chemistry-structure`). Хранит разметку в атрибуте `html`
(санитизируется ещё раз при разборе и при программном наполнении) и отдаёт её
обратно без изменений. Выделяется и удаляется, но не редактируется. В схему
попадает только при `legacy: true`.

## 2.3. Формат сохраняемого HTML

`getHTML()` отдаёт обычный HTML. Контракты собственных узлов:

```html
<!-- формула: MathML — источник истины, SVG — переносимая проекция -->
<span data-formula="true" data-formula-type="math"
      data-mathml="&lt;math xmlns=&quot;http://www.w3.org/1998/Math/MathML&quot; display=&quot;inline&quot; data-formula-type=&quot;math&quot;&gt;&lt;semantics&gt;…&lt;annotation encoding=&quot;application/x-tex&quot;&gt;\frac{a}{b}&lt;/annotation&gt;&lt;/semantics&gt;&lt;/math&gt;"
      contenteditable="false" class="rte-formula" role="img" aria-label="\frac{a}{b}">
  <span class="rte-formula__render" data-render-host="true"><svg …>…</svg></span>
</span>

<!-- голосовое сообщение -->
<div data-audio="true" data-src="https://…/voice.webm" data-name="voice.webm"
     data-mime="audio/webm" data-duration="12.4" data-peaks="3,18,42,…" class="rte-audio">
  <audio controls="controls" preload="metadata" src="https://…/voice.webm" class="rte-audio__native"></audio>
</div>

<!-- вложение -->
<div data-attachment="true" data-href="https://…/notes.txt" data-name="notes.txt"
     data-size="1204" data-mime="text/plain" class="rte-attachment">
  <a href="https://…/notes.txt" download="notes.txt" rel="noopener noreferrer" class="rte-attachment__link">notes.txt (1.2 KB)</a>
</div>

<!-- legacy-фрагмент (только legacy-режим) -->
<span data-legacy-embed="true" class="rte-legacy-embed" contenteditable="false"><svg …>…</svg></span>
```

Остальное — стандартный HTML TipTap: `<p>`, `<h1>…<h6>`, `<ul>/<ol>/<li>`
(внутри `<li>` — `<p>`), `<blockquote>`, `<code>`, `<pre class="rte-code-block"><code>`,
`<hr>`, `<strong>/<em>/<u>/<s>`, `<sub>/<sup>`,
`<a href rel="noopener noreferrer" [target="_blank"] [class]>`,
`<img class="rte-image" src alt [width height]>`, `<table class="rte-table">` с
`<colgroup>`/`colwidth`, `<mark data-color style="background-color">`,
`<span style="color: …; font-size: …">`, `style="text-align: …"` на абзацах и
заголовках.

Размер формулы **запечён в пикселях** внутри SVG (`width`/`height`/`vertical-align`
в `px`, пересчитанные из `ex` MathJax по коэффициенту 0.6 для кегля 15 px по
умолчанию), поэтому формула выглядит одинаково в абзаце, ячейке таблицы и
заголовке и не реагирует на `font-size` окружения. Масштаб задаётся опцией
`formulaScale` **при рендере**, а не стилем.

Экспортированный документ содержит только то, что пропускает санитайзер, —
то есть его можно отдавать во вьюер или в любой другой HTML-контекст без
дополнительной очистки (при условии, что он не менялся вне редактора).

## 2.4. `prepareIncomingHtml`

```ts
export interface PrepareIncomingHtmlOptions { legacy?: boolean }
export const prepareIncomingHtml: (html: string, options?: PrepareIncomingHtmlOptions) => string;
```

Единственный путь входа контента: начальный `content`, `setHTML()`,
вставка из буфера (`transformPastedHTML`), документ во вьюере
(`createRichContent`). Живёт отдельно от движка, чтобы вьюер не тянул
TipTap/ProseMirror.

```
upgradeLegacyHtml (если legacy) → inlineMathMLToFormulaNodes → sanitizeHtml
```

`inlineMathMLToFormulaNodes(html)` находит сырые `<math>` (не внутри
`span[data-formula]`), прогоняет через `normalizeMathML` и заменяет на
`span[data-formula]` с `data-formula-type` из `data-formula-type` MathML (по
умолчанию `math`). Невосстановимый `<math>` заменяется пустым `<span>`. Так
MathML, вставленный из другого редактора, становится редактируемой формулой,
а не вырезается санитайзером.

## 2.5. Санитайзер

`security/sanitize.ts`. Три независимых экземпляра DOMPurify (ленивая
инициализация, нужен DOM — на сервере вызов бросает ошибку):

| Функция | Вход | Правила |
| --- | --- | --- |
| `sanitizeHtml(html)` | HTML документа | `ALLOWED_TAGS = HTML_TAGS`, `ALLOWED_ATTR = HTML_ATTRS`, `ALLOWED_URI_REGEXP` (схемы `http https mailto tel ftp blob data` + относительные), `ALLOW_DATA_ATTR: false` (разрешены **только перечисленные** `data-*`), `FORBID_TAGS: script style iframe object embed form input link meta`, `KEEP_CONTENT: true` (текст из запрещённых обёрток остаётся) |
| `sanitizeMathML(mathml)` | значение `data-mathml` | `ALLOWED_TAGS = MATHML_TAGS`, `ALLOWED_ATTR = MATHML_ATTRS`, `FORBID_TAGS: script annotation-xml mglyph`; добавляет `xmlns`, если его нет; разбирает как HTML (MathLive пишет именованные сущности `&ne;`, недопустимые в XML); результат должен начинаться с `<math`, иначе `''` |
| `sanitizeSvg(svg)` | вывод MathJax | `USE_PROFILES: { svg: true, svgFilters: false }`, `ADD_TAGS: ['use']`, `ADD_ATTR: SVG_EXTRA_ATTRS`, `FORBID_TAGS: script foreignObject a image` |

Хуки `afterSanitizeAttributes` у HTML-санитайзера:

- `href`: только `http: https: mailto: tel: ftp: blob:` или относительный
  адрес; `data:` в ссылках **никогда**; иначе атрибут удаляется;
- `src`: `http: https: blob:` или `data:image/* | audio/* | video/*`;
- `style`: удаляются объявления, содержащие `url(`, `expression`,
  `javascript:` или начинающиеся с `@`; пустой `style` снимается;
- `<a target="_blank">` получает `rel="noopener noreferrer"`;
- `<use href|xlink:href>` — только локальные `#id`.

У MathML-санитайзера хук снимает любые `href`/`xlink:href`; у SVG — оставляет
только локальные `#id` (MathJax ссылается на собственные инлайн-глифы).

### Что разрешено (контракт документа)

Списки экспортируются из `@rich-editor/core` и **повторяются** в
`packages/django-rich-editor/rich_editor/sanitize.py`; тест
`tests/sanitize-contract.test.ts` читает python-файл и падает при расхождении.

- `HTML_TAGS`: `p br hr h1–h6 strong b em i u s del ins mark small code pre blockquote ul ol li a span div img figure figcaption audio source table thead tbody tfoot tr th td caption colgroup col sub sup` и SVG-набор MathJax: `svg g defs path use rect line circle ellipse polygon polyline text tspan title`.
- `HTML_ATTRS`: `href target rel download src alt title class style colspan rowspan colwidth span width height controls preload type lang dir start reversed value`; контракты узлов: `data-formula data-formula-type data-mathml aria-label data-audio data-duration data-peaks data-name data-mime data-attachment data-size data-text-align data-render-host data-legacy-embed data-color`; атрибуты SVG: `viewBox viewbox xmlns xmlns:xlink xlink:href d transform fill stroke stroke-width focusable role aria-hidden data-c data-mml-node x y rx ry text-anchor font-family font-size id`.
- `MATHML_TAGS`: `math semantics annotation mrow mi mn mo ms mtext mspace mfrac msqrt mroot mstyle merror mpadded mphantom menclose msub msup msubsup munder mover munderover mmultiscripts mprescripts none mtable mtr mtd mlabeledtr maligngroup malignmark mfenced maction`. **Нет** `annotation-xml` (классический mXSS-вектор с `encoding="text/html"`) и `mglyph` (внешние ресурсы).
- `MATHML_ATTRS`: презентационные атрибуты MathML (`display displaystyle mathvariant mathsize mathcolor … columnalign rowalign … actiontype selection`) плюс `encoding` (для `<annotation>`) и `data-formula-type`.
- `ALLOWED_URI_SCHEMES`: `http https mailto tel ftp blob data`.

### Как расширять

Списки — константы модуля; публичного API «добавить тег» нет. Варианты:

1. **Не трогать санитайзер**, а описать новую возможность в рамках allowlist
   (например, узел с `<div class="…" data-name>` — `class` и `data-name` уже
   разрешены). Это предпочтительный путь.
2. Если нужен новый тег/атрибут — менять `HTML_TAGS`/`HTML_ATTRS` в
   `sanitize.ts` **и** в `sanitize.py`, иначе `sanitize-contract.test.ts`
   упадёт, а сервер начнёт портить документы.
3. Расширение TipTap обязано в `parseHTML` работать только с тем, что
   санитайзер пропустит, — иначе узел молча исчезнет при открытии.

Проверочная функция `resetSanitizers()` — тестовый шов, сбрасывает кэш
экземпляров DOMPurify.

## 2.6. Legacy-режим (Froala + Wiris)

Включается опцией `legacy: true` (`RichEditorCore`, `createRichEditor`,
`createRichContent`, проп `legacy` у Vue-компонентов, `legacy=True` в
Django). Выключен по умолчанию: хостам без старых данных незачем платить
разбором документа на каждый `setHTML`. Стили старой разметки — отдельный
файл `legacy.css` (`@rich-editor/core/legacy.css`, `@rich-editor/vue/legacy.css`),
работающий только внутри `.rte-content.rte-legacy`.

### Что делает `upgradeLegacyHtml(html)`

Запускается до санитайзера. Быстрая проверка — регулярка
`/Wiris|formula-rendered|formula-chemistry-structure/i`; если признаков нет,
документ не разбирается.

| Исходная разметка | Результат |
| --- | --- |
| `<img class="Wirisformula" data-mathml="…">`, `<img class="Wiriscas" …>` | `decodeWirisMathml(data-mathml)` → `normalizeMathML` → `span[data-formula]` с `data-formula-type` из MathML. Если MathML не восстановился — картинка остаётся как есть |
| `.formula-rendered` (вывод MathJax), `.formula-chemistry-structure` (JSME) | `span[data-legacy-embed]` с исходным `innerHTML` (вложенные embed уходят вместе с родителем) |

`decodeWirisMathml(raw)` понимает две кодировки `data-mathml`:

- HTML-экранирование, часто двойное (`&amp;lt;math&amp;gt;`) — снимается до
  3 проходов через `<textarea>.innerHTML`, пока не появится `<math`;
- «безопасный XML» Wiris: `«` → `<`, `»` → `>`, `¨` → `"`, `§` → `&`,
  `` ` `` → `'`.

Возвращает `''`, если `<math` так и не появился.

### Что меняется в схеме при `legacy: true`

- `LegacyHighlight` вместо `Highlight`: `span[style*="background-color"]`
  → марка `highlight` с исходным цветом (`data-color`).
- `Image` становится **инлайновым** (`inline: true`): в разметке Froala
  картинка всегда внутри абзаца, блочный узел разорвал бы его.
- В схему добавляется `LegacyEmbedNode`.
- Класс `rte-legacy` на области ввода / вьюере включает `legacy.css`.

`FontSize` и `StrictTextStyle` работают в обоих режимах — один и тот же
HTML с инлайновыми стилями даёт одинаковый результат с флагом и без (это
проверяет тест `legacy-froala.test.ts`).

### Что покрывает `legacy.css`

Классы Froala, переписанные с нуля (вендорный CSS не копировался —
ADR 0007): `fr-dib`, `fr-dii`, `fr-fil`, `fr-fir` (раскладка картинок),
`fr-rounded`, `fr-bordered`, `fr-shadow`, `fr-img-caption`/`fr-img-wrap`/`fr-inner`
(подписи), `fr-dashed-borders`, `fr-alternate-rows`, `fr-highlighted`,
`fr-thick` (таблицы), `fr-file`, `fr-green`, `fr-strong` (ссылки),
`fr-class-highlighted`, `fr-class-code`, `fr-class-transparency`,
`fr-text-gray`, `fr-text-bordered`, `fr-text-spaced`, `fr-text-uppercase`,
`fr-clearfix`, `fr-hide-by-clipping`, плюс `.rte-legacy-embed`. Все значения —
через токены `--rte-*`; шестнадцать `--rte-legacy-*` переменных перечислены в
корневом `README.md` («Legacy content») и в шапке `legacy.css`.

### Границы режима

- **Вьюер** сохраняет все классы Froala (разметка идёт в `innerHTML`
  после санитайзера). **Редактор** при сохранении теряет декоративные классы,
  кроме тех, что сидят на ссылке (`fr-file`, `fr-green`, `fr-strong`): схема
  моделирует только то, что знает. Формулы, подсветка, выравнивание, кегль и
  структура переживают редактирование.
- `<video>`, `<iframe>` и эмодзи-спаны с `background: url(...)` не
  восстанавливаются (вне allowlist / CSS-фильтр).
- Подпись картинки (`fr-img-caption`) в редакторе сливается с абзацем.
- `legacy` читается один раз: схему нельзя поменять у живого редактора. Во
  Vue — пересоздайте компонент через `:key`.

Полный список — `LIMITATIONS.md` («Content saved by Froala») и
[15-limitations-and-status.md](15-limitations-and-status.md).
