const SUBSCRIPT_DIGITS = '₀₁₂₃₄₅₆₇₈₉';

const SUPERSCRIPTS: Record<string, string> = {
  0: '⁰',
  1: '¹',
  2: '²',
  3: '³',
  4: '⁴',
  5: '⁵',
  6: '⁶',
  7: '⁷',
  8: '⁸',
  9: '⁹',
  '+': '⁺',
  '-': '⁻',
};

const toSubscript = (text: string): string =>
  text.replace(/\d/g, (digit) => SUBSCRIPT_DIGITS[Number(digit)] ?? digit);

const toSuperscript = (text: string): string =>
  text.replace(/./g, (char) => SUPERSCRIPTS[char] ?? char);

/**
 * Подпись атома для вывода: `CH_3` → `CH₃`, `SO_4^{2-}` → `SO₄²⁻`.
 *
 * Индексы в SVG проще набрать юникодом, чем отдельными `<tspan>`: подпись
 * остаётся одной строкой, и её ширину можно оценить по числу знаков. Цифра
 * сразу после буквы или скобки тоже считается индексом — так пишут без
 * подчёркивания и люди, и распознавание.
 */
export const formatChemLabel = (label: string): string =>
  label
    .replace(/\^\{([^}]*)\}/g, (_, group: string) => toSuperscript(group))
    .replace(/\^([^\s_^{}])/g, (_, char: string) => toSuperscript(char))
    .replace(/_\{([^}]*)\}/g, (_, group: string) => toSubscript(group))
    .replace(/_(\d+)/g, (_, digits: string) => toSubscript(digits))
    .replace(/_([^\s_^{}])/g, (_, char: string) => char)
    .replace(/(?<=[A-Za-z)\]])(\d+)/g, (_, digits: string) => toSubscript(digits))
    .replace(/[{}]/g, '');
