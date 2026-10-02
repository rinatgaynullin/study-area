# 13. Рецепты

## Назначение

Короткие рабочие примеры на типовые сценарии. Все импорты сверены с
экспортами `@rich-editor/core` и `@rich-editor/vue`
([14-api-reference.md](14-api-reference.md)); подробности опций — в
тематических разделах.

## Рецепты

### Своя кнопка в тулбаре

```ts
import { createRichEditor, type ToolbarItemDescriptor } from '@rich-editor/core';

const toolbarItems: Record<string, ToolbarItemDescriptor> = {
  stamp: {
    id: 'stamp',
    icon: 'check',
    labelKey: 'my_stamp',
    kind: 'button',
    run: ({ editor }) => editor.chain().focus().insertContent('✔ ').run(),
  },
};

createRichEditor({
  element,
  toolbar: [{ id: 'format', items: ['bold', 'italic'] }, { id: 'mine', items: ['stamp'] }],
  toolbarItems,
  messages: { ru: { my_stamp: 'Штамп' }, en: { my_stamp: 'Stamp' } },
});
```

Запись с встроенным id (`bold`) заменяет встроенную кнопку. Во Vue — пропы
`:toolbar`, `:toolbar-items`, `:messages`.

### Своя возможность (`EditorFeature`) с диалогом

```ts
import { Node } from '@tiptap/core';
import { createModal, createRichEditor, type DialogComponent, type EditorFeature } from '@rich-editor/core';

const CalloutNode = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  parseHTML: () => [{ tag: 'div.rte-callout' }],          // div и class проходят санитайзер
  renderHTML: () => ['div', { class: 'rte-callout' }, 0],
});

let dialog: DialogComponent<void> | null = null;

const callout: EditorFeature = {
  id: 'callout',
  extensions: () => [CalloutNode],
  toolbarItems: () => [
    { id: 'callout', icon: 'blockquote', labelKey: 'callout_title', kind: 'button', run: () => dialog?.open() },
  ],
  dialogs: (context) => {
    const modal = createModal({ title: context.t('callout_title'), closeLabel: context.t('common_close') });
    const apply = document.createElement('button');
    apply.type = 'button';
    apply.textContent = context.t('common_apply');
    apply.onclick = () => {
      context.editor.chain().focus().toggleWrap('callout').run();
      modal.close();
    };
    modal.footer.appendChild(apply);
    dialog = modal;
    return [modal];
  },
};

createRichEditor({ element, features: [callout], messages: { ru: { callout_title: 'Врезка' } } });
```

Пункт встанет своей группой в конец тулбара; чтобы поставить его в нужное
место, перечислите id в `toolbar`. Диалог пересобирается при смене языка,
поэтому состояние между открытиями в нём не хранят.

### Свой адаптер загрузки

```ts
import type { UploadAdapter } from '@rich-editor/core';

const uploadImage: UploadAdapter = async (file, ctx) => {
  const body = new FormData();
  body.append('file', file);
  const response = await fetch('/api/uploads', { method: 'POST', body, signal: ctx.signal });
  if (!response.ok) throw new Error(ctx.t('error_upload_failed', { name: file.name }));
  const { url } = await response.json();
  return { url, name: file.name, mime: file.type, size: file.size };
};

createRichEditor({ element, uploadImage, onError: (error) => toast(error.message) });
```

### Своя тема

```css
.rte-root,
.rte-content-root {
  --rte-color-primary: #396fdb;
  --rte-font-family: Inter, system-ui, sans-serif;
  --rte-radius: 6px;
}
```

Тёмная тема — `theme: 'dark'` / `'auto'` или класс `rte-theme-dark` на `<html>`.
Токены — `THEMING.md`.

### Legacy-контент (Froala/Wiris)

```ts
import { createRichContent, createRichEditor } from '@rich-editor/core';
import '@rich-editor/core/legacy.css';

createRichContent({ element: viewerEl, html: legacyHtml, legacy: true }); // показать как есть
createRichEditor({ element: editorEl, content: legacyHtml, legacy: true }); // править
```

```vue
<RichContent :html="html" legacy />
<RichEditor :key="legacy ? 'legacy' : 'new'" v-model="html" :legacy="legacy" />
```

Django: `RichTextField(legacy=True)`, `RichEditorWidget(legacy=True)` или
`RICH_EDITOR = {'LEGACY': True}`; в шаблонах `{% rich_content body legacy=True %}`.

### Вьюер на странице без бандлера

```html
<link rel="stylesheet" href="/static/rich-editor/styles.css" />
<article id="answer"></article>
<script type="module">
  import { createRichContent } from '/static/rich-editor/viewer.js';
  createRichContent({ element: document.querySelector('#answer'), html: window.ANSWER_HTML, theme: 'auto' });
</script>
```

### Экспорт с гарантированным SVG

```ts
await editor.core.whenFormulasReady(); // во Vue: editorRef.value.whenFormulasReady()
const html = editor.core.getHTML();
```

### Программная вставка формулы

```ts
import { latexToMathML } from '@rich-editor/vue';

const mathml = await latexToMathML('\\int_0^1 x^2\\,dx', 'math');
editorRef.value?.insertFormula(mathml, 'math');
```

### Переключение языка и свои уведомления

```ts
editor.setLocale('en');
editor.setMessages({ en: { toolbar_bold: 'Heavy' } });

createRichEditor({
  element,
  statusLine: false,
  onUpload: ({ kind, phase }) => (phase === 'start' ? showSpinner(kind) : hideSpinner(kind)),
  onError: (error) => toast.error(error.message),
});
```

### Nuxt

```vue
<ClientOnly><RichEditor v-model="html" /></ClientOnly>
```

В `nuxt.config.ts`: `css: ['@rich-editor/vue/styles.css']`,
`vite: { optimizeDeps: { include: ['mathlive'] } }`.

### Django: свои права на загрузку

```python
from django.urls import path, reverse_lazy
from rich_editor.views import ImageUploadView
from rich_editor.widgets import RichEditorWidget

class StaffImageUpload(ImageUploadView):
    def has_permission(self, request):
        return request.user.is_staff

urlpatterns = [path('uploads/image/', StaffImageUpload.as_view(), name='staff_image_upload')]

widget = RichEditorWidget(uploads={'image': reverse_lazy('staff_image_upload')})
```

## См. также

- [03-vanilla-ui.md](03-vanilla-ui.md), [05-media-and-uploads.md](05-media-and-uploads.md),
  [10-standalone-and-django.md](10-standalone-and-django.md).
