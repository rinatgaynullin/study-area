import { afterEach, describe, expect, it } from 'vitest';
import { RichEditorCore, prepareIncomingHtml, sanitizeHtml, sanitizeSvg } from '../src';

describe('HTML sanitization', () => {
  it('removes script tags and their contents', () => {
    const output = sanitizeHtml('<p>ok</p><script>alert(1)</script>');

    expect(output).toContain('<p>ok</p>');
    expect(output).not.toContain('alert');
    expect(output.toLowerCase()).not.toContain('<script');
  });

  it('strips inline event handlers', () => {
    for (const hostile of [
      '<img src="x" onerror="alert(1)">',
      '<div onclick="alert(1)">text</div>',
      '<p onmouseover="alert(1)">text</p>',
      '<body onload="alert(1)"><p>text</p></body>',
    ]) {
      const output = sanitizeHtml(hostile);
      expect(output).not.toMatch(/on\w+\s*=/i);
      expect(output).not.toContain('alert');
    }
  });

  it('rejects dangerous URL schemes in links', () => {
    for (const scheme of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
      'vbscript:msgbox(1)',
    ]) {
      const output = sanitizeHtml(`<a href="${scheme}">link</a>`);
      expect(output).not.toContain(scheme);
      expect(output).not.toMatch(/javascript:|vbscript:|data:text\/html/i);
    }
  });

  it('keeps safe link schemes and forces rel on new-tab links', () => {
    expect(sanitizeHtml('<a href="https://example.com">x</a>')).toContain('https://example.com');
    expect(sanitizeHtml('<a href="mailto:a@b.c">x</a>')).toContain('mailto:a@b.c');
    expect(sanitizeHtml('<a href="/relative">x</a>')).toContain('/relative');

    const newTab = sanitizeHtml('<a href="https://example.com" target="_blank">x</a>');
    expect(newTab).toContain('rel="noopener noreferrer"');
  });

  it('allows blob and image data URLs on media, but not on links', () => {
    expect(sanitizeHtml('<img src="blob:http://localhost/abc">')).toContain('blob:');
    expect(sanitizeHtml('<img src="data:image/png;base64,iVBORw0KGgo=">')).toContain('data:image/png');
    expect(sanitizeHtml('<a href="data:image/png;base64,iVBORw0KGgo=">x</a>')).not.toContain('data:');
  });

  it('drops iframes, objects and form controls', () => {
    const output = sanitizeHtml(
      '<iframe src="https://evil.test"></iframe><object data="x"></object><form><input name="a"></form>',
    );

    expect(output).not.toContain('<iframe');
    expect(output).not.toContain('<object');
    expect(output).not.toContain('<input');
  });

  it('strips CSS that can fetch or execute', () => {
    const output = sanitizeHtml(
      '<p style="color: red; background: url(javascript:alert(1)); width: expression(alert(1))">x</p>',
    );

    expect(output).toContain('color: red');
    expect(output).not.toContain('url(');
    expect(output).not.toContain('expression');
  });

  it('keeps embedded MathJax SVG but strips the dangerous parts of it', () => {
    const output = sanitizeHtml(
      '<span data-formula="true"><svg viewBox="0 0 10 10"><defs><path id="g" d="M0 0"/></defs>' +
        '<use xlink:href="#g"/><use xlink:href="https://evil.test/x.svg#g"/>' +
        '<script>alert(1)</script></svg></span>',
    );

    expect(output).toContain('<svg');
    expect(output).toContain('<use');
    expect(output).toContain('#g');
    expect(output).not.toContain('evil.test');
    expect(output).not.toContain('alert');
  });

  it('blocks script smuggled through SVG event handlers', () => {
    const output = sanitizeHtml('<svg onload="alert(1)"><rect onclick="alert(1)"/></svg>');

    expect(output).not.toMatch(/on\w+\s*=/i);
    expect(output).not.toContain('alert');
  });

  it('survives the MathML mXSS payload shape', () => {
    const output = prepareIncomingHtml(
      '<math><annotation-xml encoding="text/html"><img src=x onerror=alert(1)></annotation-xml></math>',
    );

    expect(output).not.toContain('onerror');
    expect(output).not.toContain('annotation-xml');
  });
});

describe('SVG sanitization', () => {
  it('removes scripts and external references from SVG', () => {
    const output = sanitizeSvg(
      '<svg><script>alert(1)</script><use xlink:href="https://evil.test/x.svg#a"/><image href="https://evil.test/x.png"/></svg>',
    );

    expect(output).not.toContain('alert');
    expect(output).not.toContain('evil.test');
    expect(output).not.toContain('<image');
  });

  it('keeps local glyph references MathJax depends on', () => {
    const output = sanitizeSvg(
      '<svg viewBox="0 0 10 10"><defs><path id="g1" d="M0 0"/></defs><use xlink:href="#g1"/></svg>',
    );

    expect(output).toContain('<use');
    expect(output).toContain('#g1');
    expect(output).toContain('viewBox');
  });
});

describe('sanitization through the editor', () => {
  let core: RichEditorCore | undefined;
  let element: HTMLElement | undefined;

  afterEach(() => {
    core?.destroy();
    element?.remove();
    core = undefined;
    element = undefined;
  });

  function mount(content: string) {
    element = document.createElement('div');
    document.body.appendChild(element);
    core = new RichEditorCore({ element, content });
    return core;
  }

  it('never lets malicious content into the document on setHTML', () => {
    const editor = mount('');
    editor.setHTML('<p>safe</p><script>alert(1)</script><img src=x onerror="alert(1)">');
    const html = editor.getHTML();

    expect(html).toContain('safe');
    expect(html).not.toContain('alert');
    expect(html).not.toMatch(/on\w+=/i);
  });

  it('sanitizes content supplied at construction time', () => {
    const editor = mount('<p onclick="alert(1)">hello</p>');

    expect(editor.getHTML()).toContain('hello');
    expect(editor.getHTML()).not.toContain('onclick');
  });
});
