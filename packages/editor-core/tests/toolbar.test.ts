import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { RichEditorCore, SIMPLE_TOOLBAR_ITEMS, createToolbar, type Toolbar } from '../src';
import { createPanelToolbarItems } from '../src/ui/toolbar-panels';
import type { EditorUiContext } from '../src/ui/types';

/**
 * Раскладка тулбара. jsdom не считает геометрию, поэтому перенос строк
 * имитируется: каждая группа условно шириной GROUP_WIDTH, строка вмещает
 * столько групп, сколько влезает в подставную ширину.
 */
const GROUP_WIDTH = 200;
let fakeWidth = Number.POSITIVE_INFINITY;
const originalOffsetTop = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetTop');

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
    configurable: true,
    get(this: HTMLElement) {
      const parent = this.parentElement;
      if (!parent || !this.classList.contains('rte-toolbar__group')) return 0;
      const perRow = Math.max(1, Math.floor(fakeWidth / GROUP_WIDTH));
      return Math.floor([...parent.children].indexOf(this) / perRow) * 32;
    },
  });
});

afterAll(() => {
  if (originalOffsetTop) Object.defineProperty(HTMLElement.prototype, 'offsetTop', originalOffsetTop);
});

let core: RichEditorCore | undefined;
let toolbar: Toolbar | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  toolbar?.destroy();
  core?.destroy();
  host?.remove();
  toolbar = core = host = undefined;
});

const noop = (): void => {};

function mountToolbar(): Toolbar {
  host = document.createElement('div');
  document.body.appendChild(host);
  core = new RichEditorCore({ element: host, content: '<p>текст</p>' });
  const instance = core;

  const context: EditorUiContext = {
    editor: instance.editor,
    t: (key, params) => instance.t(key, params),
    limits: instance.getLimits(),
    uploads: instance.uploads,
    editFormula: noop,
  };

  toolbar = createToolbar(context, {
    groups: [
      { id: 'history', items: ['undo', 'redo'], collapsible: true },
      { id: 'heading', items: ['heading'] },
      { id: 'format', items: ['bold', 'italic'] },
      { id: 'script', items: ['subscript', 'superscript'], collapsible: true },
      { id: 'list', items: ['bulletList'] },
      { id: 'block', items: ['blockquote', 'code'], collapsible: true },
    ],
    items: {
      ...SIMPLE_TOOLBAR_ITEMS,
      ...createPanelToolbarItems({
        insertTable: noop,
        editLink: noop,
        pickImage: noop,
        pickFile: noop,
        recordAudio: noop,
        insertFormula: noop,
      }),
    },
  });
  host.appendChild(toolbar.element);
  return toolbar;
}

const groupsOf = (bar: Toolbar) => bar.element.querySelectorAll(':scope > .rte-toolbar__group');
const overflowOf = (bar: Toolbar) =>
  [...bar.element.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.getAttribute('aria-label') === 'Ещё',
  );

describe('раскладка тулбара', () => {
  it('выше порога схлопывает группы по одной, пока не поместится в строку', () => {
    const bar = mountToolbar();

    fakeWidth = 2000;
    bar.layout(2000);
    expect(groupsOf(bar)).toHaveLength(6);
    expect(overflowOf(bar)).toBeUndefined();

    // Четыре группы в строку: три схлопываемых уходят в меню, остаётся 3 + «⋯».
    fakeWidth = 800;
    bar.layout(800);
    expect(groupsOf(bar)).toHaveLength(4);
    expect(overflowOf(bar)).toBeDefined();

    overflowOf(bar)!.click();
    const menu = bar.element.querySelector('.rte-dropdown__panel:not([hidden])')!;
    expect(menu.textContent).toContain('Отменить');
    expect(menu.textContent).toContain('Цитата');
  });

  it('возвращает группы из меню, когда места снова хватает', () => {
    const bar = mountToolbar();
    fakeWidth = 800;
    bar.layout(800);
    expect(groupsOf(bar)).toHaveLength(4);

    fakeWidth = 2000;
    bar.layout(2000);
    expect(groupsOf(bar)).toHaveLength(6);
    expect(overflowOf(bar)).toBeUndefined();
  });

  it('ниже порога схлопывает все схлопываемые группы сразу', () => {
    const bar = mountToolbar();
    fakeWidth = 2000;
    bar.layout(500);
    expect(groupsOf(bar)).toHaveLength(4);
    expect(overflowOf(bar)).toBeDefined();
  });
});

describe('состояние и доступность кнопок', () => {
  it('переключатели сообщают состояние через aria-pressed', () => {
    const bar = mountToolbar();
    const bold = [...bar.element.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.getAttribute('aria-label') === 'Полужирный',
    )!;
    expect(bold.getAttribute('aria-pressed')).toBe('false');

    core!.editor.commands.selectAll();
    core!.editor.commands.toggleBold();
    bar.syncState();
    expect(bold.getAttribute('aria-pressed')).toBe('true');
    expect(bold.classList.contains('rte-btn--active')).toBe(true);
  });

  it('подсказка несёт сочетание клавиш, доступное имя — нет', () => {
    const bar = mountToolbar();
    const bold = [...bar.element.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.getAttribute('aria-label') === 'Полужирный',
    )!;
    expect(bold.title).toBe('Полужирный · Ctrl+B');
    expect(bold.getAttribute('aria-keyshortcuts')).toBe('Control+B');
  });

  it('кнопка заголовка показывает текущий уровень, выравнивание — текущую иконку', () => {
    const bar = mountToolbar();
    const heading = bar.element.querySelector<HTMLButtonElement>('[aria-label="Заголовок"]')!;
    expect(heading.textContent?.trim()).toBe('Обычный текст');

    core!.editor.commands.toggleHeading({ level: 2 });
    bar.syncState();
    expect(heading.textContent?.trim()).toBe('H2');
  });

  it('у тулбара есть имя', () => {
    const bar = mountToolbar();
    expect(bar.element.getAttribute('aria-label')).toBe('Панель форматирования');
  });
});
