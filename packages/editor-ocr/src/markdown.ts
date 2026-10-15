/**
 * Markdown из текста распознавания → HTML редактора.
 *
 * Подмножество, которое пишет бэкенд: заголовки `#`, жирный `**`, курсив
 * `*`, зачёркивание `~~`, линия `---`, списки `*`/`-`/`•` и `1.`, таблицы
 * `| a | b |`. Текст экранируется: он от нейросети и ученика, а откроется у
 * учителя. Плейсхолдеры узлов (формулы, химия, чертежи) проходят как есть.
 */

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface MarkdownOptions {
  /** Плейсхолдеры, которые не экранируются и могут стоять отдельной строкой блоком. */
  placeholder: RegExp;
  /** Плейсхолдер — блочный узел (чертёж): строка из него одного не оборачивается в `<p>`. */
  isBlockPlaceholder(token: string): boolean;
}

/** Инлайновая разметка строки: экранирование, затем `**`, `*`, `~~`. */
export const inlineMarkdownToHtml = (line: string, placeholder: RegExp): string => {
  const pieces = line.split(new RegExp(`(${placeholder.source})`, 'g'));

  return pieces
    .map((piece, index) => {
      // Нечётные элементы — совпадения плейсхолдеров.
      if (index % 2 === 1) return piece;

      return escapeHtml(piece)
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/~~(.+?)~~/g, '<s>$1</s>')
        .replace(/(^|[^*])\*(?!\s)([^*]+?)\*(?!\*)/g, '$1<em>$2</em>');
    })
    .join('');
};

const parseTableRow = (line: string): string[] | null => {
  const trimmed = line.trim();

  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return null;

  const cells = trimmed.split('|').slice(1, -1).map((cell) => cell.trim());

  return cells.length >= 2 ? cells : null;
};

const isSeparatorRow = (line: string): boolean => {
  const trimmed = line.trim();

  return /^\|[\s\-:|]+\|$/.test(trimmed) && trimmed.includes('-');
};

/** Строка — часть таблицы, если это разделитель или рядом строка с тем же числом ячеек. */
const isTableLine = (lines: string[], index: number): boolean => {
  const cells = parseTableRow(lines[index]);

  if (!cells) return false;

  if (isSeparatorRow(lines[index])) return true;

  const neighbours = [lines[index - 1], lines[index + 1]].filter((line): line is string => line !== undefined);

  return neighbours.some((line) => {
    if (isSeparatorRow(line)) return true;

    const other = parseTableRow(line);

    return other !== null && Math.abs(other.length - cells.length) <= 1;
  });
};

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^[*\-•]\s+(.*)$/;
const ORDERED = /^(\d+)\.\s+(.*)$/;

/**
 * Построчный разбор: списки, таблицы, заголовки, линии и абзацы.
 *
 * Состояние — открытый список и открытая таблица — общее для всех строк,
 * поэтому разбор собран в класс.
 */
class MarkdownBlocks {
  private readonly out: string[] = [];

  private list: { tag: 'ul' | 'ol'; start: number } | null = null;

  private inTable = false;

  private tableRows = 0;

  constructor(private readonly options: MarkdownOptions) {}

  render(text: string): string {
    const lines = text.split('\n');

    lines.forEach((rawLine, index) => {
      const line = rawLine.trim();
      const bullet = BULLET.exec(line);
      const ordered = ORDERED.exec(line);

      if (bullet || ordered) {
        this.closeTable();
        this.pushListItem(bullet ? 'ul' : 'ol', bullet ? bullet[1] : ordered![2], ordered ? Number(ordered[1]) : 1);

        return;
      }

      this.closeList();

      if (isTableLine(lines, index)) {
        this.pushTableLine(line);

        return;
      }

      this.closeTable();
      this.pushBlock(line);
    });

    this.closeList();
    this.closeTable();

    return this.out.join('');
  }

  private inline(text: string): string {
    return inlineMarkdownToHtml(text, this.options.placeholder);
  }

  private pushListItem(tag: 'ul' | 'ol', text: string, number: number): void {
    if (this.list && this.list.tag !== tag) this.closeList();

    if (!this.list) {
      this.list = { tag, start: number };
      // Нумерация сохраняется: список со 2 пункта так и остаётся со 2.
      this.out.push(tag === 'ol' && number !== 1 ? `<ol start="${number}">` : `<${tag}>`);
    }

    this.out.push(`<li><p>${this.inline(text)}</p></li>`);
  }

  private closeList(): void {
    if (!this.list) return;

    this.out.push(`</${this.list.tag}>`);
    this.list = null;
  }

  private pushTableLine(line: string): void {
    if (!this.inTable) {
      this.inTable = true;
      this.tableRows = 0;
      this.out.push('<table><tbody>');
    }

    if (isSeparatorRow(line)) return;

    const cells = parseTableRow(line) ?? [];
    const tag = this.tableRows === 0 ? 'th' : 'td';

    this.tableRows += 1;
    this.out.push(`<tr>${cells.map((cell) => `<${tag}><p>${this.inline(cell)}</p></${tag}>`).join('')}</tr>`);
  }

  private closeTable(): void {
    if (!this.inTable) return;

    this.out.push('</tbody></table>');
    this.inTable = false;
  }

  private pushBlock(line: string): void {
    if (line === '') {
      this.out.push('<p></p>');

      return;
    }

    const heading = HEADING.exec(line);

    if (heading) {
      const level = Math.min(heading[1].length, 3);

      this.out.push(`<h${level}>${this.inline(heading[2])}</h${level}>`);

      return;
    }

    if (/^-{3,}$/.test(line)) {
      this.out.push('<hr>');

      return;
    }

    // Строка из одного плейсхолдера блока — сам блок, без абзаца вокруг.
    if (this.options.isBlockPlaceholder(line)) {
      this.out.push(line);

      return;
    }

    // Одинокая строка таблицы без соседей — просто текст её ячеек.
    const stray = line.startsWith('|') && line.endsWith('|') ? line.split('|').slice(1, -1).join(' ').trim() : line;

    this.out.push(`<p>${this.inline(stray || line)}</p>`);
  }
}

export const markdownToHtml = (text: string, options: MarkdownOptions): string =>
  new MarkdownBlocks(options).render(text);
