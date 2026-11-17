import { createRichContent, createRichEditor, type RichContent, type RichEditorUi } from '@rich-editor/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DRAWINGS_MESSAGES,
  createDrawingsContent,
  createDrawingsFeature,
  drawingsContent,
  type DrawingsFeatureOptions,
} from '../src';

let ui: RichEditorUi | undefined;
let viewer: RichContent | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  ui?.destroy();
  ui = undefined;
  viewer?.destroy();
  viewer = undefined;
  host?.remove();
  host = undefined;
});

const mountEditor = (options: Record<string, unknown> = {}, feature: DrawingsFeatureOptions = {}): RichEditorUi => {
  host = document.createElement('div');
  document.body.appendChild(host);
  ui = createRichEditor({
    element: host,
    content: '<p>привет</p>',
    features: [createDrawingsFeature(feature)],
    ...options,
  });

  return ui;
};

const toolbarButton = (label: string): HTMLButtonElement => {
  const found = [...document.querySelectorAll<HTMLButtonElement>('.rte-toolbar button')].find(
    (button) => button.getAttribute('aria-label') === label,
  );

  if (!found) throw new Error(`Нет кнопки тулбара с подписью «${label}»`);

  return found;
};

const openDialog = (): HTMLElement => {
  const dialog = document.querySelector<HTMLElement>('.rte-modal:not([hidden])');

  if (!dialog) throw new Error('Диалог не открыт');

  return dialog;
};

