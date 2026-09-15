/**
 * Достаёт MathML из атрибута `data-mathml`, которым Froala/Wiris помечает
 * картинку формулы.
 *
 * Значение приходит закодированным, причём в двух разных видах в зависимости
 * от версии и настроек Wiris:
 *
 * - HTML-экранирование, зачастую двойное (`&amp;lt;math&amp;gt;`), потому что
 *   строку экранировали и при сохранении в атрибут, и при записи в БД;
 * - «безопасный XML» Wiris, где угловые скобки и кавычки заменены на `«`, `»`
 *   и `¨`, чтобы разметка гарантированно пережила любой санитайзер.
 *
 * Обрабатываем оба: угадывать по конфигурации нечего, а неверно разобранный
 * атрибут молча превратит формулу в мусор.
 */

/** Символы «безопасного XML» Wiris и их настоящие значения. */
const WIRIS_SAFE_XML: ReadonlyArray<readonly [RegExp, string]> = [
  [/«/g, '<'],
  [/»/g, '>'],
  [/¨/g, '"'],
  [/§/g, '&'],
  [/`/g, "'"],
];

/** Сколько раз подряд пытаемся снять HTML-экранирование. */
const MAX_UNESCAPE_PASSES = 3;

function unescapeHtmlOnce(value: string): string {
  const element = document.createElement('textarea');
  element.innerHTML = value;
  return element.value;
}

/**
 * Снимает экранирование, пока строка меняется, но не больше нескольких проходов.
 * Ограничение защищает от данных, где `&amp;amp;amp;…` раскручивается бесконечно.
 */
export function decodeWirisMathml(raw: string): string {
  if (!raw) return '';
  if (typeof document === 'undefined') return raw;

  let value = raw;
  for (const [pattern, character] of WIRIS_SAFE_XML) {
    value = value.replace(pattern, character);
  }

  for (let pass = 0; pass < MAX_UNESCAPE_PASSES; pass += 1) {
    if (value.includes('<math')) break;
    const next = unescapeHtmlOnce(value);
    if (next === value) break;
    value = next;
  }

  return value.includes('<math') ? value : '';
}
