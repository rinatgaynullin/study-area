import { createRichEditor, type RichEditorError, type RichEditorUi } from '@rich-editor/core';
import { createChemistryFeature } from '@rich-editor/chemistry';
import { createDrawingsFeature } from '@rich-editor/drawings';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createOcrFeature, type OcrFeature, type RecognizeAdapter } from '../src';

const OCR_TEXT = `# Решение

\\chemfig{CH_3-CH_2-CH_3} и $x^2$
<<<TIKZ_START>>>
\\begin{tikzpicture}\\end{tikzpicture}
<<<TIKZ_END>>>
<<<DATA_START>>>
{"type":"2d","vertices":{"A":[0,0],"B":[4,0],"C":[0,3]},"edges":[["A","B"],["B","C"],["C","A"]]}
<<<DATA_END>>>
Ответ: ~~12~~ 15.`;

let ui: RichEditorUi | undefined;
let host: HTMLElement | undefined;

beforeAll(() => {
  // jsdom не умеет blob-адреса: локальные снимки для панели сканов получают заглушку.
  if (typeof URL.createObjectURL !== 'function') {
    let counter = 0;

    Object.defineProperty(URL, 'createObjectURL', { writable: true, value: () => `blob:scan-${++counter}` });
    Object.defineProperty(URL, 'revokeObjectURL', { writable: true, value: () => undefined });
  }
});

afterEach(() => {
  ui?.destroy();
  ui = undefined;
  host?.remove();
  host = undefined;
});

const image = (name = 'scan.png', size = 10): File =>
  new File([new Uint8Array(size)], name, { type: 'image/png' });

const mountEditor = (
  ocr: OcrFeature,
  options: Record<string, unknown> = {},
): { ui: RichEditorUi; errors: RichEditorError[] } => {
  const errors: RichEditorError[] = [];

  host = document.createElement('div');
  document.body.appendChild(host);
  ui = createRichEditor({
    element: host,
    content: '<p>привет</p>',
    features: [createChemistryFeature(), createDrawingsFeature({ scans: ocr.scans }), ocr],
    onError: (error) => errors.push(error),
    ...options,
  });

  return { ui, errors };
};

const toolbarButton = (label: string): HTMLButtonElement | undefined =>
  [...document.querySelectorAll<HTMLButtonElement>('.rte-toolbar button')].find(
    (button) => button.getAttribute('aria-label') === label,
  );

