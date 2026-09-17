/**
 * Проверка того, что редактор собирается без фреймворка.
 *
 * Страница подключает только ядро: ни Vue, ни компонентов — один вызов
 * `createRichEditor`. Если она работает, значит обёртке действительно
 * достаточно смонтировать готовый интерфейс.
 */
import 'mathlive/fonts.css';
import '@rich-editor/core/styles.css';
import { createRichEditor } from '@rich-editor/core';
import './styles.css';

const host = document.querySelector<HTMLElement>('#editor');
if (!host) throw new Error('Не найден контейнер редактора');

const editor = createRichEditor({
  element: host,
  content: '<h2>Ванильный редактор</h2><p>Набран <strong>без</strong> фреймворка.</p>',
  minHeight: '280px',
});

// Для проверки из тестов: даём доступ к документу.
Object.assign(window, { vanillaEditor: editor });
