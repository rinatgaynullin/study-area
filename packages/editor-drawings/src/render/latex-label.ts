import { escapeXml } from './svg-builder';

/**
 * Подписи физических схем приходят в подмножестве LaTeX: греческие буквы,
 * индексы, `\vec{F}`, `\text{…}`. Полноценный рендер формул здесь ни к
 * чему — хватает замены команд на юникод и `<tspan>` для индексов.
 */

const SYMBOLS: Record<string, string> = {
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  epsilon: 'ε',
  varepsilon: 'ε',
  eta: 'η',
  theta: 'θ',
  lambda: 'λ',
  mu: 'μ',
  nu: 'ν',
  pi: 'π',
  rho: 'ρ',
  sigma: 'σ',
  tau: 'τ',
  phi: 'φ',
  varphi: 'φ',
  chi: 'χ',
  psi: 'ψ',
  omega: 'ω',
  Delta: 'Δ',
  Omega: 'Ω',
  Phi: 'Φ',
  Psi: 'Ψ',
  propto: '∝',
  approx: '≈',
  cdot: '·',
  times: '×',
  pm: '±',
  le: '≤',
  ge: '≥',
  neq: '≠',
  infty: '∞',
  degree: '°',
  circ: '°',
  odot: '⊙',
  otimes: '⊗',
  cong: '≅',
};

const CALLIGRAPHIC: Record<string, string> = { E: 'ℰ', F: 'ℱ', P: '𝒫' };

const SUBSCRIPT_SIZE = 9.5;
const SUBSCRIPT_SHIFT = 4.5;

/** Разбивает строку на знаки: буква, индекс `_x`/`_{..}`, вектор, прочее. */
interface Token {
  kind: 'letter' | 'subscript' | 'text' | 'other';
  value: string;
  vector?: boolean;
}

const tokenize = (source: string): Token[] => {
  const tokens: Token[] = [];
  let index = 0;

  const readGroup = (): string => {
    // Открывающая скобка уже под курсором.
    let depth = 0;
    let text = '';

    while (index < source.length) {
      const char = source[index];

      index += 1;

      if (char === '{') {
        depth += 1;

        if (depth === 1) continue;
      }

      if (char === '}') {
        depth -= 1;

        if (depth === 0) return text;
      }

      text += char;
    }

    return text;
  };

  while (index < source.length) {
    const char = source[index];

    if (char === '\\') {
      const command = /^\\([A-Za-z]+)/.exec(source.slice(index));

      if (command) {
        index += command[0].length;

        const name = command[1];

        if (name === 'text' || name === 'mathrm' || name === 'mathit') {
          if (source[index] === '{') tokens.push({ kind: 'text', value: readGroup() });

          continue;
        }

        if (name === 'vec') {
          let target = '';

          if (source[index] === '{') {
            target = readGroup();
          } else {
            target = source[index] ?? '';
            index += 1;
          }

          // Стрелка рисуется над первой буквой; остальное — индекс или хвост.
          [...target].forEach((letter, position) => {
            tokens.push({ kind: /[A-Za-z]/.test(letter) ? 'letter' : 'other', value: letter, vector: position === 0 });
          });

          continue;
        }

        if (name === 'mathcal') {
          const target = source[index] === '{' ? readGroup() : '';

          tokens.push({ kind: 'other', value: CALLIGRAPHIC[target] ?? target });

          continue;
        }

        tokens.push({ kind: 'other', value: SYMBOLS[name] ?? '' });

        continue;
      }

      index += 1;

      continue;
    }

    if (char === '_' || char === '^') {
      index += 1;

      const value = source[index] === '{' ? readGroup() : (source[index] ?? '');

      if (source[index - 1] !== '}' && source[index] !== undefined && source[index] !== '{') index += 1;

      if (value) tokens.push({ kind: 'subscript', value });

      continue;
    }

    if (char === '{' || char === '}') {
      index += 1;

      continue;
    }

    tokens.push({ kind: /[A-Za-z]/.test(char) ? 'letter' : 'other', value: char });
    index += 1;
  }

  return tokens;
};

/**
 * LaTeX-подпись → разметка `<tspan>` для `<text>`. Результат уже
 * экранирован: вставлять как `markup`, не экранируя повторно.
 */
export const latexToSvgTspans = (latex: string): string => {
  if (!latex) return '';

  // `\t` из JSON без второго слеша читается как табуляция — это было начало `\text`.
  const source = latex.replace(/\t/g, '\\t').replace(/\\{2,}/g, '\\');

  return tokenize(source)
    .map((token) => {
      const safe = escapeXml(token.value);

      switch (token.kind) {
        case 'subscript':
          return `<tspan dy="${SUBSCRIPT_SHIFT}" font-size="${SUBSCRIPT_SIZE}">${safe}</tspan><tspan dy="-${SUBSCRIPT_SHIFT}"></tspan>`;
        case 'text':
          return `<tspan font-style="normal" font-weight="normal">${safe}</tspan>`;
        case 'letter':
          return token.vector
            ? `<tspan font-style="italic">${safe}</tspan><tspan dx="-7.5" dy="-8.5" font-size="8.5" font-style="normal">→</tspan><tspan dx="1" dy="8.5"></tspan>`
            : `<tspan font-style="italic">${safe}</tspan>`;
        default:
          return safe;
      }
    })
    .join('');
};

/** Подпись без разметки — для `aria-label` и TikZ. */
export const latexToPlainText = (latex: string): string =>
  tokenize(latex.replace(/\t/g, '\\t').replace(/\\{2,}/g, '\\'))
    .map((token) => (token.kind === 'subscript' ? `_${token.value}` : token.value))
    .join('');
