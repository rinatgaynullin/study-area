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

const mountEditor = (options: Record<string, unknown> = {}): RichEditorUi => {
  host = document.createElement('div');
  document.body.appendChild(host);
  ui = createRichEditor({ element: host, content: '<p>привет</p>', ...options });

  return ui;
};

/** Открытый диалог: закрытые остаются в DOM под атрибутом `hidden`. */
const openDialog = (): HTMLElement | null => document.querySelector('.rte-modal:not([hidden])');

const toolbarButton = (label: string): HTMLButtonElement => {
  const found = [...document.querySelectorAll<HTMLButtonElement>('.rte-toolbar button')].find(
    (button) => button.getAttribute('aria-label') === label,
  );

  if (!found) throw new Error(`Нет кнопки тулбара с подписью «${label}»`);

  return found;
};

/** TipTap ставит фокус в следующем кадре, чтобы не спорить с отрисовкой. */
const nextFrame = (): Promise<void> =>
  new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });

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
    await nextFrame();

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

describe('тема', () => {
  it('опция theme ставит класс на корень, setTheme его переключает', () => {
    const editor = mountEditor({ theme: 'dark' });

    expect(editor.element.classList.contains('rte-theme-dark')).toBe(true);

    editor.setTheme('light');
    expect(editor.element.classList.contains('rte-theme-dark')).toBe(false);
  });
});

describe('строка статуса', () => {
  it('показывает идущую загрузку и последнюю ошибку', async () => {
    let finish!: (result: { url: string }) => void;

    const uploadImage = () =>
      new Promise<{ url: string }>((resolve) => {
        finish = resolve;
      });

    const editor = mountEditor({ uploadImage });
    const status = editor.element.querySelector<HTMLElement>('.rte-status')!;

    // Живая область существует и пустой: читалка объявляет только то, что
    // появилось в уже существующем регионе. Пустую строку схлопывают стили.
    expect(status.hidden).toBe(false);
    expect(status.getAttribute('role')).toBe('status');
    expect(status.textContent).toBe('');

    const file = new File([new Uint8Array(16)], 'a.png', { type: 'image/png' });
    const pending = editor.core.insertImageFile(file);

    expect(status.textContent).toBe('Загрузка изображения…');

    finish({ url: 'https://cdn.example.com/a.png' });
    await pending;
    expect(status.textContent).toBe('');
    expect(status.hidden).toBe(false);

    const huge = new File([new Uint8Array(16)], 'big.png', { type: 'image/png' });

    Object.defineProperty(huge, 'size', { value: 100 * 1024 * 1024 });
    await editor.core.insertImageFile(huge);
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
          run: ({ editor }) => {
            editor.chain().focus().insertContent('!').run();
          },
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

describe('клавиатура из документа', () => {
  const pressInEditor = (content: HTMLElement, init: KeyboardEventInit): void => {
    content.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }),
    );
  };

  it('Alt+F10 переводит фокус в тулбар, Escape — обратно в документ', async () => {
    const editor = mountEditor();
    const content = editor.element.querySelector<HTMLElement>('.rte-content')!;

    content.focus();

    pressInEditor(content, { key: 'F10', altKey: true });

    const active = document.activeElement as HTMLElement;

    expect(active.closest('.rte-toolbar')).not.toBeNull();

    active.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );

    await nextFrame();
    expect(document.activeElement).toBe(content);
  });

  it('Ctrl+K открывает диалог ссылки, как кнопка тулбара', () => {
    const editor = mountEditor();
    const content = editor.element.querySelector<HTMLElement>('.rte-content')!;

    content.focus();

    pressInEditor(content, { key: 'k', ctrlKey: true });

    const dialog = openDialog();

    expect(dialog).not.toBeNull();
    expect(dialog!.querySelector('.rte-modal__title')?.textContent).toBe('Ссылка');
    expect(toolbarButton('Ссылка').getAttribute('aria-keyshortcuts')).toBe('Control+K');
  });
});

