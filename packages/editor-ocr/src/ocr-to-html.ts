import { latexToMathML, type FormulaType } from '@rich-editor/core';
import { unwrapChemfig } from '@rich-editor/chemistry/viewer';
import { detectDrawingKind, parseSceneJson, type DrawingKind } from '@rich-editor/drawings/viewer';
import {
  ceToLatex,
  findBraced,
  fixMarkdownTableLines,
  normalizeLatexText,
  pipesToVmatrix,
  replaceCeBlocks,
  stripDollarsInsideEnvironments,
  wrapBareLatex,
} from './latex-text';
import { markdownToHtml } from './markdown';
import {
  DATA_BLOCK,
  GEOMETRY_PLACEHOLDER,
  OCR_BOUNDARY,
  SVG_BLOCK,
  TIKZ_BLOCK,
  extractBlocks,
  wrapBlock,
} from './markers';

/** Предмет работы: влияет только на вид чертежа без явного типа в сцене. */
export type OcrSubject = 'math' | 'physics' | 'chemistry' | string;

/** Метаданные ответа `GET /ocr/status`: чертежи могут прийти не в тексте, а здесь. */
export interface OcrMetadata {
  ocr_and_tikz_data?: string;
  raw_ocr_and_tikz_data?: string;
  ocr_and_tikz_data_plots?: Array<{ tikz_code?: string; data?: unknown }>;
  plots?: Array<{ tikz_code?: string; data?: unknown }>;
  ocr_and_tikz_data_tikz_code?: string;
  ocr_and_tikz_data_data?: string;
}

export interface OcrToHtmlOptions {
  subject?: OcrSubject;
  metadata?: OcrMetadata;
  /** Оборачивать голый LaTeX в `$`; выключается для текста, где это ломает прозу. */
  wrapBareLatex?: boolean;
}

const escapeAttr = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const unescapeAttr = (value: string): string =>
  value.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/**
 * Плейсхолдеры из символов частного использования: в тексте их не бывает.
 * Без групп захвата — по этому шаблону текст режется `split`.
 */
const PLACEHOLDER = /(?:MATH|CHEM|DRAW|NODE)\d+/;
const PLACEHOLDER_G = new RegExp(PLACEHOLDER.source, 'g');
const PLACEHOLDER_PARSE = /^(MATH|CHEM|DRAW|NODE)(\d+)$/;

type PlaceholderKind = 'MATH' | 'CHEM' | 'DRAW' | 'NODE';

const placeholder = (kind: PlaceholderKind, index: number): string => `${kind}${index}`;

const parsePlaceholder = (token: string): { kind: PlaceholderKind; index: number } | null => {
  const match = PLACEHOLDER_PARSE.exec(token);

  return match ? { kind: match[1] as PlaceholderKind, index: Number(match[2]) } : null;
};

interface MathEntry {
  latex: string;
  display: boolean;
  type: FormulaType;
}

interface DrawingEntry {
  kind: DrawingKind | 'chemistry';
  data: string;
  tikz: string;
}

