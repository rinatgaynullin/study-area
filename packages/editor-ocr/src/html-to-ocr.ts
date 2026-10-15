import { extractTexAnnotation, mathmlToLatex } from '@rich-editor/core';
import {
  normalizePhysicsScene,
  parseSceneJson,
  renderPhysicsSvg,
  hasDrawableContent,
} from '@rich-editor/drawings/viewer';
import { wrapBlock } from './markers';

export interface HtmlToOcrOptions {
  /**
   * Класть к физической схеме готовый SVG 340×300 в блоке `SVG` — так делал
   * PinQueen для нейросети-проверяющего. Включено по умолчанию.
   */
  physicsSvg?: boolean;
}

/** Переносы вне `<pre>` ничего не значат; схлопываем, как браузер. */
const collapseWhitespace = (text: string): string => text.replace(/\s+/g, ' ');

/** Строчный узел без текста: формула, химия. */
const isFormula = (element: Element): boolean => element.hasAttribute('data-formula');

const isChemistry = (element: Element): boolean => element.hasAttribute('data-chemistry-code');

const isDrawing = (element: Element): boolean =>
  element.hasAttribute('data-geometry-data') || element.hasAttribute('data-physics-data');

/** Абзац, в котором нет ничего кроме одной формулы, — выключная формула. */
const soleFormulaOf = (paragraph: Element): Element | null => {
  const children = [...paragraph.childNodes].filter(
    (node) => !(node.nodeType === Node.TEXT_NODE && !(node.textContent ?? '').trim()),
  );

  const [only] = children;

  return children.length === 1 && only instanceof Element && isFormula(only) ? only : null;
};

/**
 * Документ редактора → текст распознавания с маркерами.
 *
 * Обратная сторона `ocrTextToHtml`: заголовки `#`, жирный, курсив и
 * зачёркивание, списки с нумерацией, таблицы, формулы `$…$` и `$$…$$`,
 * `\chemfig{…}`, чертежи блоками `TIKZ` + `DATA`, физика с блоком `SVG`.
 * Потери оригинала — нумерация, зачёркивание, TikZ физики — здесь закрыты.
 * Формулы читаются из аннотации MathML, чужой MathML конвертируется.
 */
class OcrTextWriter {
  constructor(private readonly options: HtmlToOcrOptions) {}

  async blocks(parent: ParentNode): Promise<string> {
    const parts = await Promise.all([...parent.childNodes].map((node) => this.block(node)));

    return parts.join('');
  }

  private async block(node: ChildNode): Promise<string> {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = collapseWhitespace(node.textContent ?? '').trim();

      return text ? `${text}\n` : '';
    }

    if (!(node instanceof Element)) return '';

    const tag = node.tagName.toLowerCase();

    if (/^h[1-6]$/.test(tag)) {
      return `${'#'.repeat(Number(tag[1]))} ${await this.inline(node)}\n\n`;
    }

    if (tag === 'p') {
      const formula = soleFormulaOf(node);

      if (formula) return `\n$$\n${await this.formula(formula)}\n$$\n`;

      const text = await this.inline(node);

      return text === '' ? '\n' : `${text}\n`;
    }

    if (tag === 'ul' || tag === 'ol') return `${await this.list(node, tag)}\n`;

    if (tag === 'table') return `\n${await this.table(node)}\n`;

    if (tag === 'hr') return '\n---\n\n';

    if (tag === 'blockquote') return this.blocks(node);

    if (isDrawing(node)) return this.drawing(node);

    if (isChemistry(node) || isFormula(node)) return `${await this.inline(node, true)}\n`;

    if (tag === 'img' || tag === 'audio' || node.hasAttribute('data-audio') || node.hasAttribute('data-attachment')) {
      return '';
    }

