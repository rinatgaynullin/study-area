# 13. Рецепты

Все примеры сверены с текущими экспортами `@rich-editor/core` /
`@rich-editor/vue` (см. [14-api-reference.md](14-api-reference.md)).

## Своя кнопка в тулбаре

```ts
import { createRichEditor, type ToolbarItemDescriptor } from '@rich-editor/core';

const toolbarItems: Record<string, ToolbarItemDescriptor> = {
  stamp: {
    id: 'stamp',
    icon: 'check',                      // любое имя из ICONS
    labelKey: 'my_stamp',               // ключ добавляем в messages
    kind: 'button',
    shortcut: 'Mod-Shift-K',            // только подсказка; само сочетание вешаем расширением ниже
    run: ({ editor }) => editor.chain().focus().insertContent('✔ ').run(),
  },
  // замена встроенной кнопки: тот же id
  bold: {
    id: 'bold',
    icon: 'bold',
    labelKey: 'toolbar_bold',
    kind: 'button',
    isActive: (editor) => editor.isActive('bold'),
    run: ({ editor }) => editor.chain().focus().toggleBold().run(),
  },
};

createRichEditor({
  element: document.querySelector('#editor')!,
  toolbar: [
    { id: 'format', items: ['bold', 'italic', 'underline'] },
    { id: 'mine', items: ['stamp'] },
  ],
  toolbarItems,
  messages: { ru: { my_stamp: 'Штамп' }, en: { my_stamp: 'Stamp' } },
});
```

Во Vue — пропы `:toolbar`, `:toolbar-items`, `:messages` (первые два читаются
один раз).

## Своя возможность (`EditorFeature`) с диалогом

Возможность = расширение схемы + пункт тулбара + диалог, одним объявлением.
Диалог собирается из `createModal` и получает `EditorUiContext`.

```ts
import { Node } from '@tiptap/core';
import {
  createModal,
  createRichEditor,
  type DialogComponent,
  type EditorFeature,
  type EditorUiContext,
} from '@rich-editor/core';

// 1. Узел: врезка-«колаут». parseHTML работает только с тем, что пропустит санитайзер:
//    <div class="rte-callout"> проходит (div и class в allowlist).
const CalloutNode = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  parseHTML: () => [{ tag: 'div.rte-callout' }],
  renderHTML: () => ['div', { class: 'rte-callout' }, 0],
  addCommands() {
    return {
      toggleCallout:
        () =>
        ({ commands }) =>
          commands.toggleWrap(this.name),
    };
  },
});

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: { toggleCallout: () => ReturnType };
  }
}

// 2. Диалог: подписи берутся из context.t при сборке; при смене языка оболочка
//    уничтожит и соберёт его заново, поэтому состояние между открытиями не храним.
const createNoteDialog = (context: EditorUiContext): DialogComponent<void> => {
  const modal = createModal({ title: context.t('note_title'), closeLabel: context.t('common_close') });
  const input = document.createElement('textarea');
  input.className = 'rte-input';
  input.setAttribute('data-autofocus', '');
  modal.body.appendChild(input);

  const apply = document.createElement('button');
  apply.type = 'button';
  apply.className = 'rte-button rte-button--primary';
  apply.textContent = context.t('common_apply');
  apply.addEventListener('click', () => {
    context.editor.chain().focus().toggleCallout().insertContent(input.value).run();
    modal.close();   // оболочка вернёт фокус в документ по событию rte:modal-close
  });
  modal.footer.appendChild(apply);

  return {
    element: modal.element,
    open: () => { input.value = ''; modal.open(); },
    close: () => modal.close(),
    get isVisible() { return modal.isVisible; },
    destroy: () => modal.destroy(),
  };
};

// 3. Возможность.
let noteDialog: DialogComponent<void> | null = null;

const calloutFeature: EditorFeature = {
  id: 'callout',
  extensions: () => [CalloutNode],
  toolbarItems: () => [
    {
      id: 'callout',
      icon: 'blockquote',
      labelKey: 'note_title',
      kind: 'button',
      isActive: (editor) => editor.isActive('callout'),
      run: () => noteDialog?.open(),
    },
  ],
  dialogs: (context) => {
    noteDialog = createNoteDialog(context);
    return [noteDialog];
  },
};

createRichEditor({
  element: document.querySelector('#editor')!,
  features: [calloutFeature],               // пункт встанет своей группой в конец тулбара
  messages: { ru: { note_title: 'Заметка' }, en: { note_title: 'Note' } },
});
```

Чтобы поставить пункт в конкретное место — перечислите его id в `toolbar`.
Чтобы перевесить кнопку чужой возможности — `toolbarItems` с тем же id (он
главнее). Если узлу нужен переводчик при сборке — `extensions: ({ t }) => […]`.

## Свой адаптер загрузки

```ts
import type { UploadAdapter } from '@rich-editor/core';

const createUploader = (endpoint: string): UploadAdapter => async (file, ctx) => {
  const body = new FormData();
  body.append('file', file, file.name);
  body.append('kind', ctx.kind);                      // 'image' | 'audio' | 'file'

  const response = await fetch(endpoint, {
    method: 'POST',
    body,
    credentials: 'same-origin',
    signal: ctx.signal,                               // редактор отменит при destroy()
  });

  if (!response.ok) {
    // сообщение пойдёт в cause; пользователь увидит локализованное error_upload_failed
    throw new Error(`${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as { url: string; id: string };
  return { url: data.url, name: file.name, mime: file.type, size: file.size, meta: { id: data.id } };
};