const PHYSICS_SCENE_MARKERS = ['spring', 'pulley', 'incline', 'horizontal_surface', 'lens', 'mirror', 'ray', 'circuit_component', 'wire', 'piston_vessel'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Есть ли в сцене что рисовать: пустые пары `TIKZ`+`DATA` в документ не попадают. */
const sceneHasContent = (raw: unknown, tikz: string): boolean => {
  if (tikz.trim()) return true;

  if (!isRecord(raw)) return false;

  const nonEmptyArray = (value: unknown): boolean => Array.isArray(value) && value.length > 0;

  return (
    nonEmptyArray(raw.elements)
    || (isRecord(raw.vertices) && Object.keys(raw.vertices).length > 0)
    || nonEmptyArray(raw.plots)
    || raw.thermo_axes !== undefined
    || raw.thermo_point !== undefined
    || raw.thermo_process !== undefined
    || nonEmptyArray(raw.optics_elements)
    || nonEmptyArray(raw.circuit_components)
  );
};

/** Вид узла по сцене и предмету: химия — только если сцена сама об этом говорит. */
const drawingKindOf = (raw: unknown, subject: OcrSubject | undefined): DrawingKind | 'chemistry' => {
  if (isRecord(raw) && (raw.type === 'chemistry' || raw.chemistry_code !== undefined)) return 'chemistry';

  return detectDrawingKind(raw, subject === 'physics' ? 'physics' : 'geometry');
};

/** Формула — реакция, если в ней есть `\ce` или химические стрелки с текстом. */
const formulaTypeOf = (latex: string): FormulaType =>
  /\\ce\{|\\xrightarrow|\\text\{[^}]*\}_\d/.test(latex) ? 'chem' : 'math';

/** Узел формулы в контракте редактора. */
const formulaHtml = (mathml: string, type: FormulaType): string =>
  `<span data-formula="true" data-formula-type="${type}" data-mathml="${escapeAttr(mathml)}"></span>`;

const chemistryHtml = (code: string): string =>
  `<span data-chemistry="true" data-chemistry-code="${escapeAttr(code)}" data-chemistry-type="chemfig"></span>`;

const drawingHtml = (kind: DrawingKind, data: string, tikz: string): string =>
  `<div data-${kind}="true" data-${kind}-data="${escapeAttr(data)}"${tikz ? ` data-tikz-code="${escapeAttr(tikz)}"` : ''}></div>`;

/**
 * Текст распознавания → HTML документа редактора.
 *
 * Разбор многошаговый, и каждый шаг достаёт из текста свой вид узлов,
 * оставляя плейсхолдеры: сначала готовые HTML-узлы и чертежи, потом химия,
 * потом формулы, потом Markdown. Списки найденного — общее состояние шагов,
 * поэтому конвертер собран в класс.
 */
class OcrDocumentBuilder {
  private readonly math: MathEntry[] = [];

  private readonly chemistry: string[] = [];

  private readonly drawings: DrawingEntry[] = [];

  /** Готовые HTML-узлы из входа: PinQueen отдаёт их в своём экспорте. */
  private readonly nodes: string[] = [];

  private readonly looksLikeHtml: boolean;

  constructor(
    private text: string,
    private readonly options: OcrToHtmlOptions,
  ) {
    this.looksLikeHtml = /<(p|div|ul|ol|li|table|span)\b/i.test(text);
  }

  async build(): Promise<string> {
    this.text = stripDollarsInsideEnvironments(fixMarkdownTableLines(this.text));
    this.protectHtmlNodes();
    this.text = normalizeLatexText(this.text)
      .replace(OCR_BOUNDARY, '')
      .replace(SVG_BLOCK, '');
    this.text = pipesToVmatrix(this.text);
    this.injectMetadataDrawings();
    this.extractDrawings();

    // Структуры — до оборачивания голого LaTeX: иначе `\chemfig{…}` ушёл бы в формулу.
    this.extractChemistry();

    const wrap = this.options.wrapBareLatex !== false && !this.looksLikeHtml;

    if (wrap) this.text = wrapBareLatex(this.text, PLACEHOLDER_G);

    this.text = this.text.replace(/\\equiv([^\s\\{}])/g, '\\equiv $1');
    this.extractMath();

    const html = this.looksLikeHtml
      ? this.text
      : markdownToHtml(this.text, {
          placeholder: PLACEHOLDER,
          isBlockPlaceholder: (token) => {
            const parsed = parsePlaceholder(token);

            return parsed !== null && (parsed.kind === 'DRAW' || parsed.kind === 'NODE' || this.isDisplayMath(parsed));
          },
        });

    return this.resolvePlaceholders(html);
  }

  private isDisplayMath(parsed: { kind: PlaceholderKind; index: number }): boolean {
    return parsed.kind === 'MATH' && (this.math[parsed.index]?.display ?? false);
  }

  /** Узлы, которые уже есть в тексте: `<span data-geometry-data>`, `<pre>{json}</pre>`, формулы PinQueen. */
  private protectHtmlNodes(): void {
    // JSON сцены в `<pre>` — чертёж.
    this.text = this.text.replace(/<pre\b[^>]*>(?:<code\b[^>]*>)?\s*(\{[\s\S]*?\})\s*(?:<\/code>)?<\/pre>/gi, (whole, json: string) => {
      const raw = parseSceneJson(json);

      if (!isRecord(raw) || !(raw.elements || raw.vertices || raw.thermo_axes || raw.plots || raw.type)) return whole;

      const kind = drawingKindOf(raw, this.options.subject);

      if (kind === 'chemistry') return whole;

      return this.pushDrawing({ kind, data: json.trim(), tikz: '' });
    });

    // Узлы PinQueen и наши: читаем атрибуты, остальное отбрасываем.
    const node =
      /<(div|span)\b[^>]*\bdata-(geometry-data|physics-data|chemistry-code)=(["'])([\s\S]*?)\3[^>]*>[\s\S]*?<\/\1>/gi;

    this.text = this.text.replace(node, (whole, _tag: string, attribute: string, _quote: string, rawValue: string) => {
      const value = unescapeAttr(rawValue);
      const tikz = /\bdata-tikz-code=(["'])([\s\S]*?)\1/i.exec(whole);

      if (attribute === 'chemistry-code') return this.pushChemistry(value);

      return this.pushDrawing({
        kind: attribute === 'physics-data' ? 'physics' : 'geometry',
        data: value,
        tikz: tikz ? unescapeAttr(tikz[2]) : '',
      });
    });

    // Формулы экспорта PinQueen: `<span data-math-latex="…" data-math-display="…">`.
    this.text = this.text.replace(
      /<span\b[^>]*\bdata-math-latex=(["'])([\s\S]*?)\1[^>]*>\s*<\/span>/gi,
      (whole, _quote: string, rawLatex: string) => {
        const display = /data-math-display=["']true["']/i.test(whole);

        return this.pushMath(unescapeAttr(rawLatex), display);
      },
    );
  }

  /** Чертежи из метаданных встают на место `$GEOMETRY_n$` или в конец текста. */
  private injectMetadataDrawings(): void {
    if (TIKZ_BLOCK.test(this.text) || DATA_BLOCK.test(this.text)) {
      TIKZ_BLOCK.lastIndex = 0;
      DATA_BLOCK.lastIndex = 0;

      return;
    }

    const metadata = this.options.metadata ?? {};
    let plots = metadata.ocr_and_tikz_data_plots ?? metadata.plots ?? [];

    if (!Array.isArray(plots) || plots.length === 0) {
      const combined = metadata.ocr_and_tikz_data ?? metadata.raw_ocr_and_tikz_data ?? '';
      const tikz = metadata.ocr_and_tikz_data_tikz_code ?? extractBlocks(combined, TIKZ_BLOCK)[0];
      const data = metadata.ocr_and_tikz_data_data ?? extractBlocks(combined, DATA_BLOCK)[0];

      plots = tikz || data ? [{ tikz_code: tikz, data }] : [];
    }

    if (plots.length === 0) return;

    const blocks = plots
      .map((plot) => {
        const data = typeof plot.data === 'string' ? plot.data : JSON.stringify(plot.data ?? {});

        return wrapBlock('TIKZ', plot.tikz_code ?? '') + wrapBlock('DATA', data || '{}');
      })
      .join('');

    if (GEOMETRY_PLACEHOLDER.test(this.text)) {
      GEOMETRY_PLACEHOLDER.lastIndex = 0;
      this.text = this.text.replace(GEOMETRY_PLACEHOLDER, blocks);
    } else {
      this.text += blocks;
    }
  }

  /** Пары `TIKZ` + `DATA` → узлы чертежей; одиночные блоки тоже. */
  private extractDrawings(): void {
    const tikzBlocks: string[] = [];
    const dataBlocks: string[] = [];

    this.text = this.text.replace(TIKZ_BLOCK, (_, body: string) => {
      tikzBlocks.push(body.trim());

      return 'TIKZ';
    });
    this.text = this.text.replace(DATA_BLOCK, (_, body: string) => {
      dataBlocks.push(body.trim());

      return 'DATA';
    });

    const count = Math.max(tikzBlocks.length, dataBlocks.length);
    const tokens: string[] = [];

    for (let index = 0; index < count; index += 1) {
      const tikz = tikzBlocks[index] ?? '';
      const data = dataBlocks[index] ?? '{}';
      const raw = parseSceneJson(data);

      if (!sceneHasContent(raw, tikz)) {
        tokens.push('');

        continue;
      }

      const kind = drawingKindOf(raw, this.options.subject);

      tokens.push(kind === 'chemistry' ? this.pushChemistry(unwrapChemfig(tikz)) : this.pushDrawing({ kind, data, tikz }));
    }

    let next = 0;
    const take = (): string => tokens[next++] ?? '';

    this.text = this.text
      .replace(/TIKZ\s*DATA/g, take)
      .replace(/TIKZ/g, take)
      .replace(/DATA/g, take);
  }

  private extractChemistry(): void {
    let found = findBraced(this.text, '\\chemfig');

    while (found) {
      this.text = `${this.text.slice(0, found.start)}${this.pushChemistry(found.body.trim())}${this.text.slice(found.end)}`;
      found = findBraced(this.text, '\\chemfig');
    }
  }

  /** `$$…$$` — выключная формула, кроме реакций и чисел; `$…$` и голый `\ce{}` — строчные. */
  private extractMath(): void {
    this.text = this.text.replace(/\$\$([\s\S]*?)\$\$/g, (_, body: string) => {
      const latex = body.trim();
      const inline = /\\to\b|\\xrightarrow|\\text|\\equiv|\\ce\b/.test(latex) || /^[0-9\s]+$/.test(latex);

      return this.pushMath(latex, !inline);
    });

    this.text = this.text.replace(/\$((?!\$)[\s\S]+?)\$/g, (whole, body: string) =>
      /\n\s*\n/.test(whole) ? whole : this.pushMath(body.trim(), false),
    );

    let found = findBraced(this.text, '\\ce');

    while (found) {
      this.text = `${this.text.slice(0, found.start)}${this.pushMath(`\\ce{${found.body.trim()}}`, false)}${this.text.slice(found.end)}`;
      found = findBraced(this.text, '\\ce');
    }
  }

  private pushMath(latex: string, display: boolean): string {
    const converted = replaceCeBlocks(latex);
    const type: FormulaType = /\\ce\{/.test(latex) ? 'chem' : formulaTypeOf(converted);

    this.math.push({ latex: converted, display, type });

    return placeholder('MATH', this.math.length - 1);
  }

  private pushChemistry(code: string): string {
    this.chemistry.push(code);

    return placeholder('CHEM', this.chemistry.length - 1);
  }

  private pushDrawing(entry: DrawingEntry): string {
    this.drawings.push(entry);

    return placeholder('DRAW', this.drawings.length - 1);
  }

  /** Все формулы конвертируются разом: LaTeX → MathML асинхронный. */
  private async resolvePlaceholders(html: string): Promise<string> {
    const mathml = await Promise.all(
      this.math.map(async (entry) => {
        try {
          return await latexToMathML(entry.latex, entry.type);
        } catch {
          return '';
        }
      }),
    );

    let result = html;

    for (let pass = 0; pass < 10 && PLACEHOLDER.test(result); pass += 1) {
      result = result.replace(PLACEHOLDER_G, (token) => {
        const parsed = parsePlaceholder(token);

        if (!parsed) return token;

        const { kind, index } = parsed;

        if (kind === 'MATH') {
          const entry = this.math[index];
          const converted = mathml[index];

          // Формула, которую не удалось конвертировать, остаётся текстом LaTeX.
          if (!entry) return '';

          if (!converted) return `$${escapeAttr(entry.latex)}$`;

          const node = formulaHtml(converted, entry.type);

          return entry.display && !this.looksLikeHtml ? `<p style="text-align: center">${node}</p>` : node;
        }

        if (kind === 'CHEM') return chemistryHtml(this.chemistry[index] ?? '');

        if (kind === 'DRAW') {
          const entry = this.drawings[index];

          if (!entry) return '';

          return entry.kind === 'chemistry' ? chemistryHtml(entry.data) : drawingHtml(entry.kind, entry.data, entry.tikz);
        }

        return this.nodes[index] ?? token;
      });
    }

    return result;
  }
}

/**
 * Текст распознавания (Markdown + LaTeX + маркеры TikZ/JSON) → HTML документа
 * в контракте редактора: формулы MathML с аннотацией LaTeX, узлы химии и
 * чертежей, абзацы, списки и таблицы. Асинхронно: LaTeX → MathML.
 */
export const ocrTextToHtml = async (text: string, options: OcrToHtmlOptions = {}): Promise<string> => {
  if (!text || !text.trim()) return '';

  return new OcrDocumentBuilder(text, options).build();
};

export { ceToLatex };
