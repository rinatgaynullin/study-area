# 7. Vue-обёртка `@rich-editor/vue`

Файлы: `packages/editor-vue/src/index.ts`, `components/rich-editor.vue`,
`components/rich-content.vue`, `components/rte-icon.vue`,
`rich-editor-plugin.ts`, `styles/index.css`.

Пакет — тонкая обёртка: интерфейс целиком живёт в ядре и собран на голом
DOM; компонент его монтирует и занимается тем, ради чего нужен фреймворк —
реактивными пропами, `v-model` и событиями (ADR 0008). Единственная
runtime-зависимость — `@rich-editor/core`; `vue ^3.4` — peer.

## 7.1. Установка и подключение

```bash
npm install @rich-editor/vue vue
```

```ts
// main.ts
import 'mathlive/fonts.css';              // шрифты поля ввода формул (бандлер вынесет файлы)
import '@rich-editor/vue/styles.css';     // стили редактора и вьюера (реэкспорт styles.css ядра)
import '@rich-editor/vue/legacy.css';     // только если есть контент Froala
```

Глобальная регистрация (по желанию):

```ts
import { RichEditorPlugin } from '@rich-editor/vue';
app.use(RichEditorPlugin);   // регистрирует <RichEditor /> и <RichContent />
```

Или локальный импорт `import { RichEditor, RichContent } from '@rich-editor/vue'`.
Экспорт по умолчанию пакета — `RichEditor`.

## 7.2. `<RichEditor />`

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { RichEditor } from '@rich-editor/vue';

const html = ref('<p>Начните писать…</p>');
</script>

<template>
  <RichEditor v-model="html" />
</template>
```

### Пропы

| Проп | Тип | По умолчанию | Реактивен? | Описание |
| --- | --- | --- | --- | --- |
| `modelValue` | `string` | `''` | да | HTML документа; санитизируется на входе |
| `locale` | `string` | `'ru'` | да (`setLocale`) | Язык интерфейса |
| `messages` | `Record<string, Messages>` | — | да, `deep` (`setMessages`) | Таблицы переводов |
| `uploadImage` / `uploadAudio` / `uploadFile` | `UploadAdapter` | — | **нет** | Адаптеры загрузки; без них — `blob:` URL |
| `limits` | `Partial<EditorLimits>` | — | да, `deep` (`setLimits`) | Пределы размеров и длительности |
| `editable` | `boolean` | `true` | да (`setEditable`) | `false` прячет тулбар и запирает документ |
| `toolbar` | `ToolbarConfig` | `'full'` | **нет** | Пресет или список групп |
| `toolbarItems` | `Record<string, ToolbarItemDescriptor>` | — | **нет** | Свои пункты / замены встроенных |
| `features` | `EditorFeature[]` | — | **нет** | Возможности: расширения + пункты + диалоги |
| `placeholder` | `string` | локализованный | **нет** | Подсказка пустого документа |
| `ariaLabel` | `string` | «Текстовый редактор» | **нет** | Имя области ввода для читалки |
| `formulaScale` | `number` | `1` | **нет** | Масштаб формул |
| `linkStyles` | `LinkStyle[]` | три встроенных | **нет** | Варианты оформления ссылки в поповере |
| `legacy` | `boolean` | `false` | **нет** | Разбор разметки Froala + Wiris; меняет схему |
| `mathliveFontsDirectory` | `string \| null` | `null` | **нет** | Каталог шрифтов MathLive; `null` — `mathlive/fonts.css` подключён |
| `minHeight` | `string` | `'220px'` | **нет** | Минимальная высота области ввода |
| `statusLine` | `boolean` | `true` | **нет** | Строка статуса под тулбаром |
| `theme` | `'light' \| 'dark' \| 'auto'` | `'light'` | да (`setTheme`) | Тёмная тема |

«Реактивен» означает наличие `watch` в компоненте. Пропы без watcher'а
читаются один раз в `onMounted`; чтобы их поменять, пересоздайте компонент
через `:key`.

Компонент не объявляет `collapseBelow`, `textSwatches`, `highlightSwatches`
и `extensions` — для них используйте `createRichEditor` напрямую или
`features`.

### События

| Событие | Payload | Когда |
| --- | --- | --- |
| `update:modelValue` | `html: string` | каждое изменение документа (`onChange`) |
| `change` | `html: string` | то же, вторым событием |
| `focus` / `blur` | — | фокус области ввода |
| `error` | `RichEditorError` | ошибки загрузок, рекордера, MathML |
| `upload` | `UploadEvent` (`kind`, `file`, `phase: 'start' \| 'done' \| 'failed'`) | этапы загрузки через адаптер |
| `ready` | `RichEditorCore` | после создания редактора в `onMounted` |

### `v-model`

Компонент хранит `lastEmitted` — последний HTML, который он отдал. Watcher
`modelValue` вызывает `core.setHTML(html)` только если пришло **не то**, что
только что было отправлено, и **не то**, что уже в документе
(`core.getHTML()`): иначе `setHTML` сбросил бы выделение и добавил шаг в
историю. `setHTML` в ядре не эмитит `onChange`, поэтому внешняя подстановка
документа не порождает `update:modelValue` — модель остаётся с тем, что
передал хост (демо после `ready` явно вызывает `core.getHTML()` после
`whenFormulasReady()`, чтобы положить в модель экспорт с SVG).

### Exposed-методы

```ts
const editor = ref<InstanceType<typeof RichEditor>>();

