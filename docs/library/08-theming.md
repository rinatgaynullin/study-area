# 8. Темизация

Полный справочник токенов — `THEMING.md` в корне репозитория: каждая
переменная, значение по умолчанию и что она контролирует. Этот раздел не
повторяет таблицы, а описывает механику и то, чего в `THEMING.md` нет.

Файлы: `packages/editor-core/src/styles.css` (объявления токенов, тёмная
тема, медиа-запросы), `legacy.css`, `ui/theme.ts`,
`tests/theme-tokens.test.ts`, `tests/legacy-css-tokens.test.ts`.

## 8.1. Контракт

- Все цвета, шрифты, радиусы, тени и размеры контролов интерфейса и
  контента читаются из CSS-переменных `--rte-*`, объявленных на `.rte-root`
  (редактор) и `.rte-content-root` (вьюер).
- Правило `.rte-root, .rte-content-root { … }` в `styles.css` задаёт
  значения по умолчанию в языке дизайн-системы umschool (Golos, 15 px,
  радиусы 8/10/12, оранжевый акцент).
- Тест `theme-tokens.test.ts` запрещает цветовые/шрифтовые/радиусные/теневые
  литералы в правилах интерфейса, требует, чтобы каждая используемая
  переменная была объявлена и каждая объявленная — использована, и сверяет
  список с таблицами `THEMING.md`. То есть контракт не может «протечь»
  незаметно.
- Группы токенов (см. `THEMING.md`): палитра `--rte-color-*`, типографика
  `--rte-font-*`/`--rte-ui-font-*`/`--rte-title-*`, форма и тени
  `--rte-radius*`/`--rte-shadow*`/`--rte-focus-ring`/`--rte-z-modal`, тулбар
  `--rte-toolbar-*`/`--rte-btn-*`, контролы диалогов `--rte-input-*`/
  `--rte-button-*`, диалоги и меню `--rte-modal-*`/`--rte-popover-padding`/
  `--rte-menu-*`, контент и медиа `--rte-content-padding`/`--rte-block-gap`/
  `--rte-formula-padding`/`--rte-audio-*`/`--rte-resize-handle-size`.

## 8.2. Переопределение

Глобально (включайте оба селектора, чтобы вьюер совпадал с редактором):

```css
.rte-root,
.rte-content-root {
  --rte-color-primary: #396fdb;
  --rte-radius: 6px;
  --rte-font-family: Inter, sans-serif;
}
```

Для одного экземпляра — класс на обёртке, переменные каскадируют:

```css
.compact .rte-root { --rte-btn-size: 30px; --rte-content-padding: 8px 10px; }
```

Стабильные классы-хуки для того, до чего переменными не дотянуться:
`.rte-root`, `.rte-content-root`, `.rte-toolbar`, `.rte-toolbar__group`,
`.rte-btn`, `.rte-btn--active`, `.rte-dropdown__panel`, `.rte-menu__item`,
`.rte-modal__panel`, `.rte-content`, `.rte-formula`, `.rte-audio`,
`.rte-attachment`, `.rte-legacy`, `.rte-legacy-embed`, `.rte-status`,
`.rte-popover`, `.rte-link-popover`, `.rte-formula-editor*`, `.rte-recorder*`.

## 8.3. Тёмная тема

```ts
type EditorTheme = 'light' | 'dark' | 'auto';
const DARK_THEME_CLASS = 'rte-theme-dark';
const applyTheme: (element: HTMLElement, theme: EditorTheme) => () => void;   // возвращает функцию снятия слежения
```

Три способа включить:

1. Опция/проп `theme` у `createRichEditor`, `createRichContent`,
   `<RichEditor />`, `<RichContent />`; позже — `setTheme()` /
   `update({ theme })` / смена пропа.
2. Класс `rte-theme-dark` на элементе или **любом предке** (например, на
   `<html>` рядом с темой хоста) — стили срабатывают от обоих вариантов:
   `.rte-theme-dark .rte-root, .rte-root.rte-theme-dark, .rte-theme-dark .rte-content-root, .rte-content-root.rte-theme-dark`.
3. Свои значения: переопределить палитру и `--rte-shadow*` под любым классом,
   как это делает встроенный блок.

`applyTheme(element, theme)`:

- `'light'` / `'dark'` — ставит/снимает класс, возвращает пустую функцию;
- `'auto'` — если `matchMedia` нет (SSR, старый jsdom), снимает класс и
  считает тему светлой; иначе синхронизирует класс с
  `(prefers-color-scheme: dark)` и подписывается на `change`; возвращённая
  функция отписывается.

