# Документация библиотеки rich-text-редактора

Полное описание того, как устроена и как работает библиотека: ядро на
ProseMirror/TipTap, интерфейс на голом DOM, формулы MathML/MathJax/MathLive,
медиа, санитайзер, Vue-обёртка, автономная сборка и Django-пакет.

Документация написана по исходному коду репозитория (состояние ветки `main`
на момент написания). Там, где существующие документы в корне репозитория
(`README.md`, `ARCHITECTURE.md`, `THEMING.md`, `LIMITATIONS.md`, ADR) уже
описывают тему, здесь даётся ссылка и дополнение, а не копия. Расхождения
между кодом и старыми документами собраны в
[15-limitations-and-status.md](15-limitations-and-status.md).

## Оглавление

| № | Файл | О чём |
| --- | --- | --- |
| 1 | [01-overview.md](01-overview.md) | Назначение, состав пакетов, схема архитектуры, жизненный цикл редактора |
| 2 | [02-core.md](02-core.md) | `RichEditorCore`, набор расширений, схема документа, формат HTML, `prepareIncomingHtml`, санитайзер, legacy-режим (Froala/Wiris) |
| 3 | [03-vanilla-ui.md](03-vanilla-ui.md) | `createRichEditor`: тулбар, пресеты, `toolbarItems`, `features`, модалка/поповер/дропдаун, диалоги, строка статуса, клавиатура, доступность |
| 4 | [04-formulas.md](04-formulas.md) | MathML как источник истины, MathJax SVG, MathLive, шаблоны, LaTeX ↔ MathML, химия |
| 5 | [05-media-and-uploads.md](05-media-and-uploads.md) | `UploadAdapter`, `UploadPipeline`, лимиты, события `onUpload`, `RichEditorError`, запись голоса, текстовые файлы |
| 6 | [06-viewer.md](06-viewer.md) | Вьюер `createRichContent` / `<RichContent />` для чтения без редактора |
| 7 | [07-vue.md](07-vue.md) | Vue-обёртка: пропы, события, `v-model`, exposed-методы, `RichEditorPlugin` |
| 8 | [08-theming.md](08-theming.md) | Токены `--rte-*`, тёмная тема, forced-colors, мобильные брейкпоинты (дополнение к `THEMING.md`) |
| 9 | [09-i18n.md](09-i18n.md) | Таблицы переводов, порядок поиска, переопределение хостом, локаль MathLive, полный список ключей |
| 10 | [10-standalone-and-django.md](10-standalone-and-django.md) | `@rich-editor/standalone` и `django-rich-editor`: подключение, загрузки, серверный санитайзер, контракт клиент ↔ сервер |
| 11 | [11-security.md](11-security.md) | Модель угроз, что делает санитайзер на клиенте и сервере, что остаётся на хосте |
| 12 | [12-development.md](12-development.md) | Запуск тестов, сборки, демо, e2e; структура тестов; соглашения по коду |
| 13 | [13-recipes.md](13-recipes.md) | Рецепты: своя кнопка, своя возможность, свой адаптер загрузки, своя тема, legacy-контент, вьюер без редактора, headless-режим |
| 14 | [14-api-reference.md](14-api-reference.md) | Справочник всех экспортов `@rich-editor/core` и `@rich-editor/vue` с сигнатурами |
| 15 | [15-limitations-and-status.md](15-limitations-and-status.md) | Известные ограничения, статус тестирования, расхождения между кодом и документами |

## С чего начать

- **Интегрирую во Vue-приложение** — [07-vue.md](07-vue.md), затем
  [05-media-and-uploads.md](05-media-and-uploads.md) (адаптеры загрузки) и
  [08-theming.md](08-theming.md).
- **Подключаю без бандлера или в Django** —
  [10-standalone-and-django.md](10-standalone-and-django.md).
- **Нужно только показывать сохранённые документы** — [06-viewer.md](06-viewer.md).
- **Расширяю редактор (кнопка, возможность, диалог)** —
  [03-vanilla-ui.md](03-vanilla-ui.md) и [13-recipes.md](13-recipes.md).
- **Отвечаю за безопасность** — [11-security.md](11-security.md) и
  [02-core.md](02-core.md#санитайзер).
- **Разрабатываю саму библиотеку** — [01-overview.md](01-overview.md),
  [12-development.md](12-development.md), ADR в `docs/adr/`.

## Соглашения в этой документации

- Пути к файлам даются от корня репозитория: `packages/editor-core/src/…`.
- Сигнатуры приводятся в TypeScript так, как они объявлены в коде
  (`packages/editor-core/src/index.ts`, `packages/editor-vue/src/index.ts`).
- Если возможность **не реализована**, об этом сказано явно; документация не
  описывает желаемое поведение.
- Имена npm-пакетов `@rich-editor/*` — заглушка (см. корневой `README.md`),
  перед публикацией их переименуют.
