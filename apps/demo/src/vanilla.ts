/**
 * Проверка того, что редактор собирается без фреймворка.
 *
 * Страница подключает только ядро: ни Vue, ни компонентов — один вызов
 * `createRichEditor`. Если она работает, значит обёртке действительно
 * достаточно смонтировать готовый интерфейс.
 */
import 'mathlive/fonts.css';
import '@rich-editor/core/styles.css';
import { createRichContent, createRichEditor } from '@rich-editor/core';
import { GEOMETRY_MESSAGES, geometryFeature, hydrateGeometry } from '@rich-editor/geometry';
import './styles.css';

const host = document.querySelector<HTMLElement>('#editor');
const viewerHost = document.querySelector<HTMLElement>('#viewer');
if (!host || !viewerHost) throw new Error('Не найдены контейнеры редактора и вьюера');

// Вьюер получает документ редактора при каждом изменении — как это делал бы
// хост, показывающий сохранённый ответ рядом с полем ввода. Доски геометрии
// вьюер не знает: после рендера их поднимает хост.
const viewer = createRichContent({ element: viewerHost });
let disposeGeometry: (() => void) | null = null;

const showInViewer = (html: string): void => {
  void viewer.update({ html }).then(() => {
    disposeGeometry?.();
    disposeGeometry = hydrateGeometry(viewerHost);
  });
};

const editor = createRichEditor({
  element: host,
  content: '<h2>Ванильный редактор</h2><p>Набран <strong>без</strong> фреймворка.</p>',
  minHeight: '280px',
  // Геометрия на JSXGraph подключается как возможность; подписи — через messages.
  features: [geometryFeature()],
  messages: GEOMETRY_MESSAGES,
  onChange: showInViewer,
});
showInViewer(editor.core.getHTML());

// Для проверки из тестов: даём доступ к документу.
Object.assign(window, { vanillaEditor: editor });