Тёмный блок переопределяет **только** токены палитры и тени (`--rte-color-*`
кроме `--rte-color-on-highlight`, `--rte-shadow`, `--rte-shadow-lg`) и ставит
`color-scheme: dark`, чтобы нативные контролы (чекбокс, `<input type="color">`,
скроллбары) следовали за темой. `--rte-color-on-highlight` остаётся тёмным:
образцы выделения — светлые пастельные и в тёмной теме.

В Django-виджете тема по умолчанию `auto`, а скрипт дополнительно следит за
`data-theme` админки на `<html>` (см. [10](10-standalone-and-django.md)).

## 8.4. Адаптив и системные режимы

В `styles.css` есть три медиа-блока, которые `THEMING.md` упоминает лишь
частично:

| Медиа-запрос | Что меняется |
| --- | --- |
| `max-width: 640px` | `--rte-btn-size: 40px`, `--rte-font-size: 16px`, `--rte-content-padding: 10px 12px`, `--rte-modal-padding-x: 20px`; галерея шаблонов в формульном диалоге — плотнее и ниже |
| `prefers-reduced-motion: reduce` | отключаются переходы у кнопок, индикатора записи и столбиков осциллограммы |
| `forced-colors: active` (высокая контрастность Windows) | фоны стираются системой, поэтому активные состояния (`.rte-btn--active`, `.rte-menu__item--active`, активная вкладка и категория формульного диалога) получают `outline: 2px solid ButtonText`; образцы цветов — `forced-color-adjust: none`, иначе палитра бессмысленна |

Схлопывание групп тулбара ниже `collapseBelow` (760 px) — не CSS, а
измерение в `ToolbarController` (см. [03](03-vanilla-ui.md#адаптивная-раскладка)).

## 8.5. Фокус

Каждый контрол показывает кольцо `--rte-focus-ring` (`2px solid
var(--rte-color-primary)`); сама область ввода кольца не показывает —
индикатор там каретка. У полей ввода рамка становится `--rte-color-primary`,
дополнительное кольцо — `--rte-input-focus-shadow` (по умолчанию `none`).

## 8.6. Legacy-стили

`legacy.css` подключается отдельно и действует только внутри
`.rte-content.rte-legacy`. Его `--rte-legacy-*` переменные (16 штук)
выводятся из базовых токенов — перекраска `--rte-color-border` меняет и новые,
и старые таблицы. Шесть литералов (зазор и толщина рамки картинки, толстая
граница ячейки, жёлтый маркер Froala, прозрачность, разрядка) — там, где у
Froala нет аналога в новом визуальном языке; каждый прокомментирован в
файле и перечислен в корневом `README.md` («Legacy content»). Тест
`legacy-css-tokens.test.ts` запрещает литералы вне `var()`-фолбэков и правила
вне скоупа `.rte-legacy`.

## 8.7. Не токены

- Внутренние отступы контролов (4–14 px), размеры образцов и чипов —
  собственный ритм редактора, литералы.
- Размеры заголовков в документе — `em` от `--rte-font-size`.
- `--rte-level` — runtime-значение индикатора записи, не тема.
- Иконки — инлайн-SVG на `currentColor`; токена иконок нет.
- Размер формулы **не зависит** от `--rte-font-size`: он запечён в пикселях
  при рендере под кегль 15 px (`DEFAULT_FORMULA_FONT_SIZE_PX`) и
  масштабируется только опцией `formulaScale`. Если хост меняет
  `--rte-font-size`, формулы останутся прежнего размера — используйте
  `formulaScale`.

## 8.8. Пример: тема под дизайн-систему

```css
/* app.css */
.rte-root,
.rte-content-root {
  --rte-color-primary: #6750a4;
  --rte-color-primary-hover: #5a4393;
  --rte-color-primary-soft: #ede7f6;
  --rte-color-link: #3949ab;
  --rte-font-family: 'Roboto', system-ui, sans-serif;
  --rte-radius: 10px;
  --rte-radius-lg: 16px;
  --rte-input-radius: 10px;
  --rte-focus-ring: 3px solid var(--rte-color-primary);
}

/* своя тёмная тема под классом хоста */
.app--dark .rte-root,
.app--dark .rte-content-root {
  --rte-color-bg: #1e1e21;
  --rte-color-text: #eceff4;
  --rte-color-border: #3a3a40;
  --rte-color-subtle-bg: #2a2a2f;
  --rte-shadow: none;
  color-scheme: dark;
}
```

Либо проще: включать встроенную тёмную тему классом `rte-theme-dark` на
`<html>` вместе с темой приложения и переопределять лишь то, что отличается.
