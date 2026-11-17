/**
 * Проверка того, что редактор собирается без фреймворка.
 *
 * Страница подключает только ядро: ни Vue, ни компонентов — один вызов
 * `createRichEditor`. Если она работает, значит обёртке действительно
 * достаточно смонтировать готовый интерфейс.
 */
// Стили и шрифты MathLive приезжают вместе с createRichEditor.
import { createRichEditor } from '@rich-editor/core';
// Вьюер берётся из отдельного входа: страница только для чтения не тянет TipTap.
import { createRichContent } from '@rich-editor/core/viewer';
import { createChemistryFeature } from '@rich-editor/chemistry';
import { chemistryContent } from '@rich-editor/chemistry/viewer';
import { createDrawingsFeature } from '@rich-editor/drawings';
import { drawingsContent } from '@rich-editor/drawings/viewer';
import { createOcrFeature } from '@rich-editor/ocr';
import { HTML_SAMPLES } from './samples';
import './styles.css';

const host = document.querySelector<HTMLElement>('#editor');
const viewerHost = document.querySelector<HTMLElement>('#viewer');
if (!host || !viewerHost) throw new Error('Не найдены контейнеры редактора и вьюера');

// Вьюер получает документ редактора при каждом изменении — как это делал бы
// хост, показывающий сохранённый ответ рядом с полем ввода.
const viewer = createRichContent({ element: viewerHost, features: [chemistryContent, drawingsContent] });

// Заглушка бэкенда распознавания: отдаёт текст образца вместо ответа нейросети.
const ocrFeature = createOcrFeature({
  recognize: async () => ({ text: HTML_SAMPLES.find((sample) => sample.id === 'ocr')?.html ?? '' }),
});

const drawingsFeature = createDrawingsFeature({ scans: ocrFeature.scans });

/** Редактор пересоздаётся флажком «Код chemfig»: возможности читаются при создании. */
const mountEditor = (chemistryCode: boolean, content: string): ReturnType<typeof createRichEditor> =>
  createRichEditor({
    element: host,
    content,
    minHeight: '280px',
    features: [createChemistryFeature({ code: chemistryCode }), drawingsFeature, ocrFeature],
    onChange: (html) => void viewer.update({ html }),
  });

let editor = mountEditor(false, '<h2>Ванильный редактор</h2><p>Набран <strong>без</strong> фреймворка.</p>');
void viewer.update({ html: editor.core.getHTML() });

// Для проверки из тестов: даём доступ к документу.
Object.assign(window, { vanillaEditor: editor });

const chemistryCodeToggle = document.createElement('input');
const chemistryCodeLabel = document.createElement('label');

chemistryCodeToggle.type = 'checkbox';
chemistryCodeLabel.append(chemistryCodeToggle, ' Код chemfig в диалоге структуры');
host.before(chemistryCodeLabel);
chemistryCodeToggle.addEventListener('change', () => {
  const html = editor.core.getHTML();

  editor.destroy();
  editor = mountEditor(chemistryCodeToggle.checked, html);
  Object.assign(window, { vanillaEditor: editor });
});
