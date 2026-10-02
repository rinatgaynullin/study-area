# 12. Разработка библиотеки

## 12.1. Окружение

- Node ≥ 20 (CI — 22), npm workspaces (`packages/*`, `apps/*`).
- Python ≥ 3.10 (CI — 3.12) для `django-rich-editor`.
- Chromium для Playwright: `npx playwright install --with-deps chromium`.

```bash
npm install
```

## 12.2. Скрипты корня (`package.json`)

| Команда | Что делает |
| --- | --- |
| `npm run dev` | `apps/demo`: пересобирает standalone в `public/standalone` (`sync-standalone.mjs`) и запускает Vite на `http://localhost:5173` — страницы `/`, `/vanilla.html`, `/standalone.html` |
| `npm test` / `npm run test:watch` / `npm run test:coverage` | Vitest (jsdom) по `packages/*/tests/**/*.test.ts` и `tests/unit/**` |
| `npm run test:e2e` | Playwright, проекты `desktop` (Desktop Chrome) и `mobile` (Pixel 5); сам поднимает `npm run dev -w @rich-editor/demo` |
| `npm run typecheck` | `tsc`/`vue-tsc --noEmit` для core, vue, standalone, demo |
| `npm run build` | core → vue → `scripts/copy-legacy-css.mjs` (кладёт `legacy.css` в `dist` обоих пакетов) → standalone |
| `npm run build:demo` | сборка демо (`DEMO_BASE` задаёт `base` для GitHub Pages) |
| `npm run ci` | typecheck + test + build |
| `npm run smoke:standalone` | дымовая проверка автономной сборки в Chromium |

Пакетные скрипты: `build` = `vite build` + генерация типов
(`tsc -p tsconfig.build.json` / `vue-tsc`), `typecheck`. Для standalone —
`build` + `scripts/copy-assets.mjs`, `smoke`.

Если порт 5173 занят, есть локальная обёртка `.playwright/local.config.ts`
(в `.gitignore`), которая запускает демо на другом порту:
`npx playwright test -c .playwright/local.config.ts`.

## 12.3. Конфигурация тестов

- `vitest.config.ts`: плагин Vue, алиасы `@rich-editor/core` →
  `packages/editor-core/src/index.ts` и `@rich-editor/vue` →
  `packages/editor-vue/src/index.ts` (тесты идут по исходникам, сборка не
  нужна), `environment: 'jsdom'`, `globals: true`, `testTimeout: 20_000`
  (первый рендер MathJax компилирует шрифты), coverage v8 по `packages/*/src`.
- `tests/setup.ts`: заглушки того, чего нет в jsdom —
  `URL.createObjectURL/revokeObjectURL`, `ResizeObserver` (класс),
  `document.elementFromPoint`, `HTMLMediaElement.play/pause`.
- `playwright.config.ts`: `testDir: tests/e2e`, таймаут 60 с, один воркер,
  `baseURL: http://localhost:5173`, `trace: retain-on-failure`,
  `PLAYWRIGHT_CHROMIUM_PATH` или `/opt/pw-browsers/chromium` для CI-образов.

## 12.4. Структура тестов

