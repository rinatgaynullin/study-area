import { createRichEditor, type RichEditorUi } from '@rich-editor/core';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDrawingsFeature, type DrawingsFeatureOptions, type SceneEditor, type SceneEditorFactory } from '../src';

/**
 * Escape в окне чертежа: окно не закрывается, конструктор активной вкладки
 * бросает начатое, возвращает «Выбрать» и снимает выделение; сцена остаётся.
 */

/** jsdom не знает PointerEvent — полотно слушает именно его. */
beforeAll(() => {
  if (typeof globalThis.PointerEvent === 'undefined') {
    class PointerEventPolyfill extends MouseEvent {
      readonly pointerId: number;

      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
      }
    }

    globalThis.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent;
  }
});

const mounted: Array<{ ui: RichEditorUi; host: HTMLElement }> = [];

afterEach(() => {
  mounted.splice(0).forEach(({ ui, host }) => {
    ui.destroy();
    host.remove();
  });
});

const mountEditor = (feature: DrawingsFeatureOptions = {}): RichEditorUi => {
  const host = document.createElement('div');

  document.body.appendChild(host);

  const ui = createRichEditor({ element: host, content: '<p>привет</p>', features: [createDrawingsFeature(feature)] });

  mounted.push({ ui, host });

  return ui;
};

/** Открывает окно чертежа кнопкой тулбара и возвращает его. */
const openDrawing = (): HTMLElement => {
  const button = [...document.querySelectorAll<HTMLButtonElement>('.rte-toolbar button')].find(
    (candidate) => candidate.getAttribute('aria-label') === 'Чертёж',
  );

  if (!button) throw new Error('Нет кнопки «Чертёж»');

  button.click();

  const dialog = document.querySelector<HTMLElement>('.rte-modal:not([hidden])');

  if (!dialog) throw new Error('Диалог не открыт');

  return dialog;
};

const isOpen = (dialog: HTMLElement): boolean => !dialog.hidden;

const find = <T extends Element = HTMLElement>(root: ParentNode, selector: string): T => {
  const found = root.querySelector<T>(selector);

  if (!found) throw new Error(`Нет ${selector}`);

  return found;
};

const canvasOf = (dialog: HTMLElement): HTMLElement => find(dialog, '.rte-drawing-dialog__editor .rte-sketch');

const overlayOf = (dialog: HTMLElement): Element => find(dialog, '.rte-drawing-dialog__editor .rte-sketch__overlay');

const saveButton = (dialog: HTMLElement): HTMLButtonElement => find<HTMLButtonElement>(dialog, '.rte-button--primary');

const pressedTool = (dialog: HTMLElement): string | undefined =>
  dialog.querySelector<HTMLElement>('.rte-drawing-dialog__editor button[data-tool][aria-pressed="true"]')?.dataset.tool;

const pickTab = (dialog: HTMLElement, tab: string): void => find<HTMLButtonElement>(dialog, `[data-tab="${tab}"]`).click();

const pickTool = (dialog: HTMLElement, tool: string): void =>
  find<HTMLButtonElement>(dialog, `.rte-drawing-dialog__editor button[data-tool="${tool}"]`).click();

/** Указатель в координатах полотна: в jsdom у полотна нулевой прямоугольник, клиент = viewBox. */
const pointer = (target: HTMLElement, type: 'pointerdown' | 'pointermove' | 'pointerup', [clientX, clientY]: [number, number]): void => {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, clientX, clientY, pointerId: 1 }));
};

const click = (target: HTMLElement, at: [number, number]): void => {
  pointer(target, 'pointerdown', at);
  pointer(target, 'pointerup', at);
};

/** Escape на элементе; возвращает событие — видно, отменено ли действие по умолчанию. */
const escape = (target: Element): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });

  target.dispatchEvent(event);

  return event;
};

/** Данные чертежа, вставленного в документ. */
const insertedData = (ui: RichEditorUi): string | null | undefined => {
  const html = new DOMParser().parseFromString(ui.core.getHTML(), 'text/html');
  const node = html.querySelector('[data-geometry-data], [data-physics-data]');

  return node?.getAttribute('data-geometry-data') ?? node?.getAttribute('data-physics-data');
};

/**
 * Начинает построение на вкладке, при `withEscape` жмёт Escape и проверяет
 * общее: окно открыто, нажат «Выбрать», черновика нет, «Вставить» прежняя;
 * потом вставляет и отдаёт данные. Тот же сценарий без Escape — эталон сцены.
 */
const runTab = (tab: string, act: (dialog: HTMLElement) => void, withEscape: boolean): string | null | undefined => {
  const ui = mountEditor();
  const dialog = openDrawing();

  pickTab(dialog, tab);
  act(dialog);

  if (withEscape) {
    const saveDisabled = saveButton(dialog).disabled;

    escape(canvasOf(dialog));
    expect(isOpen(dialog)).toBe(true);
    expect(pressedTool(dialog)).toBe('select');
    expect(overlayOf(dialog).childElementCount).toBe(0);
    expect(saveButton(dialog).disabled).toBe(saveDisabled);
  }

  saveButton(dialog).click();

  const data = insertedData(ui);

  mounted.splice(0).forEach((entry) => {
    entry.ui.destroy();
    entry.host.remove();
  });

  return data;
};

