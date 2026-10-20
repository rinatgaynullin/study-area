/**
 * Терпимый разбор JSON-сцены.
 *
 * Сцена приходит от нейросети и от людей: с ограждением ```json, хвостовыми
 * запятыми, одинарными и «умными» кавычками, комментариями. Исправления
 * применяются по одному, пока `JSON.parse` не согласится; `eval` и
 * `new Function` не используются.
 */

const FENCE = /^```[a-z]*\s*|\s*```$/gi;

/** Отрезает всё до первой скобки объекта и после последней парной. */
const extractObject = (text: string): string => {
  const start = text.search(/[{[]/);

  if (start < 0) return text;

  const open = text[start];
  const close = open === '{' ? '}' : ']';
  const end = text.lastIndexOf(close);

  return end > start ? text.slice(start, end + 1) : text.slice(start);
};

/**
 * Команды LaTeX, которые начинаются с буквы escape-последовательности JSON:
 * без второго слеша `\frac` читается как перевод страницы и «rac»,
 * `\theta` — как табуляция и «heta», и разбор проходит без ошибки, но с
 * испорченной подписью. Переводов строк и табуляций в строках сцен не бывает,
 * поэтому слово из этого списка после слеша считается командой LaTeX.
 */
const LATEX_COMMANDS_LIKE_ESCAPES: ReadonlySet<string> = new Set([
  'backslash', 'bar', 'beta', 'bf', 'big', 'bigl', 'bigr', 'binom', 'bmod', 'bot', 'boxed', 'bullet',
  'forall', 'frac', 'frown',
  'nabla', 'ne', 'nearrow', 'neg', 'neq', 'newline', 'ngeq', 'ni', 'nleq', 'not', 'notin', 'nu',
  'rangle', 'rbrace', 'rceil', 'rfloor', 'rho', 'right', 'rightarrow', 'rightleftharpoons', 'rm',
  'tan', 'tau', 'text', 'textbf', 'textit', 'textrm', 'tfrac', 'therefore', 'theta', 'tilde', 'times', 'to', 'top',
  'triangle',
  'underline', 'uparrow', 'upsilon',
]);

/** Символы, которые после слеша образуют допустимый escape JSON. */
const JSON_ESCAPES = '"\\/bfnrtu';

/**
 * Удваивает слеш перед командой LaTeX внутри строк JSON до первой попытки
 * разбора: иначе `\frac` молча станет управляющим символом. Уже экранированный
 * `\\frac`, `\"`, `\n` перед обычным текстом и `\u00e9` остаются как есть.
 */
const escapeLatexCommands = (text: string): string => {
  let result = '';
  let inString = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (char === '"') inString = !inString;

    if (!inString || char !== '\\') {
      result += char;

      continue;
    }

    const next = text[index + 1] ?? '';
    const word = /^[a-zA-Z]+/.exec(text.slice(index + 1))?.[0] ?? '';

    if (!JSON_ESCAPES.includes(next) || LATEX_COMMANDS_LIKE_ESCAPES.has(word)) {
      // Недопустимый escape или команда LaTeX: слеш — часть текста.
      result += '\\\\';

      continue;
    }

    // Допустимый escape переписывается целиком, чтобы `\"` не закрыл строку.
    result += char + next;
    index += 1;
  }

  return result;
};

/** Правки по возрастанию грубости: каждая следующая применяется поверх предыдущих. */
const REPAIRS: Array<(text: string) => string> = [
  // LaTeX в строках: `\vec{F}` — недопустимый escape для JSON, удваиваем слеш.
  (text) => text.replace(/\\(?!["\\/bfnrtu])/g, '\\\\'),
  (text) => text.replace(/[\u201c\u201d\u00ab\u00bb]/g, '"').replace(/[\u2018\u2019]/g, "'"),
  // Комментарии `//` и `/* */` вне строк — грубо, но строки сцены их не содержат.
  (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"'\\])\/\/[^\n]*/g, '$1'),
  (text) => text.replace(/,\s*([}\]])/g, '$1'),
  (text) => text.replace(/\b(NaN|Infinity|-Infinity|undefined)\b/g, 'null'),
  // Одинарные кавычки вокруг ключей и значений.
  (text) => text.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_, inner: string) => `"${inner.replace(/"/g, '\\"')}"`),
  // Ключи без кавычек.
  (text) => text.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":'),
];

const tryParse = (text: string): unknown | undefined => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

/**
 * Разбирает текст сцены. `null`, если даже после всех правок это не JSON.
 * Результат — произвольное значение: дальше его приводит нормализация.
 */
export const parseSceneJson = (text: string): unknown | null => {
  if (!text) return null;

  let current = escapeLatexCommands(extractObject(text.trim().replace(FENCE, '').trim()));
  const direct = tryParse(current);

  if (direct !== undefined) return direct;

  for (const repair of REPAIRS) {
    current = repair(current);

    const parsed = tryParse(current);

    if (parsed !== undefined) return parsed;
  }

  return null;
};

/** Сцена в строку для атрибута узла: компактно и детерминированно. */
export const stringifyScene = (scene: unknown): string => JSON.stringify(scene);
