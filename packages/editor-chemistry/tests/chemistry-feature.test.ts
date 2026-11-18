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
  it('по умолчанию в диалоге конструктор без поля кода: готовая формула на полотне, вставка кладёт узел', () => {
    const editor = mountEditor();

    toolbarButton('Структурная формула').click();

    const dialog = openDialog();

    expect(dialog.querySelector('.rte-modal__title')?.textContent).toBe('Структурная формула');
    expect(dialog.querySelector('.rte-modal__panel--wide')).not.toBeNull();
    expect(dialog.querySelector('textarea')).toBeNull();
    expect(dialog.querySelector('.rte-chem-builder')).not.toBeNull();
    expect(dialog.querySelector<HTMLButtonElement>('.rte-button--primary')?.disabled).toBe(true);
    expect(dialog.querySelector<HTMLElement>('.rte-button--danger')?.hidden).toBe(true);

    dialog.querySelector<HTMLButtonElement>('button[data-code="**6(------)"]')?.click();
    expect(dialog.querySelector('.rte-chem-builder__canvas svg')).not.toBeNull();
    expect(dialog.querySelector<HTMLButtonElement>('.rte-button--primary')?.disabled).toBe(false);

    dialog.querySelector<HTMLButtonElement>('.rte-button--primary')?.click();

    expect(document.querySelector('.rte-modal:not([hidden])')).toBeNull();
    expect(editor.core.getHTML()).toContain('data-chemistry-code="**6(------)"');
  });

  it('сборка нажатиями: CH₃–CH₂–OH вставляется как код chemfig', () => {
    const editor = mountEditor();

    toolbarButton('Структурная формула').click();

    const dialog = openDialog();
    const press = (selector: string): void => {
      dialog.querySelector(selector)?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    };

    press('[data-action="start"]');
    press('button[data-group="CH_2"]');
    press('[data-plus][data-angle="0"]');
    press('button[data-group="OH"]');
    press('[data-plus][data-angle="0"]');
    dialog.querySelector<HTMLButtonElement>('.rte-button--primary')?.click();

    expect(editor.core.getHTML()).toContain('data-chemistry-code="CH_3-[:0]CH_2-[:0]OH"');
  });

  it('с code: true поле кода синхронизировано с конструктором в обе стороны', () => {
    const editor = mountEditor({ features: [createChemistryFeature({ code: true })] });

    toolbarButton('Структурная формула').click();

    const dialog = openDialog();

    expect(dialog.querySelector('details summary')?.textContent).toBe('Код chemfig');

    dialog.querySelector<HTMLButtonElement>('button[data-code="**6(------)"]')?.click();
    expect(dialog.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('**6(------)');

    typeCode(dialog, 'CH_3-CH=CH_2');
    expect(dialog.querySelector('.rte-chem-builder__canvas')?.textContent).toContain('CH₃');

    dialog.querySelector<HTMLButtonElement>('.rte-button--primary')?.click();

    expect(document.querySelector('.rte-modal:not([hidden])')).toBeNull();
    expect(editor.core.getHTML()).toContain('data-chemistry-code="CH_3-CH=CH_2"');
  });

  it('пока код в поле не разбирается: сохранить нельзя, конструктор заперт и текст не затирает', () => {
    const editor = mountEditor({ features: [createChemistryFeature({ code: true })] });

    toolbarButton('Структурная формула').click();

    const dialog = openDialog();
    const status = dialog.querySelector('.rte-chemistry-dialog__status');
    const input = dialog.querySelector<HTMLTextAreaElement>('textarea');
    const saveButton = dialog.querySelector<HTMLButtonElement>('.rte-button--primary');
    const press = (selector: string): void => {
      dialog.querySelector(selector)?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    };

    typeCode(dialog, 'CH_3-OH');
    typeCode(dialog, 'CH_3-(');

    expect(status?.textContent).toBe('Не удалось разобрать код chemfig');
    expect(status?.classList.contains('rte-chemistry-dialog__status--error')).toBe(true);
    expect(saveButton?.disabled).toBe(true);
    expect(dialog.querySelector('.rte-chem-builder')?.hasAttribute('inert')).toBe(true);

    // Нажатия в конструкторе не затирают текст в поле.
    press('[data-atom="1"]');
    press('button[data-code="**6(------)"]');
    expect(input?.value).toBe('CH_3-(');
    expect(status?.textContent).toBe('Не удалось разобрать код chemfig');

    // Ctrl+Enter в поле тоже ничего не пишет.
    input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
    expect(editor.core.getHTML()).not.toContain('data-chemistry');

    typeCode(dialog, '');
    expect(dialog.querySelector('.rte-chem-builder')?.hasAttribute('inert')).toBe(false);
    press('[data-action="start"]');
    expect(input?.value).toBe('CH_3');
    expect(saveButton?.disabled).toBe(false);
  });

  it('правка поля — шаг истории конструктора: отмена возвращает прежнюю структуру', () => {
    mountEditor({ features: [createChemistryFeature({ code: true })] });

    toolbarButton('Структурная формула').click();

    const dialog = openDialog();
    const input = dialog.querySelector<HTMLTextAreaElement>('textarea');

    typeCode(dialog, 'CH_3-OH');
    typeCode(dialog, 'CH_3-O');
    typeCode(dialog, 'CH_3-OH');
    typeCode(dialog, 'CH_3-OH ');
    dialog.querySelector('[data-action="undo"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(input?.value).toBe('CH_3-O');
  });

  it('битый код узла без поля кода: пустой конструктор, просьба собрать заново, сохранение заменяет код', () => {
    const editor = mountEditor();

    editor.core.setHTML('<p><span data-chemistry-code="A-(B"></span></p>');
    editor.element
      .querySelector<HTMLElement>('.rte-content .rte-chemistry')
      ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));

    const dialog = openDialog();

    expect(dialog.querySelector('.rte-chemistry-dialog__status')?.textContent).toBe(
      'Эту формулу не получилось открыть. Собери её заново',
    );
    expect(dialog.querySelector('[data-action="start"]')).not.toBeNull();
    expect(dialog.querySelector<HTMLButtonElement>('.rte-button--primary')?.disabled).toBe(true);

    dialog.querySelector('[data-action="start"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    dialog.querySelector<HTMLButtonElement>('.rte-button--primary')?.click();
    expect(editor.core.getHTML()).toContain('data-chemistry-code="CH_3"');
  });

  it('сохранение без правок оставляет исходный код байт в байт, правка пишет запись конструктора', () => {
    const original = 'CH_3-[::30,1.5]CH_2-OH';
    const editor = mountEditor();
    const openNode = (): HTMLElement => {
      editor.element
        .querySelector<HTMLElement>('.rte-content .rte-chemistry')
        ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));

      return openDialog();
    };
    const press = (dialog: HTMLElement, selector: string): void => {
      dialog.querySelector(selector)?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    };

    editor.core.setHTML(`<p><span data-chemistry-code="${original}"></span></p>`);

    let dialog = openNode();

    dialog.querySelector<HTMLButtonElement>('.rte-button--primary')?.click();
    expect(editor.core.getHTML()).toContain(`data-chemistry-code="${original}"`);

    // Правка и её отмена — тоже «без правок».
    dialog = openNode();
    press(dialog, '[data-atom="2"]');
    press(dialog, '[data-plus]');
    press(dialog, '[data-action="undo"]');
    dialog.querySelector<HTMLButtonElement>('.rte-button--primary')?.click();
    expect(editor.core.getHTML()).toContain(`data-chemistry-code="${original}"`);

    dialog = openNode();
    press(dialog, '[data-atom="2"]');
    press(dialog, '[data-plus][data-angle="90"]');
    dialog.querySelector<HTMLButtonElement>('.rte-button--primary')?.click();
    // Параметры связи, которые модель хранит не целиком, остаются дословно.
    expect(editor.core.getHTML()).toContain('data-chemistry-code="CH_3-[::30,1.5]CH_2-OH-[:90]CH_3"');
  });

  it('с полем кода сохранение без правок тоже оставляет исходный код', () => {
    const original = '[:30]**6(------)';
    const editor = mountEditor({ features: [createChemistryFeature({ code: true })] });

    editor.core.setHTML(`<p><span data-chemistry-code="${original}"></span></p>`);
    editor.element
      .querySelector<HTMLElement>('.rte-content .rte-chemistry')
      ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));

    openDialog().querySelector<HTMLButtonElement>('.rte-button--primary')?.click();
    expect(editor.core.getHTML()).toContain(`data-chemistry-code="${original}"`);
  });

  it('формула, которую модель не повторит без потерь, открывается только для просмотра', () => {
    const editor = mountEditor();

    editor.core.setHTML('<p><span data-chemistry-code="A*6(B-----)"></span></p>');
    editor.element
      .querySelector<HTMLElement>('.rte-content .rte-chemistry')
      ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));

    const dialog = openDialog();

    expect(dialog.querySelector('.rte-chemistry-dialog__status')?.textContent).toBe('Эту формулу здесь изменить нельзя');
    expect(dialog.querySelector('.rte-chem-builder__canvas svg')).not.toBeNull();
    expect(dialog.querySelector('.rte-chem-builder')?.hasAttribute('inert')).toBe(true);
    expect(dialog.querySelector<HTMLButtonElement>('.rte-button--primary')?.disabled).toBe(true);

    dialog.querySelector('[data-atom="0"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    dialog.querySelector('[data-action="clear"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    dialog.querySelector<HTMLButtonElement>('.rte-button--primary')?.click();
    expect(editor.core.getHTML()).toContain('data-chemistry-code="A*6(B-----)"');
  });

  it('с code: true формула только для просмотра отпирается, когда код в поле разбирается без потерь', () => {
    const editor = mountEditor({ features: [createChemistryFeature({ code: true })] });

    editor.core.setHTML('<p><span data-chemistry-code="CH_3(-OH)-*6(------)"></span></p>');
    editor.element
      .querySelector<HTMLElement>('.rte-content .rte-chemistry')
      ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));

    const dialog = openDialog();

    expect(dialog.querySelector<HTMLDetailsElement>('details')?.open).toBe(true);
    expect(dialog.querySelector<HTMLButtonElement>('.rte-button--primary')?.disabled).toBe(true);

    typeCode(dialog, '*6((-CH_3)------)');
    expect(dialog.querySelector('.rte-chem-builder')?.hasAttribute('inert')).toBe(false);
    expect(dialog.querySelector('.rte-chemistry-dialog__status')?.textContent).toBe('');
    dialog.querySelector<HTMLButtonElement>('.rte-button--primary')?.click();
    expect(editor.core.getHTML()).toContain('data-chemistry-code="*6((-CH_3)------)"');
  });

  it('с code: true нерабочий код раскрывает блок кода и ставит фокус в поле', async () => {
    const editor = mountEditor({ features: [createChemistryFeature({ code: true })] });

    editor.core.setHTML('<p><span data-chemistry-code="A-(B"></span></p>');
    editor.element
      .querySelector<HTMLElement>('.rte-content .rte-chemistry')
      ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));

    const dialog = openDialog();
    const details = dialog.querySelector<HTMLDetailsElement>('details');

    expect(details?.open).toBe(true);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(document.activeElement).toBe(dialog.querySelector('textarea'));

    typeCode(dialog, 'CH_3');
    if (details) details.open = false;
    typeCode(dialog, 'CH_3-(');
    expect(details?.open).toBe(true);
  });

  it('клик по узлу открывает диалог на правку; сохранение меняет код, удаление убирает узел', () => {
    const editor = mountEditor({ features: [createChemistryFeature({ code: true })] });

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

  it('правка узла конструктором: структура открывается на полотне, добавленный атом сохраняется', () => {
    const editor = mountEditor();

    editor.core.setHTML('<p><span data-chemistry-code="CH_3-OH"></span></p>');
    editor.element
      .querySelector<HTMLElement>('.rte-content .rte-chemistry')
      ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));

    const dialog = openDialog();
    const press = (selector: string): void => {
      dialog.querySelector(selector)?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    };

    press('[data-atom="1"]');
    press('button[data-group="CH_3"]');
    press('[data-plus][data-angle="90"]');
    dialog.querySelector<HTMLButtonElement>('.rte-button--primary')?.click();

    expect(editor.core.getHTML()).toContain('data-chemistry-code="CH_3-OH-[:90]CH_3"');
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

describe('Escape в окне структуры', () => {
  const escape = (target: Element): void => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  };

  const isOpen = (dialog: HTMLElement): boolean => !dialog.hidden;

  it('снимает выделение, без выделения окно остаётся открытым; закрывают «Отмена» и крестик', () => {
    mountEditor();
    toolbarButton('Структурная формула').click();

    let dialog = openDialog();
    const stage = dialog.querySelector<HTMLElement>('.rte-chem-builder__stage')!;

    dialog.querySelector('[data-action="start"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(dialog.querySelector('[data-plus]')).not.toBeNull();

    escape(stage);
    expect(dialog.querySelector('[data-plus]')).toBeNull();
    expect(isOpen(dialog)).toBe(true);

    escape(stage);
    escape(dialog.querySelector('.rte-modal__panel')!);
    expect(isOpen(dialog)).toBe(true);
    // Собранное не пропало.
    expect(dialog.querySelector<HTMLButtonElement>('.rte-button--primary')?.disabled).toBe(false);

    [...dialog.querySelectorAll<HTMLButtonElement>('.rte-modal__footer .rte-button')]
      .find((button) => button.textContent === 'Отмена')
      ?.click();
    expect(isOpen(dialog)).toBe(false);

    toolbarButton('Структурная формула').click();
    dialog = openDialog();
    dialog.querySelector<HTMLButtonElement>('.rte-modal__close')?.click();
    expect(isOpen(dialog)).toBe(false);
  });

  it('в поле кода Escape ничего не делает', () => {
    mountEditor({ features: [createChemistryFeature({ code: true })] });
    toolbarButton('Структурная формула').click();

    const dialog = openDialog();

    typeCode(dialog, 'CH_3-CH_2');

    const input = dialog.querySelector<HTMLTextAreaElement>('textarea')!;

    input.focus();
    escape(input);
    expect(isOpen(dialog)).toBe(true);
    expect(input.value).toBe('CH_3-CH_2');
    expect(document.activeElement).toBe(input);
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