describe('Escape в окне чертежа', () => {
  it('планиметрия: «Отрезок» с первой точкой — черновик сброшен, «Выбрать» нажат, сцена та же', () => {
    const act = (dialog: HTMLElement): void => {
      pickTool(dialog, 'segment');
      click(canvasOf(dialog), [200, 150]);
      click(canvasOf(dialog), [320, 150]);
      click(canvasOf(dialog), [320, 250]);
      expect(overlayOf(dialog).childElementCount).toBeGreaterThan(0);
    };
    const expected = runTab('planimetry', act, false);

    expect(expected).toContain('"vertices"');
    expect(runTab('planimetry', act, true)).toBe(expected);
  });

  it('стереометрия: «Отрезок» с первой точкой — черновик сброшен, сцена та же', () => {
    const act = (dialog: HTMLElement): void => {
      pickTool(dialog, 'point');
      click(canvasOf(dialog), [200, 200]);
      click(canvasOf(dialog), [300, 200]);
      pickTool(dialog, 'segment');
      click(canvasOf(dialog), [250, 300]);
      expect(overlayOf(dialog).childElementCount).toBeGreaterThan(0);
    };
    const expected = runTab('stereometry', act, false);

    expect(expected).toContain('"vertices"');
    expect(runTab('stereometry', act, true)).toBe(expected);
  });

  it('графики: недорисованный штрих карандаша пропадает, график не появляется', () => {
    const template = (dialog: HTMLElement): void => find<HTMLButtonElement>(dialog, 'button[data-plot-template]').click();
    const expected = runTab('plots', template, false);
    const ui = mountEditor();
    const dialog = openDrawing();

    pickTab(dialog, 'plots');
    template(dialog);
    pickTool(dialog, 'pencil');
    pointer(canvasOf(dialog), 'pointerdown', [100, 100]);
    pointer(canvasOf(dialog), 'pointermove', [160, 140]);
    pointer(canvasOf(dialog), 'pointermove', [220, 200]);
    expect(overlayOf(dialog).querySelector('polyline')).not.toBeNull();

    escape(canvasOf(dialog));
    expect(isOpen(dialog)).toBe(true);
    expect(pressedTool(dialog)).toBe('select');
    expect(overlayOf(dialog).childElementCount).toBe(0);
    // Кнопку отпустили уже после Escape — штрих не превращается в график.
    pointer(canvasOf(dialog), 'pointerup', [220, 200]);
    saveButton(dialog).click();
    expect(insertedData(ui)).toBe(expected);
  });

  it('графики: черновик области штриховки сброшен', () => {
    const act = (dialog: HTMLElement): void => {
      find<HTMLButtonElement>(dialog, 'button[data-plot-template]').click();
      pickTool(dialog, 'shading');
      click(canvasOf(dialog), [100, 100]);
      click(canvasOf(dialog), [200, 100]);
    };
    const expected = runTab('plots', act, false);

    expect(runTab('plots', act, true)).toBe(expected);
  });

  it('физика: выбран «Удалить» и элемент — Escape снимает выделение и возвращает «Выбрать»', () => {
    const act = (dialog: HTMLElement): void => {
      find<HTMLButtonElement>(dialog, '.rte-builder__palette button[data-element]').click();
      pickTool(dialog, 'delete');
    };
    const expected = runTab('physics', act, false);

    expect(expected).toContain('"elements"');
    expect(runTab('physics', act, true)).toBe(expected);

    mountEditor();

    const dialog = openDrawing();

    pickTab(dialog, 'physics');
    find<HTMLButtonElement>(dialog, '.rte-builder__palette button[data-element]').click();
    expect(dialog.querySelector('.rte-builder__props-empty')).toBeNull();
    escape(canvasOf(dialog));
    expect(dialog.querySelector('.rte-builder__props-empty')).not.toBeNull();
    expect(isOpen(dialog)).toBe(true);
  });

  it('выделенная точка: Escape снимает выделение, повторный — ничего не меняет', () => {
    mountEditor();

    const dialog = openDrawing();

    pickTool(dialog, 'point');
    click(canvasOf(dialog), [200, 150]);
    pickTool(dialog, 'select');
    click(canvasOf(dialog), [200, 150]);
    expect(dialog.querySelector('.rte-builder__props input')).not.toBeNull();

    escape(canvasOf(dialog));
    expect(dialog.querySelector('.rte-builder__props input')).toBeNull();
    expect(pressedTool(dialog)).toBe('select');

    const props = find(dialog, '.rte-builder__props').innerHTML;

    escape(canvasOf(dialog));
    expect(find(dialog, '.rte-builder__props').innerHTML).toBe(props);
    expect(isOpen(dialog)).toBe(true);
  });

  it('Escape на кнопке инструмента и на вкладке — то же, фокус возвращается на полотно', () => {
    mountEditor();

    const dialog = openDrawing();
    const segment = find<HTMLButtonElement>(dialog, '.rte-drawing-dialog__editor button[data-tool="segment"]');

    segment.click();
    click(canvasOf(dialog), [200, 150]);
    segment.focus();
    expect(escape(segment).defaultPrevented).toBe(true);
    expect(isOpen(dialog)).toBe(true);
    expect(pressedTool(dialog)).toBe('select');
    expect(overlayOf(dialog).childElementCount).toBe(0);
    expect(document.activeElement).toBe(canvasOf(dialog));

    pickTool(dialog, 'circle');

    const tab = find<HTMLButtonElement>(dialog, '[data-tab="planimetry"]');

    tab.focus();
    escape(tab);
    expect(pressedTool(dialog)).toBe('select');
    expect(document.activeElement).toBe(canvasOf(dialog));
  });

  it('Escape в поле свойств: недописанное значение не применяется, фокус на полотне', () => {
    const ui = mountEditor();
    const dialog = openDrawing();

    pickTool(dialog, 'point');
    click(canvasOf(dialog), [200, 150]);
    pickTool(dialog, 'select');
    click(canvasOf(dialog), [200, 150]);

    const name = find<HTMLInputElement>(dialog, '.rte-builder__props input[type="text"]');
    const before = name.value;

    name.focus();
    name.value = 'Q';
    escape(name);
    expect(isOpen(dialog)).toBe(true);
    expect(document.activeElement).toBe(canvasOf(dialog));
    expect(dialog.querySelector('.rte-builder__props input')).toBeNull();
    // Браузер пришлёт `change`, когда поле потеряет фокус: значение уже прежнее.
    expect(name.value).toBe(before);
    name.dispatchEvent(new Event('change', { bubbles: true }));

    saveButton(dialog).click();
    expect(insertedData(ui)).toContain(`"${before}"`);
    expect(insertedData(ui)).not.toContain('"Q"');
  });

  it('рисунок переживает Escape: три нажатия, «Вставить» отдаёт тот же рисунок', () => {
    const act = (dialog: HTMLElement): void => {
      pickTool(dialog, 'segment');
      click(canvasOf(dialog), [200, 150]);
      click(canvasOf(dialog), [320, 150]);
    };
    const expected = runTab('planimetry', act, false);
    const ui = mountEditor();
    const dialog = openDrawing();

    act(dialog);
    escape(canvasOf(dialog));
    escape(find(dialog, '.rte-drawing-dialog__editor button[data-tool="point"]'));
    escape(find(dialog, '.rte-modal__panel'));
    expect(isOpen(dialog)).toBe(true);
    saveButton(dialog).click();
    expect(insertedData(ui)).toBe(expected);
  });

  it('вкладка JSON: Escape ничего не меняет, окно открыто', () => {
    mountEditor({ json: true });

    const dialog = openDrawing();

    pickTab(dialog, 'json');

    const input = find<HTMLTextAreaElement>(dialog, 'textarea:not([readonly])');

    input.focus();
    input.value = '{"type":"2d"';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    const event = escape(input);

    expect(event.defaultPrevented).toBe(false);
    expect(isOpen(dialog)).toBe(true);
    expect(input.value).toBe('{"type":"2d"');
    expect(document.activeElement).toBe(input);
  });

  it('закрывают окно «Отмена» и крестик', () => {
    mountEditor();

    let dialog = openDrawing();

    escape(canvasOf(dialog));
    expect(isOpen(dialog)).toBe(true);
    [...dialog.querySelectorAll<HTMLButtonElement>('.rte-modal__footer .rte-button')]
      .find((button) => button.textContent === 'Отмена')
      ?.click();
    expect(isOpen(dialog)).toBe(false);

    dialog = openDrawing();
    find<HTMLButtonElement>(dialog, '.rte-modal__close').click();
    expect(isOpen(dialog)).toBe(false);
  });

  it('cancel() активной вкладки зовётся ровно один раз, где бы ни нажали Escape', () => {
    const cancel = vi.fn();
    const focus = vi.fn();
    const canvas = document.createElement('div');
    const button = document.createElement('button');

    canvas.tabIndex = 0;
    // Полотно, как у встроенных конструкторов, отменяет само и помечает событие.
    canvas.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;

      event.preventDefault();
      cancel();
    });

    const factory: SceneEditorFactory = {
      id: 'fake',
      kind: 'geometry',
      labelKey: 'drawings_tab_planimetry',
      accepts: () => true,
      create: (): SceneEditor => {
        const element = document.createElement('div');

        element.append(button, canvas);

        return { element, load: () => {}, getScene: () => ({}), onChange: () => () => {}, focus, cancel, destroy: () => element.remove() };
      },
    };

    mountEditor({ editors: [factory] });

    const dialog = openDrawing();

    focus.mockClear();
    escape(button);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalledTimes(1);

    escape(canvas);
    expect(cancel).toHaveBeenCalledTimes(2);
    escape(find(dialog, '.rte-modal__footer .rte-button'));
    expect(cancel).toHaveBeenCalledTimes(3);
    expect(isOpen(dialog)).toBe(true);
  });
});
