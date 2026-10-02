import { RichEditorCore, sanitizeHtml } from '@rich-editor/core';
import { GeometryNode } from '../src/geometry-node';

const SCRIPT = "A = point(1, 2) << name: 'A' >>;";

describe('узел geometry', () => {
  it('санитайзер пропускает атрибуты построения', () => {
    const html = `<div data-geometry="${SCRIPT}" data-bbox="-5 5 5 -5" data-height="240">x</div>`;

    expect(sanitizeHtml(html)).toContain('data-geometry=');
    expect(sanitizeHtml(html)).toContain('data-bbox="-5 5 5 -5"');
    expect(sanitizeHtml(html)).toContain('data-height="240"');
  });

  it('читает div[data-geometry] и экспортирует его обратно с теми же атрибутами', () => {
    const element = document.createElement('div');

    document.body.appendChild(element);

    const core = new RichEditorCore({
      element,
      content: `<p>До</p><div data-geometry="${SCRIPT}" data-bbox="-3 2 3 -2" data-height="200"></div><p>После</p>`,
      extensions: [GeometryNode.configure({ t: (key: string) => key })],
    });

    const html = core.getHTML();

    expect(html).toContain(`data-geometry="${SCRIPT}"`);
    expect(html).toContain('data-bbox="-3 2 3 -2"');
    expect(html).toContain('data-height="200"');
    expect(html).toContain('class="rte-geometry"');
    expect(html).toContain('role="img"');

    core.destroy();
    element.remove();
  });

  it('insertGeometry добавляет узел с границами по умолчанию', () => {
    const element = document.createElement('div');

    document.body.appendChild(element);

    const core = new RichEditorCore({
      element,
      content: '<p></p>',
      extensions: [GeometryNode.configure({ t: (key: string) => key })],
    });

    core.editor.commands.insertGeometry({ script: SCRIPT });

    expect(core.getHTML()).toContain('data-bbox="-6 5 6 -5"');
    expect(core.getHTML()).toContain('data-height="320"');

    core.destroy();
    element.remove();
  });
});

describe('состояние узла geometry', () => {
  const STATE_HTML = `<div data-geometry="${SCRIPT}" data-geometry-state='{"a":{"value":2},"Q":{"coords":[1,-1]},"bad":5,"worse":{"coords":["x"]}}'></div>`;

  const mountCore = (content: string) => {
    const element = document.createElement('div');

    document.body.appendChild(element);

    return new RichEditorCore({
      element,
      content,
      extensions: [GeometryNode.configure({ t: (key: string) => key })],
    });
  };

  it('читает data-geometry-state и отбрасывает мусор', () => {
    const core = mountCore(STATE_HTML);
    const attrs = core.editor.state.doc.firstChild?.attrs;

    expect(attrs?.state).toEqual({ a: { value: 2 }, Q: { coords: [1, -1] } });
    expect(core.getHTML()).toContain('data-geometry-state=');
    expect(core.getHTML()).not.toContain('bad');

    core.destroy();
  });

  it('без сдвигов атрибут состояния в HTML не пишется', () => {
    const core = mountCore(`<div data-geometry="${SCRIPT}"></div>`);

    expect(core.getHTML()).not.toContain('data-geometry-state');

    core.destroy();
  });

  it('санитайзер пропускает data-geometry-state', () => {
    expect(sanitizeHtml(STATE_HTML)).toContain('data-geometry-state=');
  });
});