describe('доступность диалогов', () => {
  const press = (target: Element, key: string): void => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  };

  it('вкладки редактора формул — список вкладок со стрелками и панелью', () => {
    mountEditor();
    toolbarButton('Математическая формула').click();

    const dialog = openDialog()!;

    const tabs = [
      ...dialog.querySelectorAll<HTMLButtonElement>('.rte-formula-editor__tabs [role="tab"]'),
    ];

    const [math, chem] = tabs;
    const panel = dialog.querySelector<HTMLElement>('[role="tabpanel"]')!;

    expect(math.getAttribute('aria-selected')).toBe('true');
    expect(math.tabIndex).toBe(0);
    expect(chem.tabIndex).toBe(-1);
    expect(math.getAttribute('aria-controls')).toBe(panel.id);
    expect(panel.getAttribute('aria-labelledby')).toBe(math.id);

    math.focus();
    press(math, 'ArrowRight');
    expect(document.activeElement).toBe(chem);
    expect(chem.getAttribute('aria-selected')).toBe('true');
    expect(chem.tabIndex).toBe(0);
    expect(panel.getAttribute('aria-labelledby')).toBe(chem.id);
    expect(dialog.querySelector('.rte-modal__title')?.textContent).toBe('Химическая формула');

    // По кругу: с последней вкладки вправо — на первую.
    press(chem, 'ArrowRight');
    expect(document.activeElement).toBe(math);
    expect(dialog.querySelector('.rte-modal__title')?.textContent).toBe('Математическая формула');
  });

  it('категории шаблонов — второй список вкладок, шаблоны названы своим LaTeX', () => {
    mountEditor();
    toolbarButton('Математическая формула').click();

    const dialog = openDialog()!;

    const categories = [
      ...dialog.querySelectorAll<HTMLButtonElement>('.rte-formula-editor__categories [role="tab"]'),
    ];

    const gallery = dialog.querySelector<HTMLElement>('.rte-formula-editor__gallery')!;

    expect(categories.length).toBeGreaterThan(1);
    expect(gallery.getAttribute('role')).toBe('tabpanel');
    expect(gallery.getAttribute('aria-labelledby')).toBe(categories[0].id);
    expect(categories[0].tabIndex).toBe(0);
    expect(categories[1].tabIndex).toBe(-1);

    categories[0].focus();
    press(categories[0], 'ArrowRight');

    const reRendered = [
      ...dialog.querySelectorAll<HTMLButtonElement>('.rte-formula-editor__categories [role="tab"]'),
    ];

    expect(document.activeElement).toBe(reRendered[1]);
    expect(reRendered[1].getAttribute('aria-selected')).toBe('true');
    expect(gallery.getAttribute('aria-labelledby')).toBe(reRendered[1].id);

    const template = gallery.querySelector<HTMLButtonElement>('.rte-formula-editor__template')!;

    expect(template.getAttribute('aria-label')).not.toBe('');
    expect(template.getAttribute('aria-label')).toBe(template.title);

    expect(
      template.querySelector('.rte-formula-editor__template-preview')?.getAttribute('aria-hidden'),
    ).toBe('true');

    expect(dialog.querySelector('.rte-formula-editor__status')?.getAttribute('role')).toBe(
      'status',
    );
  });

  it('поповер ссылки назван, Escape из его поля возвращает каретку в текст', async () => {
    const editor = mountEditor({
      content: '<p><a href="https://example.com">ссылка</a> и текст</p>',
    });

    const content = editor.element.querySelector<HTMLElement>('.rte-content')!;

    editor.core.editor.commands.setTextSelection(3);

    const popover = editor.element.querySelector<HTMLElement>(
      '.rte-popover:not(.rte-dropdown__panel)',
    )!;

    expect(popover.hidden).toBe(false);
    expect(popover.getAttribute('role')).toBe('dialog');
    expect(popover.getAttribute('aria-label')).toBe('Ссылка');

    const href = popover.querySelector<HTMLInputElement>('input[type="url"]')!;

    href.focus();
    expect(document.activeElement).toBe(href);

    press(href, 'Escape');
    expect(popover.hidden).toBe(true);
    await nextFrame();
    expect(document.activeElement).toBe(content);

    // Возврат фокуса и движение каретки по той же ссылке панель не возвращают:
    // Escape что-то значит. Каретка вышла и вернулась — панель снова здесь.
    editor.core.editor.commands.setTextSelection(5);
    expect(popover.hidden).toBe(true);
    editor.core.editor.commands.setTextSelection(12);
    editor.core.editor.commands.setTextSelection(3);
    expect(popover.hidden).toBe(false);
  });

  it('недопустимый адрес в диалоге ссылки объявляется и помечает поле', () => {
    mountEditor();
    toolbarButton('Ссылка').click();

    const dialog = openDialog()!;
    const href = dialog.querySelector<HTMLInputElement>('input[type="url"]')!;
    const error = dialog.querySelector<HTMLElement>('.rte-field__error')!;

    expect(error.getAttribute('role')).toBe('alert');
    expect(error.hidden).toBe(true);

    // eslint-disable-next-line no-script-url -- проверяем опасную схему намеренно
    href.value = 'javascript:alert(1)';

    [...dialog.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === 'Применить')!
      .click();

    expect(error.hidden).toBe(false);
    expect(error.textContent).toBe('Недопустимый адрес ссылки');
    expect(href.getAttribute('aria-invalid')).toBe('true');
  });
});

