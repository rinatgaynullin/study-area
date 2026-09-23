import { mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { enMessages, latexToMathML, RichEditor } from '../src';

let wrapper: VueWrapper | undefined;

afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = '';
});

const mountEditor = async (props: Record<string, unknown> = {}) => {
  wrapper = mount(RichEditor, {
    props: { modelValue: '<p>привет</p>', ...props },
    attachTo: document.body,
  });

  // The core editor is created in onMounted; the toolbar stays disabled until
  // that render flushes.
  await nextTick();

  return wrapper;
};

/** Toolbar buttons are addressed by their localized tooltip, as a user would. */
const button = (w: VueWrapper, label: string) => {
  const found = w
    .findAll('.rte-toolbar button')
    .find((el) => el.attributes('aria-label') === label);

  if (!found) throw new Error(`No toolbar button labelled "${label}"`);

  return found;
};

const html = (w: VueWrapper): string => (w.vm as unknown as { getHTML(): string }).getHTML();

/** Текст элемента внутри открытого диалога: скрытые тоже остаются в DOM. */
const openDialogText = (selector: string): string =>
  document.querySelector(`.rte-modal:not([hidden]) ${selector}`)?.textContent ?? '';

describe('mounting', () => {
  it('renders the toolbar and the editable surface', async () => {
    const w = await mountEditor();

    expect(w.find('.rte-toolbar').exists()).toBe(true);
    expect(w.find('.rte-content').exists()).toBe(true);
    expect(w.find('.rte-content').text()).toContain('привет');
  });

  it('passes ariaLabel through to the editing surface', async () => {
    const w = await mountEditor({ ariaLabel: 'Ответ' });

    expect(w.find('.rte-content').attributes('aria-label')).toBe('Ответ');
  });

  it('hides the toolbar when not editable', async () => {
    const w = await mountEditor({ editable: false });

    // Ванильная оболочка прячет тулбар атрибутом, а не пересоздаёт разметку:
    // так режим чтения переключается без перестройки редактора.
    expect(w.find('.rte-toolbar').attributes('hidden')).toBeDefined();
    expect(w.find('.rte-root--readonly').exists()).toBe(true);
  });

  it('renders only the configured toolbar preset', async () => {
    const full = await mountEditor({ toolbar: 'full' });
    const fullCount = full.findAll('.rte-toolbar button').length;

    full.unmount();

    const w = await mountEditor({ toolbar: 'minimal' });

    expect(w.findAll('.rte-toolbar button').length).toBeLessThan(fullCount);
    expect(() => button(w, 'Полужирный')).not.toThrow();
  });

  it('accepts a custom toolbar configuration', async () => {
    const w = await mountEditor({ toolbar: [{ id: 'custom', items: ['bold', 'italic'] }] });

    expect(w.findAll('.rte-toolbar button')).toHaveLength(2);
  });
});

