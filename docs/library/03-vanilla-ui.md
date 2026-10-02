# 3. Интерфейс ядра на голом DOM: `createRichEditor`

Файлы: `packages/editor-core/src/ui/*`. Интерфейс редактора — тулбар,
диалоги, поповеры, строка статуса — написан без фреймворка (ADR 0008).
Обёртка под фреймворк только монтирует его.

## 3.1. `createRichEditor(options): RichEditorUi`

```ts
import { createRichEditor } from '@rich-editor/core';
import '@rich-editor/core/styles.css';

const editor = createRichEditor({
  element: document.querySelector('#editor')!,
  content: '<p>Привет</p>',
  toolbar: 'standard',
  onChange: (html) => console.log(html),
});

editor.core.getHTML();
editor.setLocale('en');
editor.destroy();
```

### Опции (`RichEditorUiOptions`)

Наследует все `RichEditorCoreOptions` (см. [02-core.md](02-core.md#опции-richeditorcoreoptions)),
кроме смысла `element` — здесь это контейнер, в который вставляется весь
редактор (`.rte-root` с тулбаром и областью ввода). Дополнительно:

```ts
interface RichEditorUiOptions extends Omit<RichEditorCoreOptions, 'element'> {
  element: HTMLElement;
  toolbar?: ToolbarConfig;                              // 'full' | 'standard' | 'minimal' | ToolbarGroupConfig[]; по умолчанию 'full'
  toolbarItems?: Record<string, ToolbarItemDescriptor>; // свои пункты и замены встроенных
  features?: EditorFeature[];                           // возможности: расширения + пункты + диалоги
  linkStyles?: LinkStyle[];                             // варианты оформления ссылки в поповере; по умолчанию DEFAULT_LINK_STYLES
  mathliveFontsDirectory?: string | null;               // откуда MathLive берёт шрифты; null — CSS уже подключён
  collapseBelow?: number;                               // ширина, ниже которой схлопываемые группы уходят в «⋯»; 760
  textSwatches?: string[];                              // палитра цвета текста; по умолчанию DEFAULT_TEXT_SWATCHES
  highlightSwatches?: string[];                         // палитра выделения; по умолчанию DEFAULT_HIGHLIGHT_SWATCHES
  minHeight?: string;                                   // min-height области ввода
  statusLine?: boolean;                                 // строка статуса под тулбаром; true
  theme?: EditorTheme;                                  // 'light' | 'dark' | 'auto'; 'light'
}
```

### Результат (`RichEditorUi`)

```ts
interface RichEditorUi {
  readonly core: RichEditorCore;     // движок: документ, команды, загрузки
  readonly element: HTMLElement;     // корень .rte-root
  setEditable(editable: boolean): void;   // прячет тулбар и переключает движок
  setLocale(locale: string): void;        // меняет язык и пересобирает тулбар и диалоги
  setMessages(messages: Record<string, Messages> | undefined): void;
  refreshLabels(): void;                  // пересобирает интерфейс, если таблицу меняли на месте
  setLimits(limits: Partial<EditorLimits>): void;
  setTheme(theme: EditorTheme): void;
  destroy(): void;
}
```

### Разметка, которую строит оболочка

```html
<div class="rte-root [rte-theme-dark] [rte-root--readonly]">
  <div class="rte-toolbar" role="toolbar" aria-label="Панель форматирования">
    <div class="rte-toolbar__group"> <button class="rte-btn" …> … </div> …
  </div>
  <div class="rte-status" role="status" aria-live="polite"></div>   <!-- если statusLine !== false -->
  <div class="rte-surface"><div class="rte-host"> <div class="rte-content ProseMirror" role="textbox" …> … </div> </div></div>
  <input class="rte-hidden-input" type="file" accept="image/*">
  <input class="rte-hidden-input" type="file" accept=".txt,.md,…,text/plain,text/markdown">
  <div class="rte-modal" hidden>…</div>  ×4 (ссылка, таблица, запись, формула) + диалоги features
  <div class="rte-popover" hidden>…</div> (поповер ссылки)
</div>
```

Оверлеи живут в DOM постоянно и скрываются атрибутом `hidden`; правило
`.rte-root [hidden], .rte-modal[hidden], … { display: none !important }` в
`styles.css` гарантирует, что `hidden` побеждает любой `display`.

## 3.2. Тулбар

### Конфигурация

```ts
interface ToolbarGroupConfig {
  id: string;
  items: string[];          // идентификаторы пунктов
  collapsible?: boolean;    // уходит в меню «⋯», когда не хватает ширины
}

type ToolbarPreset = 'full' | 'standard' | 'minimal';
type ToolbarConfig = ToolbarPreset | ToolbarGroupConfig[];

const TOOLBAR_PRESETS: Record<ToolbarPreset, ToolbarGroupConfig[]>;
const resolveToolbar: (config: ToolbarConfig | undefined) => ToolbarGroupConfig[]; // undefined/неизвестный пресет → full
```

Пресеты (`ui/presets.ts`), группировка повторяет QEditor из Quasar:

| Пресет | Группы |
| --- | --- |
| `full` | `history` (undo redo) ⋯, `heading`, `format` (bold italic underline strike), `script` (subscript superscript) ⋯, `color` (textColor highlight) ⋯, `align` ⋯, `list` (bulletList orderedList), `block` (blockquote code codeBlock horizontalRule) ⋯, `insert` (link table image audio file), `formula` (formulaMath formulaChem), `clear` (clearFormat) ⋯ |
| `standard` | `history` ⋯, `heading`, `format` (bold italic underline), `list`, `insert` (link image audio) ⋯, `formula` |
| `minimal` | `format` (bold italic underline), `list`, `insert` (link) |

«⋯» — группа с `collapsible: true`. Схлопываться может только группа, целиком
состоящая из обычных кнопок (панель дропдауна в меню не помещается), поэтому
`color` и `align` из пресета `full` на деле не схлопываются, хоть и помечены.

### Встроенные пункты

| id | Вид | Что делает | Шорткат (подсказка) |
| --- | --- | --- | --- |
| `undo` / `redo` | кнопка | undo / redo; недоступна, когда отменять нечего | `Mod-Z` / `Mod-Shift-Z` |
| `bold` `italic` `underline` `strike` | кнопка-переключатель | toggle марки | `Mod-B` `Mod-I` `Mod-U` `Mod-Shift-S` |
| `subscript` `superscript` | переключатель | toggle | `Mod-,` `Mod-.` |
| `bulletList` `orderedList` | переключатель | toggle списка | `Mod-Shift-8` `Mod-Shift-7` |
| `blockquote` `code` `codeBlock` | переключатель | toggle | `Mod-Shift-B` `Mod-E` `Mod-Alt-C` |
| `horizontalRule` | кнопка | `setHorizontalRule` | — |
| `clearFormat` | кнопка | `unsetAllMarks().clearNodes()` | — |
| `heading` | дропдаун с текстом | «Обычный текст» / H1–H6 (`menuitemradio`); кнопка показывает текущий уровень (`H2`) | заголовки — `Mod-Alt-1…6` от TipTap, в подсказке не показывается |
| `align` | дропдаун с динамической иконкой | left / center / right / justify (`menuitemradio`) | — |
| `textColor` | дропдаун-палитра | `setColor` / `unsetColor`; сетка 6 колонок, «Без цвета», «Свой цвет» (`<input type="color">`) | — |
| `highlight` | дропдаун-палитра | `setHighlight({ color })` / `unsetHighlight` | — |
| `table` | дропдаун | «Вставить таблицу» → диалог; внутри таблицы — действия `addRowBefore addRowAfter deleteRow addColumnBefore addColumnAfter deleteColumn mergeCells splitCell toggleHeaderRow toggleHeaderColumn deleteTable` | — |
| `file` | дропдаун | «Прикрепить файлом» / «Вставить содержимое как текст» → системный выбор файла | — |
| `link` | кнопка | диалог ссылки | `Mod-K` (вешает оболочка) |
| `image` | кнопка | системный выбор картинки | — |
| `audio` | кнопка | диалог записи | — |
| `formulaMath` / `formulaChem` | кнопка | диалог формул с нужной вкладкой | — |

Шорткаты самих команд вешают расширения TipTap; тулбар лишь показывает их в
`title` («Полужирный · Ctrl+B» / «⌘B» на Mac) и в `aria-keyshortcuts`
(`Control+B` / `Meta+B`). Доступное имя (`aria-label`) — подпись без шортката:
в тестах ищите кнопки по `aria-label`.

Неизвестный id в конфигурации **игнорируется** (опечатка не ломает тулбар).
Пустая группа не рисуется.

### Дескриптор пункта

```ts
type ToolbarItemKind = 'button' | 'dropdown';

interface ToolbarItemDescriptor {
  id: string;
  icon?: string;                                       // имя из ICONS
  dynamicIcon?(editor: Editor): string;                // иконка от состояния; главнее icon
  text?(context: EditorUiContext): string;             // короткая подпись вместо иконки (уровень заголовка)
  labelKey: string;                                    // ключ перевода подписи/подсказки
  shortcut?: string;                                   // «Mod-Shift-S» — только для подсказки и aria-keyshortcuts
  kind?: ToolbarItemKind;
  run?(context: EditorUiContext, payload?: unknown): void;
  isActive?(editor: Editor): boolean;                  // подсветка + aria-pressed
  isDisabled?(editor: Editor): boolean;
  renderPanel?(context: EditorUiContext, close: () => void): HTMLElement;  // только для 'dropdown'
}
```

`EditorUiContext` — то, что получает каждый кусок интерфейса:

```ts
interface EditorUiContext {
  editor: Editor;
  t: Translate;
  limits: EditorLimits;      // getter: читает актуальные пределы у движка
  uploads: UploadPipeline;
  editFormula(payload: FormulaPayload): void;   // открывает диалог формул
}
```

Доступные имена иконок (`ICONS`, `IconName`): `bold italic underline strike
heading paragraph subscript superscript bulletList orderedList blockquote code
codeBlock horizontalRule link unlink table alignLeft alignCenter alignRight
alignJustify textColor highlight clearFormat undo redo image audio file
formulaMath formulaChem more chevronDown close check openLink trash play pause
stop record noColor`. Иконки — инлайн-SVG на `currentColor`, без внешних
ресурсов.

### `toolbarItems`: свои пункты и замена встроенных

`options.toolbarItems` накладывается на реестр **последним**, поэтому запись с
встроенным id заменяет встроенный пункт, а с id пункта какой-либо `feature` —
пункт возможности:

```ts
import type { ToolbarItemDescriptor } from '@rich-editor/core';

const toolbarItems: Record<string, ToolbarItemDescriptor> = {
  stamp: {
    id: 'stamp',
    icon: 'check',
    labelKey: 'my_stamp',          // ключ нужно добавить в messages
    kind: 'button',
    run: ({ editor }) => editor.chain().focus().insertContent('✔ ').run(),
  },
};

createRichEditor({
  element,
  toolbar: [{ id: 'mine', items: ['bold', 'italic', 'stamp'] }],
  toolbarItems,
  messages: { ru: { my_stamp: 'Штамп' }, en: { my_stamp: 'Stamp' } },
});
```

Чтобы пункт появился, его id должен быть в конфигурации тулбара (для
`toolbarItems` автоматической группы нет — в отличие от `features`).

### `features`: возможность одним объявлением

```ts
interface EditorFeature {
  id: string;
  extensions?(options: FeatureBuildOptions): unknown[];   // расширения TipTap
  toolbarItems?(): ToolbarItemDescriptor[];               // пункты; вызывается один раз
  dialogs?(context: EditorUiContext): UiComponent[];      // диалоги; вызывается при создании и при каждой смене языка
}

interface FeatureBuildOptions {
  t: Translate;
  legacy: boolean;
  placeholder?: string;
  formulaScale: number;
  onFormulaEdit?: (payload: FormulaPayload) => void;
}

interface UiComponent { readonly element: HTMLElement; destroy(): void }
interface DialogComponent<TPayload = void> extends UiComponent {
  open(payload: TPayload): void; close(): void; readonly isVisible: boolean;
}
```

Правила монтирования:

- расширения возможности добавляются к движку после расширений хоста;
- пункты попадают в реестр (ниже по приоритету, чем `toolbarItems`);
- пункты, **не упомянутые** в конфигурации тулбара, добавляются группой с
  `id` возможности в конец тулбара — подключённую возможность должно быть
  видно; упомянутые остаются там, где их поставил хост;
- элементы, которые вернул `dialogs(context)`, добавляются в `.rte-root`
  рядом со встроенными диалогами и уничтожаются вместе с редактором; при
  смене языка они уничтожаются и собираются заново, поэтому диалог должен
  собираться из контекста, а не хранить состояние между пересборками.

Полный пример — в [13-recipes.md](13-recipes.md#своя-возможность-feature-с-диалогом).

### Адаптивная раскладка

`ToolbarController.layout(width)`:

- ниже `collapseBelow` (760 px по умолчанию) все схлопываемые группы уходят в
  меню «⋯» сразу;
- выше — тулбар измеряет себя (`offsetTop` групп): если переносится на вторую
  строку, схлопывает группы по одной **с конца**, пока не поместится; если
  места стало больше, пробует вернуть одну и откатывается при переносе.

Пересчёт — один на кадр по `ResizeObserver`. Пункты из «⋯» остаются
переключателями (`menuitemcheckbox` с `aria-checked`).

Кнопка `heading` имеет фиксированную ширину подписи (`--rte-btn-text-width`,
9.5em), чтобы тулбар не дёргался при переходе каретки между абзацем и
заголовком.

### Клавиатура в тулбаре (roving tabindex)

Тулбар — одна остановка `Tab` (ARIA toolbar pattern): `tabindex="0"` у
текущей кнопки, `-1` у остальных. `←`/`→` ходят по доступным кнопкам по
кругу, `Home`/`End` — к краям, `Escape` возвращает каретку в документ
(`focusEditorView`), `Enter`/`Space` активируют кнопку. Из документа
`Alt+F10` переводит фокус в тулбар (`Toolbar.focus()`). Кнопки гасят
`mousedown`, чтобы документ не терял выделение при клике мышью.

### API тулбара (для своих раскладок)

```ts
const createToolbar: (context: EditorUiContext, options: ToolbarOptions) => Toolbar;

interface ToolbarOptions { groups: ToolbarGroupConfig[]; items: Record<string, ToolbarItemDescriptor>; collapseBelow?: number }

interface Toolbar extends UiComponent {
  syncState(): void;              // перечитать состояние документа
  setDisabled(disabled: boolean): void;
  rebuild(): void;                // пересобрать кнопки (смена локали)
  layout(width: number): void;    // подобрать число схлопнутых групп
  focus(): void;                  // фокус на текущую кнопку
}
```

`SIMPLE_TOOLBAR_ITEMS` — реестр встроенных пунктов с одной командой (без
дропдаунов и диалогов), экспортируется для своих тулбаров.

## 3.3. Примитивы: модалка, поповер, дропдаун

### `createModal`

```ts
interface ModalOptions { title: string; closeLabel: string; wide?: boolean; onClose?(): void }
interface Modal extends DialogComponent {
  readonly body: HTMLElement;     // наполняет создатель
  readonly footer: HTMLElement;   // кнопки
  setTitle(title: string): void;
}
const createModal: (options: ModalOptions) => Modal;
const MODAL_CLOSE_EVENT = 'rte:modal-close';
```

Поведение `ModalController`:

- разметка `.rte-modal > .rte-modal__backdrop + .rte-modal__panel[role=dialog][aria-modal][aria-labelledby][tabindex=-1]`;
- `open()`: запоминает `document.activeElement`, снимает `hidden`, слушает
  `keydown` на документе (Escape закрывает; Tab замкнут в кольцо по видимым
  фокусируемым элементам панели), подстраивает оверлей под `visualViewport`
  (телефоны: адресная строка Safari, экранная клавиатура), **запирает
  прокрутку документа** (`overflow: hidden` на `<html>` с компенсацией ширины
  скроллбара; снимается, когда закрыт последний диалог), в следующем кадре
  фокусирует элемент с `data-autofocus`, иначе первый фокусируемый, иначе
  саму панель;
- `close()`: прячет, отписывается, диспатчит отменяемое всплывающее событие
  `rte:modal-close`. Если обработчик вызвал `preventDefault()` (так делает
  оболочка редактора — она возвращает фокус в документ), фокус **не**
  возвращается на прежний элемент; иначе возвращается;
- клик по подложке закрывает, по панели — нет; `destroy()` снимает замок
  прокрутки, если диалог был открыт.

### `createPopover`

```ts
type PopoverCloseReason = 'escape' | 'outside' | 'api';
interface PopoverOptions {
  offset?: number;                  // зазор от якоря; 8
  role?: string;                    // 'dialog' по умолчанию; 'menu' у дропдауна
  className?: string;
  labelledBy?: string; label?: string;
  align?: 'center' | 'start';       // центр под якорем или от левого края
  isInside?(target: Node): boolean; // что считать «внутри» при клике мимо
  onClose?(reason: PopoverCloseReason): void;
}
interface Popover extends UiComponent {
  open(anchor: DOMRect): void; close(reason?: PopoverCloseReason): void;
  readonly isVisible: boolean; readonly body: HTMLElement;
  reposition(anchor: DOMRect): void;
}
const createPopover: (options?: PopoverOptions) => Popover;
```

Панель `position: fixed` с `z-index: var(--rte-z-modal)`: её не обрежет
`overflow: hidden` корня редактора. Не забирает фокус. Пока открыта, слушает
`mousedown` (клик мимо → `close('outside')`), `keydown` (Escape →
`close('escape')`), `scroll` (capture) и `resize` окна (переставляется).
Ставится под якорем, если помещается, иначе над ним; прижимается к краям окна
с отступом 8 px.

### `createDropdown`, `createMenuItem`, `createMenuSeparator`

```ts
interface DropdownOptions { label: string; iconName?: string; text?: string; renderPanel(close: () => void): HTMLElement }
interface Dropdown extends UiComponent {
  readonly button: HTMLButtonElement;
  close(): void; setActive(active: boolean): void; setDisabled(disabled: boolean): void;
  setText(text: string): void; setIcon(name: string): void;
}
const createDropdown: (options: DropdownOptions) => Dropdown;

type MenuItemRole = 'menuitem' | 'menuitemradio' | 'menuitemcheckbox';
interface MenuItemOptions { label: string; iconName?: string; active?: boolean; disabled?: boolean; role?: MenuItemRole; labelClass?: string; onSelect(): void }
const createMenuItem: (options: MenuItemOptions) => HTMLButtonElement;
const createMenuSeparator: () => HTMLElement;
```

Кнопка `aria-haspopup="menu"`, `aria-expanded`; панель — поповер с
`role="menu"`, `aria-labelledby` = id кнопки. `renderPanel` вызывается **при
каждом открытии**, поэтому панель всегда отражает текущее выделение.
Клавиатура: `↓`/`↑` на кнопке открывают меню и ставят фокус на первый/последний
пункт; внутри `↑`/`↓` ходят по кругу, `Home`/`End` — к краям, `Escape`
закрывает и возвращает фокус на кнопку. Сетка (контейнер с
`data-menu-columns="N"`) — `←`/`→` по соседям, `↑`/`↓` по строкам, без
перескока через край (так устроена палитра цветов).

### Хелперы DOM (`ui/dom.ts`)

Не экспортируются из пакета, но описывают стиль кода интерфейса: `el(tag, {
class, text, html, attrs, children })`, `icon(name, size)`, `on(target, type,
listener, options): Unsubscribe`, `createDisposer()` — список отписок,
который `destroy()` вызывает одной строкой.

## 3.4. Диалоги

Все диалоги построены на `createModal`, реализуют `DialogComponent` и
пересобираются при смене языка.

### Ссылка (`dialogs/link-dialog.ts`)

`open({ href, targetBlank, canRemove })`. Поля: адрес (`type="url"`,
`data-autofocus`), чекбокс «Открывать в новой вкладке», кнопки «Удалить
ссылку» (только при `canRemove`), «Отмена», «Применить». `Enter` в поле
применяет. Адрес проходит `normalizeHref`:

```ts
const normalizeHref: (value: string) => string | null;
```

— без схемы достраивается до `https://…`; допускаются только `http https
mailto tel`; иначе `null` → ошибка `link_invalid` (`role="alert"`,
`aria-invalid` на поле). Применение: `extendMarkRange('link').setLink({ href,
target: targetBlank ? '_blank' : null })`. Открывается кнопкой `link` и по
`Mod-K` из документа.

### Таблица (`dialogs/create-table-dialog.ts`)

Строки 1–20 (по умолчанию 3), столбцы 1–10 (по умолчанию 3), «Со строкой
заголовка» (по умолчанию включено). Значения клампятся; диалог всегда
открывается с умолчаниями. Применение: `insertTable({ rows, cols, withHeaderRow })`.

### Запись голоса (`dialogs/audio-recorder-dialog.ts`)

Фазы `idle → recording ⇄ paused → ready`. Кнопки каждой фазы показываются
только в ней: «Записать» → «Пауза»/«Продолжить» + «Остановить» → «Записать
заново» + «Вставить». Когда нажатая кнопка прячется, фокус переходит на
кнопку новой фазы (кольцо фокуса модалки не теряется). Показывает время,
«Осталось {time}» / «Максимальная длительность: {seconds} с», индикатор уровня
(CSS-переменная `--rte-level`), превью `<audio controls>` готового дубля.
Если `MediaRecorder` недоступен — только текст `audio_unsupported`.
Пределы читаются у `context.limits` при каждом обращении — `setLimits` на
живом редакторе виден сразу. На пределе длительности или размера рекордер
становится на паузу, а диалог сам финализирует дубль. Закрытие любым
способом гасит микрофон (`recorder.cancel()`) и отзывает blob превью. Ошибки
рекордера — в `role="alert"` диалога и в `onError` редактора (через
`reportError` оболочки → строка статуса + хост).

### Формула (`dialogs/formula-dialog.ts`)

Подробно — [04-formulas.md](04-formulas.md#диалог-формул). Кратко: широкая
модалка (`wide`), вкладки «Математика»/«Химия» (`role="tablist"`), поле
MathLive (ленивый `import('mathlive')`), категории шаблонов (второй tablist),
галерея шаблонов (кнопки, названные своим LaTeX), живое превью
(`aria-live="polite"`), кнопки «Удалить формулу» (только при правке), «Отмена»,
«Вставить»/«Сохранить». `open(payload | null)`: `null` или `pos: null` —
вставка, иначе правка.

## 3.5. Поповер ссылки (`ui/link-popover.ts`)

Появляется, когда каретка оказывается внутри ссылки в редактируемом
документе (проверка на каждой транзакции через `sync()`); показывает поля
«Адрес», «Текст», «Стиль» (если `linkStyles.length > 1`), кнопки «Открыть»
(в новой вкладке с `noopener,noreferrer`), «Удалить ссылку», «Применить».
Не забирает фокус. Поля перезаполняются, только если ссылка сменилась мимо
панели. `Escape` из поля закрывает панель, возвращает каретку в текст и
**не показывает панель снова**, пока каретка не покинет эту ссылку.

Применение: если текст изменён — `insertContent({ type: 'text', text, marks:
[link] })` заменяет содержимое всей марки; иначе `setLink(attrs)`. Класс
оформления пишется в атрибут `class` марки ссылки. Если у ссылки не было
`target`, поповер при применении ставит `target="_blank"`.

```ts
interface LinkStyle { labelKey: string; className: string }
const DEFAULT_LINK_STYLES: LinkStyle[] = [
  { labelKey: 'link_style_default', className: '' },
  { labelKey: 'link_style_strong', className: 'rte-link--strong' },
  { labelKey: 'link_style_muted', className: 'rte-link--muted' },
];
```

Стили `.rte-link--strong` и `.rte-link--muted` определены в `styles.css`
(`.rte-content a.rte-link--…`), поэтому они работают и во вьюере.

## 3.6. Строка статуса

`.rte-status[role=status][aria-live=polite]` под тулбаром. Показывает
`upload_image` / `upload_audio` / `upload_file` («Загрузка изображения…»),
пока идёт хоть одна загрузка через адаптер соответствующего вида (счётчик по
`onUpload` `start`/`done`/`failed`), и последнюю ошибку (`error.message`) в
течение 6 секунд с классом `rte-status--error`. Элемент есть в DOM всегда,
даже пустой, — читалки пропускают регион, который появляется вместе с
текстом. `statusLine: false` убирает его: хост показывает свои уведомления
по `onError`/`onUpload`. Локальный blob-путь (без адаптера) событий загрузки
не даёт.

## 3.7. Клавиатурные сокращения

| Где | Клавиши | Действие |
| --- | --- | --- |
| Документ | `Mod-B/I/U`, `Mod-Shift-S`, `Mod-Shift-7/8`, `Mod-Shift-B`, `Mod-E`, `Mod-Alt-C`, `Mod-Alt-1…6`, `Mod-,`/`Mod-.`, `Mod-Z`/`Mod-Shift-Z`, `Mod-Y` | стандартные TipTap |
| Документ | `Alt+F10` | фокус в тулбар (расширение `richEditorUiShortcuts` оболочки) |
| Документ | `Mod-K` | диалог ссылки |
| Документ | `←`/`→` | выделяют формулу как узел; `Enter` на выделенной формуле открывает её редактор |
| Тулбар | `←`/`→`, `Home`/`End`, `Enter`/`Space`, `Escape` | навигация, активация, возврат в документ |
| Кнопка меню | `↓`/`↑` | открыть и встать на первый/последний пункт |
| Меню | `↑`/`↓`, `Home`/`End`, `Enter`, `Escape`; в сетке `←`/`→` | навигация |
| Диалог | `Tab` (кольцо), `Escape`, `Enter` в текстовом поле | фокус, закрытие, применение |
| Формульный диалог | `←`/`→`, `Home`/`End` на вкладках и категориях | переключение (ARIA tabs) |
| Плеер аудио | `Tab` до кнопки и осциллограммы; `←/→/↑/↓` ±5 с, `Home`/`End`, `Escape` | управление |
| Поповер ссылки | `Tab` до полей, `Enter` применяет, `Escape` закрывает и возвращает каретку | — |

`formatShortcut('Mod-B')` → `⌘B` на Mac / `Ctrl+B` иначе;
`ariaKeyshortcuts('Mod-B')` → `Meta+B` / `Control+B` (внутренние функции
`ui/shortcuts.ts`, не экспортируются).

## 3.8. Доступность: сводка

- **Область ввода**: `role="textbox"`, `aria-multiline`, `aria-label`
  (`ariaLabel` или «Текстовый редактор»), `aria-placeholder`.
- **Тулбар**: `role="toolbar"` с `aria-label`; одна остановка Tab; кнопки с
  `aria-label`, `aria-keyshortcuts`, переключатели с `aria-pressed`; кнопка
  меню — `aria-haspopup="menu"`, `aria-expanded`, текущее значение
  (`H2`) через `aria-describedby`.
- **Меню**: `role="menu"` + `aria-labelledby`; пункты `menuitem` /
  `menuitemradio` / `menuitemcheckbox` с `aria-checked`; палитра — сетка.
- **Диалоги**: `role="dialog"`, `aria-modal`, `aria-labelledby` заголовком,
  focus trap, возврат фокуса в документ; ошибки — `role="alert"` +
  `aria-invalid`; вкладки — `tablist/tab/tabpanel` с `aria-selected`,
  `aria-controls`; статусы загрузки — `role="status"`.
- **Узлы документа**: формула — `role="img"` с `aria-label` из LaTeX (и в
  экспорте, и во вьюере); голосовое сообщение — `role="group"` с именем,
  осциллограмма — `role="slider"` с `aria-valuemin/max/now/text`; вложение —
  ссылка с `aria-label` «Скачать: имя».
- **Живые регионы**: строка статуса (`polite`), превью формулы (`polite`),
  статус загрузки MathLive.
- **Фокус виден**: `--rte-focus-ring` на всех контролах; в области ввода
  индикатором служит каретка.
- **forced-colors**: активные состояния получают `outline`, образцы цветов —
  `forced-color-adjust: none`; `prefers-reduced-motion` отключает переходы.

Чего нет: речевого описания формул (speech-rule-engine) и навигации по
выражению — имя формулы читалке даёт её LaTeX.
