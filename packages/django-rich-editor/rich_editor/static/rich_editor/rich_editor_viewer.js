/**
 * Вьюер сохранённых документов на страницах без редактора.
 *
 * `{% rich_content html %}` рендерит документ в `<div data-rich-content>`.
 * Скрипт нужен не всегда: формулы, экспортированные редактором, несут свой
 * SVG, а тёмная тема включается классом. Он дорисовывает формулы, пришедшие
 * без SVG, и следует за темой админки.
 */
import { createRichContent } from './viewer.js';

function resolveTheme() {
  const admin = document.documentElement.dataset.theme;
  return admin === 'dark' || admin === 'light' ? admin : 'auto';
}

export function render(root = document) {
  for (const element of root.querySelectorAll('[data-rich-content]')) {
    if (element.dataset.richContentReady) continue;
    element.dataset.richContentReady = 'true';
    createRichContent({
      element,
      html: element.innerHTML,
      legacy: element.hasAttribute('data-legacy'),
      theme: resolveTheme(),
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => render());
} else {
  render();
}

window.richContent = { render };