createRichEditor({
  element,
  uploadImage: createUploader('/api/uploads/image'),
  uploadAudio: createUploader('/api/uploads/audio'),
  uploadFile: createUploader('/api/uploads/file'),
  limits: { maxImageSizeBytes: 5 * 1024 * 1024 },
  onUpload: ({ kind, phase }) => console.log(kind, phase),
  onError: (error) => toast(error.message),           // error.code: 'upload-failed' | 'file-too-large' | …
});
```

Файл, превышающий лимит, отвергается **до** вызова адаптера. Без адаптера
соответствующего вида файл остаётся `blob:` URL.

## Своя тема

```css
/* подключить после styles.css */
.rte-root,
.rte-content-root {
  --rte-color-primary: #396fdb;
  --rte-color-primary-soft: #e8f0ff;
  --rte-font-family: Inter, system-ui, sans-serif;
  --rte-radius: 6px;
  --rte-btn-size: 32px;
}
```

Тёмная тема — `theme="dark"` / `theme: 'dark'` / `'auto'`, либо класс
`rte-theme-dark` на `<html>`. Полный список токенов — `THEMING.md`;
механика — [08-theming.md](08-theming.md).

## Чтение legacy-контента (Froala/Wiris)

```ts
import { createRichContent, createRichEditor } from '@rich-editor/core';
import '@rich-editor/core/styles.css';
import '@rich-editor/core/legacy.css';     // отдельный файл: хост без старых данных его не грузит

// показать как есть — все классы Froala доживают до CSS
const viewer = createRichContent({ element: viewerEl, html: legacyHtml, legacy: true });

// открыть на правку — формулы Wiris станут узлами формул, MathJax/JSME — legacyEmbed
const editor = createRichEditor({ element: editorEl, content: legacyHtml, legacy: true });
```

```vue
<RichContent :html="html" legacy />
<RichEditor :key="legacy ? 'legacy' : 'new'" v-model="html" :legacy="legacy" />
```

Django: `RichTextField(legacy=True)` / `RichEditorWidget(legacy=True)` /
`RICH_EDITOR = {'LEGACY': True}`; в шаблонах `{% rich_editor_assets legacy=True %}`,
`{% rich_content body legacy=True %}`.

Что при правке теряется, а что нет — [02-core.md](02-core.md#границы-режима).

## Вьюер на странице без редактора

```html
<link rel="stylesheet" href="/static/rich-editor/styles.css" />
<article id="answer"></article>
<script type="module">
  import { createRichContent } from '/static/rich-editor/viewer.js';   // без ProseMirror и MathLive
  const viewer = createRichContent({
    element: document.querySelector('#answer'),
    html: window.ANSWER_HTML,
    theme: 'auto',
    onRendered: () => console.log('формулы дорисованы'),
  });
</script>
```

Если HTML экспортирован редактором, формулы уже содержат SVG и MathJax не
грузится. Если бэкенд хранит только `<math>` или `data-mathml` без SVG —
вьюер дорисует (ленивый чанк MathJax).

## Headless: свой интерфейс поверх движка

```ts
import { RichEditorCore, latexToMathML, mathmlToLatex } from '@rich-editor/core';

const core = new RichEditorCore({
  element: document.querySelector('#surface')!,
  content: initialHtml,
  onChange: (html) => save(html),
  onFormulaEdit: async ({ mathml, type, pos }) => {
    const latex = await myPrompt(mathml ? await mathmlToLatex(mathml) : '');
    if (latex === null) return;
    const next = await latexToMathML(latex, type);
    if (pos === null) core.insertFormula(next, type);
    else core.updateFormulaAt(pos, next, type);
  },
  onError: (error) => showToast(error.message),
});

// свои кнопки
myBoldButton.onclick = () => core.editor.chain().focus().toggleBold().run();
```

Схема, санитайзер, формульный пайплайн, загрузки и рекордер работают так же,
как под штатным интерфейсом. Тулбар можно собрать из `createToolbar(context,
{ groups, items: SIMPLE_TOOLBAR_ITEMS })`, передав собственный
`EditorUiContext`.

## Программная вставка формулы

```ts
import { latexToMathML } from '@rich-editor/vue';

const mathml = await latexToMathML('\\int_0^1 x^2\\,dx', 'math');
editorRef.value?.insertFormula(mathml, 'math');     // Vue exposed-метод → core.insertFormula
```

## Экспорт с гарантированным SVG

```ts
await editor.core.whenFormulasReady();   // или editorRef.value.whenFormulasReady()
const html = editor.core.getHTML();      // каждая отрисованная формула содержит <svg>
```

## Переключение языка на лету

```ts
editor.setLocale('en');                            // пересобирает тулбар и диалоги
editor.setMessages({ en: { toolbar_bold: 'Heavy' } });
```

Во Vue достаточно поменять `locale`/`messages`.

## Отключить строку статуса и показывать свои уведомления

```ts
createRichEditor({
  element,
  statusLine: false,
  onUpload: ({ kind, phase, file }) => phase === 'start' ? showSpinner(kind) : hideSpinner(kind),
  onError: (error) => toast.error(error.message),
});
```

## Nuxt

```vue
<ClientOnly><RichEditor v-model="html" /></ClientOnly>
```

и `css: ['@rich-editor/vue/styles.css']`, `vite.optimizeDeps.include: ['mathlive']`
в `nuxt.config.ts`.

## Django: ужесточить права на загрузку и свои URL

```python
# views.py
from rich_editor.views import ImageUploadView

class StaffImageUpload(ImageUploadView):
    def has_permission(self, request):
        return request.user.is_staff

# urls.py
path('uploads/image/', StaffImageUpload.as_view(), name='staff_image_upload'),

# forms.py
body = RichTextFormField(widget=RichEditorWidget(uploads={'image': reverse_lazy('staff_image_upload')}))
```

Скрипт виджета принимает и ответ формата `{"link": "..."}` — старые вьюхи
`django-froala-editor` можно оставить.
