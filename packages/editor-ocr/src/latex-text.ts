/**
 * Подготовка LaTeX в тексте распознавания.
 *
 * Нейросеть пишет формулы по-разному: с двойными слешами, без `$`, с
 * незакрытыми окружениями, с `\ce{}` для реакций. Функции ниже приводят
 * текст к виду, который понимает конвертер LaTeX → MathML, не меняя
 * содержания формул.
 */

const ENVIRONMENTS = ['cases', 'aligned', 'array', 'vmatrix', 'pmatrix', 'matrix', 'Bmatrix', 'bmatrix', 'tabular', 'gather', 'align'];

const CLOSABLE_ENVIRONMENTS = ['cases', 'aligned', 'array', 'vmatrix', 'pmatrix', 'matrix', 'tabular'];

/** `\\frac` из JSON-строк → `\frac`. */
export const unescapeDoubleBackslashCommands = (text: string): string =>
  text.replace(/\\\\([a-zA-Z]+|[{}[\]|])/g, (_, command: string) => `\\${command}`);

/** `\left (` → `\left(`: пробел после `\left` ломает MathLive. */
export const normalizeLeftRightDelimiters = (text: string): string =>
  text.replace(/\\left\s+([([{.|)])/g, '\\left$1').replace(/\\right\s+([)\]},.|(])/g, '\\right$1');

/** `tabular` — табличное окружение текста; в формуле это `array`. */
export const tabularToArray = (text: string): string =>
  text
    .replace(/\\begin\s*\{\s*tabular\s*\}\s*(\{[^}]*\})/g, '\\begin{array}$1')
    .replace(/\\end\s*\{\s*tabular\s*\}/g, '\\end{array}')
    .replace(/\\cline\s*\{?\s*\d+-\d+\s*\}?/g, '\\hline');

/**
 * Закрывает окружения, у которых `\begin` есть, а `\end` нет: конец
 * окружения — перед следующим заголовком Markdown или в конце текста.
 */
export const closeOpenEnvironments = (text: string): string => {
  let result = text;

  CLOSABLE_ENVIRONMENTS.forEach((name) => {
    const begin = new RegExp(`\\\\begin\\s*\\{\\s*${name}\\s*\\}`, 'g');
    const end = new RegExp(`\\\\end\\s*\\{\\s*${name}\\s*\\}`, 'g');
    const opens = [...result.matchAll(begin)].map((match) => ({ index: match.index, length: match[0].length }));
    const closes = [...result.matchAll(end)].map((match) => ({ index: match.index }));

    if (opens.length <= closes.length) return;

    // Скобочный проход: каждое `\end` закрывает ближайший открытый `\begin`.
    const events = [
      ...opens.map((open) => ({ ...open, kind: 'begin' as const })),
      ...closes.map((close) => ({ ...close, length: 0, kind: 'end' as const })),
    ].sort((a, b) => a.index - b.index);
    const unclosed: Array<{ index: number; length: number }> = [];

    events.forEach((event) => {
      if (event.kind === 'begin') unclosed.push(event);
      else unclosed.pop();
    });

    unclosed
      .sort((a, b) => b.index - a.index)
      .forEach((open) => {
        const after = result.slice(open.index + open.length);
        const heading = /\n#[#\s]/.exec(after);
        const cut = open.index + open.length + (heading ? heading.index : after.length);

        result = `${result.slice(0, cut)}\n\\end{${name}}\n${result.slice(cut)}`;
      });
  });

  return result;
};

/** Полная нормализация LaTeX: слеши, табуляр, разделители, незакрытые окружения. */
export const normalizeLatexText = (text: string): string =>
  closeOpenEnvironments(normalizeLeftRightDelimiters(tabularToArray(unescapeDoubleBackslashCommands(text))));

