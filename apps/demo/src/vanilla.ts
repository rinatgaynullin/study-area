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

/** Флажки разработчика: вкладка JSON в диалоге чертежа и поле кода chemfig. */
interface DevOptions {
  json: boolean;
  chemistryCode: boolean;
}

/**
 * Редактор собирается заново, когда меняется флажок разработчика: возможности
 * читаются один раз при создании. Документ переезжает в новый экземпляр.
 */
const mountEditor = (content: string, dev: DevOptions): RichEditorUi =>
  createRichEditor({
    element: host,
    content,
    minHeight: '280px',
    features: [
      createChemistryFeature({ code: dev.chemistryCode }),
      createDrawingsFeature({ scans: ocrFeature.scans, json: dev.json }),
      ocrFeature,
    ],
    onChange: (html) => void viewer.update({ html }),
  });

let editor = mountEditor('<h2>Ванильный редактор</h2><p>Набран <strong>без</strong> фреймворка.</p>', {
  json: false,
  chemistryCode: false,
});
void viewer.update({ html: editor.core.getHTML() });

// Для проверки из тестов: даём доступ к документу.
Object.assign(window, { vanillaEditor: editor });

/** Флажок разработчика над редактором. */
const devToggle = (label: string): HTMLInputElement => {
  const input = document.createElement('input');
  const wrapper = document.createElement('label');

  input.type = 'checkbox';
  wrapper.className = 'demo__check';
  wrapper.append(input, ` ${label}`);
  host.before(wrapper);

  return input;
};

// Вкладка JSON, образцы и TikZ в диалоге чертежа — инструменты разработчика.
const jsonToggle = devToggle('JSON в диалоге чертежа');
const chemistryCodeToggle = devToggle('Код chemfig в диалоге структуры');

const remountEditor = (): void => {
  const content = editor.core.getHTML();

  editor.destroy();
  editor = mountEditor(content, { json: jsonToggle.checked, chemistryCode: chemistryCodeToggle.checked });
  Object.assign(window, { vanillaEditor: editor });
};

jsonToggle.addEventListener('change', remountEditor);
chemistryCodeToggle.addEventListener('change', remountEditor);