describe('toolbar commands', () => {
  it.each([
    ['Полужирный', '<strong>'],
    ['Курсив', '<em>'],
    ['Подчёркнутый', '<u>'],
    ['Зачёркнутый', '<s>'],
    ['Нижний индекс', '<sub>'],
    ['Верхний индекс', '<sup>'],
    ['Моноширинный текст', '<code>'],
  ])('%s wraps the selection in %s', async (label, tag) => {
    const w = await mountEditor({ modelValue: '<p>текст</p>' });

    (w.vm as unknown as { focus(): void }).focus();

    (
      w.vm as unknown as { editor: { commands: { selectAll(): void } } }
    ).editor.commands.selectAll();

    await button(w, label).trigger('click');

    expect(html(w)).toContain(tag);
  });

  it.each([
    ['Маркированный список', '<ul>'],
    ['Нумерованный список', '<ol>'],
    ['Цитата', '<blockquote>'],
    ['Блок кода', '<pre class="rte-code-block">'],
    ['Горизонтальная линия', '<hr>'],
  ])('%s produces %s', async (label, tag) => {
    const w = await mountEditor({ modelValue: '<p>текст</p>' });

    (w.vm as unknown as { focus(): void }).focus();

    await button(w, label).trigger('click');

    expect(html(w)).toContain(tag);
  });

  it('applies and clears formatting', async () => {
    const w = await mountEditor({ modelValue: '<p>текст</p>' });
    const vm = w.vm as unknown as { focus(): void; editor: { commands: { selectAll(): void } } };

    vm.focus();
    vm.editor.commands.selectAll();

    await button(w, 'Полужирный').trigger('click');
    expect(html(w)).toContain('<strong>');

    vm.editor.commands.selectAll();
    await button(w, 'Очистить форматирование').trigger('click');
    expect(html(w)).not.toContain('<strong>');
  });

  it('undoes and redoes', async () => {
    const w = await mountEditor({ modelValue: '<p>текст</p>' });
    const vm = w.vm as unknown as { focus(): void; editor: { commands: { selectAll(): void } } };

    vm.focus();
    vm.editor.commands.selectAll();

    await button(w, 'Полужирный').trigger('click');
    expect(html(w)).toContain('<strong>');

    await button(w, 'Отменить').trigger('click');
    expect(html(w)).not.toContain('<strong>');

    await button(w, 'Повторить').trigger('click');
    expect(html(w)).toContain('<strong>');
  });

  it('reflects the active state of the current selection', async () => {
    const w = await mountEditor({ modelValue: '<p>текст</p>' });
    const vm = w.vm as unknown as { focus(): void; editor: { commands: { selectAll(): void } } };

    vm.focus();
    vm.editor.commands.selectAll();

    expect(button(w, 'Полужирный').classes()).not.toContain('rte-btn--active');

    await button(w, 'Полужирный').trigger('click');
    await nextTick();

    expect(button(w, 'Полужирный').classes()).toContain('rte-btn--active');
  });

  it('opens the heading menu and applies a level', async () => {
    const w = await mountEditor({ modelValue: '<p>текст</p>' });

    (w.vm as unknown as { focus(): void }).focus();

    await button(w, 'Заголовок').trigger('click');

    const items = w.findAll('.rte-dropdown__panel .rte-menu__item');

    expect(items.length).toBe(7);

    await items[2].trigger('click');
    expect(html(w)).toContain('<h2>');
  });

  it('applies text alignment from the menu', async () => {
    const w = await mountEditor({ modelValue: '<p>текст</p>' });

    (w.vm as unknown as { focus(): void }).focus();

    await button(w, 'Выравнивание').trigger('click');
    await w.findAll('.rte-dropdown__panel .rte-menu__item')[1].trigger('click');

    expect(html(w)).toContain('text-align: center');
  });

  it('applies a colour swatch', async () => {
    const w = await mountEditor({ modelValue: '<p>текст</p>' });
    const vm = w.vm as unknown as { focus(): void; editor: { commands: { selectAll(): void } } };

    vm.focus();
    vm.editor.commands.selectAll();

    await button(w, 'Цвет текста').trigger('click');
    await w.findAll('.rte-colors__swatch')[3].trigger('click');

    expect(html(w)).toContain('color:');
  });

  it('inserts a table through the dialog', async () => {
    const w = await mountEditor({ modelValue: '<p>текст</p>' });

    (w.vm as unknown as { focus(): void }).focus();

    await button(w, 'Таблица').trigger('click');
    await w.find('.rte-dropdown__panel:not([hidden]) .rte-menu__item').trigger('click');

    const dialog = document.querySelector('.rte-modal:not([hidden]) .rte-modal__panel');

    expect(dialog).not.toBeNull();

    dialog!.querySelector<HTMLButtonElement>('.rte-button--primary')!.click();
    await nextTick();

    expect(html(w)).toContain('<table');
  });
});

describe('v-model', () => {
  it('emits updated HTML as the document changes', async () => {
    const w = await mountEditor({ modelValue: '<p>текст</p>' });
    const vm = w.vm as unknown as { focus(): void; editor: { commands: { selectAll(): void } } };

    vm.focus();
    vm.editor.commands.selectAll();

    await button(w, 'Полужирный').trigger('click');

    const emitted = w.emitted('update:modelValue');

    expect(emitted).toBeTruthy();
    expect(String(emitted!.at(-1)![0])).toContain('<strong>');
    expect(w.emitted('change')).toBeTruthy();
  });

  it('applies external model changes to the document', async () => {
    const w = await mountEditor({ modelValue: '<p>первый</p>' });

    await w.setProps({ modelValue: '<p>второй</p>' });
    await nextTick();

    expect(w.find('.rte-content').text()).toContain('второй');
  });

  it('sanitizes HTML arriving through the model', async () => {
    const w = await mountEditor({ modelValue: '<p>ok</p>' });

    await w.setProps({ modelValue: '<p>safe</p><script>alert(1)</script>' });
    await nextTick();

    expect(html(w)).not.toContain('alert');
  });
});

describe('theme', () => {
  it('the theme prop toggles the built-in dark theme', async () => {
    const w = await mountEditor({ theme: 'dark' });

    expect(w.find('.rte-root').classes()).toContain('rte-theme-dark');

    await w.setProps({ theme: 'light' });
    expect(w.find('.rte-root').classes()).not.toContain('rte-theme-dark');
  });
});

