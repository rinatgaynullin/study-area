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
import { createRichContent } from '@rich-editor/core';
import '@rich-editor/core/styles.css';

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
<RichContent :html="html" theme="auto" @rendered="onRendered" />
```

## Ограничения

- Только клиент: санитайзеру нужен DOM, серверного рендера контента нет.
- Вьюеру нужен тот же `styles.css`, что и редактору; для legacy —
  дополнительно `legacy.css`.

## См. также

- [07-vue.md](07-vue.md), [08-theming.md](08-theming.md), [11-security.md](11-security.md).