    // Неизвестный блок — его содержимое.
    return node.childNodes.length > 0 ? this.blocks(node) : '';
  }

  private async list(list: Element, tag: 'ul' | 'ol', depth = 0): Promise<string> {
    const start = Number(list.getAttribute('start') ?? '1') || 1;
    const items = [...list.children].filter((child) => child.tagName.toLowerCase() === 'li');
    const indent = '  '.repeat(depth);

    const lines = await Promise.all(
      items.map(async (item, index) => {
        const nested: string[] = [];
        const own: string[] = [];

        for (const child of item.childNodes) {
          if (child instanceof Element && (child.tagName.toLowerCase() === 'ul' || child.tagName.toLowerCase() === 'ol')) {
            nested.push(await this.list(child, child.tagName.toLowerCase() as 'ul' | 'ol', depth + 1));
          } else if (child instanceof Element && child.tagName.toLowerCase() === 'p') {
            own.push(await this.inline(child));
          } else {
            own.push(await this.inlineNode(child));
          }
        }

        const marker = tag === 'ol' ? `${start + index}.` : '*';
        const text = own.join('').trim();

        return `${indent}${marker} ${text}\n${nested.join('')}`;
      }),
    );

    return lines.join('');
  }

  private async table(table: Element): Promise<string> {
    const rows = [...table.querySelectorAll('tr')];
    const lines: string[] = [];

    for (const [index, row] of rows.entries()) {
      const cells = await Promise.all(
        [...row.children].map(async (cell) => (await this.inline(cell)).replace(/\n/g, ' ').trim()),
      );

      lines.push(`| ${cells.join(' | ')} |`);

      if (index === 0) lines.push(`| ${cells.map(() => '---').join(' | ')} |`);
    }

    return `${lines.join('\n')}\n`;
  }

  private drawing(node: Element): string {
    const tikz = node.getAttribute('data-tikz-code') ?? '';

    if (node.hasAttribute('data-geometry-data')) {
      return wrapBlock('TIKZ', tikz) + wrapBlock('DATA', node.getAttribute('data-geometry-data') ?? '{}');
    }

    const data = node.getAttribute('data-physics-data') ?? '{}';
    let result = '';

    if (this.options.physicsSvg !== false) {
      const scene = normalizePhysicsScene(parseSceneJson(data));

      if (hasDrawableContent(scene)) {
        result += wrapBlock('SVG', renderPhysicsSvg(scene, { width: 340, height: 300, autoFit: true }));
      }
    }

    // TikZ физики оригинал терял; свой блок он получает так же, как геометрия.
    if (tikz.trim()) result += wrapBlock('TIKZ', tikz);

    return result + wrapBlock('DATA', data);
  }

  private async inline(parent: Element, allowSelf = false): Promise<string> {
    if (allowSelf) return this.inlineNode(parent);

    const parts = await Promise.all([...parent.childNodes].map((node) => this.inlineNode(node)));

    return parts.join('');
  }

  private async inlineNode(node: ChildNode): Promise<string> {
    if (node.nodeType === Node.TEXT_NODE) return collapseWhitespace(node.textContent ?? '');

    if (!(node instanceof Element)) return '';

    if (isFormula(node)) return `$${await this.formula(node)}$`;

    if (isChemistry(node)) return `\\chemfig{${node.getAttribute('data-chemistry-code') ?? ''}}`;

    if (isDrawing(node)) return this.drawing(node);

    const tag = node.tagName.toLowerCase();

    if (tag === 'br') return '\n';

    const inner = await this.inline(node);

    if (!inner.trim()) return inner;

    switch (tag) {
      case 'strong':
      case 'b':
        return `**${inner}**`;
      case 'em':
      case 'i':
        return `*${inner}*`;
      case 's':
      case 'del':
      case 'strike':
        return `~~${inner}~~`;
      default:
        return inner;
    }
  }

  private async formula(node: Element): Promise<string> {
    const mathml = node.getAttribute('data-mathml') ?? '';
    const annotation = extractTexAnnotation(mathml);

    if (annotation !== null) return this.tidyLatex(annotation);

    try {
      return this.tidyLatex(await mathmlToLatex(mathml));
    } catch {
      return '';
    }
  }

  private tidyLatex(latex: string): string {
    return latex.replace(/\\dots\b/g, '\\ldots').replace(/\\equiv([^\s\\{}])/g, '\\equiv $1').trim();
  }
}

/** HTML документа редактора → текст распознавания для отправки на бэкенд. */
export const htmlToOcrText = async (html: string, options: HtmlToOcrOptions = {}): Promise<string> => {
  if (!html || !html.trim()) return '';

  const document = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const text = await new OcrTextWriter(options).blocks(document.body);

  return text.replace(/\n{3,}/g, '\n\n').trim();
};