const typeJson = (dialog: HTMLElement, json: string): void => {
  const input = dialog.querySelector<HTMLTextAreaElement>('textarea:not([readonly])');

  if (!input) throw new Error('В диалоге нет поля JSON');

  input.value = json;
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

const TRIANGLE =
  '{"type":"2d","vertices":{"A":[0,0],"B":[4,0],"C":[0,3]},"edges":[["A","B"],["B","C"],["C","A"]],"angles":[{"points":["B","A","C"],"style":"right"}]}';

const BLOCK =
  '{"elements":[{"id":"floor","type":"surface","points":[[-5,0],[5,0]]},{"id":"F","type":"vector","vectorType":"force","points":[[0,0.5],[3,0.5]],"label":"\\\\vec{F}"}]}';

const PINQUEEN_HTML =
  `<p>Треугольник <span data-geometry-data='${TRIANGLE}' data-tikz-code="\\begin{tikzpicture}\\end{tikzpicture}" class="geometry-node"></span></p>`
  + `<div data-physics-data='${BLOCK}'></div>`;

describe('узлы чертежей в редакторе', () => {
  it('читает разметку PinQueen (span и div) и экспортирует свой контракт без SVG', () => {
    const editor = mountEditor();

    editor.core.setHTML(PINQUEEN_HTML);

    const html = editor.core.getHTML();

    expect(html).toContain('data-geometry="true"');
    expect(html).toContain('data-geometry-data=');
    expect(html).toContain('data-tikz-code="\\begin{tikzpicture}\\end{tikzpicture}"');
    expect(html).toContain('data-physics="true"');
    expect(html).toContain('data-physics-data=');
    expect(html).toContain('aria-label="Чертёж"');
    expect(html).toContain('aria-label="Физическая схема"');
    expect(html).not.toContain('<svg');
    // Сцена хранится как пришла: ключи и порядок не меняются.
    expect(html).toContain('&quot;vertices&quot;:{&quot;A&quot;:[0,0]');
  });

  it('рисует карточки с заголовком по типу сцены и SVG внутри области ввода', () => {
    const editor = mountEditor();

    editor.core.setHTML(PINQUEEN_HTML);

    const cards = editor.element.querySelectorAll<HTMLElement>('.rte-content .rte-drawing');

    expect(cards).toHaveLength(2);
    expect(cards[0].querySelector('.rte-drawing__title')?.textContent).toBe('Планиметрия');
    expect(cards[0].querySelector('.rte-drawing__preview svg')).not.toBeNull();
    expect(cards[1].querySelector('.rte-drawing__title')?.textContent).toBe('Механика');
    expect(cards[1].querySelector('.rte-drawing__preview svg')).not.toBeNull();
  });

  it('битый JSON и пустая сцена дают плейсхолдер, а данные не теряются', () => {
    const editor = mountEditor();

    // Санитайзер обрезает пробелы по краям атрибутов; остальное сохраняется как есть.
    editor.core.setHTML('<div data-geometry-data="{vertices: [1,"></div><div data-physics-data="{}"></div>');

    const cards = editor.element.querySelectorAll<HTMLElement>('.rte-content .rte-drawing');

    expect(cards[0].classList.contains('rte-drawing--invalid')).toBe(true);
    expect(cards[0].querySelector('svg')).toBeNull();
    expect(cards[1].classList.contains('rte-drawing--empty')).toBe(true);
    expect(cards[1].querySelector('.rte-drawing__preview')?.textContent).toBe('Пустой чертёж');
    expect(editor.core.getHTML()).toContain('data-geometry-data="{vertices: [1,"');
  });

  it('команды вставляют, обновляют и удаляют чертежи обоих видов', () => {
    const editor = mountEditor();
    const { editor: tiptap } = editor.core;

    expect(tiptap.commands.insertGeometry({ data: TRIANGLE, tikz: 'tikz-1' })).toBe(true);
    expect(tiptap.commands.insertPhysics({ data: BLOCK })).toBe(true);
    expect(tiptap.commands.insertGeometry({ data: '  ' })).toBe(false);

    const positions: Record<string, number> = {};

    tiptap.state.doc.descendants((node, pos) => {
      if (node.type.name === 'geometry' || node.type.name === 'physics') positions[node.type.name] = pos;
    });

    expect(tiptap.commands.updateGeometry({ pos: positions.geometry, data: '{"type":"2d"}', tikz: 'tikz-2' })).toBe(true);
    expect(editor.core.getHTML()).toContain('data-tikz-code="tikz-2"');
    expect(tiptap.commands.updatePhysics({ pos: positions.geometry, data: '{}' })).toBe(false);
    expect(tiptap.commands.deleteDrawingAt(positions.physics)).toBe(true);
    expect(editor.core.getHTML()).not.toContain('data-physics');
  });
});

describe('возможность целиком: кнопки, диалог, подписи', () => {
  it('кнопка «Чертёж» открывает диалог; шаблон даёт превью и TikZ; вставка кладёт узел', () => {
    const editor = mountEditor({}, { json: true });

    toolbarButton('Чертёж').click();

    const dialog = openDialog();

    expect(dialog.querySelector('.rte-modal__title')?.textContent).toBe('Чертёж');
    expect(dialog.querySelector<HTMLButtonElement>('.rte-button--primary')?.disabled).toBe(true);

    dialog.querySelector<HTMLButtonElement>('button[data-template="triangle"]')?.click();

    expect(dialog.querySelector('.rte-drawing-dialog__preview svg')).not.toBeNull();
    expect(dialog.querySelector<HTMLTextAreaElement>('textarea[readonly]')?.value).toContain('\\begin{tikzpicture}');

    dialog.querySelector<HTMLButtonElement>('.rte-button--primary')?.click();

    const html = editor.core.getHTML();

    expect(html).toContain('data-geometry-data=');
    expect(html).toContain('data-tikz-code=');
  });

  it('кнопка «Физическая схема» даёт свой заголовок и шаблоны; схема вставляется своим узлом', () => {
    const editor = mountEditor({}, { json: true });

    toolbarButton('Физическая схема').click();

    const dialog = openDialog();

    expect(dialog.querySelector('.rte-modal__title')?.textContent).toBe('Физическая схема');
    expect(dialog.querySelector('button[data-template="block-force"]')).not.toBeNull();
    expect(dialog.querySelector('button[data-template="triangle"]')).toBeNull();

    // Сцена набирается на вкладке JSON: конструктор физики — соседняя вкладка.
    dialog.querySelector<HTMLButtonElement>('[data-tab="json"]')?.click();
    typeJson(dialog, BLOCK);
    dialog.querySelector<HTMLButtonElement>('.rte-button--primary')?.click();

    expect(editor.core.getHTML()).toContain('data-physics-data=');
  });

  it('нечитаемый JSON объявляется ошибкой, но сохраняется как есть', () => {
    const editor = mountEditor({}, { json: true });

    toolbarButton('Чертёж').click();

    const dialog = openDialog();

    // JSON правится на своей вкладке; конструктор нечитаемое не примет.
    dialog.querySelector<HTMLButtonElement>('[data-tab="json"]')?.click();
    typeJson(dialog, '{"vertices": ');

    const status = dialog.querySelector('.rte-drawing-dialog__status');

    expect(status?.classList.contains('rte-drawing-dialog__status--error')).toBe(true);
    expect(dialog.querySelector<HTMLButtonElement>('.rte-button--primary')?.disabled).toBe(false);

    dialog.querySelector<HTMLButtonElement>('.rte-button--primary')?.click();
    // Диалог обрезает пробелы по краям, остальное уходит как набрано.
    expect(editor.core.getHTML()).toContain('data-geometry-data="{&quot;vertices&quot;:"');
  });

  it('клик по карточке открывает диалог на правку без выбора вида; удаление убирает узел', () => {
    const editor = mountEditor();

    editor.core.setHTML(`<div data-physics-data='${BLOCK}'></div>`);

    editor.element
      .querySelector<HTMLElement>('.rte-content .rte-drawing')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    const dialog = openDialog();

    expect(dialog.querySelector('.rte-modal__title')?.textContent).toBe('Изменить физическую схему');
    // У физики одна вкладка: строка вкладок не нужна, выбирать вид нельзя.
    expect(dialog.querySelector('.rte-drawing-dialog__kinds')).toBeNull();
    expect(dialog.querySelector<HTMLElement>('.rte-drawing-dialog__head')?.hidden).toBe(true);
    expect(dialog.querySelector<HTMLElement>('.rte-button--danger')?.hidden).toBe(false);

    dialog.querySelector<HTMLButtonElement>('.rte-button--danger')?.click();
    expect(editor.core.getHTML()).not.toContain('data-physics');
  });

  it('подписи приходят из таблиц возможности и следуют за языком', () => {
    const editor = mountEditor({ locale: 'en' });

    expect(toolbarButton('Drawing')).toBeInstanceOf(HTMLButtonElement);
    expect(toolbarButton('Physics diagram')).toBeInstanceOf(HTMLButtonElement);

    editor.setLocale('ru');
    expect(toolbarButton('Чертёж')).toBeInstanceOf(HTMLButtonElement);
    expect(Object.keys(DRAWINGS_MESSAGES.en).sort()).toEqual(Object.keys(DRAWINGS_MESSAGES.ru).sort());
  });
});

describe('раскладка диалога', () => {
  const activeTab = (dialog: HTMLElement): string | null | undefined =>
    dialog.querySelector('[role="tab"][aria-selected="true"]')?.textContent;

  it('окно на весь экран; вкладки — в строке шапки диалога', () => {
    mountEditor();
    toolbarButton('Чертёж').click();

    const dialog = openDialog();
    const head = dialog.querySelector('.rte-drawing-dialog__head');

    expect(dialog.querySelector('.rte-modal__panel')?.classList.contains('rte-modal__panel--fill')).toBe(true);
    expect(head?.querySelector('.rte-drawing-dialog__tabs[role="tablist"]')).not.toBeNull();
    expect(head?.children).toHaveLength(1);
  });

  it('по умолчанию нет ни JSON, ни образцов, ни предпросмотра, ни TikZ', () => {
    mountEditor();
    toolbarButton('Чертёж').click();

    const dialog = openDialog();

    expect(dialog.querySelector('[data-tab="json"]')).toBeNull();
    expect(dialog.querySelector('.rte-drawing-dialog__templates')).toBeNull();
    expect(dialog.querySelector('.rte-drawing-dialog__preview')).toBeNull();
    expect(dialog.querySelector('textarea')).toBeNull();
    expect(dialog.querySelector('details')).toBeNull();
  });

  it('с опцией json служебное свёрнуто на конструкторе и раскрыто на вкладке JSON; статус снаружи', () => {
    mountEditor({}, { json: true });
    toolbarButton('Чертёж').click();

    const dialog = openDialog();
    const more = dialog.querySelector<HTMLDetailsElement>('details.rte-drawing-dialog__more');

    expect(more?.querySelector('.rte-drawing-dialog__templates')).not.toBeNull();
    expect(more?.querySelector('.rte-drawing-dialog__preview')).not.toBeNull();
    expect(more?.querySelector('textarea[readonly]')).not.toBeNull();
    expect(more?.querySelector('summary')?.textContent).toBe('Шаблоны, предпросмотр и код TikZ');
    expect(dialog.querySelector('.rte-drawing-dialog__status')?.closest('details')).toBeNull();
    expect(more?.open).toBe(false);

    dialog.querySelector<HTMLButtonElement>('[data-tab="json"]')?.click();
    expect(more?.open).toBe(true);
    expect(dialog.querySelector('.rte-drawing-dialog')?.classList.contains('rte-drawing-dialog--json')).toBe(true);

    dialog.querySelector<HTMLButtonElement>('[data-tab="planimetry"]')?.click();
    expect(more?.open).toBe(false);
    expect(dialog.querySelector('.rte-drawing-dialog')?.classList.contains('rte-drawing-dialog--json')).toBe(false);
  });

  it('вкладки нового чертежа — четыре конструктора; «Физика» делает чертёж физической схемой', () => {
    const editor = mountEditor();

    toolbarButton('Чертёж').click();

    const dialog = openDialog();

    expect([...dialog.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent)).toEqual([
      'Планиметрия',
      'Стереометрия',
      'Графики',
      'Физика',
    ]);
    expect(dialog.querySelector('input[type="radio"]')).toBeNull();
    expect(dialog.querySelector('.rte-modal__title')?.textContent).toBe('Чертёж');

    dialog.querySelector<HTMLButtonElement>('[data-tab="physics"]')?.click();

    expect(activeTab(dialog)).toBe('Физика');
    expect(dialog.querySelector('.rte-builder--physics')).not.toBeNull();
    expect(dialog.querySelector('.rte-modal__title')?.textContent).toBe('Физическая схема');

    dialog.querySelector<HTMLButtonElement>('.rte-builder__palette button[data-element]')?.click();
    dialog.querySelector<HTMLButtonElement>('.rte-button--primary')?.click();

    const html = editor.core.getHTML();

    expect(html).toContain('data-physics-data=');
    expect(html).not.toContain('data-geometry-data=');

    // Обратно на геометрию — и заголовок обратно.
    toolbarButton('Чертёж').click();
    dialog.querySelector<HTMLButtonElement>('[data-tab="physics"]')?.click();
    dialog.querySelector<HTMLButtonElement>('[data-tab="stereometry"]')?.click();
    expect(dialog.querySelector('.rte-modal__title')?.textContent).toBe('Чертёж');
  });

  const BROKEN_HTML = '<div data-geometry-data="{vertices: [1,"></div>';

  const editBroken = (editor: RichEditorUi): HTMLElement => {
    editor.core.setHTML(BROKEN_HTML);
    editor.element
      .querySelector<HTMLElement>('.rte-content .rte-drawing')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    return openDialog();
  };

  it('нечитаемая сцена без JSON: чистый конструктор и просьба нарисовать заново; вставка заменяет узел', () => {
    const editor = mountEditor();
    const dialog = editBroken(editor);
    const status = dialog.querySelector<HTMLElement>('.rte-drawing-dialog__status');

    expect(activeTab(dialog)).toBe('Планиметрия');
    // Пустое полотно: ни вершин, ни отрезков — только сетка и оси (и узор штриховки в `<defs>`).
    const drawn = [
      ...dialog.querySelectorAll('.rte-sketch__layer circle, .rte-sketch__layer line:not(.rte-drawing__grid):not(.rte-drawing__axis)'),
    ].filter((shape) => !shape.closest('defs'));

    expect(drawn).toEqual([]);
    expect(status?.hidden).toBe(false);
    expect(status?.textContent).toBe('Не получилось прочитать чертёж. Нарисуй его заново');
    expect(status?.classList.contains('rte-drawing-dialog__status--error')).toBe(true);

    // Новый чертёж: точка на полотне — и «Сохранить» заменяет битый узел.
    const canvas = dialog.querySelector<HTMLElement>('.rte-sketch');

    dialog.querySelector<HTMLButtonElement>('button[data-tool="point"]')?.click();
    canvas?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 100, clientY: 100 }));
    canvas?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, clientX: 100, clientY: 100 }));
    dialog.querySelector<HTMLButtonElement>('.rte-button--primary')?.click();

    const html = editor.core.getHTML();

    expect(html).not.toContain('{vertices: [1,');
    expect(html).toContain('data-geometry-data=');
    expect(editor.element.querySelectorAll('.rte-content .rte-drawing')).toHaveLength(1);
  });

  it('нечитаемая сцена с JSON: вкладка JSON с исходным текстом; переход на конструктор и обратно текст не меняет', () => {
    const editor = mountEditor({}, { json: true });
    const dialog = editBroken(editor);
    const code = (): string | undefined => dialog.querySelector<HTMLTextAreaElement>('textarea:not([readonly])')?.value;
    const status = dialog.querySelector('.rte-drawing-dialog__status');

    expect(activeTab(dialog)).toBe('JSON');
    expect(code()).toBe('{vertices: [1,');
    expect(status?.classList.contains('rte-drawing-dialog__status--error')).toBe(true);
    expect(status?.textContent).not.toContain('Нарисуй');

    dialog.querySelector<HTMLButtonElement>('[data-tab="planimetry"]')?.click();
    expect(activeTab(dialog)).toBe('Планиметрия');
    dialog.querySelector<HTMLButtonElement>('[data-tab="json"]')?.click();
    expect(code()).toBe('{vertices: [1,');
  });

  it('пустой текст JSON принимает вид последнего конструктора: после «Физики» вставляется физическая схема', () => {
    const editor = mountEditor({}, { json: true });

    toolbarButton('Чертёж').click();

    const dialog = openDialog();

    // Конструктор только открыли, ничего не рисовали — и сразу на вкладку JSON.
    dialog.querySelector<HTMLButtonElement>('[data-tab="physics"]')?.click();
    dialog.querySelector<HTMLButtonElement>('[data-tab="json"]')?.click();

    expect(activeTab(dialog)).toBe('JSON');
    expect(dialog.querySelector('.rte-modal__title')?.textContent).toBe('Физическая схема');

    typeJson(dialog, BLOCK);
    dialog.querySelector<HTMLButtonElement>('.rte-button--primary')?.click();

    const html = editor.core.getHTML();

    expect(html).toContain('data-physics-data=');
    expect(html).not.toContain('data-geometry-data=');
  });

  it('непустой текст JSON хранит свой вид: вкладка «Физика» без рисунка его не меняет', () => {
    const editor = mountEditor({}, { json: true });

    toolbarButton('Чертёж').click();

    const dialog = openDialog();

    dialog.querySelector<HTMLButtonElement>('[data-tab="json"]')?.click();
    typeJson(dialog, TRIANGLE);
    dialog.querySelector<HTMLButtonElement>('[data-tab="physics"]')?.click();
    dialog.querySelector<HTMLButtonElement>('[data-tab="json"]')?.click();

    expect(dialog.querySelector('.rte-modal__title')?.textContent).toBe('Чертёж');

    dialog.querySelector<HTMLButtonElement>('.rte-button--primary')?.click();

    const html = editor.core.getHTML();

    expect(html).toContain('data-geometry-data=');
    expect(html).not.toContain('data-physics-data=');
  });
});

