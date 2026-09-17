import { Extension } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  IMAGE_ACCEPT,
  TEXT_FILE_ACCEPT,
  createModal,
  createRichEditor,
  type EditorFeature,
  type RichEditorUi,
} from '../src/index';

/**
 * Тесты ванильной оболочки — того самого редактора, который обёртки под
 * фреймворки только монтируют. Проверяют её собственные обязанности: разметку,
 * режим чтения, смену локали и возврат фокуса, а не команды движка.
 */
let ui: RichEditorUi | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  ui?.destroy();
  ui = undefined;
  host?.remove();
  host = undefined;
});

function mountEditor(options: Record<string, unknown> = {}): RichEditorUi {
  host = document.createElement('div');
  document.body.appendChild(host);
  ui = createRichEditor({ element: host, content: '<p>привет</p>', ...options });
  return ui;
}

/** Открытый диалог: закрытые остаются в DOM под атрибутом `hidden`. */
function openDialog(): HTMLElement | null {
  return document.querySelector('.rte-modal:not([hidden])');
}

function toolbarButton(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>('.rte-toolbar button')].find(
    (button) => button.getAttribute('aria-label') === label,
  );
  if (!found) throw new Error(`Нет кнопки тулбара с подписью «${label}»`);
  return found;
}

describe('ванильная оболочка редактора', () => {
  it('собирает тулбар и область ввода без фреймворка', () => {
    const editor = mountEditor();

    expect(editor.element.classList.contains('rte-root')).toBe(true);
    expect(editor.element.querySelector('.rte-toolbar')).not.toBeNull();
    expect(editor.element.querySelector('.rte-content')).not.toBeNull();
    expect(editor.core.getHTML()).toContain('привет');
  });

  it('в режиме чтения прячет тулбар, а не пересоздаёт разметку', () => {
    const editor = mountEditor({ editable: false });
    const toolbar = editor.element.querySelector<HTMLElement>('.rte-toolbar')!;

    expect(toolbar.hidden).toBe(true);
    expect(editor.element.classList.contains('rte-root--readonly')).toBe(true);

    editor.setEditable(true);
    expect(toolbar.hidden).toBe(false);
    expect(editor.element.classList.contains('rte-root--readonly')).toBe(false);
  });

  it('пересобирает подписи тулбара при смене локали', () => {
    // Английская таблица встроена: хосту достаточно сменить локаль.
    const editor = mountEditor();
    expect(toolbarButton('Полужирный')).toBeTruthy();

    editor.setLocale('en');
    expect(toolbarButton('Bold')).toBeTruthy();
    expect(() => toolbarButton('Полужирный')).toThrow();
  });

  it('держит диалоги в DOM и показывает по одному', () => {
    mountEditor();
    expect(openDialog()).toBeNull();
    expect(document.querySelectorAll('.rte-modal').length).toBeGreaterThan(1);

    toolbarButton('Математическая формула').click();
    expect(openDialog()?.querySelector('.rte-modal__title')?.textContent).toContain(
      'Математическая',
    );
  });

  it('возвращает фокус в документ после закрытия диалога', async () => {
    const editor = mountEditor();
    const content = editor.element.querySelector<HTMLElement>('.rte-content')!;

    const button = toolbarButton('Математическая формула');
    button.focus();
    button.click();
    expect(openDialog()).not.toBeNull();

    openDialog()!.querySelector<HTMLButtonElement>('.rte-modal__close')!.click();
    expect(openDialog()).toBeNull();

    // TipTap ставит фокус в следующем кадре, чтобы не спорить с отрисовкой.
    await new Promise((resolve) => requestAnimationFrame(resolve));

    // Фокус на кнопке тулбара оставил бы клавиатуру без документа: Backspace
    // после «Отмены» не удалил бы выделенный узел.
    expect(document.activeElement).toBe(content);
  });

  it('уничтожается целиком: ни оболочки, ни диалогов в DOM', () => {
    const editor = mountEditor();
    expect(document.querySelectorAll('.rte-modal').length).toBeGreaterThan(0);

    editor.destroy();
    ui = undefined;

    expect(document.querySelector('.rte-root')).toBeNull();
    expect(document.querySelector('.rte-modal')).toBeNull();
    expect(document.querySelector('.rte-popover')).toBeNull();
  });
});