const pickFiles = (files: File[]): void => {
  const input = document.querySelector<HTMLInputElement>('.rte-ocr-input');

  if (!input) throw new Error('Нет поля выбора снимков');

  Object.defineProperty(input, 'files', { value: files, configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
};

const statusText = (): string => document.querySelector('.rte-status')?.textContent ?? '';

describe('возможность «Распознать фото»', () => {
  it('кнопка тулбара открывает выбор снимков, результат адаптера встаёт в документ узлами', async () => {
    const recognize = vi.fn<RecognizeAdapter>(async (files) => ({
      text: OCR_TEXT,
      scans: files.map((file) => `https://cdn.example/${file.name}`),
    }));
    const ocr = createOcrFeature({ recognize, subject: 'math' });
    const { ui: editor, errors } = mountEditor(ocr);

    const button = toolbarButton('Распознать фото');

    expect(button).toBeDefined();

    const input = document.querySelector<HTMLInputElement>('.rte-ocr-input');

    expect(input?.accept).toBe('image/*');
    expect(input?.multiple).toBe(true);

    pickFiles([image('a.png'), image('b.png')]);

    await vi.waitFor(() => expect(editor.core.getHTML()).toContain('data-chemistry-code'));

    expect(recognize).toHaveBeenCalledTimes(1);
    expect(recognize.mock.calls[0][0].map((file) => file.name)).toEqual(['a.png', 'b.png']);
    expect(recognize.mock.calls[0][1].subject).toBe('math');

    const html = editor.core.getHTML();

    expect(html).toContain('<h1>Решение</h1>');
    expect(html).toContain('<p>привет</p>');
    expect(html).toContain('data-geometry-data');
    expect(html).toContain('<s>12</s>');
    expect(errors).toEqual([]);
    // Снимки хоста — для панели сканов в конструкторе чертежей.
    expect(ocr.scans()).toEqual(['https://cdn.example/a.png', 'https://cdn.example/b.png']);
  });

  it('пока бэкенд думает, строка статуса занята; без адресов от хоста сканы — локальные', async () => {
    let finish: (text: string) => void = () => undefined;
    const recognize: RecognizeAdapter = () =>
      new Promise((resolve) => {
        finish = (text) => resolve({ text });
      });
    const ocr = createOcrFeature({ recognize });

    mountEditor(ocr);
    pickFiles([image()]);

    await vi.waitFor(() => expect(statusText()).toBe('Распознаём фото…'));

    finish('Готово');

    await vi.waitFor(() => expect(statusText()).toBe(''));

    expect(ui?.core.getHTML()).toContain('<p>Готово</p>');
    expect(ocr.scans()).toEqual([expect.stringMatching(/^blob:/)]);
  });

  it('ошибка адаптера приходит хосту с кодом recognize-failed, документ не меняется', async () => {
    const ocr = createOcrFeature({
      recognize: () => Promise.reject(new Error('backend down')),
    });
    const { ui: editor, errors } = mountEditor(ocr);

    pickFiles([image()]);

    await vi.waitFor(() => expect(errors).toHaveLength(1));

    expect(errors[0].code).toBe('recognize-failed');
    expect(errors[0].message).toBe('Не удалось распознать фото.');
    expect(statusText()).toBe('Не удалось распознать фото.');
    expect(editor.core.getHTML()).toBe('<p>привет</p>');
  });

  it('пустой ответ, лишние и неподходящие файлы отклоняются до вызова адаптера', async () => {
    const recognize = vi.fn<RecognizeAdapter>(async () => ({ text: '   ' }));
    const ocr = createOcrFeature({ recognize, maxFiles: 2 });
    const { errors } = mountEditor(ocr, { limits: { maxImageSizeBytes: 100 } });

    pickFiles([image('1.png'), image('2.png'), image('3.png')]);
    pickFiles([new File(['x'], 'notes.txt', { type: 'text/plain' })]);
    pickFiles([image('big.png', 200)]);

    expect(recognize).not.toHaveBeenCalled();
    expect(errors.map((error) => error.code)).toEqual(['recognize-failed', 'unsupported-type', 'file-too-large']);
    expect(errors[0].message).toBe('Не больше 2 фото за раз.');

    pickFiles([image()]);

    await vi.waitFor(() => expect(errors).toHaveLength(4));

    expect(errors[3].message).toBe('Распознавание не вернуло текст.');
  });

  it('replace: результат заменяет документ; recognize() работает без кнопки и диалога', async () => {
    const ocr = createOcrFeature({
      recognize: async () => ({ text: 'Только это' }),
      replace: true,
      toolbarItem: false,
    });
    const { ui: editor } = mountEditor(ocr);

    expect(toolbarButton('Распознать фото')).toBeUndefined();
    await expect(ocr.recognize([image()])).resolves.toBe(true);
    expect(editor.core.getHTML()).toBe('<p>Только это</p>');
    await expect(ocr.recognize([])).resolves.toBe(false);
  });

  it('после уничтожения редактора поздний ответ адаптера никуда не вставляется', async () => {
    let finish: () => void = () => undefined;
    const ocr = createOcrFeature({
      recognize: () =>
        new Promise((resolve) => {
          finish = () => resolve({ text: 'поздно' });
        }),
    });
    const { ui: editor, errors } = mountEditor(ocr);
    const pending = ocr.recognize([image()]);

    editor.destroy();
    ui = undefined;
    finish();

    await expect(pending).resolves.toBe(false);
    expect(errors).toEqual([]);
    expect(ocr.scans()).toEqual([]);
  });
});
