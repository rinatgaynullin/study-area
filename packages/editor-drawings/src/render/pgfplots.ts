/**
 * Разбор pgfplots-кода в сырую сцену `plot_2d` для `normalizeGeometryScene`.
 *
 * Нейросеть иногда отдаёт график не JSON-сценой, а TikZ: `\addplot{x^2-2*x+1};`,
 * `\addplot[only marks] coordinates {(1,2)};`, `\node at (axis cs:1,2) {A};`.
 * Разбираются многочлены до второй степени, `k/x`, `sqrt(x)`, точки и подписи;
 * всё остальное пропускается. Выход — сырой объект, а не `GeometryScene`:
 * типизацию и умолчания даёт нормализация.
 */

type RawPlot = Record<string, unknown>;

interface AddplotCommand {
  options: string;
  /** Слово между опциями и фигурной группой: `coordinates`, `table` или ничего. */
  keyword: string;
  body: string;
  /** Конец команды в тексте — отсюда ищется `\addlegendentry`. */
  end: number;
}

interface Polynomial {
  a: number;
  b: number;
  c: number;
}

/** Именованные цвета pgfplots → цвета чертежа. */
const NAMED_COLORS: Record<string, string> = {
  blue: '#2563eb',
  red: '#dc2626',
  green: '#16a34a',
  orange: '#f97316',
  purple: '#9333ea',
  violet: '#7c3aed',
  magenta: '#db2777',
  pink: '#ec4899',
  cyan: '#0891b2',
  teal: '#0d9488',
  brown: '#92400e',
  olive: '#4d7c0f',
  gray: '#6b7280',
  grey: '#6b7280',
  black: '#1e293b',
};

const NUMBER = '[-+]?(?:\\d+\\.?\\d*|\\.\\d+)';
const COORDINATE_PAIR = new RegExp(`\\(\\s*(${NUMBER})\\s*,\\s*(${NUMBER})\\s*\\)`, 'g');
const NODE_AT = new RegExp(
  `\\\\node\\b[^;{]*?\\bat\\s*\\(\\s*(?:axis\\s+cs\\s*:\\s*)?(${NUMBER})\\s*,\\s*(${NUMBER})\\s*\\)[^{;]*\\{([^}]*)\\}`,
  'g',
);
const DOMAIN = new RegExp(`\\bdomain\\s*=\\s*(${NUMBER})\\s*:\\s*(${NUMBER})`);
/** Подпись ставится на точку, если она ближе этого расстояния в единицах графика. */
const LABEL_SNAP = 0.1;

/** `-b / 2a` при `b = 0` даёт `-0`, который потом всплывает в JSON и сравнениях. */
const unsigned = (value: number): number => (value === 0 ? 0 : value);

/** Текст между парными скобками начиная с `start` (где стоит `open`) и позиция после закрывающей. */
const readBalanced = (source: string, start: number, open: string, close: string): { text: string; end: number } | null => {
  let depth = 0;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];

    if (char === open) depth += 1;

    if (char === close) {
      depth -= 1;

      if (depth === 0) return { text: source.slice(start + 1, index), end: index + 1 };
    }
  }

  return null;
};

const skipSpaces = (source: string, index: number): number => {
  let position = index;

  while (position < source.length && /\s/.test(source[position])) position += 1;

  return position;
};

/** Все `\addplot` в тексте: опции в `[...]`, необязательное слово, тело в `{...}`. */
const findAddplots = (source: string): AddplotCommand[] => {
  const commands: AddplotCommand[] = [];
  let cursor = source.indexOf('\\addplot');

  while (cursor >= 0) {
    let position = cursor + '\\addplot'.length;

    if (source[position] === '+') position += 1;

    position = skipSpaces(source, position);

    let options = '';

    if (source[position] === '[') {
      const group = readBalanced(source, position, '[', ']');

      if (group) {
        options = group.text;
        position = skipSpaces(source, group.end);
      }
    }

    const word = /^[a-z]+/i.exec(source.slice(position));
    const keyword = word ? word[0].toLowerCase() : '';

    position = skipSpaces(source, position + keyword.length);

    const body = source[position] === '{' ? readBalanced(source, position, '{', '}') : null;

    if (body) {
      commands.push({ options, keyword, body: body.text, end: body.end });
      position = body.end;
    }

    cursor = source.indexOf('\\addplot', Math.max(position, cursor + 1));
  }

  return commands;
};

