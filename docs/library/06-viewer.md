# 6. Вьюер: `createRichContent` и `<RichContent />`

Файлы: `packages/editor-core/src/ui/rich-content.ts`,
`packages/editor-vue/src/components/rich-content.vue`,
`packages/editor-standalone/src/viewer.ts`,
`packages/django-rich-editor/rich_editor/static/rich_editor/rich_editor_viewer.js`.

## 6.1. Зачем отдельный вьюер

Показ сохранённого документа не требует редакторского стека. Вьюер не
импортирует ни TipTap/ProseMirror, ни MathLive — только `prepareIncomingHtml`
(санитайзер + апгрейд формул) и ленивый MathJax. Документ, экспортированный
редактором, несёт SVG каждой формулы, поэтому для него **MathJax не грузится
вовсе**. Формулы, пришедшие только с `data-mathml` (например, от бэкенда,
который хранит только источник) или как сырой `<math>`, дорисовываются по
месту.

## 6.2. API ядра

```ts
interface RichContentOptions {
  element: HTMLElement;        // станет вьюером: получает классы и содержимое
  html?: string;
  formulaScale?: number;       // 1
  legacy?: boolean;            // разметка Froala + Wiris
  theme?: EditorTheme;         // 'light' | 'dark' | 'auto'; или класс rte-theme-dark на предке
  onRendered?(): void;         // все ожидавшие формулы отрисованы
}

type RichContentUpdate = Partial<Pick<RichContentOptions, 'html' | 'formulaScale' | 'legacy' | 'theme'>>;

interface RichContent {
  readonly element: HTMLElement;
  update(next: RichContentUpdate): Promise<void>;   // подменяет документ/настройки, дорисовывает формулы
  renderPendingFormulas(): Promise<void>;           // формулы без SVG — или все, если масштаб не 1
  destroy(): void;
}

const createRichContent: (options: RichContentOptions) => RichContent;
```

```ts
import { createRichContent } from '@rich-editor/core';
import '@rich-editor/core/styles.css';

const viewer = createRichContent({
  element: document.querySelector('#answer')!,
  html,
  onRendered: () => console.log('формулы готовы'),
});

await viewer.update({ html: nextHtml });
viewer.destroy();
```

### Что делает

1. Добавляет на элемент классы `rte-content-root rte-content` (и
   `rte-legacy` при `legacy`), применяет тему (`applyTheme`).
2. `paint()`: `element.innerHTML = prepareIncomingHtml(html, { legacy })` —
   **тот же путь входа**, что у редактора; санитизация обязательна и
   неотключаема.
3. `renderPendingFormulas()`: для каждого `span[data-formula]`:
   - если нет `aria-label` (формула от бэкенда, знающего только MathML) —
     ставит `role="img"` и `aria-label` из LaTeX-аннотации или текста MathML;
     имя, записанное редактором, уважается;
   - находит или создаёт render host (`span.rte-formula__render[data-render-host]`);
   - если в хосте уже есть SVG и `formulaScale === 1` — ничего не делает;
   - иначе `renderMathML(data-mathml, { fontSizePx: 15 * formulaScale })` и
     записывает SVG (если вьюер не уничтожен и рендер удался).
   После всех — `onRendered()`.
4. Первую отрисовку **не ждёт**: вьюер готов сразу, формулы дорисуются
   асинхронно. Неудачный рендер не бросает — формула остаётся без SVG.

`update()` меняет только переданные поля, при `theme` переподключает
`applyTheme`, затем `paint()` и `await renderPendingFormulas()`.
`destroy()` ставит флаг, снимает тему, очищает элемент и убирает классы
`rte-content-root rte-content rte-legacy rte-theme-dark`.

Вьюер ничего не знает о событиях редактирования: клик по формуле ничего не
открывает, `contenteditable` отсутствует.

## 6.3. Vue: `<RichContent />`

```vue
<script setup lang="ts">
import { RichContent } from '@rich-editor/vue';
import '@rich-editor/vue/styles.css';

defineProps<{ html: string }>();
</script>

<template>
  <RichContent :html="html" @rendered="onRendered" />
</template>
```

| Проп | Тип | По умолчанию | |
| --- | --- | --- | --- |
| `html` | `string` | `''` | Санитизируется всегда |
| `formulaScale` | `number` | `1` | Масштаб формул относительно текста |
| `legacy` | `boolean` | `false` | Разметка Froala + Wiris (нужен `@rich-editor/vue/legacy.css`) |
| `theme` | `'light' \| 'dark' \| 'auto'` | `'light'` | Тёмная тема |

- Событие `rendered` — после отрисовки ожидавших формул (каждый `update`).
- Exposed: `renderPendingFormulas(): Promise<void>`.
- Шаблон — один корневой `<div class="rte-content-root rte-content" :class="{ 'rte-legacy': legacy }">`;
  классы стоят и в шаблоне, чтобы серверная оболочка под SSR уже их несла.
  Сам вьюер создаётся в `onMounted` (санитайзеру нужен DOM) и уничтожается в
  `onBeforeUnmount`; все четыре пропа наблюдаются одним watcher'ом →
  `viewer.update({ html, formulaScale, legacy, theme })`.
- Под SSR компонент безопасен: на сервере рендерится пустая оболочка, на
  клиенте наполняется.

## 6.4. Автономная сборка и Django

`viewer.js` из `@rich-editor/standalone` экспортирует `createRichContent`,
`applyTheme`, `DARK_THEME_CLASS`, `prepareIncomingHtml`, `upgradeLegacyHtml` и
типы — без ProseMirror и MathLive; MathJax — ленивый чанк.

В Django тег `{% rich_content html %}` рендерит
`<div class="rte-content-root rte-content [rte-legacy]" data-rich-content [data-legacy]>…</div>`,
а скрипт `rich_editor_viewer.js` (`{% rich_viewer_assets %}`) находит
`[data-rich-content]`, помечает `data-rich-content-ready` и вызывает
`createRichContent({ element, html: element.innerHTML, legacy, theme })`.
Тема берётся из `data-theme` на `<html>` (переключатель админки) или `auto`.
Скрипт нужен только для формул без SVG и слежения за темой; документ с SVG
читается и без JavaScript. Подробнее — [10-standalone-and-django.md](10-standalone-and-django.md).

## 6.5. Что вьюер сохраняет, а редактор — нет

Вьюер кладёт санитизированную разметку в DOM как есть, поэтому все классы
(в том числе 24 декоративных класса Froala) доживают до CSS. Редактор
разбирает HTML в схему ProseMirror и сохраняет только то, что моделируют
узлы и марки. Поэтому для **показа** legacy-контента всегда используйте
вьюер, а редактор открывайте только когда документ действительно нужно
править (ADR 0007).

## 6.6. Тёмная тема и стили

Вьюеру нужен тот же `styles.css`, что и редактору (контентные правила
`.rte-content …` общие). Токены задаются на `.rte-content-root`; тёмная тема —
проп/опция `theme` или класс `rte-theme-dark` на любом предке. Для legacy —
дополнительно `legacy.css`. См. [08-theming.md](08-theming.md).
