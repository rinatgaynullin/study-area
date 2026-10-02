# 12. Разработка библиотеки

## Назначение

Монорепозиторий на npm workspaces (`packages/*`, `apps/*`): Node ≥ 20,
Python ≥ 3.10 для Django-пакета, Chromium для Playwright
(`npx playwright install --with-deps chromium`). Тесты идут по исходникам через
алиасы, сборка для них не нужна.

## Когда использовать

- Правите ядро, обёртку, standalone или Django-пакет.
- Проверяете изменение перед PR: `npm run ci` повторяет то, что делает CI.

## Интерфейс

### Команды корня

| Команда | Что делает |
| --- | --- |
| `npm install` | Зависимости всех пакетов |
| `npm run dev` | Демо на `http://localhost:5173`: `/` (Vue), `/vanilla.html` (ядро), `/standalone.html` (статика) |
| `npm test`, `npm run test:watch`, `npm run test:coverage` | Vitest (jsdom): ядро, оболочка, Vue |
| `npm run test:e2e` | Playwright, проекты `desktop` и `mobile`; демо поднимается сам |
| `npm run typecheck` | `tsc` / `vue-tsc` для core, vue, standalone, demo |
| `npm run build` | core → vue → копия `legacy.css` → standalone |
| `npm run build:demo` | Сборка демо (`DEMO_BASE` — префикс для GitHub Pages) |
| `npm run ci` | typecheck + test + build |
| `npm run smoke:standalone` | Дымовая проверка автономной сборки в Chromium |

Django: `cd packages/django-rich-editor && pip install -e '.[test]' && pytest`.

### Слои тестов

| Слой | Где | Инструмент |
| --- | --- | --- |
| Ядро и оболочка | `packages/editor-core/tests/*.test.ts` | Vitest + jsdom |
| Vue | `packages/editor-vue/tests/*.test.ts` | Vitest + `@vue/test-utils` |
| E2E | `tests/e2e/*.spec.ts` — три страницы демо | Playwright |
| Standalone | `packages/editor-standalone/scripts/smoke.mjs` | Chromium |
| Django | `packages/django-rich-editor/tests/` | pytest-django |

Тесты-контракты, которые падают при расхождении кода и документов:
`sanitize-contract` (TS и Python), `theme-tokens` (CSS и `THEMING.md`),
`legacy-css-tokens`, `i18n` и `i18n-keys-in-use`, `mathlive-i18n`,
`templates` (каждый шаблон рендерится). CI (`.github/workflows/ci.yml`)
запускает все слои на каждый PR.

### Соглашения

- Файлы `kebab-case`; `index.ts` — только реэкспорты; побочные импорты
  (`styles.css`) живут в модулях.
- Стрелочные функции; классы — для модулей с разделяемым изменяемым
  состоянием (контроллеры оболочки и тулбара, `UploadPipeline`,
  `VoiceRecorder`). Публичный API остаётся фабриками `create*`.
- Новый ключ i18n добавляется в `ru.ts` и `en.ts` одновременно; стили — только
  через токены `--rte-*`; изменение `sanitize.ts` дублируется в `sanitize.py`.
- Комментарии по-русски, объясняют «почему». Значимые решения — ADR в
  `docs/adr/`; изменения — `CHANGELOG.md`; новые токены — `THEMING.md`.

### Как добавить

| Что | Где |
| --- | --- |
| Пункт тулбара с одной командой | `ui/toolbar-items.ts` (+ иконка в `ui/icons.ts`, ключи в `ru.ts`/`en.ts`, пресет в `ui/presets.ts`) |
| Пункт с панелью или диалогом | `ui/toolbar-panels.ts`; диалог — `ui/dialogs/`, регистрация в оболочке `ui/rich-editor-ui.ts` |
| Узел документа | `nodes/<name>.ts` по образцу `attachment.ts`; разметка должна проходить санитайзер; тип опций реэкспортировать из `index.ts` |
| Возможность без правки ядра | `EditorFeature` ([13](13-recipes.md#своя-возможность-editorfeature-с-диалогом)) |

## Пример

```bash
npm install
npm run dev            # демо
npm test               # юнит и компонентные тесты
npm run test:e2e       # Playwright
npm run ci             # то же, что CI
```

## Ограничения

- Playwright настроен только на Chromium; Safari и Firefox не проверяются.
- Файла конфигурации ESLint в репозитории нет — стайлгайд соблюдается на ревью.
- Пакеты не публикуются; scope `@rich-editor` переименуется перед публикацией.

## См. также

- `ARCHITECTURE.md`, `CHANGELOG.md`, `docs/adr/`.
- [15-limitations-and-status.md](15-limitations-and-status.md) — статус тестов и
  расхождения.