describe('вьюер', () => {
  it('документная часть пропускает разметку и дорисовывает карточки', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);

    viewer = createRichContent({ element: host, html: PINQUEEN_HTML, features: [drawingsContent] });
    await viewer.renderPendingFormulas();

    const cards = host.querySelectorAll<HTMLElement>('.rte-drawing');

    expect(cards).toHaveLength(2);
    expect(cards[0].querySelector('svg')).not.toBeNull();
    expect(cards[0].querySelector('.rte-drawing__title')?.textContent).toBe('Планиметрия');
    expect(cards[0].getAttribute('role')).toBe('img');
    expect(host.querySelector('[data-tikz-code]')).not.toBeNull();
  });

  it('язык заголовков задаётся при создании документной части', () => {
    host = document.createElement('div');
    document.body.appendChild(host);

    viewer = createRichContent({
      element: host,
      html: `<div data-physics-data='${BLOCK}'></div>`,
      features: [createDrawingsContent({ locale: 'en' })],
    });

    expect(host.querySelector('.rte-drawing__title')?.textContent).toBe('Mechanics');
  });

  it('без документной части узлы вырезаются санитайзером', () => {
    host = document.createElement('div');
    document.body.appendChild(host);

    viewer = createRichContent({ element: host, html: PINQUEEN_HTML });

    expect(host.querySelector('[data-geometry-data]')).toBeNull();
  });
});