```
packages/editor-core/tests/
  sanitize.test.ts · sanitize-contract.test.ts        санитайзер и его контракт с Python
  formula.test.ts · formula-node.test.ts              MathML-утилиты, узел формулы (клик, Enter, a11y)
  mathjax-output.test.ts · mathml-import.test.ts      SVG MathJax (один root, инлайн-глифы, px), импорт сторонних систем уравнений
  templates.test.ts · mathlive-i18n.test.ts           каждый шаблон через реальный пайплайн; русские строки MathLive
  editor-content.test.ts                              round-trip HTML, формулы, таблицы
  upload.test.ts · recorder.test.ts                   адаптеры, лимиты, рекордер с mock MediaRecorder
  audio-recorder-dialog.test.ts                       диалог записи на пределах, фокус, alert
  toolbar.test.ts · ui-primitives.test.ts · vanilla-ui.test.ts   раскладка, roving tabindex, меню/модалка/поповер, оболочка целиком, features, Alt+F10, Ctrl+K
  rich-content.test.ts · legacy-viewer.test.ts        вьюер; legacy во вьюере и обратный импорт
  legacy-froala.test.ts · legacy-css-tokens.test.ts   Wiris-декодер, legacyEmbed, подсветка, инлайновые стили; токены legacy.css
  theme.test.ts · theme-tokens.test.ts                applyTheme; контракт токенов и THEMING.md
  i18n.test.ts · i18n-keys-in-use.test.ts             переводчик; неиспользуемые ключи
  links.test.ts · shortcuts.test.ts · lru-cache.test.ts
  fixtures/froala-content.ts                          образцы разметки Froala/Wiris
packages/editor-vue/tests/
  rich-editor.test.ts                                 монтирование, команды тулбара, v-model (и эхо), тема, i18n, exposed API, диалог формул, ошибки
  rich-content.test.ts                                вьюер: санитизация, формулы с MathML, SVG, масштаб, аудио, вложения
tests/e2e/
  editor.spec.ts                                      Vue-демо: документ, вставка HTML (в т. ч. враждебного), формулы, тулбар, тема, адаптив, legacy, картинки, поповер ссылки, размер формул, модалка на телефоне
  vanilla.spec.ts                                     страница ядра: тулбар, меню, диалоги, режим чтения, рекордер, локаль, клавиатура (Alt+F10, стрелки, Enter на формуле, Ctrl+K)
  standalone.spec.ts                                  автономная сборка из статики; ссылки между страницами демо
packages/django-rich-editor/tests/                   pytest-django: sanitize, views, widget, templatetags
```

Слои (из `ARCHITECTURE.md`, дополнено):

| Слой | Инструмент | Запуск |
| --- | --- | --- |
| Юнит/интеграция ядра | Vitest + jsdom | `npm test` |
| Оболочка (vanilla UI) | Vitest + jsdom | `npm test` |
| Vue-обёртка | Vitest + `@vue/test-utils` | `npm test` |
| E2E | Playwright desktop + mobile | `npm run test:e2e` |
| Автономная сборка | `smoke.mjs` в Chromium | `npm run smoke:standalone` |
| Django | pytest | `cd packages/django-rich-editor && pytest` |

Тесты-«контракты», которые стоит знать: `sanitize-contract` (TS ↔ Python),
`theme-tokens` (CSS ↔ `THEMING.md`), `legacy-css-tokens`, `i18n-keys-in-use`,
`mathlive-i18n` (наши ключи ↔ реальный MathLive), `templates` (каждый
шаблон рендерится). Они ловят расхождения между кодом и документами.

## 12.5. CI (`.github/workflows/ci.yml`)

Три job на push в `main` и каждый PR (параллельные запуски одного ref
отменяются):

1. **build** — `npm ci`, `npm run ci` (typecheck + vitest + build всех
   пакетов), `npm run build:demo`, установка Chromium,
   `npm run smoke:standalone`.
2. **django** — Python 3.12, `pip install -e 'packages/django-rich-editor[test]'`,
   `pytest`.
3. **e2e** — матрица `desktop` / `mobile`, `npx playwright test --project=…`;
   при падении выгружается `playwright-report`.

`pages.yml` публикует `apps/demo` на GitHub Pages при push в `main` или по
кнопке (`DEMO_BASE` = путь проекта).

## 12.6. Соглашения по коду

Источник правил — стайлгайд umschool
(`.agents/skills/umschool-frontend-styleguide/references/*.md`) и фактический
стиль репозитория (коммит «Ядро: стиль под eslint-конфиг и стайлгайд
umschool»). Файла конфигурации ESLint в репозитории нет — правила
соблюдаются вручную и на ревью.

- **Файлы — `kebab-case`**; модуль с одним экспортом называется как экспорт
  (`rich-editor-core.ts` → `RichEditorCore`, `create-color-panel.ts` →
  `createColorPanel`). Vue-компоненты тоже `kebab-case` (`rich-editor.vue`).
- **Стрелочные функции** для всего, что не класс: `export const
  createRichContent = (options) => {…}`; `function` — только там, где
  нужны перегрузки (`on` в `ui/dom.ts`) или `this`.
