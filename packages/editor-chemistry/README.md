# @rich-editor/chemistry

Структурные формулы для `@rich-editor/core`: атомарный узел `chemistry` с кодом
chemfig в `data-chemistry-code`, диалог с шаблонами и живым превью, рендер в SVG
без внешних зависимостей и лёгкий вход для вьюера.

```ts
import { createRichEditor } from '@rich-editor/core';
import { createChemistryFeature } from '@rich-editor/chemistry';

createRichEditor({ element, features: [createChemistryFeature()] });
```

```ts
import { createRichContent } from '@rich-editor/core/viewer';
import { chemistryContent } from '@rich-editor/chemistry/viewer';

createRichContent({ element, html, features: [chemistryContent] });
```

Подробности — `docs/library/16-chemistry.md`.
