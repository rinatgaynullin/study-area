/**
 * Проверка того, что редактор собирается без фреймворка.
 *
 * Страница подключает только ядро: ни Vue, ни компонентов — один вызов
 * `createRichEditor`. Если она работает, значит обёртке действительно
 * достаточно смонтировать готовый интерфейс.
 */
// Стили и шрифты MathLive приезжают вместе с createRichEditor.
import { createRichEditor, type RichEditorUi } from '@rich-editor/core';
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

/**
 * Редактор собирается заново, когда меняется флажок JSON: возможности
 * читаются один раз при создании. Документ переезжает в новый экземпляр.
 */
const mountEditor = (content: string, json: boolean): RichEditorUi =>
  createRichEditor({
    element: host,
    content,
    minHeight: '280px',
    features: [createChemistryFeature(), createDrawingsFeature({ scans: ocrFeature.scans, json }), ocrFeature],
    onChange: (html) => void viewer.update({ html }),
  });

let editor = mountEditor('<h2>Ванильный редактор</h2><p>Набран <strong>без</strong> фреймворка.</p>', false);
void viewer.update({ html: editor.core.getHTML() });

// Для проверки из тестов: даём доступ к документу.
Object.assign(window, { vanillaEditor: editor });

// Вкладка JSON, образцы и TikZ в диалоге чертежа — инструменты разработчика.
const jsonToggle = document.createElement('input');

jsonToggle.type = 'checkbox';

const jsonLabel = document.createElement('label');

jsonLabel.className = 'demo__check';
jsonLabel.append(jsonToggle, ' JSON в диалоге чертежа');
host.before(jsonLabel);

jsonToggle.addEventListener('change', () => {
  const content = editor.core.getHTML();

  editor.destroy();
  editor = mountEditor(content, jsonToggle.checked);
  Object.assign(window, { vanillaEditor: editor });
});