/** Внутри окружений `$` лишние: они рвут формулу на части. */
export const stripDollarsInsideEnvironments = (text: string): string =>
  ENVIRONMENTS.reduce((result, name) => {
    const pattern = new RegExp(`(\\\\begin\\s*\\{\\s*${name}\\s*\\})([\\s\\S]*?)(\\\\end\\s*\\{\\s*${name}\\s*\\})`, 'g');

    return result.replace(pattern, (_, open: string, body: string, close: string) => `${open}${body.replace(/\$/g, '')}${close}`);
  }, text);

/** Строки таблиц, склеенные в одну, и разделитель заголовка без переносов. */
export const fixMarkdownTableLines = (text: string): string => {
  let result = text;
  let previous = '';
  let guard = 0;

  while (previous !== result && guard < 10) {
    previous = result;
    result = result.replace(/(\|[^\n|]+\|[^\n|]*\|)\s*\|\s*([^\n|]+\|[^\n|]*\|)/g, '$1\n| $2');
    guard += 1;
  }

  return result
    .replace(/([^\n])\s*(\|(?:[\s-]*:?---+:?[\s-]*\|)+)/g, '$1\n$2')
    .replace(/(\|(?:[\s-]*:?---+:?[\s-]*\|)+)\s*([^\n])/g, '$1\n$2');
};

/**
 * `|a b c d|` — определитель, записанный палочками: четыре или девять
 * коротких элементов становятся `vmatrix`. Строки таблиц и прозу не трогает.
 */
export const pipesToVmatrix = (text: string): string =>
  text.replace(/\|([^|\n]+)\|/g, (whole, inner: string) => {
    if (/[=]|\\cdot|\\times|\\begin|\\end|:---|---:|---|\\rightarrow|\\Rightarrow/.test(inner)) return whole;

    if (/[a-zA-Zа-яА-ЯёЁ]{5,}/.test(inner)) return whole;

    const cells: string[] = [];
    let current = '';
    let depth = 0;

    [...inner].forEach((char) => {
      if (char === '{') depth += 1;

      if (char === '}') depth = Math.max(0, depth - 1);

      if ((char === ' ' || char === '\t') && depth === 0) {
        if (current.trim()) cells.push(current.trim());

        current = '';

        return;
      }

      current += char;
    });

    if (current.trim()) cells.push(current.trim());

    if (cells.length === 0 || !cells.every((cell) => cell.length <= 12 && !cell.includes('='))) return whole;

    if (cells.length === 4) {
      return `\\begin{vmatrix} ${cells[0]} & ${cells[1]} \\\\ ${cells[2]} & ${cells[3]} \\end{vmatrix}`;
    }

    if (cells.length === 9) {
      return (
        `\\begin{vmatrix} ${cells[0]} & ${cells[1]} & ${cells[2]} \\\\ `
        + `${cells[3]} & ${cells[4]} & ${cells[5]} \\\\ ${cells[6]} & ${cells[7]} & ${cells[8]} \\end{vmatrix}`
      );
    }

    return whole;
  });

/**
 * Реакция из `\ce{…}` в LaTeX для формулы типа «химия»: `2H2 + O2 -> 2H2O`
 * → `2 \text{H}_2 + \text{O}_2 \to 2 \text{H}_2\text{O}`.
 */
export const ceToLatex = (source: string): string => {
  const trimmed = source.trim();

  if (!trimmed) return '';

  const parts = trimmed.split(/(\s*\+\s*|\s*->\s*\[[^\]]*\]|\s*->\s*|\s*-\s*|\s*=\s*|\s*\\equiv\s*)/g);

  return parts
    .map((part, index) => {
      if (index % 2 === 1) {
        const operator = part.trim();

        if (operator === '-') return ' \\text{-} ';

        if (operator === '->') return ' \\to ';

        const conditions = /^->\s*\[(.*?)\]$/.exec(operator);

        if (conditions) return ` \\xrightarrow{\\text{${conditions[1].replace(/\^o/g, '^\\circ').trim()}}} `;

        return part;
      }

      let formula = part.trim();

      if (!formula) return '';

      const coefficient = /^(\d+)\s*(.*)$/.exec(formula);
      let prefix = '';

      if (coefficient) {
        prefix = `${coefficient[1]} `;
        formula = coefficient[2].trim();
      }

      if (!formula) return prefix.trim();

      const body = formula
        .split(/([A-Za-z()]+|\d+)/g)
        .filter(Boolean)
        .map((piece) => (/^\d+$/.test(piece) ? `_${piece}` : `\\text{${piece}}`))
        .join('');

      return prefix + body;
    })
    .join('')
    .trim();
};