const readAxisLabel = (source: string, key: 'xlabel' | 'ylabel'): string | undefined => {
  const match = new RegExp(`\\b${key}\\s*=\\s*(?:\\{([^}]*)\\}|([^,\\]\\s]+))`).exec(source);
  const text = (match?.[1] ?? match?.[2] ?? '').replace(/\$/g, '').trim();

  return text === '' ? undefined : text;
};

const readColor = (options: string): string | undefined => {
  const match = /\b(blue|red|green|orange|purple|violet|magenta|pink|cyan|teal|brown|olive|gray|grey|black)\b/i.exec(options);

  return match ? NAMED_COLORS[match[1].toLowerCase()] : undefined;
};

const readDomain = (options: string): [number, number] | undefined => {
  const match = DOMAIN.exec(options);

  return match ? [Number(match[1]), Number(match[2])] : undefined;
};

/** Общие поля графика из опций: цвет, пунктир, область. */
const baseFields = (options: string): RawPlot => ({
  ...(readColor(options) ? { color: readColor(options) } : {}),
  ...(/\b(dashed|dotted)\b/i.test(options) ? { style: 'dashed' } : {}),
  ...(readDomain(options) ? { domain: readDomain(options) } : {}),
});

/** Число из коэффициента: пусто — единица, `1/2` — дробь. */
const coefficient = (text: string | undefined): number => {
  if (!text) return 1;

  const [numerator, denominator] = text.split('/');

  return denominator ? Number(numerator) / Number(denominator) : Number(numerator);
};

const COEFFICIENT = '(\\d*\\.?\\d+(?:\\/\\d*\\.?\\d+)?)?';

/** Один член многочлена без знака: `2x^2`, `(x-1)^2`, `3*x`, `x`, `5`. */
const parseTerm = (term: string): Polynomial | null => {
  const square = new RegExp(`^${COEFFICIENT}\\*?\\(x([+-]\\d*\\.?\\d+)\\)\\^2$`).exec(term);

  if (square) {
    const k = coefficient(square[1]);
    const h = Number(square[2]);

    return { a: k, b: 2 * k * h, c: k * h * h };
  }

  const quadratic = new RegExp(`^${COEFFICIENT}\\*?x\\^2$`).exec(term);

  if (quadratic) return { a: coefficient(quadratic[1]), b: 0, c: 0 };

  const linear = new RegExp(`^${COEFFICIENT}\\*?x$`).exec(term);

  if (linear) return { a: 0, b: coefficient(linear[1]), c: 0 };

  const constant = new RegExp(`^${COEFFICIENT}$`).exec(term);

  if (constant && constant[1]) return { a: 0, b: 0, c: coefficient(constant[1]) };

  return null;
};

/** Многочлен `ax² + bx + c` из выражения pgfplots; `null`, если это не он. */
const parsePolynomial = (expression: string): Polynomial | null => {
  const source = expression.replace(/\s+/g, '').replace(/\*\*/g, '^');

  if (source === '') return null;

  const total: Polynomial = { a: 0, b: 0, c: 0 };
  let depth = 0;
  let termStart = 0;
  let sign = 1;

  const flush = (end: number): boolean => {
    const term = source.slice(termStart, end);

    if (term === '') return false;

    const parsed = parseTerm(term);

    if (!parsed) return false;

    total.a += sign * parsed.a;
    total.b += sign * parsed.b;
    total.c += sign * parsed.c;

    return true;
  };

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (char === '(') depth += 1;

    if (char === ')') depth -= 1;

    if ((char === '+' || char === '-') && depth === 0) {
      // Знак в начале или сразу после `^`/`(` — часть члена, а не разделитель.
      const previous = source[index - 1];

      if (index === termStart && index === 0) {
        sign = char === '-' ? -1 : 1;
        termStart = index + 1;

        continue;
      }

      if (previous === '^' || previous === '(') continue;

      if (!flush(index)) return null;

      sign = char === '-' ? -1 : 1;
      termStart = index + 1;
    }
  }

  return flush(source.length) ? total : null;
};

const sqrtPlot = (expression: string): RawPlot | null => {
  const source = expression.replace(/\s+/g, '');
  const match = /^(-)?sqrt\((-)?x(?:([+-]\d*\.?\d+))?\)$/.exec(source);

  if (!match) return null;

  const directionX = match[2] ? -1 : 1;
  const shift = match[3] ? Number(match[3]) : 0;

  return {
    type: 'sqrt',
    vertex: [unsigned(-shift / directionX), 0],
    directionX: directionX < 0 ? 'left' : 'right',
    directionY: match[1] ? 'down' : 'up',
    stretch: 1,
  };
};

