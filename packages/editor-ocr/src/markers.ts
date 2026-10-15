/**
 * Маркеры блоков в тексте распознавания PinQueen.
 *
 * Бэкенд оборачивает TikZ и JSON-сцену маркерами `TIKZ_START` / `TIKZ_END`,
 * `DATA_START` / `DATA_END`; обёртка бывает трёх видов — `<<<X>>>`, `[[[X]]]`
 * и `$X$`, — а пробелы внутри гуляют. Регулярные выражения здесь
 * принимают любой вариант и отдают текст между маркерами.
 */

/** Открывающая или закрывающая обёртка маркера: `<<<`, `[[[` или ничего. */
const OPEN = '(?:<<<|\\[\\[\\[)?';
const CLOSE = '(?:>>>|\\]\\]\\])?';

/** Один маркер с любой обёрткой, например `<<< $TIKZ_START$ >>>`. */
const marker = (name: string): string => `${OPEN}\\s*\\$?${name}\\$?\\s*${CLOSE}`;

/** Пара маркеров с содержимым между ними. */
const block = (name: string): RegExp =>
  new RegExp(`${marker(`${name}_START`)}\\s*([\\s\\S]*?)\\s*${marker(`${name}_END`)}`, 'g');

export const TIKZ_BLOCK = block('TIKZ');
export const DATA_BLOCK = block('DATA');
export const SVG_BLOCK = block('SVG');

/** Маркеры границ всего текста: `OCR_START` / `OCR_END` в любом написании. */
export const OCR_BOUNDARY = new RegExp(
  `${OPEN}\\s*\\$?OCR_(?:START|S_T\\s*ART|END|E_N\\s*ND)\\$?\\s*${CLOSE}`,
  'gi',
);

/** Плейсхолдер чертежа, который бэкенд оставляет в тексте: `$GEOMETRY_1$` или `%%$GEOMETRY_1$%%`. */
export const GEOMETRY_PLACEHOLDER = /(?:%%\s*)?\$GEOMETRY_\d+\$(?:\s*%%)?/g;

/** Блоки, которые мы пишем обратно. */
export const wrapBlock = (name: string, body: string): string =>
  `\n<<<${name}_START>>>\n${body}\n<<<${name}_END>>>\n`;

/** Все вхождения блока: содержимое по порядку. */
export const extractBlocks = (text: string, pattern: RegExp): string[] =>
  [...text.matchAll(pattern)].map((match) => match[1].trim());