- **Классы — для модулей с разделяемым изменяемым состоянием**, к которому
  обращаются несколько обработчиков/шагов: контроллеры оболочки, тулбара,
  модалки, поповера, диалогов формул и записи, `UploadPipeline`,
  `VoiceRecorder`, `Translator`, `LruCache`. Обработчики событий в классах —
  `private readonly onX = (): void => {…}` (стрелочные поля, чтобы не
  привязывать `this`). Публичный API при этом остаётся фабрикой `create*`,
  возвращающей интерфейс.
- **Константы — `UPPER_SNAKE_CASE`** (`DEFAULT_LIMITS`, `ERROR_VISIBLE_MS`,
  `REGEX_SCHEME`); ключи объектов не трогаются.
- **Имена обработчиков** — `on + контекст + глагол` (`onImageInputChange`,
  `onModalClose`); предикаты — `is/has/can…` (`isRecordingSupported`,
  `isWrapped`); полные слова `event`, `error`.
- **Комментарии** — по-русски, объясняют *почему*, а не *что*; публичные
  типы в `types.ts` частично задокументированы по-английски (историческое).
- **`index.ts` — только реэкспорты**; побочные импорты (`styles.css`) живут в
  модулях (`rich-editor-core.ts`, компонентах Vue).
- **i18n-ключи** — `lower_snake` с префиксом контекста; новый ключ
  добавляется в `ru.ts` и `en.ts` одновременно, иначе упадёт `i18n.test.ts`
  («matching key sets»); неиспользуемый ключ ловит `i18n-keys-in-use`.
- **Стили** — только через токены `--rte-*` (тест запретит литерал);
  компонентные классы `rte-блок__элемент--модификатор`.
- **Санитайзер** — изменения в `sanitize.ts` дублируются в `sanitize.py`.
- **Документация** — `CHANGELOG.md` (Keep a Changelog), ADR на значимые
  решения, `THEMING.md` при изменении токенов, `LIMITATIONS.md` при
  осознанных ограничениях.

## 12.7. Как добавить

**Пункт тулбара с одной командой** — запись в `SIMPLE_ITEMS`
(`ui/toolbar-items.ts`): `id`, `icon` (добавить в `ui/icons.ts`, если новый),
`labelKey` (ключи в `ru.ts`/`en.ts`), `activeName`, `shortcut`, `run`; затем
в нужный пресет (`ui/presets.ts`).

**Пункт с панелью или диалогом** — дескриптор в `createPanelToolbarItems`
(`ui/toolbar-panels.ts`); диалог — фабрика в `ui/dialogs/`, регистрация в
`buildOverlays()` оболочки.

**Узел документа** — `nodes/<name>.ts` по образцу `attachment.ts`: атрибуты
с `parseHTML`/`renderHTML`, `parseHTML` с `getAttrs`, экспорт, node view на
голом DOM, команды с `declare module '@tiptap/core'`; добавить в
`buildExtensions()`; проверить, что `sanitizeHtml` пропускает разметку
(иначе — allowlist в TS **и** Python); реэкспорт типа опций из `index.ts`
(иначе типы команд не дойдут до потребителей — см. комментарий в конце
`index.ts`).

**Внешняя возможность без правки ядра** — `EditorFeature` ([13-recipes.md](13-recipes.md)).

## 12.8. Демо как инструмент

`apps/demo/src/app.vue` — стенд с переключателями локали, пресета, темы,
режима загрузки (локально / mock-адаптер с задержкой и журналом), режима
чтения, мобильного viewport, legacy; вкладки «Экспортированный HTML»,
«Исходник», «Вставить HTML» (с образцами из `samples.ts`: MathML из другого
редактора, система уравнений, legacy Froala, инлайновые стили, небезопасный
HTML, разметка из Word, базовое форматирование), «Вьюер без редактора».
`vanilla.ts` — ядро без Vue (редактор + вьюер, связанные через `onChange`);
`public/standalone-demo.js` — автономная сборка. E2E-тесты опираются именно
на эти страницы, поэтому их разметка — часть тестового контракта.

## 12.9. Публикация

Пакеты не опубликованы; scope `@rich-editor` — заглушка. Перед публикацией:
переименовать scope в `package.json` всех пакетов и в `exports`/импортах
демо, собрать `npm run build`, для Django — `npm run build -w
@rich-editor/standalone && node packages/django-rich-editor/scripts/sync-static.mjs
&& cd packages/django-rich-editor && python -m build`.
