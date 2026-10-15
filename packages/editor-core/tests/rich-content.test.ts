import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createRichContent,
  latexToMathML,
  type ContentFeature,
  type RichContent,
} from '../src';

/**
 * Ванильный вьюер: санитизация, классы темы, отрисовка формул без SVG.
 * Vue-обёртка проверяет только то, что добавляет сама, — пропы и событие.
 */
let viewer: RichContent | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  viewer?.destroy();
  viewer = undefined;
  host?.remove();
  host = undefined;
});

const mountViewer = async (
  html: string,
  options: Record<string, unknown> = {},
): Promise<RichContent> => {
  host = document.createElement('div');
  document.body.appendChild(host);
  viewer = createRichContent({ element: host, html, ...options });
  await viewer.renderPendingFormulas();

  return viewer;
};

const formulaHtml = (mathml: string, rendered = ''): string => {
  const escaped = mathml.replace(/"/g, '&quot;');

  return (
    `<span data-formula="true" data-formula-type="math" data-mathml="${escaped}" contenteditable="false">`
    + `<span class="rte-formula__render" data-render-host="true">${rendered}</span></span>`
  );
};

describe('вьюер без фреймворка', () => {
  it('ставит классы темы на свой элемент и снимает их при уничтожении', async () => {
    const view = await mountViewer('<p>x</p>');

    expect(view.element.classList.contains('rte-content-root')).toBe(true);
    expect(view.element.classList.contains('rte-content')).toBe(true);

    view.destroy();
    viewer = undefined;
    expect(host!.className).toBe('');
    expect(host!.innerHTML).toBe('');
  });

  it('санитизирует разметку тем же путём, что и редактор', async () => {
    const view = await mountViewer(
      '<p>safe</p><script>alert(1)</script><img src=x onerror="alert(1)">',
    );

    expect(view.element.innerHTML).toContain('safe');
    expect(view.element.innerHTML).not.toContain('alert');
  });

  it('дорисовывает формулы без SVG и сообщает об этом', async () => {
    let rendered = 0;
    const mathml = await latexToMathML('\\frac{a}{b}', 'math');

    const view = await mountViewer(`<p>${formulaHtml(mathml)}</p>`, {
      onRendered: () => {
        rendered += 1;
      },
    });

    expect(view.element.querySelector('.rte-formula__render svg')).not.toBeNull();
    expect(rendered).toBeGreaterThan(0);
  });

  it('не трогает SVG, приехавший с документом, при масштабе 1', async () => {
    const mathml = await latexToMathML('x^2', 'math');
    const view = await mountViewer(`<p>${formulaHtml(mathml, '<svg id="precomputed"></svg>')}</p>`);

    expect(view.element.querySelector('.rte-formula__render svg')?.id).toBe('precomputed');
  });

  it('тема ставится опцией и меняется через update', async () => {
    const view = await mountViewer('<p>x</p>', { theme: 'dark' });

    expect(view.element.classList.contains('rte-theme-dark')).toBe(true);

    await view.update({ theme: 'light' });
    expect(view.element.classList.contains('rte-theme-dark')).toBe(false);
  });

  it('update подменяет документ и переключает legacy-класс', async () => {
    const view = await mountViewer('<p>первый</p>');

    await view.update({ html: '<p>второй</p>', legacy: true });

    expect(view.element.textContent).toContain('второй');
    expect(view.element.classList.contains('rte-legacy')).toBe(true);

    await view.update({ legacy: false });
    expect(view.element.classList.contains('rte-legacy')).toBe(false);
  });
});

describe('возможности во вьюере', () => {
  const chemistryHtml = '<p><span data-chemistry="true" data-chemistry-code="A-B">C</span></p>';

  it('пропускает разметку возможности через санитайзер по её правилам', async () => {
    const feature: ContentFeature = {
      id: 'chemistry',
      sanitize: { attributes: ['data-chemistry', 'data-chemistry-code'] },
    };

    const view = await mountViewer(chemistryHtml, { features: [feature] });
    const node = view.element.querySelector('[data-chemistry]');

    expect(node?.getAttribute('data-chemistry-code')).toBe('A-B');

    view.destroy();
    viewer = undefined;

    const plain = await mountViewer(chemistryHtml);

    expect(plain.element.querySelector('[data-chemistry]')).toBeNull();
  });

  it('оживляет узлы после каждой отрисовки и снимает перед следующей и при уничтожении', async () => {
    const dispose = vi.fn();
    const hydrate = vi.fn((root: HTMLElement) => {
      root.querySelectorAll('[data-chemistry]').forEach((node) => {
        node.appendChild(document.createElement('svg'));
      });

      return dispose;
    });

    const feature: ContentFeature = {
      id: 'chemistry',
      sanitize: { attributes: ['data-chemistry', 'data-chemistry-code'] },
      hydrate,
    };

    const view = await mountViewer(chemistryHtml, { features: [feature], formulaScale: 1.5 });

    expect(hydrate).toHaveBeenCalledTimes(1);
    expect(hydrate.mock.calls[0][0]).toBe(view.element);
    expect(hydrate.mock.calls[0][1]).toEqual({ formulaScale: 1.5 });
    expect(view.element.querySelector('[data-chemistry] svg')).not.toBeNull();
    expect(dispose).not.toHaveBeenCalled();

    await view.update({ html: chemistryHtml });

    // Старая отрисовка снята до того, как легла новая разметка.
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(hydrate).toHaveBeenCalledTimes(2);

    view.destroy();
    viewer = undefined;
    expect(dispose).toHaveBeenCalledTimes(2);
  });

  it('update ждёт асинхронный гидратор, onRendered приходит после него', async () => {
    const order: string[] = [];

    const feature: ContentFeature = {
      id: 'slow',
      hydrate: async () => {
        await new Promise((resolve) => {
          setTimeout(resolve, 5);
        });

        order.push('hydrated');
      },
    };

    const view = await mountViewer('<p>x</p>', {
      features: [feature],
      onRendered: () => order.push('rendered'),
    });

    // Первую отрисовку вьюер не ждёт — дожидаемся её сами, прежде чем мерить update.
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });

    order.length = 0;
    await view.update({ html: '<p>y</p>' });

    expect(order).toEqual(['hydrated', 'rendered']);
  });

  it('результат гидратора, пережившего свою отрисовку, снимается сразу', async () => {
    const disposers: Array<ReturnType<typeof vi.fn>> = [];
    let release: (() => void) | undefined;

    const feature: ContentFeature = {
      id: 'slow',
      hydrate: () =>
        new Promise<() => void>((resolve) => {
          const dispose = vi.fn();

          disposers.push(dispose);
          release = () => resolve(dispose);
        }),
    };

    host = document.createElement('div');
    document.body.appendChild(host);
    viewer = createRichContent({ element: host, html: '<p>a</p>', features: [feature] });

    const first = release!;

    // Вторая отрисовка началась, пока первый гидратор ещё не ответил.
    const second = viewer.update({ html: '<p>b</p>' });

    first();
    await Promise.resolve();
    release!();
    await second;

    expect(disposers).toHaveLength(2);
    expect(disposers[0]).toHaveBeenCalledTimes(1);
    expect(disposers[1]).not.toHaveBeenCalled();
  });
});

describe('доступность вьюера', () => {
  it('формула без имени получает role="img" и имя из LaTeX, имя редактора остаётся', async () => {
    const element = document.createElement('div');

    document.body.appendChild(element);

    const mathml =
      '<math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mi>x</mi>'
      + '<annotation encoding="application/x-tex">x</annotation></semantics></math>';

    const contentViewer = createRichContent({
      element,
      html:
        `<p><span data-formula="true" data-mathml="${mathml.replace(/"/g, '&quot;')}"></span>`
        + `<span data-formula="true" role="img" aria-label="своё имя" data-mathml="${mathml.replace(/"/g, '&quot;')}"></span></p>`,
    });

    await contentViewer.renderPendingFormulas();

    const [bare, named] = [...element.querySelectorAll('span[data-formula]')];

    expect(bare.getAttribute('role')).toBe('img');
    expect(bare.getAttribute('aria-label')).toBe('x');
    expect(named.getAttribute('aria-label')).toBe('своё имя');

    contentViewer.destroy();
    element.remove();
  });
});
