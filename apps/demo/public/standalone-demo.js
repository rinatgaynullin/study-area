/**
 * Страница standalone.html: редактор и вьюер из автономной сборки.
 *
 * Файл лежит в public и не проходит через Vite: импорты относительные, как
 * в Django-шаблоне или на CDN. Именно так сборку получит хост без бандлера.
 */
import { createRichEditor } from './standalone/editor.js';
import { createRichContent } from './standalone/viewer.js';

const FORMULA =
  '<math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mfrac><mi>a</mi><mi>b</mi></mfrac>' +
  '<annotation encoding="application/x-tex">\\frac{a}{b}</annotation></semantics></math>';

const viewer = createRichContent({ element: document.querySelector('#viewer') });

const editor = createRichEditor({
  element: document.querySelector('#editor'),
  content:
    '<h2>Автономная сборка</h2><p>Подключена одним <code>&lt;script type="module"&gt;</code>, ' +
    'без Vite и npm на стороне страницы.</p>' +
    `<p>Формула из MathML: <span data-formula="true" data-mathml="${FORMULA.replace(/"/g, '&quot;')}"></span></p>`,
  minHeight: '280px',
  onChange: (html) => void viewer.update({ html }),
});
void editor.core.whenFormulasReady().then(() => viewer.update({ html: editor.core.getHTML() }));

// Для проверки из тестов: даём доступ к документу.
window.standaloneEditor = editor;
