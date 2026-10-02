# 7. Vue-обёртка `@rich-editor/vue`

## Назначение

Тонкая обёртка над `createRichEditor` и `createRichContent`: компоненты
`RichEditor` и `RichContent` монтируют интерфейс ядра и добавляют то, ради
чего нужен фреймворк — реактивные пропы, `v-model`, события. Пакет
реэкспортирует API ядра, чтобы хосту хватало одного импорта. Единственная
зависимость — `@rich-editor/core`; `vue ^3.4` — peer.

## Когда использовать

- Приложение на Vue 3 (в том числе Nuxt — только на клиенте).
- Для опций, которых нет у компонента (`collapseBelow`, палитры, `extensions`),
  вызывайте `createRichEditor` из того же пакета ([03](03-vanilla-ui.md)).

## Интерфейс

Полный список экспортов — [14-api-reference.md](14-api-reference.md#rich-editorvue).

### Подключение

```ts
import 'mathlive/fonts.css';            // шрифты поля ввода формул
import '@rich-editor/vue/styles.css';   // стили редактора и вьюера
import '@rich-editor/vue/legacy.css';   // только если есть контент Froala

import { RichEditorPlugin } from '@rich-editor/vue';
app.use(RichEditorPlugin);              // регистрирует RichEditor и RichContent глобально
```

Или локально: `import { RichEditor, RichContent } from '@rich-editor/vue'`.
Экспорт по умолчанию — `RichEditor`.

### Пропы `RichEditor`

«Реактивен» — компонент следит за пропом; остальные читаются один раз при
монтировании (для смены пересоздайте компонент через `:key`).

| Проп | Тип | По умолчанию | Реактивен | Что делает |
| --- | --- | --- | --- | --- |
| `modelValue` | `string` | `''` | да | HTML документа (`v-model`); санитизируется на входе |
| `locale` | `string` | `'ru'` | да | Язык интерфейса |
| `messages` | `Record<string, Messages>` | — | да, deep | Таблицы переводов ([09](09-i18n.md)) |
| `uploadImage`, `uploadAudio`, `uploadFile` | `UploadAdapter` | — | нет | Адаптеры загрузки ([05](05-media-and-uploads.md)) |
| `limits` | `Partial<EditorLimits>` | — | да, deep | Пределы размеров и длительности |
| `editable` | `boolean` | `true` | да | `false` прячет тулбар и запирает документ |
| `toolbar` | `ToolbarConfig` | `'full'` | нет | Пресет или список групп ([03](03-vanilla-ui.md#тулбар)) |
| `toolbarItems` | `Record<string, ToolbarItemDescriptor>` | — | нет | Свои пункты и замены встроенных |
| `features` | `EditorFeature[]` | — | нет | Возможности; тип импортируется из `@rich-editor/core` |
| `placeholder` | `string` | локализованный | нет | Подсказка пустого документа |
| `ariaLabel` | `string` | «Текстовый редактор» | нет | Имя области ввода для читалки |
| `formulaScale` | `number` | `1` | нет | Масштаб формул |
| `linkStyles` | `LinkStyle[]` | три встроенных | нет | Варианты оформления ссылки |
| `legacy` | `boolean` | `false` | нет | Разметка Froala + Wiris; меняет схему |
| `mathliveFontsDirectory` | `string` или `null` | `null` | нет | Каталог шрифтов MathLive ([04](04-formulas.md#шрифты-и-локаль-mathlive)) |
| `minHeight` | `string` | `'220px'` | нет | Минимальная высота области ввода |
| `statusLine` | `boolean` | `true` | нет | Строка статуса под тулбаром |
| `theme` | `EditorTheme` | `'light'` | да | `'light'`, `'dark'`, `'auto'` |

### События `RichEditor`

| Событие | Payload | Когда |
| --- | --- | --- |
| `update:modelValue`, `change` | `html: string` | Каждое изменение документа |
| `focus`, `blur` | — | Фокус области ввода |
| `error` | `RichEditorError` | Ошибки загрузок, записи, MathML |
| `upload` | `UploadEvent` | Фазы загрузки через адаптер |
| `ready` | `RichEditorCore` | Редактор создан (в `onMounted`) |

`v-model`: компонент не применяет повторно HTML, который сам только что отдал
или который уже в документе, — иначе сбивалось бы выделение и история.

### Exposed-методы `RichEditor`

| Член | Что делает |
| --- | --- |
| `getHTML()`, `setHTML(html)`, `getJSON()`, `getText()` | Контент ([02](02-core.md#поля-и-методы)) |
| `isEmpty()`, `focus()` | Состояние и фокус |
| `insertFormula(mathml, type?)` | Вставка формулы |
| `whenFormulasReady()` | Дождаться SVG перед экспортом |
| `editor`, `core` | TipTap `Editor` и `RichEditorCore` (`null` до монтирования) |

Язык, тема, пределы и режим чтения меняются пропами, не методами.

### `RichContent` и `RteIcon`

`RichContent` — пропы `html`, `formulaScale`, `legacy`, `theme`, событие
`rendered`, exposed `renderPendingFormulas()` ([06](06-viewer.md)).
`RteIcon` — `name: string` (имя из `ICONS`), `size?: number` (20): иконка
редактора для своего интерфейса.

## Пример

```vue
<script setup lang="ts">
import { ref, shallowRef } from 'vue';
import { RichEditor, RichContent, type RichEditorError, type UploadAdapter } from '@rich-editor/vue';
import en from './locales/en.json';

const html = ref('<p>Начните писать…</p>');
const editor = shallowRef<InstanceType<typeof RichEditor> | null>(null);

const uploadImage: UploadAdapter = async (file, ctx) => {
  const body = new FormData();
  body.append('file', file);
  const res = await fetch('/api/uploads/image', { method: 'POST', body, signal: ctx.signal });
  if (!res.ok) throw new Error('upload failed');
  return await res.json(); // { url, name?, mime?, size? }
};

const onError = (error: RichEditorError) => toast(error.message);

const exportHtml = async () => {
  await editor.value?.whenFormulasReady();
  return editor.value?.getHTML();
};
</script>

<template>
  <RichEditor
    ref="editor"
    v-model="html"
    locale="en"
    :messages="{ en }"
    :upload-image="uploadImage"
    :limits="{ maxAudioDurationSec: 120 }"
    toolbar="standard"
    theme="auto"
    aria-label="Ответ"
    @error="onError"
  />
  <RichContent :html="html" theme="auto" />
</template>
```

### Nuxt

Редактор работает только на клиенте: оборачивайте в `ClientOnly`, в
`nuxt.config.ts` добавьте `css: ['@rich-editor/vue/styles.css']` и
`vite: { optimizeDeps: { include: ['mathlive'] } }`. `RichContent` можно
ставить где угодно: на сервере — пустая оболочка, на клиенте — наполнение.

## Ограничения

- Компонент не даёт доступа к `RichEditorUi` — только к `core`.
- `setHTML()` не обновляет `v-model`: после программной подстановки документа
  обновите модель сами.
- Нет компонентов интерфейса на Vue (`EditorToolbar`, `RteModal` и т. п.):
  диалоги строятся на `createModal` / `createPopover` из ядра.

## См. также

- [03-vanilla-ui.md](03-vanilla-ui.md) — что делает каждая опция.
- [13-recipes.md](13-recipes.md) — Nuxt, legacy, экспорт с SVG.