editor.value.getHTML(): string;
editor.value.setHTML(html: string): void;
editor.value.getJSON(): Record<string, unknown> | undefined;
editor.value.getText(): string;
editor.value.focus(): void;
editor.value.isEmpty(): boolean;                 // true, пока редактор не создан
editor.value.insertFormula(mathml: string, type?: FormulaType): boolean;
await editor.value.whenFormulasReady(): Promise<void>;
editor.value.editor;                             // TipTap Editor | null
editor.value.core;                               // RichEditorCore | null
```

Остальное (`setLocale`, `setTheme`, `setLimits`, `setEditable`) делается
через пропы. Доступа к `RichEditorUi` компонент не даёт — только к `core`.

### Разметка

Один корневой элемент `<div ref="host" class="rte-mount" />`; всё остальное
строит ядро внутри него. Класс и атрибуты с хоста проваливаются на корень
(в шаблоне намеренно нет комментариев — они делали компонент фрагментом).

### Жизненный цикл

- `onMounted`: `createRichEditor({ … все пропы …, onChange, onFocus, onBlur,
  onError, onUpload })`, затем `emit('ready', instance.core)`.
- `onBeforeUnmount`: `ui.destroy()`.
- Watchers: `modelValue`, `editable`, `locale`, `messages` (deep), `limits`
  (deep, только если не `undefined`), `theme`.

## 7.3. `<RichContent />`

Описан в [06-viewer.md](06-viewer.md#63-vue-richcontent-). Пропы `html`,
`formulaScale`, `legacy`, `theme`; событие `rendered`; exposed
`renderPendingFormulas()`.

## 7.4. `<RteIcon />`

```vue
<RteIcon name="bold" :size="20" />
```

Пропы: `name: string` (имя из `ICONS`), `size?: number` (20). Рисует
`<svg class="rte-icon" viewBox="0 0 24 24" aria-hidden="true">` с разметкой из
константы `ICONS` — для хостов, которые хотят повторить иконки редактора в
своём интерфейсе.

## 7.5. Реэкспорты

Из `@rich-editor/vue` доступно всё, что нужно для типизации и для
построения своих диалогов, без установки `@rich-editor/core`:

- фабрики ядра: `createRichEditor`, `createRichContent`, `applyTheme`,
  `DARK_THEME_CLASS`, `createToolbar`, `createModal`, `createPopover`,
  `createDropdown`, `TOOLBAR_PRESETS`, `resolveToolbar`,
  `SIMPLE_TOOLBAR_ITEMS`, `DEFAULT_LINK_STYLES`, `MATHLIVE_STRINGS`,
  `mathliveRu`, `clearPreviewCache`, `renderLatexPreview`;
- ядро и утилиты: `RichEditorCore`, `RichEditorError`, `DEFAULT_LIMITS`,
  `ICONS`, `enMessages` (= `en`), `ruMessages` (= `ru`), `buildMathML`,
  `latexToMathML`, `mathmlToLatex`, `normalizeMathML`, `renderMathML`;
- типы: `Dropdown`, `LinkStyle`, `MathliveStrings`, `Modal`, `Popover`,
  `RichEditorUi`, `RichEditorUiOptions`, `RichContentViewer` (= `RichContent`
  ядра; переименован, чтобы не конфликтовать с компонентом),
  `RichContentOptions`, `EditorTheme`, `Toolbar`, `ToolbarConfig`,
  `ToolbarGroupConfig`, `ToolbarItemDescriptor`, `ToolbarPreset`,
  `DialogComponent`, `EditorUiContext`, `UiComponent`, `EditorLimits`,
  `FormulaPayload`, `FormulaType`, `Messages`, `UploadAdapter`,
  `UploadContext`, `UploadEvent`, `UploadKind`, `UploadResult`, `IconName`;
- `ToolbarItemId = string` (раньше закрытый союз литералов);
  `ToolbarGroup` — устаревший алиас `ToolbarGroupConfig`.

Чего в Vue-пакете **нет** (удалено при переходе на ванильный интерфейс,
см. `CHANGELOG.md`): `EditorToolbar`, `RteModal`, `RtePopover`,
`LinkPopover`, `FormulaDialog`, `AudioRecorderDialog`, `RteDropdown`,
`RteToolbarButton`, `ColorPanel`, `readToolbarState`, `useEditorI18n`.

## 7.6. Nuxt / SSR

Редактор работает только на клиенте (ProseMirror, DOMPurify, MathLive нужен
DOM):

```vue
<ClientOnly><RichEditor v-model="html" /></ClientOnly>
```

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  css: ['@rich-editor/vue/styles.css'],
  vite: { optimizeDeps: { include: ['mathlive'] } },
});
```

`<RichContent />` можно ставить где угодно: на сервере — пустая оболочка с
классами, на клиенте — наполнение. Серверного рендера контента нет
(санитайзеру нужен DOM).

## 7.7. Полный пример

```vue
<script setup lang="ts">
import { ref, shallowRef } from 'vue';
import {
  RichEditor,
  RichContent,
  type RichEditorError,
  type UploadAdapter,
  type UploadEvent,
} from '@rich-editor/vue';
import en from './locales/en.json';

const html = ref('');
const editor = shallowRef<InstanceType<typeof RichEditor> | null>(null);

const uploadImage: UploadAdapter = async (file, ctx) => {
  const body = new FormData();
  body.append('file', file);
  const res = await fetch('/api/uploads/image', { method: 'POST', body, signal: ctx.signal });
  if (!res.ok) throw new Error('upload failed');
  return await res.json();   // { url, name?, mime?, size? }
};

const onError = (error: RichEditorError) => toast(error.message);
const onUpload = (event: UploadEvent) => console.log(event.kind, event.phase);

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
    @upload="onUpload"
  />
  <RichContent :html="html" theme="auto" />
</template>
```
