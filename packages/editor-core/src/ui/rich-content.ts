import { DEFAULT_FORMULA_FONT_SIZE_PX, renderMathML } from '../formula/mathjax';
import { prepareIncomingHtml } from '../prepare-html';
import { applyTheme, type EditorTheme } from './theme';

export interface RichContentOptions {
  /** Элемент, который станет вьюером: получает классы и содержимое. */
  element: HTMLElement;
  html?: string;
  /** Масштаб формул относительно текста. */
  formulaScale?: number;
  /** Разбирать разметку старого редактора (Froala + Wiris). */
  legacy?: boolean;
  /** Тема: светлая, тёмная или как в системе. Или класс `rte-theme-dark` на предке. */
  theme?: EditorTheme;
  /** Все формулы, ждавшие отрисовки, отрисованы. */
  onRendered?(): void;
}

export type RichContentUpdate = Partial<
  Pick<RichContentOptions, 'html' | 'formulaScale' | 'legacy' | 'theme'>
>;

export interface RichContent {
  readonly element: HTMLElement;
  /** Подменяет документ или настройки и дорисовывает формулы. */
  update(next: RichContentUpdate): Promise<void>;
  /** Дорисовывает формулы, пришедшие без SVG, — или все, если масштаб не 1. */
  renderPendingFormulas(): Promise<void>;
  destroy(): void;
}

function createRenderHost(): HTMLElement {
  const host = document.createElement('span');
  host.className = 'rte-formula__render';
  host.setAttribute('data-render-host', 'true');
  return host;
}

/**
 * Вьюер сохранённого документа — без фреймворка и без редакторского стека.
 *
 * Ни ProseMirror, ни MathLive: разметка проходит санитайзер и ложится в
 * элемент как есть. Формулы, экспортированные редактором, несут свой SVG, и
 * MathJax для них не грузится; формулы с одним `data-mathml` — например, от
 * бэкенда, который хранит только источник, — отрисовываются по месту.
 */
export function createRichContent(options: RichContentOptions): RichContent {
  const { element } = options;
  let html = options.html ?? '';
  let formulaScale = options.formulaScale ?? 1;
  let legacy = options.legacy ?? false;
  let destroyed = false;

  element.classList.add('rte-content-root', 'rte-content');
  let releaseTheme = applyTheme(element, options.theme ?? 'light');

  function paint(): void {
    element.classList.toggle('rte-legacy', legacy);
    // Тот же единственный путь входа, что и у редактора.
    element.innerHTML = prepareIncomingHtml(html, { legacy });
  }

  async function renderPendingFormulas(): Promise<void> {
    const formulas = [...element.querySelectorAll<HTMLElement>('span[data-formula]')];

    await Promise.all(
      formulas.map(async (formula) => {
        const host =
          formula.querySelector<HTMLElement>('[data-render-host]') ??
          formula.appendChild(createRenderHost());

        // SVG, приехавший с документом, уже нужного размера — если только не
        // просили другой масштаб: пиксели в разметке на font-size не
        // реагируют, и применить его можно только перерисовкой.
        if (host.childElementCount > 0 && formulaScale === 1) return;

        const svg = await renderMathML(formula.getAttribute('data-mathml') ?? '', {
          fontSizePx: DEFAULT_FORMULA_FONT_SIZE_PX * formulaScale,
        });
        if (!destroyed && svg) host.innerHTML = svg;
      }),
    );

    if (!destroyed) options.onRendered?.();
  }

  async function update(next: RichContentUpdate): Promise<void> {
    if (next.html !== undefined) html = next.html;
    if (next.formulaScale !== undefined) formulaScale = next.formulaScale;
    if (next.legacy !== undefined) legacy = next.legacy;
    if (next.theme !== undefined) {
      releaseTheme();
      releaseTheme = applyTheme(element, next.theme);
    }
    paint();
    await renderPendingFormulas();
  }

  paint();
  void renderPendingFormulas();

  return {
    element,
    update,
    renderPendingFormulas,
    destroy: () => {
      destroyed = true;
      releaseTheme();
      element.replaceChildren();
      element.classList.remove('rte-content-root', 'rte-content', 'rte-legacy', 'rte-theme-dark');
    },
  };
}
