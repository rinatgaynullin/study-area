# 3. Редактор без фреймворка: `createRichEditor`

## Назначение

`createRichEditor(options)` собирает редактор целиком на голом DOM: тулбар,
строку статуса, область ввода, диалоги (ссылка, таблица, запись голоса,
формула) и поповер ссылки. Возвращает `RichEditorUi` с движком в поле `core`.
Vue-компонент `RichEditor` — ровно этот вызов, обёрнутый в компонент.

## Когда использовать

- Страница без фреймворка, другой фреймворк, Django-шаблон (через
  [standalone](10-standalone-and-django.md)).
- Во Vue — компонент из [07-vue.md](07-vue.md); сюда — за опциями, которых у
  компонента нет (`collapseBelow`, `textSwatches`, `highlightSwatches`,
  `extensions`).

## Интерфейс

Сигнатуры — [14-api-reference.md](14-api-reference.md#интерфейс-на-голом-dom).

### Опции `RichEditorUiOptions`

Все опции `RichEditorCoreOptions` ([02](02-core.md#опции-richeditorcoreoptions))
плюс перечисленные ниже. `element` здесь — контейнер, в который вставляется весь
редактор (`.rte-root`).

| Параметр | Тип | По умолчанию | Что делает |
| --- | --- | --- | --- |
| `toolbar` | `ToolbarConfig` | `'full'` | Пресет `'full'`, `'standard'`, `'minimal'` или список групп |
| `toolbarItems` | `Record<string, ToolbarItemDescriptor>` | — | Свои пункты; запись со встроенным `id` заменяет встроенный пункт |
| `features` | `EditorFeature[]` | — | Возможности: расширения схемы, пункты тулбара и диалоги одним объявлением |
| `linkStyles` | `LinkStyle[]` | `DEFAULT_LINK_STYLES` | Варианты оформления ссылки в поповере (класс на ссылке) |
| `mathliveFontsDirectory` | `string` или `null` | `null` | Каталог шрифтов MathLive; `null` — подключён `mathlive/fonts.css` |
| `collapseBelow` | `number` | `760` | Ширина, ниже которой схлопываемые группы уходят в меню «Ещё» |
| `textSwatches`, `highlightSwatches` | `string[]` | `DEFAULT_TEXT_SWATCHES`, `DEFAULT_HIGHLIGHT_SWATCHES` | Палитры цвета текста и выделения |
| `minHeight` | `string` | — | `min-height` области ввода |
| `statusLine` | `boolean` | `true` | Строка под тулбаром с идущими загрузками и последней ошибкой |
| `theme` | `EditorTheme` | `'light'` | `'light'`, `'dark'` или `'auto'` ([08](08-theming.md)) |

### Результат `RichEditorUi`

| Член | Что делает |
| --- | --- |
| `core` | `RichEditorCore`: документ, команды, загрузки ([02](02-core.md)) |
| `element` | Корень `.rte-root` |
| `setEditable(editable)` | Режим чтения: запирает документ и прячет тулбар |
| `setLocale(locale)`, `setMessages(messages)` | Меняют язык или таблицы и пересобирают тулбар и диалоги |
| `refreshLabels()` | Пересобирает интерфейс, если таблицу переводов изменили на месте |
| `setLimits(limits)` | Пределы загрузок и записи у живого редактора |
| `setTheme(theme)` | Переключает тему; `'auto'` следит за системной настройкой |
| `destroy()` | Снимает слушатели, уничтожает диалоги и движок, убирает корень из DOM |

### Тулбар

`ToolbarConfig` — имя пресета или массив групп `{ id, items, collapsible? }`.
Группа с `collapsible: true` уходит в меню «Ещё», когда тулбару не хватает
ширины (схлопываются только группы из обычных кнопок, без дропдаунов).

| Пресет | Группы |
| --- | --- |
| `full` | история, заголовок, начертание, индексы, цвета, выравнивание, списки, блоки, вставка, формулы, очистка |
| `standard` | история, заголовок, `bold italic underline`, списки, `link image audio`, формулы |
| `minimal` | `bold italic underline`, списки, `link` |

Встроенные пункты (идентификаторы для `items`):

| id | Вид | Что делает | Клавиши |
| --- | --- | --- | --- |
| `undo`, `redo` | кнопка | История; недоступна, когда нечего отменять | `Mod-Z`, `Mod-Shift-Z` |
| `bold`, `italic`, `underline`, `strike` | переключатель | Начертание | `Mod-B`, `Mod-I`, `Mod-U`, `Mod-Shift-S` |
| `subscript`, `superscript` | переключатель | Индексы | `Mod-,`, `Mod-.` |
| `bulletList`, `orderedList` | переключатель | Списки | `Mod-Shift-8`, `Mod-Shift-7` |
| `blockquote`, `code`, `codeBlock` | переключатель | Цитата, моноширинный текст, блок кода | `Mod-Shift-B`, `Mod-E`, `Mod-Alt-C` |
| `horizontalRule`, `clearFormat` | кнопка | Линия; снять марки и блочные стили | — |
| `heading` | дропдаун | «Обычный текст», H1–H6; кнопка показывает текущий уровень | — |
| `align` | дропдаун | По левому краю, по центру, по правому, по ширине | — |
| `textColor`, `highlight` | палитра | Цвет текста и выделения; «Без цвета», «Свой цвет» | — |
| `table` | дропдаун | «Вставить таблицу» → диалог; внутри таблицы — действия со строками и столбцами | — |
| `file` | дропдаун | «Прикрепить файлом» или «Вставить содержимое как текст» | — |
| `link` | кнопка | Диалог ссылки | `Mod-K` |
| `image`, `audio` | кнопка | Выбор картинки; диалог записи голоса | — |
| `formulaMath`, `formulaChem` | кнопка | Диалог формул с нужной вкладкой | — |

Неизвестный id в конфигурации игнорируется, пустая группа не рисуется.
`Mod` — `Ctrl`, на Mac — `Cmd`; подсказка кнопки показывает сочетание.

### Свой пункт: `ToolbarItemDescriptor`

| Поле | Тип | Что делает |
| --- | --- | --- |
| `id` | `string` | Идентификатор для `items` группы |
| `icon` | `string` | Имя из `ICONS` ([14](14-api-reference.md#примитивы)) |
| `dynamicIcon(editor)` | `string` | Иконка от состояния документа; главнее `icon` |
| `text(context)` | `string` | Короткая подпись вместо иконки (как уровень заголовка) |
| `labelKey` | `string` | Ключ перевода подписи и подсказки; добавьте его в `messages` |
| `shortcut` | `string` | Сочетание в записи TipTap (`'Mod-Shift-K'`) — только для подсказки |
| `kind` | `'button'` или `'dropdown'` | Вид пункта |
| `run(context, payload?)` | `void` | Действие кнопки |
| `isActive(editor)`, `isDisabled(editor)` | `boolean` | Подсветка и доступность |
| `renderPanel(context, close)` | `HTMLElement` | Содержимое панели; только для `'dropdown'` |

`context` — `EditorUiContext`: `editor`, `t`, `limits`, `uploads`,
`editFormula(payload)`. Пункт из `toolbarItems` появится, только если его id
есть в конфигурации тулбара.

### Возможность: `EditorFeature`

| Поле | Что возвращает | Когда вызывается |
| --- | --- | --- |
| `id` | — | Имя группы, в которую встанут пункты, не упомянутые в `toolbar` |
| `extensions(options)` | расширения TipTap | При создании; `options` — `{ t, legacy, placeholder, formulaScale, onFormulaEdit }` |
| `toolbarItems()` | `ToolbarItemDescriptor[]` | При создании, один раз |
| `dialogs(context)` | `UiComponent[]` | При создании и при каждой смене языка — диалог собирается из контекста |

Диалоги строятся на `createModal` / `createPopover`, монтируются рядом со
встроенными и уничтожаются вместе с редактором. `toolbarItems` хоста главнее
пунктов возможности с тем же id.

### Примитивы для своих диалогов

| Фабрика | Что даёт |
| --- | --- |
| `createModal({ title, closeLabel, wide?, onClose? })` | Модалка: `body`, `footer`, `open()`, `close()`, `setTitle()`; ловушка фокуса, `Escape`, замок прокрутки |
| `createPopover(options?)` | Панель у `DOMRect`: `open(anchor)`, `close(reason?)`, `reposition()`; не забирает фокус |
| `createDropdown({ label, iconName?, text?, renderPanel })` | Кнопка с меню; `renderPanel` вызывается при каждом открытии |
| `createMenuItem(options)`, `createMenuSeparator()` | Пункт меню с ролью `menuitem` / `menuitemradio` / `menuitemcheckbox` и разделитель |

### Клавиатура

| Где | Клавиши |
| --- | --- |
| Документ | `Alt+F10` — фокус в тулбар; `Mod-K` — диалог ссылки; `Enter` на выделенной формуле — её редактор |
| Тулбар | Одна остановка `Tab`; стрелки, `Home`/`End`, `Enter`/`Space`, `Escape` — назад в документ |
| Меню | Стрелки, `Home`/`End`, `Enter`, `Escape`; палитра — сетка |
| Диалог | `Tab` по кольцу, `Escape`, `Enter` в поле применяет |

## Пример

```ts
import { createRichEditor, type ToolbarItemDescriptor } from '@rich-editor/core';
import '@rich-editor/core/styles.css';

const toolbarItems: Record<string, ToolbarItemDescriptor> = {
  stamp: {
    id: 'stamp',
    icon: 'check',
    labelKey: 'my_stamp',
    kind: 'button',
    run: ({ editor }) => editor.chain().focus().insertContent('✔ ').run(),
  },
};

const editor = createRichEditor({
  element: document.querySelector('#editor')!,
  toolbar: [
    { id: 'format', items: ['bold', 'italic', 'underline'] },
    { id: 'mine', items: ['link', 'stamp'], collapsible: true },
  ],
  toolbarItems,
  messages: { ru: { my_stamp: 'Штамп' }, en: { my_stamp: 'Stamp' } },
  onChange: (html) => console.log(html),
});

editor.setLocale('en');
editor.destroy();
```

## Ограничения

- Читаются один раз: `toolbar`, `toolbarItems`, `features`, `extensions`,
  `linkStyles`, `legacy`, `placeholder`, `ariaLabel`, `formulaScale`,
  `minHeight`, `statusLine`, `collapseBelow`, палитры, `mathliveFontsDirectory`,
  адаптеры. Для смены пересоздайте редактор.
- Строка статуса показывает только загрузки через адаптер: локальный `blob:`
  путь событий не даёт.
- Поповер ссылки при применении ставит `target="_blank"`, если у ссылки не было
  `target`.

## См. также

- [13-recipes.md](13-recipes.md) — своя кнопка, возможность с диалогом,
  headless-режим.
- [09-i18n.md](09-i18n.md) — ключи переводов для своих пунктов.
- `docs/adr/0008-framework-free-ui.md`.