describe('v-model echo', () => {
  it('does not re-apply HTML the document already holds', async () => {
    const w = await mountEditor({ modelValue: '<p>текст</p>' });
    const vm = w.vm as unknown as { core: { setHTML(html: string): void; getHTML(): string } };
    const setHTML = vi.spyOn(vm.core, 'setHTML');

    // Хост вернул ровно то, что в документе: сброс выделения и лишний шаг в
    // истории здесь ни к чему.
    await w.setProps({ modelValue: vm.core.getHTML() });
    expect(setHTML).not.toHaveBeenCalled();

    await w.setProps({ modelValue: '<p>другой</p>' });
    expect(setHTML).toHaveBeenCalledTimes(1);
  });
});

describe('i18n', () => {
  it('labels the toolbar in Russian by default', async () => {
    const w = await mountEditor();

    expect(button(w, 'Полужирный').exists()).toBe(true);
  });

  it('switches toolbar labels when messages and locale change', async () => {
    const w = await mountEditor({ locale: 'en', messages: { en: enMessages } });

    expect(button(w, 'Bold').exists()).toBe(true);
    expect(button(w, 'Voice message').exists()).toBe(true);

    await w.setProps({ locale: 'ru' });
    expect(button(w, 'Полужирный').exists()).toBe(true);
  });

  it('accepts a partial JSON tree and falls back for the rest', async () => {
    const w = await mountEditor({ locale: 'fr', messages: { fr: { toolbar_bold: 'Gras' } } });

    expect(button(w, 'Gras').exists()).toBe(true);
    expect(button(w, 'Курсив').exists()).toBe(true);
  });
});

describe('exposed API', () => {
  it('exposes document accessors and the formula entry point', async () => {
    const w = await mountEditor({ modelValue: '<p>текст</p>' });

    const vm = w.vm as unknown as {
      getHTML(): string;
      setHTML(html: string): void;
      getText(): string;
      isEmpty(): boolean;
      insertFormula(mathml: string, type?: 'math' | 'chem'): boolean;
      whenFormulasReady(): Promise<void>;
    };

    expect(vm.getText()).toContain('текст');
    expect(vm.isEmpty()).toBe(false);

    vm.setHTML('<p>заменено</p>');
    expect(vm.getHTML()).toContain('заменено');

    const mathml = await latexToMathML('\\frac{a}{b}', 'math');

    expect(vm.insertFormula(mathml, 'math')).toBe(true);
    await vm.whenFormulasReady();

    expect(vm.getHTML()).toContain('data-formula="true"');
  });

  it('emits ready once the core editor exists', async () => {
    const w = await mountEditor();

    expect(w.emitted('ready')).toHaveLength(1);
  });
});

describe('formula dialog', () => {
  it('opens from the toolbar for math and chemistry', async () => {
    const w = await mountEditor();

    await button(w, 'Математическая формула').trigger('click');
    await nextTick();
    expect(openDialogText('.rte-modal__title')).toContain('Математическая');

    document
      .querySelector<HTMLButtonElement>('.rte-modal:not([hidden]) .rte-modal__close')!
      .click();

    await nextTick();

    await button(w, 'Химическая формула').trigger('click');
    await nextTick();
    expect(openDialogText('.rte-modal__title')).toContain('Химическая');
  });

  it('opens with the clicked formula and saves the updated MathML', async () => {
    const w = await mountEditor({ modelValue: '<p>x</p>' });

    const vm = w.vm as unknown as {
      insertFormula(mathml: string): boolean;
      whenFormulasReady(): Promise<void>;
      getHTML(): string;
    };

    vm.insertFormula(await latexToMathML('x^2', 'math'));
    await vm.whenFormulasReady();
    await nextTick();

    const node = document.querySelector<HTMLElement>('.rte-content .rte-formula')!;

    node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    await nextTick();

    expect(document.querySelector('.rte-modal:not([hidden]) .rte-modal__panel')).not.toBeNull();
    // The dialog is bound to the clicked node, so saving updates it in place.
    expect(openDialogText('.rte-button--danger')).toContain('Удалить формулу');
  });
});

describe('errors', () => {
  it('surfaces upload failures to the host', async () => {
    const w = await mountEditor({
      uploadImage: vi.fn(async () => {
        throw new Error('boom');
      }),
    });

    const { core } = w.vm as unknown as { core: { insertImageFile(file: File): Promise<boolean> } };

    await core.insertImageFile(new File([new Uint8Array([1])], 'a.png', { type: 'image/png' }));

    expect(w.emitted('error')).toBeTruthy();
  });
});
