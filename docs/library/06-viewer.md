# 6. Вьюер: `createRichContent` и `RichContent`

## Назначение

Вьюер показывает сохранённый документ без редакторского стека: ни ProseMirror,
ни MathLive не загружаются. HTML проходит тот же санитайзер, что и в редакторе,
и кладётся в элемент; формулы, пришедшие без SVG (только `data-mathml` или
сырой `<math>`), дорисовываются лениво подключаемым MathJax. Документ,
экспортированный редактором, уже содержит SVG — для него MathJax не грузится.

## Когда использовать

- Страницы чтения: ответы, задания, статьи.
- Показ legacy-контента Froala: вьюер сохраняет все классы разметки, редактор —
  нет ([02](02-core.md#ограничения)).

## Интерфейс

Сигнатуры — [14-api-reference.md](14-api-reference.md#интерфейс-на-голом-dom).

### Опции `RichContentOptions`

| Параметр | Тип | По умолчанию | Что делает |
| --- | --- | --- | --- |
| `element` | `HTMLElement` | — | Станет вьюером: получает классы `rte-content-root rte-content` и содержимое |
| `html` | `string` | `''` | Документ; санитизируется всегда |
| `formulaScale` | `number` | `1` | Масштаб формул; при значении, отличном от 1, все формулы перерисовываются |
| `legacy` | `boolean` | `false` | Разметка Froala + Wiris; нужен `legacy.css` |
| `theme` | `EditorTheme` | `'light'` | `'light'`, `'dark'`, `'auto'`; или класс `rte-theme-dark` на предке |
| `onRendered` | `() => void` | — | Все ожидавшие формулы отрисованы (после каждого `update`) |

### Результат `RichContent`

| Член | Что делает |
| --- | --- |
| `element` | Тот же элемент |
| `update({ html?, formulaScale?, legacy?, theme? })` | Меняет переданные поля, перерисовывает документ, дорисовывает формулы; `Promise<void>` |
| `renderPendingFormulas()` | Дорисовывает формулы без SVG (или все, если масштаб не 1); `Promise<void>` |
| `destroy()` | Очищает элемент, снимает классы и слежение за темой |

Первую отрисовку вьюер не ждёт: он готов сразу, формулы дорисуются
асинхронно. Клик по формуле ничего не открывает.

### Vue: `RichContent`

Пропы `html`, `formulaScale`, `legacy`, `theme` с теми же умолчаниями; все
реактивны. Событие `rendered`; exposed-метод `renderPendingFormulas()`. Под
SSR рендерится пустая оболочка с классами, наполняется на клиенте.

### Standalone и Django

`viewer.js` из `@rich-editor/standalone` экспортирует `createRichContent`,
`applyTheme`, `DARK_THEME_CLASS`, `prepareIncomingHtml`, `upgradeLegacyHtml`.
В Django тег `{% rich_content html %}` рендерит контейнер, а скрипт из
`{% rich_viewer_assets %}` дорисовывает формулы и следует за темой админки
([10](10-standalone-and-django.md#теги-шаблонов)).

## Пример

```ts
// Отдельный вход: без TipTap, MathLive и стилей тулбара.
import { createRichContent } from '@rich-editor/core/viewer';
import '@rich-editor/core/viewer.css';

const viewer = createRichContent({
  element: document.querySelector('#answer')!,
  html,
  theme: 'auto',
  onRendered: () => console.log('формулы готовы'),
});

await viewer.update({ html: nextHtml });
viewer.destroy();
```

```vue
<script setup lang="ts">
// Вход вьюера Vue-пакета: только <RichContent /> и ванильный вьюер.
import { RichContent } from '@rich-editor/vue/viewer';
import '@rich-editor/vue/viewer.css';
</script>

<template>
  <RichContent :html="html" theme="auto" @rendered="onRendered" />
</template>
```

### Точки входа

| Импорт | Что даёт |
| --- | --- |
| `@rich-editor/core/viewer`, `@rich-editor/core/viewer.css` | `createRichContent`, тема, `prepareIncomingHtml`, санитайзер, рендер формул; стили документа и токены темы без интерфейса редактора |
| `@rich-editor/vue/viewer`, `@rich-editor/vue/viewer.css` | `<RichContent />` плюс то же, что выше |
| `@rich-editor/core`, `@rich-editor/vue` | Полный пакет: редактор и вьюер вместе, `styles.css` на оба |

Сборка ядра проверяет, что граф импортов входа `./viewer` не содержит TipTap,
ProseMirror и MathLive (`packages/editor-core/scripts/check-viewer.mjs`).

## Ограничения

- Только клиент: санитайзеру нужен DOM, серверного рендера контента нет.
- Вьюеру достаточно `viewer.css` (документ и токены темы); для legacy —
  дополнительно `legacy.css`. Полный `styles.css` его включает.

## См. также

- [07-vue.md](07-vue.md), [08-theming.md](08-theming.md), [11-security.md](11-security.md).