const hyperbolaPlot = (expression: string): RawPlot | null => {
  const source = expression.replace(/\s+/g, '');
  const match = /^(-)?(\d*\.?\d+)?\/x$/.exec(source);

  if (!match) return null;

  const k = (match[1] ? -1 : 1) * (match[2] ? Number(match[2]) : 1);

  return { type: 'hyperbola', center: [0, 0], k };
};

const pointsFromBody = (body: string, options: string): RawPlot[] => {
  const hollow = /\bmark\s*=\s*o\b/i.test(options) || /\bfill\s*=\s*white\b/i.test(options);
  const color = readColor(options);
  const points: RawPlot[] = [];

  for (const match of body.matchAll(COORDINATE_PAIR)) {
    points.push({
      type: 'point',
      coords: [Number(match[1]), Number(match[2])],
      style: hollow ? 'void' : 'solid',
      ...(color ? { color } : {}),
    });
  }

  return points;
};

/** Подпись из `\addlegendentry{…}` сразу после команды, пока не начался следующий график. */
const legendAfter = (source: string, command: AddplotCommand): string | undefined => {
  const nextPlot = source.indexOf('\\addplot', command.end);
  const tail = source.slice(command.end, nextPlot < 0 ? source.length : nextPlot);
  const match = /\\addlegendentry\s*\{([^}]*)\}/.exec(tail);
  const text = match?.[1].replace(/\$/g, '').trim();

  return text ? text : undefined;
};

const plotsFromCommand = (source: string, command: AddplotCommand, yLabel: string): RawPlot[] => {
  const { options, keyword, body } = command;

  if (keyword === 'coordinates' || /\bonly\s+marks\b/i.test(options)) return pointsFromBody(body, options);

  if (keyword !== '') return [];

  const expression = body.trim();
  const label = legendAfter(source, command) ?? `${yLabel} = ${expression.replace(/\*/g, '')}`;
  const base = { ...baseFields(options), label };
  const polynomial = parsePolynomial(expression);

  if (polynomial) {
    const { a, b, c } = polynomial;

    if (a !== 0) {
      const vertexX = -b / (2 * a);

      return [
        {
          type: 'parabola',
          vertex: [unsigned(vertexX), unsigned(a * vertexX * vertexX + b * vertexX + c)],
          direction: a < 0 ? 'down' : 'up',
          stretchY: Math.abs(a),
          ...base,
        },
      ];
    }

    return [{ type: 'line', k: b, b: c, ...base }];
  }

  const special = sqrtPlot(expression) ?? hyperbolaPlot(expression);

  return special ? [{ ...special, ...base }] : [];
};

/** Подпись `\node` ставится на ближайшую точку или становится новой точкой. */
const applyNodes = (source: string, plots: RawPlot[]): void => {
  for (const match of source.matchAll(NODE_AT)) {
    const x = Number(match[1]);
    const y = Number(match[2]);
    const label = match[3].replace(/\$/g, '').replace(/\s+/g, ' ').trim();

    if (label === '') continue;

    const point = plots.find((plot) => {
      const coords = plot.coords;

      return (
        plot.type === 'point'
        && Array.isArray(coords)
        && Math.abs(Number(coords[0]) - x) < LABEL_SNAP
        && Math.abs(Number(coords[1]) - y) < LABEL_SNAP
      );
    });

    if (point) {
      point.label = label;
    } else {
      plots.push({ type: 'point', coords: [x, y], style: 'solid', label });
    }
  }
};

/**
 * Сырая сцена `plot_2d` из pgfplots-кода или `null`, если графиков в нём нет.
 * Парабола отдаёт `stretchY` — поле, которое читает рендер.
 */
export const parsePgfplotsTikz = (tikz: string): Record<string, unknown> | null => {
  if (typeof tikz !== 'string' || tikz.trim() === '') return null;

  const axes = { x_label: readAxisLabel(tikz, 'xlabel') ?? 'x', y_label: readAxisLabel(tikz, 'ylabel') ?? 'y' };
  const plots = findAddplots(tikz).flatMap((command) => plotsFromCommand(tikz, command, axes.y_label));

  applyNodes(tikz, plots);

  return plots.length === 0 ? null : { type: 'plot_2d', axes, plots };
};
