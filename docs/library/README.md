# Документация библиотеки rich-text-редактора

Описание публичных интерфейсов: что делает каждая часть библиотеки, когда её
использовать и как вызывать. Внутреннее устройство здесь не описывается — для
него есть исходники и ADR в `docs/adr/`.

Имена npm-пакетов `@rich-editor/*` — заглушка, перед публикацией их переименуют.

## Оглавление

| № | Файл | О чём |
| --- | --- | --- |
| 1 | [01-overview.md](01-overview.md) | Состав пакетов, что куда подключать, путь документа «HTML на входе — HTML на выходе» |
| 2 | [02-core.md](02-core.md) | `RichEditorCore`: headless-движок, опции, методы, формат сохраняемого HTML, legacy-режим |
| 3 | [03-vanilla-ui.md](03-vanilla-ui.md) | `createRichEditor`: редактор с тулбаром без фреймворка; пресеты, свои пункты, `features` |
| 4 | [04-formulas.md](04-formulas.md) | Формулы: MathML как формат, LaTeX и MathML, рендер в SVG, шаблоны, шрифты MathLive |
| 5 | [05-media-and-uploads.md](05-media-and-uploads.md) | Адаптеры загрузки, лимиты, коды ошибок, запись голоса, текстовые файлы |
| 6 | [06-viewer.md](06-viewer.md) | Вьюер `createRichContent` и `RichContent`: показ документа без редактора |
| 7 | [07-vue.md](07-vue.md) | Vue-обёртка: пропы, события, exposed-методы, плагин, Nuxt |
| 8 | [08-theming.md](08-theming.md) | Тёмная тема, `applyTheme`, классы-хуки; список токенов — в `THEMING.md` |
| 9 | [09-i18n.md](09-i18n.md) | Локали, таблицы переводов, порядок поиска, ключи, строки MathLive |
| 10 | [10-standalone-and-django.md](10-standalone-and-django.md) | Сборка без бандлера и Django-пакет: виджет, поля, вьюхи загрузок, теги |
| 11 | [11-security.md](11-security.md) | Что вырезает санитайзер на клиенте и сервере, что остаётся на хосте |
| 12 | [12-development.md](12-development.md) | Команды сборки и тестов, слои тестов, соглашения |
| 13 | [13-recipes.md](13-recipes.md) | Короткие рабочие примеры на типовые сценарии |
| 14 | [14-api-reference.md](14-api-reference.md) | Сигнатуры всех экспортов `@rich-editor/core`, `@rich-editor/vue`, standalone, Django |
| 15 | [15-limitations-and-status.md](15-limitations-and-status.md) | Ограничения, неочевидное поведение, расхождения кода с документами |

## С чего начать

- **Фронтенд-интегратор, Vue**: [07-vue.md](07-vue.md) →
  [05-media-and-uploads.md](05-media-and-uploads.md) → [08-theming.md](08-theming.md) →
  [13-recipes.md](13-recipes.md).
- **Фронтенд-интегратор без Vue**: [03-vanilla-ui.md](03-vanilla-ui.md) →
  [06-viewer.md](06-viewer.md) → [05-media-and-uploads.md](05-media-and-uploads.md).
- **Бэкенд, Django**: [10-standalone-and-django.md](10-standalone-and-django.md) →
  [11-security.md](11-security.md) → [05-media-and-uploads.md](05-media-and-uploads.md#лимиты).
- **Разработчик библиотеки**: [01-overview.md](01-overview.md) → [02-core.md](02-core.md) →
  [12-development.md](12-development.md) →
  [15-limitations-and-status.md](15-limitations-and-status.md).

## Соглашения

- Сигнатуры приводятся так, как они объявлены в `packages/editor-core/src/index.ts`
  и `packages/editor-vue/src/index.ts`. Полный список — в
  [14-api-reference.md](14-api-reference.md); тематические разделы ссылаются на
  него, а не копируют.
- Таблицы «Интерфейс» перечисляют параметры: имя, тип, значение по умолчанию,
  что делает.
- Если возможность не реализована, об этом сказано явно.
