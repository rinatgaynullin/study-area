import * as viewer from '../src/viewer';

/**
 * Вход вьюера — публичная поверхность для хостов без редактора: отдаёт вьюер,
 * тему и подготовку HTML, но не редактор. Отсутствие TipTap в его сборке
 * сторожит scripts/check-viewer.mjs.
 */
describe('вход @rich-editor/core/viewer', () => {
  it('отдаёт вьюер, тему и подготовку HTML, но не редактор', () => {
    expect(typeof viewer.createRichContent).toBe('function');
    expect(typeof viewer.applyTheme).toBe('function');
    expect(typeof viewer.prepareIncomingHtml).toBe('function');
    expect(typeof viewer.sanitizeHtml).toBe('function');
    expect(typeof viewer.renderMathML).toBe('function');
    expect('createRichEditor' in viewer).toBe(false);
    expect('RichEditorCore' in viewer).toBe(false);
  });

  it('рендерит документ через санитайзер', async () => {
    const element = document.createElement('div');

    document.body.appendChild(element);

    const content = viewer.createRichContent({
      element,
      html: '<p>Текст<script>alert(1)</script></p>',
    });

    await viewer.whenFormulasReady();

    expect(element.querySelector('p')?.textContent).toBe('Текст');
    expect(element.querySelector('script')).toBeNull();

    content.destroy();
    element.remove();
  });
});