describe('доступность узлов документа', () => {
  const press = (target: Element, key: string): void => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  };

  it('имя области ввода задаётся опцией ariaLabel', () => {
    const editor = mountEditor({ ariaLabel: 'Ответ на задание' });

    expect(editor.element.querySelector('.rte-content')?.getAttribute('aria-label')).toBe(
      'Ответ на задание',
    );

    editor.destroy();

    const plain = mountEditor();

    expect(plain.element.querySelector('.rte-content')?.getAttribute('aria-label')).toBe(
      'Текстовый редактор',
    );
  });

  it('голосовое сообщение — группа с именем и ползунком, стрелки перематывают', () => {
    const editor = mountEditor();

    editor.core.editor.commands.insertAudio({
      src: 'blob:audio',
      name: 'Объяснение',
      duration: 60,
      peaks: '10,50,90',
    });

    const player = editor.element.querySelector<HTMLElement>('.rte-audio')!;

    expect(player.getAttribute('role')).toBe('group');
    expect(player.getAttribute('aria-label')).toBe('Объяснение');

    const slider = player.querySelector<HTMLElement>('.rte-audio__waveform')!;

    expect(slider.getAttribute('role')).toBe('slider');
    expect(slider.tabIndex).toBe(0);
    expect(slider.getAttribute('aria-label')).toBe('Позиция воспроизведения');
    expect(slider.getAttribute('aria-valuemin')).toBe('0');
    expect(slider.getAttribute('aria-valuemax')).toBe('60');
    expect(slider.getAttribute('aria-valuenow')).toBe('0');

    press(slider, 'ArrowRight');
    expect(slider.getAttribute('aria-valuenow')).toBe('5');
    expect(slider.getAttribute('aria-valuetext')).toBe('0:05 / 1:00');
    press(slider, 'End');
    expect(slider.getAttribute('aria-valuenow')).toBe('60');
    press(slider, 'ArrowLeft');
    expect(slider.getAttribute('aria-valuenow')).toBe('55');
    press(slider, 'Home');
    expect(slider.getAttribute('aria-valuenow')).toBe('0');

    // Безымянное сообщение называется по типу.
    editor.core.editor.commands.insertAudio({ src: 'blob:audio2', duration: 3 });

    const players = editor.element.querySelectorAll<HTMLElement>('.rte-audio');

    expect(players[players.length - 1].getAttribute('aria-label')).toBe('Голосовое сообщение');
  });

  it('вложение: ссылка называет и действие, и файл', () => {
    const editor = mountEditor();

    editor.core.editor.commands.insertAttachment({
      href: 'blob:file',
      name: 'отчёт.txt',
      size: 12,
    });

    const link = editor.element.querySelector<HTMLAnchorElement>('.rte-attachment__link')!;

    expect(link.getAttribute('aria-label')).toBe('Скачать: отчёт.txt');
    expect(link.textContent).toBe('отчёт.txt');
  });
});
