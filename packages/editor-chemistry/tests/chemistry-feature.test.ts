import { createRichContent, createRichEditor, type RichContent, type RichEditorUi } from '@rich-editor/core';
import { afterEach, describe, expect, it } from 'vitest';
import { CHEMISTRY_MESSAGES, chemistryContent, createChemistryFeature } from '../src';

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

const mountEditor = (options: Record<string, unknown> = {}): RichEditorUi => {
  host = document.createElement('div');
  document.body.appendChild(host);
  ui = createRichEditor({
    element: host,
    content: '<p>привет</p>',
    features: [createChemistryFeature()],
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

/** Открытый диалог: закрытые остаются в DOM под атрибутом `hidden`. */
const openDialog = (): HTMLElement => {
  const dialog = document.querySelector<HTMLElement>('.rte-modal:not([hidden])');

  if (!dialog) throw new Error('Диалог не открыт');

  return dialog;
};

const typeCode = (dialog: HTMLElement, code: string): void => {
  const input = dialog.querySelector<HTMLTextAreaElement>('textarea');

  if (!input) throw new Error('В диалоге нет поля кода');

  input.value = code;
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

const PINQUEEN_HTML =
  '<p>Бензол <span data-chemistry-code="[:30]**6(------)" data-chemistry-type="chemfig" class="chemistry-node"></span>'
  + ' и <div data-chemistry-code="CH_3-CH_2-OH" data-chemistry-type="chemfig"></div></p>';

describe('узел структурной формулы в редакторе', () => {
  it('читает разметку PinQueen (span и div) и экспортирует свой контракт без SVG', () => {
    const editor = mountEditor();

    editor.core.setHTML(PINQUEEN_HTML);

    const html = editor.core.getHTML();

    expect(html.match(/data-chemistry-code=/g)).toHaveLength(2);
    expect(html).toContain('data-chemistry-code="[:30]**6(------)"');
    expect(html).toContain('data-chemistry-code="CH_3-CH_2-OH"');
    expect(html).toContain('data-chemistry-type="chemfig"');
    expect(html).toContain('data-chemistry="true"');
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Структурная формула: CH_3-CH_2-OH"');
    expect(html).not.toContain('<svg');
  });

  it('рисует SVG в области ввода и помечает код вне подмножества, не теряя его', () => {
    const editor = mountEditor();

    editor.core.setHTML(
      '<p><span data-chemistry-code="CH_3-OH"></span><span data-chemistry-code="A-(B"></span></p>',
    );

    const nodes = editor.element.querySelectorAll<HTMLElement>('.rte-content .rte-chemistry');

    expect(nodes).toHaveLength(2);
    expect(nodes[0].querySelector('svg')).not.toBeNull();
    expect(nodes[1].classList.contains('rte-chemistry--invalid')).toBe(true);
    expect(nodes[1].textContent).toBe('A-(B');
    expect(editor.core.getHTML()).toContain('data-chemistry-code="A-(B"');
  });

  it('узел без кода не попадает в документ', () => {
    const editor = mountEditor();

    editor.core.setHTML('<p>x <span data-chemistry-code="  "></span></p>');

    expect(editor.core.getHTML()).not.toContain('data-chemistry');
  });

  it('команды вставляют, обновляют и удаляют структуру', () => {
    const editor = mountEditor();
    const { editor: tiptap } = editor.core;

    expect(tiptap.commands.insertChemistry({ code: ' CH_3-OH ' })).toBe(true);
    expect(tiptap.commands.insertChemistry({ code: '   ' })).toBe(false);
    expect(editor.core.getHTML()).toContain('data-chemistry-code="CH_3-OH"');

    let pos = -1;

    tiptap.state.doc.descendants((node, nodePos) => {
      if (node.type.name === 'chemistry') pos = nodePos;
    });

    expect(tiptap.commands.updateChemistry({ pos, code: '**6(------)' })).toBe(true);
    expect(editor.core.getHTML()).toContain('data-chemistry-code="**6(------)"');

    expect(tiptap.commands.deleteChemistryAt(pos)).toBe(true);
    expect(editor.core.getHTML()).not.toContain('data-chemistry');
  });
});

describe('возможность целиком: кнопка, диалог, подписи', () => {
  it('кнопка тулбара открывает диалог, шаблон и ввод кода дают превью, вставка кладёт узел', () => {
    const editor = mountEditor();

    toolbarButton('Структурная формула').click();

    const dialog = openDialog();

    expect(dialog.querySelector('.rte-modal__title')?.textContent).toBe('Структурная формула');
    expect(dialog.querySelector<HTMLButtonElement>('.rte-button--primary')?.disabled).toBe(true);
    expect(dialog.querySelector<HTMLElement>('.rte-button--danger')?.hidden).toBe(true);

    dialog.querySelector<HTMLButtonElement>('button[data-code="**6(------)"]')?.click();
    expect(dialog.querySelector('.rte-chemistry-dialog__preview svg')).not.toBeNull();
    expect(dialog.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('**6(------)');

    typeCode(dialog, 'CH_3-CH=CH_2');
    expect(dialog.querySelector('.rte-chemistry-dialog__preview')?.textContent).toContain('CH₃');

    dialog.querySelector<HTMLButtonElement>('.rte-button--primary')?.click();

    expect(document.querySelector('.rte-modal:not([hidden])')).toBeNull();
    expect(editor.core.getHTML()).toContain('data-chemistry-code="CH_3-CH=CH_2"');
  });

  it('неразобранный код объявляется, но вставить его можно', () => {
    const editor = mountEditor();

    toolbarButton('Структурная формула').click();

    const dialog = openDialog();

    typeCode(dialog, 'A-(B');

    const status = dialog.querySelector('.rte-chemistry-dialog__status');

    expect(status?.textContent).toBe('Не удалось разобрать код: будет показан как текст');
    expect(status?.classList.contains('rte-chemistry-dialog__status--error')).toBe(true);
    expect(dialog.querySelector<HTMLButtonElement>('.rte-button--primary')?.disabled).toBe(false);

    dialog.querySelector<HTMLButtonElement>('.rte-button--primary')?.click();
    expect(editor.core.getHTML()).toContain('data-chemistry-code="A-(B"');
  });

  it('клик по узлу открывает диалог на правку; сохранение меняет код, удаление убирает узел', () => {
    const editor = mountEditor();

    editor.core.setHTML('<p><span data-chemistry-code="CH_3-OH"></span></p>');

    const node = editor.element.querySelector<HTMLElement>('.rte-content .rte-chemistry');

    node?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));

    const dialog = openDialog();

    expect(dialog.querySelector('.rte-modal__title')?.textContent).toBe('Изменить структурную формулу');
    expect(dialog.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('CH_3-OH');
    expect(dialog.querySelector<HTMLElement>('.rte-button--danger')?.hidden).toBe(false);

    typeCode(dialog, 'CH_3-CH_2-OH');
    dialog.querySelector<HTMLButtonElement>('.rte-button--primary')?.click();
    expect(editor.core.getHTML()).toContain('data-chemistry-code="CH_3-CH_2-OH"');

    editor.element
      .querySelector<HTMLElement>('.rte-content .rte-chemistry')
      ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    openDialog().querySelector<HTMLButtonElement>('.rte-button--danger')?.click();
    expect(editor.core.getHTML()).not.toContain('data-chemistry');
  });

  it('подписи приходят из таблиц возможности и следуют за языком', () => {
    const editor = mountEditor({ locale: 'en' });

    expect(toolbarButton('Structural formula')).toBeInstanceOf(HTMLButtonElement);

    editor.setLocale('ru');
    expect(toolbarButton('Структурная формула')).toBeInstanceOf(HTMLButtonElement);

    // Таблицы возможности полные: у каждого русского ключа есть английский.
    expect(Object.keys(CHEMISTRY_MESSAGES.en).sort()).toEqual(Object.keys(CHEMISTRY_MESSAGES.ru).sort());
  });

  it('без пункта тулбара узел всё равно читается из разметки', () => {
    const editor = mountEditor({ features: [createChemistryFeature({ toolbarItem: false })] });

    expect(() => toolbarButton('Структурная формула')).toThrow();

    editor.core.setHTML(PINQUEEN_HTML);
    expect(editor.core.getHTML().match(/data-chemistry-code=/g)).toHaveLength(2);
  });
});

describe('вьюер', () => {
  it('документная часть пропускает разметку и дорисовывает SVG по коду', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);

    viewer = createRichContent({ element: host, html: PINQUEEN_HTML, features: [chemistryContent] });
    await viewer.renderPendingFormulas();

    const nodes = host.querySelectorAll<HTMLElement>('[data-chemistry-code]');

    expect(nodes).toHaveLength(2);
    expect(nodes[0].querySelector('svg')).not.toBeNull();
    expect(nodes[0].getAttribute('role')).toBe('img');
    // Имени в разметке PinQueen нет — читалке остаётся код.
    expect(nodes[0].getAttribute('aria-label')).toBe('[:30]**6(------)');
  });

  it('без документной части узлы вырезаются санитайзером', () => {
    host = document.createElement('div');
    document.body.appendChild(host);

    viewer = createRichContent({ element: host, html: PINQUEEN_HTML });

    expect(host.querySelector('[data-chemistry-code]')).toBeNull();
  });

  it('масштаб формул масштабирует и структуры', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);

    viewer = createRichContent({
      element: host,
      html: '<p><span data-chemistry-code="CH_3-OH"></span></p>',
      features: [chemistryContent],
      formulaScale: 2,
    });

    const svg = host.querySelector('svg');
    const viewBoxWidth = Number(svg?.getAttribute('viewBox')?.split(' ')[2]);

    expect(Number(svg?.getAttribute('width'))).toBe(Math.round(viewBoxWidth * 2));
  });
});
