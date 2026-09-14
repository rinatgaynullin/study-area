import { mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import { latexToMathML, RichContent } from '../src';

let wrapper: VueWrapper | undefined;

afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
});

async function mountContent(html: string, props: Record<string, unknown> = {}) {
  wrapper = mount(RichContent, { props: { html, ...props }, attachTo: document.body });
  await nextTick();
  await (wrapper.vm as unknown as { renderPendingFormulas(): Promise<void> }).renderPendingFormulas();
  await nextTick();
  return wrapper;
}

function formulaHtml(mathml: string, type = 'math', rendered = ''): string {
  const escaped = mathml.replace(/"/g, '&quot;');
  return (
    `<span data-formula="true" data-formula-type="${type}" data-mathml="${escaped}" contenteditable="false">` +
    `<span class="rte-formula__render" data-render-host="true">${rendered}</span></span>`
  );
}

describe('read-only rendering', () => {
  it('renders document content without any editing affordances', async () => {
    const w = await mountContent('<h2>Заголовок</h2><p><strong>жирный</strong></p>');

    expect(w.find('h2').text()).toBe('Заголовок');
    expect(w.find('strong').exists()).toBe(true);
    expect(w.find('.rte-toolbar').exists()).toBe(false);
    expect(w.find('[contenteditable="true"]').exists()).toBe(false);
  });

  it('carries the theme class so CSS variables apply', async () => {
    const w = await mountContent('<p>x</p>');

    expect(w.classes()).toContain('rte-content-root');
    expect(w.classes()).toContain('rte-content');
  });

  it('sanitizes the HTML it is given', async () => {
    const w = await mountContent('<p>safe</p><script>alert(1)</script><img src=x onerror="alert(1)">');

    expect(w.html()).toContain('safe');
    expect(w.html()).not.toContain('alert');
    expect(w.html()).not.toMatch(/on\w+=/i);
  });

  it('renders formulas that arrive with MathML only', async () => {
    const mathml = await latexToMathML('\\frac{a}{b}', 'math');
    const w = await mountContent(`<p>${formulaHtml(mathml)}</p>`);

    const svg = w.find('.rte-formula__render svg');
    expect(svg.exists()).toBe(true);
    expect(w.emitted('rendered')).toBeTruthy();
  });

  it('keeps an SVG that already travelled with the document', async () => {
    const mathml = await latexToMathML('x^2', 'math');
    const marker = '<svg id="precomputed"></svg>';
    const w = await mountContent(`<p>${formulaHtml(mathml, 'math', marker)}</p>`);

    expect(w.find('.rte-formula__render svg').attributes('id')).toBe('precomputed');
  });

  it('renders chemistry formulas too', async () => {
    const mathml = await latexToMathML('2\\mathrm{H}_2+\\mathrm{O}_2', 'chem');
    const w = await mountContent(`<p>${formulaHtml(mathml, 'chem')}</p>`);

    expect(w.find('[data-formula-type="chem"] svg').exists()).toBe(true);
  });

  it('drops a formula whose MathML is not usable', async () => {
    const w = await mountContent(`<p>${formulaHtml('<p>not mathml</p>')}</p>`);

    expect(w.find('.rte-formula__render svg').exists()).toBe(false);
    expect(w.text()).not.toContain('not mathml');
  });

  it('re-renders when the html prop changes', async () => {
    const w = await mountContent('<p>первый</p>');
    expect(w.text()).toContain('первый');

    await w.setProps({ html: `<p>второй ${formulaHtml(await latexToMathML('y', 'math'))}</p>` });
    await nextTick();
    await (w.vm as unknown as { renderPendingFormulas(): Promise<void> }).renderPendingFormulas();

    expect(w.text()).toContain('второй');
    expect(w.find('.rte-formula__render svg').exists()).toBe(true);
  });

  it('scales formulas through the host font size', async () => {
    const mathml = await latexToMathML('z', 'math');
    const w = await mountContent(`<p>${formulaHtml(mathml)}</p>`, { formulaScale: 1.5 });

    expect(w.find('.rte-formula__render').attributes('style')).toContain('font-size: 1.5em');
  });

  it('keeps the native audio player so recordings stay playable', async () => {
    const w = await mountContent(
      '<div data-audio="true" data-src="blob:http://localhost/a"><audio controls src="blob:http://localhost/a" class="rte-audio__native"></audio></div>',
    );

    expect(w.find('audio.rte-audio__native').exists()).toBe(true);
    expect(w.find('audio').attributes('controls')).toBeDefined();
  });

  it('keeps attachments downloadable', async () => {
    const w = await mountContent(
      '<div data-attachment="true" data-href="https://cdn.example.com/a.txt" data-name="a.txt"><a href="https://cdn.example.com/a.txt" download="a.txt">a.txt</a></div>',
    );

    expect(w.find('a[download]').attributes('href')).toBe('https://cdn.example.com/a.txt');
  });
});