describe('оверлеи', () => {
  it('модалка затемняет страницу и закрывается кликом по подложке', () => {
    mountEditor();
    toolbarButton('Математическая формула').click();

    const backdrop = openDialog()!.querySelector<HTMLElement>('.rte-modal__backdrop');
    expect(backdrop).not.toBeNull();

    backdrop!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(openDialog()).toBeNull();
  });

  it('смена локали переводит диалоги, а не только тулбар', () => {
    const editor = mountEditor();
    editor.setLocale('en');

    toolbarButton('Link').click();
    const dialog = openDialog()!;
    expect(dialog.querySelector('.rte-modal__title')?.textContent).toBe('Link');
    expect(dialog.querySelector('.rte-button--primary')?.textContent).toBe('Apply');
  });

  it('смена таблицы переводов тоже пересобирает диалоги', () => {
    const editor = mountEditor();
    editor.setMessages({ ru: { link_title: 'Гиперссылка' } });

    toolbarButton('Ссылка').click();
    expect(openDialog()?.querySelector('.rte-modal__title')?.textContent).toBe('Гиперссылка');
  });

  it('пикеры файлов принимают то же, что пайплайн загрузки', () => {
    const editor = mountEditor();
    const inputs = editor.element.querySelectorAll<HTMLInputElement>('input[type="file"]');

    expect([...inputs].map((input) => input.accept)).toEqual([IMAGE_ACCEPT, TEXT_FILE_ACCEPT]);
  });
});

describe('строка статуса', () => {
  it('показывает идущую загрузку и последнюю ошибку', async () => {
    let finish!: (result: { url: string }) => void;
    const uploadImage = () => new Promise<{ url: string }>((resolve) => { finish = resolve; });
    const editor = mountEditor({ uploadImage });
    const status = editor.element.querySelector<HTMLElement>('.rte-status')!;
    expect(status.hidden).toBe(true);

    const file = new File([new Uint8Array(16)], 'a.png', { type: 'image/png' });
    const pending = editor.core.insertImageFile(file);
    expect(status.hidden).toBe(false);
    expect(status.textContent).toBe('Загрузка изображения…');

    finish({ url: 'https://cdn.example.com/a.png' });
    await pending;
    expect(status.hidden).toBe(true);

    const huge = new File([new Uint8Array(16)], 'big.png', { type: 'image/png' });
    Object.defineProperty(huge, 'size', { value: 100 * 1024 * 1024 });
    await editor.core.insertImageFile(huge);
    expect(status.hidden).toBe(false);
    expect(status.classList.contains('rte-status--error')).toBe(true);
    expect(status.textContent).toContain('big.png');
  });

  it('выключается опцией — у хоста свои уведомления', () => {
    const editor = mountEditor({ statusLine: false });
    expect(editor.element.querySelector('.rte-status')).toBeNull();
  });

  it('диалог назван своим заголовком', () => {
    mountEditor();
    toolbarButton('Математическая формула').click();
    const dialog = openDialog()!.querySelector('[role="dialog"]')!;
    const title = dialog.querySelector('.rte-modal__title')!;
    expect(dialog.getAttribute('aria-labelledby')).toBe(title.id);
    expect(title.id).not.toBe('');
  });
});

describe('возможности поверх встроенных', () => {
  it('подключает возможность одним объявлением: расширение, пункт, диалог', () => {
    const plain = mountEditor();
    const builtInDialogs = document.querySelectorAll('.rte-modal').length;
    plain.destroy();
    ui = undefined;

    const seenAtBuild: string[] = [];
    const feature: EditorFeature = {
      id: 'shout',
      extensions: ({ t }) => {
        // Переводчик доступен уже при сборке, а не только в рантайме.
        seenAtBuild.push(t('toolbar_bold'));
        return [Extension.create({ name: 'shoutProbe' })];
      },
      toolbarItems: () => [
        {
          id: 'shout',
          icon: 'bold',
          labelKey: 'shout_label',
          kind: 'button',
          run: ({ editor }) => void editor.chain().focus().insertContent('!').run(),
        },
      ],
      dialogs: (context) => [
        createModal({ title: context.t('shout_label'), closeLabel: context.t('common_close') }),
      ],
    };

    const editor = mountEditor({
      features: [feature],
      messages: { ru: { shout_label: 'Крикнуть' } },
    });

    expect(seenAtBuild).toEqual(['Полужирный']);
    expect(
      editor.core.editor.extensionManager.extensions.some((item) => item.name === 'shoutProbe'),
    ).toBe(true);

    // Пункт не упомянут в пресете — встал отдельной группой в конце.
    const groups = editor.element.querySelectorAll('.rte-toolbar__group');
    expect(groups[groups.length - 1].querySelector('button')?.title).toBe('Крикнуть');

    toolbarButton('Крикнуть').click();
    expect(editor.core.getHTML()).toContain('!');

    expect(document.querySelectorAll('.rte-modal').length).toBe(builtInDialogs + 1);
    editor.destroy();
    ui = undefined;
    expect(document.querySelector('.rte-modal')).toBeNull();
  });

  it('ставит пункт возможности туда, где его перечислил хост', () => {
    const feature: EditorFeature = {
      id: 'shout',
      toolbarItems: () => [{ id: 'shout', icon: 'bold', labelKey: 'toolbar_bold', kind: 'button' }],
    };

    const editor = mountEditor({
      features: [feature],
      toolbar: [{ id: 'mine', items: ['shout', 'italic'] }],
    });

    const groups = editor.element.querySelectorAll('.rte-toolbar__group');
    expect(groups).toHaveLength(1);
    expect(groups[0].querySelectorAll('button')).toHaveLength(2);
  });
});
