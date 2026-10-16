import {
  collectSanitizerRules,
  type ContentFeature,
  type ContentHydrateContext,
  type ContentHydrateDispose,
} from '../content-feature';
import { DEFAULT_FORMULA_FONT_SIZE_PX, renderMathML } from '../formula/mathjax';
import { formulaAccessibleName } from '../formula/mathml';
import { prepareIncomingHtml } from '../prepare-html';
import type { SanitizerRules } from '../security/sanitize';
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
  /**
   * Возможности, чьи узлы есть в документе: их разметка проходит санитайзер,
   * а после каждой отрисовки узлы оживляет `hydrate`. Читаются один раз,
   * как и у редактора: набор возможностей — часть контракта документа.
   */
  features?: ContentFeature[];
  /** Документ отрисован: формулы дорисованы, узлы возможностей оживлены. */
  onRendered?(): void;
}

export type RichContentUpdate = Partial<
  Pick<RichContentOptions, 'html' | 'formulaScale' | 'legacy' | 'theme'>
>;

export interface RichContent {
  readonly element: HTMLElement;
  /** Подменяет документ или настройки, перерисовывает его и дорисовывает формулы. */
  update(next: RichContentUpdate): Promise<void>;
  /** Дорисовывает формулы, пришедшие без SVG, — или все, если масштаб не 1. */
  renderPendingFormulas(): Promise<void>;
  destroy(): void;
}

const createRenderHost = (): HTMLElement => {
  const host = document.createElement('span');

  host.className = 'rte-formula__render';
  host.setAttribute('data-render-host', 'true');

  return host;
};

/**
 * Вьюер сохранённого документа — без фреймворка и без редакторского стека.
 *
 * Ни ProseMirror, ни MathLive: разметка проходит санитайзер и ложится в
 * элемент как есть. Формулы, экспортированные редактором, несут свой SVG, и
 * MathJax для них не грузится; формулы с одним `data-mathml` — например, от
 * бэкенда, который хранит только источник, — отрисовываются по месту.
 *
 * Отрисовка, гидрация возможностей и дорисовка формул ссылаются на одно
 * состояние — документ, масштаб, номер отрисовки, — поэтому оно живёт в
 * полях, а шаги — в методах.
 */
class RichContentController implements RichContent {
  readonly element: HTMLElement;

  private readonly options: RichContentOptions;

  private html: string;

  private formulaScale: number;

  private legacy: boolean;

  private destroyed = false;

  private releaseTheme: () => void;

  private readonly features: ContentFeature[];

  /** Правила санитайзера возможностей; считаются один раз. */
  private readonly sanitize: SanitizerRules | undefined;

  /** Что сняли бы гидраторы текущей отрисовки: слушатели, таймеры. */
  private disposers: ContentHydrateDispose[] = [];

  /**
   * Номер отрисовки. Гидратор асинхронный: если документ сменился, пока он
   * работал, его узлов уже нет — результат снимается сразу.
   */
  private generation = 0;

  constructor(options: RichContentOptions) {
    this.options = options;
    this.element = options.element;
    this.html = options.html ?? '';
    this.formulaScale = options.formulaScale ?? 1;
    this.legacy = options.legacy ?? false;
    this.features = options.features ?? [];
    this.sanitize = collectSanitizerRules(this.features);

    this.element.classList.add('rte-content-root', 'rte-content');
    this.releaseTheme = applyTheme(this.element, options.theme ?? 'light');

    // Первую отрисовку не ждём: вьюер готов сразу. Неудачный рендер
    // renderMathML не пробрасывает — формула остаётся без SVG.
    this.render();
  }

  async update(next: RichContentUpdate): Promise<void> {
    if (next.html !== undefined) this.html = next.html;

    if (next.formulaScale !== undefined) this.formulaScale = next.formulaScale;

    if (next.legacy !== undefined) this.legacy = next.legacy;

    if (next.theme !== undefined) {
      this.releaseTheme();
      this.releaseTheme = applyTheme(this.element, next.theme);
    }

    await this.render();
  }

  async renderPendingFormulas(): Promise<void> {
    await this.renderFormulas();

    if (!this.destroyed) this.options.onRendered?.();
  }

  destroy(): void {
    this.destroyed = true;
    this.generation += 1;
    this.disposeHydrated();
    this.releaseTheme();
    this.element.replaceChildren();
    this.element.classList.remove('rte-content-root', 'rte-content', 'rte-legacy', 'rte-theme-dark');
  }

  /** Полная отрисовка: разметка, затем параллельно гидрация и формулы. */
  private async render(): Promise<void> {
    this.paint();
    await Promise.all([this.hydrate(), this.renderFormulas()]);

    if (!this.destroyed) this.options.onRendered?.();
  }

  private paint(): void {
    // Старые узлы уходят вместе с разметкой — снимаем с них слушатели раньше.
    this.disposeHydrated();
    this.generation += 1;
    this.element.classList.toggle('rte-legacy', this.legacy);

    // Тот же единственный путь входа, что и у редактора.
    this.element.innerHTML = prepareIncomingHtml(this.html, {
      legacy: this.legacy,
      sanitize: this.sanitize,
    });
  }

  /** Даёт возможностям оживить свои узлы и запоминает, как это снять. */
  private async hydrate(): Promise<void> {
    const { generation } = this;
    const context: ContentHydrateContext = { formulaScale: this.formulaScale };

    await Promise.all(
      this.features.map(async (feature) => {
        const dispose = await feature.hydrate?.(this.element, context);

        if (typeof dispose !== 'function') return;

        if (this.destroyed || generation !== this.generation) dispose();
        else this.disposers.push(dispose);
      }),
    );
  }

  private disposeHydrated(): void {
    const { disposers } = this;

    this.disposers = [];
    disposers.forEach((dispose) => dispose());
  }

  private async renderFormulas(): Promise<void> {
    const formulas = [...this.element.querySelectorAll<HTMLElement>('span[data-formula]')];

    await Promise.all(
      formulas.map(async (formula) => {
        // Формула от бэкенда, знающего только MathML, приходит без имени —
        // читалке она была бы «изображением». Имя редактора уважаем.
        if (!formula.hasAttribute('aria-label')) {
          formula.setAttribute('role', 'img');

          formula.setAttribute(
            'aria-label',
            formulaAccessibleName(formula.getAttribute('data-mathml') ?? ''),
          );
        }

        const host =
          formula.querySelector<HTMLElement>('[data-render-host]')
          ?? formula.appendChild(createRenderHost());

        // SVG, приехавший с документом, уже нужного размера — если только не
        // просили другой масштаб: пиксели в разметке на font-size не
        // реагируют, и применить его можно только перерисовкой.
        if (host.childElementCount > 0 && this.formulaScale === 1) return;

        const svg = await renderMathML(formula.getAttribute('data-mathml') ?? '', {
          fontSizePx: DEFAULT_FORMULA_FONT_SIZE_PX * this.formulaScale,
        });

        if (!this.destroyed && svg) host.innerHTML = svg;
      }),
    );
  }
}

export const createRichContent = (options: RichContentOptions): RichContent =>
  new RichContentController(options);