/** Находит `\command{…}` с учётом вложенных скобок; возвращает границы и тело. */
export const findBraced = (
  text: string,
  command: string,
  from = 0,
): { start: number; end: number; body: string } | null => {
  const at = text.indexOf(`${command}{`, from);

  if (at === -1) return null;

  // Экранированный слеш перед командой — часть той же записи.
  let start = at;

  while (start > 0 && text[start - 1] === '\\') start -= 1;

  let depth = 1;
  let index = at + command.length + 1;
  let body = '';

  while (index < text.length && depth > 0) {
    const char = text[index];

    if (char === '{') depth += 1;
    else if (char === '}') depth -= 1;

    if (depth > 0) body += char;

    index += 1;
  }

  return depth === 0 ? { start, end: index, body } : null;
};

/** Все `\ce{…}` внутри формулы → их LaTeX. */
export const replaceCeBlocks = (latex: string): string => {
  let result = latex;
  let found = findBraced(result, '\\ce');

  while (found) {
    result = `${result.slice(0, found.start)}${ceToLatex(found.body)}${result.slice(found.end)}`;
    found = findBraced(result, '\\ce');
  }

  return result;
};

/**
 * Оборачивает в `$` формулы, которые нейросеть оставила голыми: окружения,
 * `\left…\right`, последовательности команд с аргументами. Уже обёрнутое и
 * плейсхолдеры не трогает.
 */
export const wrapBareLatex = (text: string, placeholderPattern: RegExp): string => {
  const saved: string[] = [];

  const stash = (value: string): string => {
    saved.push(value);

    return `${saved.length - 1}`;
  };

  let result = text.replace(placeholderPattern, (match) => stash(match));

  result = result.replace(/\$\$[\s\S]*?\$\$/g, (match) => stash(match));
  result = result.replace(/\$(?!\$)[\s\S]+?\$/g, (match) => (/\n\s*\n/.test(match) ? match : stash(match)));

  CLOSABLE_ENVIRONMENTS.forEach((name) => {
    const pattern = new RegExp(`\\\\begin\\s*\\{\\s*${name}\\s*\\}[\\s\\S]*?\\\\end\\s*\\{\\s*${name}\\s*\\}`, 'g');

    result = result.replace(pattern, (match) => stash(`\n$$\n${match.trim()}\n$$\n`));
  });

  result = result.replace(/\\left[([{.|][\s\S]*?\\right[)\]}.|]/g, (match) => stash(`\n$$\n${match.trim()}\n$$\n`));

  // Команда с аргументами и хвостом из символов формулы: `\frac{a}{b} + 1`.
  const bare = /\\(?:[a-zA-Z]+|\S)(?:\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}|\[[^[\]]*\]|[a-zA-Z0-9_^+\-=,.\s()]|\\[a-zA-Z]+)*/g;

  result = result.replace(bare, (match) => {
    const trimmed = match.trim();

    if (!trimmed || /\d+/.test(trimmed) || /^[0-9\s+=:-]+$/.test(trimmed)) return match;

    // Пробелы по краям — часть прозы вокруг, а не формулы.
    const leading = /^\s*/.exec(match)?.[0] ?? '';
    const trailing = /\s*$/.exec(match)?.[0] ?? '';

    return `${leading}$${trimmed}$${trailing}`;
  });

  result = result.replace(/\\\\{1,2}\s*$/gm, '');

  return result.replace(/(\d+)/g, (_, index: string) => saved[Number(index)] ?? '');
};
