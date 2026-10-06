# 2. Ядро: `RichEditorCore`

## Назначение

`RichEditorCore` — headless-движок: собирает TipTap `Editor` с набором
расширений библиотеки (формулы, голосовые сообщения, вложения, таблицы,
картинки, цвета) и даёт хосту единый API для контента, формул и медиа. Тулбара
и диалогов в нём нет — на нём построены `createRichEditor`
([03](03-vanilla-ui.md)) и Vue-компонент ([07](07-vue.md)).

## Когда использовать

- Нужен собственный интерфейс поверх движка (свои кнопки, свой диалог формул).
- Во всех остальных случаях берите `createRichEditor` или `RichEditor`: они
  создают `RichEditorCore` сами и отдают его как `core`.

## Интерфейс

Сигнатуры — [14-api-reference.md](14-api-reference.md#движок-и-вход-документа).

### Опции `RichEditorCoreOptions`

| Параметр | Тип | По умолчанию | Что делает |
| --- | --- | --- | --- |
| `element` | `HTMLElement` | — | Куда монтировать область ввода; нужен DOM (только клиент) |
| `content` | `string` | `''` | Начальный HTML; проходит `prepareIncomingHtml` |
| `editable` | `boolean` | `true` | Режим редактирования |
| `placeholder` | `string` | `t('editor_placeholder')` | Подсказка пустого документа |
| `ariaLabel` | `string` | `t('editor_aria_label')` | Имя области ввода для читалки; в форме — подпись поля |
| `locale` | `string` | `'ru'` | Язык интерфейса и сообщений об ошибках |
| `messages` | `Record<string, Messages>` | — | Таблицы переводов хоста ([09](09-i18n.md)) |
| `limits` | `Partial<EditorLimits>` | `DEFAULT_LIMITS` | Пределы размеров и длительности ([05](05-media-and-uploads.md#лимиты)) |
| `uploadImage`, `uploadAudio`, `uploadFile` | `UploadAdapter` | — | Адаптеры загрузки; без них файл остаётся `blob:` URL |
| `formulaScale` | `number` | `1` | Масштаб формул относительно текста |
| `extensions` | `unknown[]` или функция `({ t }) => unknown[]` | — | Дополнительные расширения TipTap; функция получает переводчик |
| `legacy` | `boolean` | `false` | Разбор разметки Froala + Wiris; меняет схему, читается один раз |
| `onChange` | `(html: string) => void` | — | Каждое изменение документа; `html` — результат `getHTML()` |
| `onSelectionUpdate`, `onTransaction` | `() => void` | — | Смена выделения; любая транзакция |
| `onFocus`, `onBlur` | `() => void` | — | Фокус области ввода |
| `onUpload` | `(event: UploadEvent) => void` | — | Начало и конец загрузки через адаптер |
| `onFormulaEdit` | `(payload: FormulaPayload) => void` | — | Пользователь вставляет или правит формулу; хост открывает свой редактор |
| `onError` | `(error: RichEditorError) => void` | — | Ошибки загрузок, записи, MathML ([05](05-media-and-uploads.md#ошибки-richeditorerror)) |

### Поля и методы

| Член | Возвращает | Что делает |
| --- | --- | --- |
| `uploads` | `UploadPipeline` | Пайплайн загрузок ([05](05-media-and-uploads.md)) |
| `getHTML()` | `string` | Синхронная сериализация; SVG формул берётся из кэша |
| `getText()` | `string` | Текст без разметки |
| `setHTML(html, options?)` | `void` | Заменяет документ через `prepareIncomingHtml`; `emitUpdate` по умолчанию `false` — `onChange` не вызывается |
| `isEmpty()` | `boolean` | Пуст ли документ |
| `focus()` | `void` | Фокус в область ввода |
| `setEditable(editable)` | `void` | Режим чтения у движка (тулбар прячет оболочка) |
| `whenFormulasReady()` | `Promise<void>` | Ждёт незавершённые рендеры MathJax, чтобы `getHTML()` содержал SVG |
| `setLocale(locale)`, `setMessages(messages)` | `void` | Переводчик ядра; уже смонтированные плееры и вложения не перерисовываются |
| `t(key, params?)` | `string` | Переводчик текущей локали |
| `setLimits(limits)`, `getLimits()` | `void`, `EditorLimits` | Пределы у живого редактора |
| `setOptions(options)` | `void` | Разом: `editable`, `locale`, `messages`, `limits`, `placeholder`, `ariaLabel`, адаптеры загрузки |
| `insertFormula(mathml, type = 'math')` | `boolean` | Нормализует MathML; непригодный → ошибка `invalid-mathml` и `false` |
| `updateFormulaAt(pos, mathml, type?)` | `boolean` | Меняет формулу по позиции |
| `deleteFormulaAt(pos)` | `boolean` | Удаляет формулу |
| `insertImageFile(file, at?)` | `Promise<boolean>` | Загрузка через адаптер `image` и вставка `<img>` |
| `insertImageUrl(result, at?)` | `boolean` | Вставка уже загруженной картинки (`UploadResult`) |
| `insertRecording(blob, meta)` | `Promise<boolean>` | Запись → файл `voice-<timestamp>.<ext>` через `uploadAudio` или `blob:` URL |
| `insertAudio(attributes)` | `boolean` | Узел голосового сообщения (`AudioAttributes`) |
| `attachTextFile(file)` | `Promise<boolean>` | Загрузка через адаптер `file` и чип-вложение |
| `insertAttachment(attributes)` | `boolean` | Узел вложения (`AttachmentAttributes`) |
| `insertTextFileContent(file)` | `Promise<boolean>` | Содержимое файла абзацами; Markdown не разбирается |
| `destroy()` | `void` | Отменяет загрузки, отзывает `blob:` URL, уничтожает редактор |

Вставка из буфера и перетаскивание файлов идут через те же методы: картинки →
`insertImageFile`, `audio/*` → узел аудио, текстовые файлы → `attachTextFile`.
Файлы вставляются по очереди, ошибки приходят в `onError`.

### Формат сохраняемого HTML

`getHTML()` отдаёт обычный HTML. Собственные узлы (сокращённо):

```html
<!-- формула: MathML в data-mathml — источник истины, SVG — переносимая проекция -->
<span data-formula="true" data-formula-type="math" data-mathml="&lt;math …&gt;…&lt;/math&gt;"
      contenteditable="false" class="rte-formula" role="img" aria-label="\frac{a}{b}">
  <span class="rte-formula__render" data-render-host="true"><svg>…</svg></span>
</span>

<!-- голосовое сообщение -->
<div data-audio="true" data-src="…/voice.webm" data-name="voice.webm" data-mime="audio/webm"
     data-duration="12.4" data-peaks="3,18,42,…" class="rte-audio">
  <audio controls preload="metadata" src="…/voice.webm" class="rte-audio__native"></audio>
</div>

<!-- вложение -->
<div data-attachment="true" data-href="…/notes.txt" data-name="notes.txt" data-size="1204"
     data-mime="text/plain" class="rte-attachment">
  <a href="…/notes.txt" download="notes.txt" rel="noopener noreferrer">notes.txt (1.2 KB)</a>
</div>
```

Остальное — стандартная разметка TipTap: `<p>`, `<h1>`–`<h6>`, списки,
`<blockquote>`, `<code>`, `<pre class="rte-code-block">`, `<hr>`,
`<strong>`/`<em>`/`<u>`/`<s>`, `<sub>`/`<sup>`,
`<a href rel="noopener noreferrer">` (плюс `target`, `class`),
`<img class="rte-image" src alt width height>`, `<table class="rte-table">`,
`<mark data-color>`, `<span style="color; font-size">`, `style="text-align"` у
абзацев и заголовков. Размер формулы запечён в пикселях внутри SVG и не
зависит от `font-size` окружения.

### Вход документа: `prepareIncomingHtml`

`prepareIncomingHtml(html, { legacy? })` — единственный путь входа контента
(начальный `content`, `setHTML()`, вставка из буфера, вьюер). Шаги: при
`legacy` — `upgradeLegacyHtml()`; сырой `<math>` поднимается до узла формулы;
`sanitizeHtml()` ([11](11-security.md)).

### Legacy-режим (Froala + Wiris)

Включается опцией `legacy: true` (ядро, `createRichEditor`,
`createRichContent`, проп Vue, `legacy=True` в Django). Стили старой разметки —
отдельный файл `legacy.css`, действует внутри `.rte-content.rte-legacy`.

| Разметка Froala/Wiris | Результат |
| --- | --- |
| `<img class="Wirisformula" data-mathml="…">` | Узел формулы: MathML декодируется (`decodeWirisMathml`) и нормализуется |
| `.formula-rendered` (MathJax), `.formula-chemistry-structure` (JSME) | Узел `legacyEmbed`: показывается и удаляется, не редактируется |
| `span[style*="background-color"]` | Марка выделения |
| Картинки | Инлайновые (как у Froala), а не блочные |

## Пример

```ts
import { RichEditorCore, latexToMathML, mathmlToLatex } from '@rich-editor/core';

const core = new RichEditorCore({
  element: document.querySelector('#surface')!,
  content: '<p>Привет</p>',
  onChange: (html) => save(html),
  onFormulaEdit: async ({ mathml, type, pos }) => {
    const latex = prompt('LaTeX', mathml ? await mathmlToLatex(mathml) : '');
    if (latex === null) return;
    const next = await latexToMathML(latex, type);
    if (pos === null) core.insertFormula(next, type);
    else core.updateFormulaAt(pos, next, type);
  },
  onError: (error) => console.warn(error.code, error.message),
});
```

## Ограничения

- TipTap-редактор и ProseMirror-JSON наружу не отдаются: команды доступны
  через возможности (`features`, [03](03-vanilla-ui.md)) и `extensions`.
- `setHTML()` не вызывает `onChange` — после программной подстановки
  документа модель хоста не обновится сама.
- `legacy`, `extensions` и `formulaScale` читаются один раз: для смены
  пересоздайте редактор. Подсказка, имя для читалки и адаптеры меняются через
  `setOptions()`.
- `insertRecording()` без `uploadAudio` кладёт `blob:` напрямую, минуя проверку
  `maxAudioSizeBytes`; предел размера в этом случае держит рекордер.
- При редактировании legacy-документа теряются декоративные классы Froala
  (кроме классов на ссылках) и структура подписей картинок; для показа
  используйте вьюер ([06](06-viewer.md)).

## См. также

- [03-vanilla-ui.md](03-vanilla-ui.md) — редактор с тулбаром поверх ядра.
- [04-formulas.md](04-formulas.md), [05-media-and-uploads.md](05-media-and-uploads.md).
- [11-security.md](11-security.md) — что пропускает санитайзер.
- `docs/adr/0004-formula-html-contract.md`, `docs/adr/0007-froala-compatibility.md`.
