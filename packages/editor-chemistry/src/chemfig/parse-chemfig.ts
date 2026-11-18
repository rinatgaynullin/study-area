import type {
  ChemAtom,
  ChemBond,
  ChemBondType,
  ChemChain,
  ChemRing,
  ChemStructure,
} from './types';

/** Код не укладывается в поддерживаемое подмножество chemfig. */
export class ChemfigSyntaxError extends Error {
  constructor(
    message: string,
    readonly position: number,
  ) {
    super(message);
    this.name = 'ChemfigSyntaxError';
  }
}

const BOND_TYPES: ReadonlySet<string> = new Set(['-', '=', '~']);

const isBondType = (char: string | undefined): char is ChemBondType =>
  char !== undefined && BOND_TYPES.has(char);

const isSpace = (char: string | undefined): boolean => char !== undefined && /\s/.test(char);

const MIN_RING_SIZE = 3;
const MAX_RING_SIZE = 8;

/** Снимает обёртку `\chemfig{…}` (и `\\chemfig{…}` из экранированных строк). */
export const unwrapChemfig = (code: string): string => {
  const trimmed = code.trim();
  const match = /^\\{1,2}chemfig\s*\{([\s\S]*)\}$/.exec(trimmed);

  return match?.[1]?.trim() ?? trimmed;
};

/**
 * Угол из квадратных скобок: `[:30]` — градусы, `[2]` — доли по 45°.
 * Остальные параметры chemfig (длина, смещения) пропускаются; относительный
 * угол `[::30]` тоже — его считаем «угол не задан».
 */
const parseAngleSpec = (spec: string): number | null => {
  const first = spec.split(',')[0]?.trim() ?? '';

  if (first === '') return null;

  if (first.startsWith(':')) {
    const degrees = Number(first.slice(1));

    return Number.isFinite(degrees) ? degrees : null;
  }

  const steps = Number(first);

  return Number.isFinite(steps) ? steps * 45 : null;
};

/**
 * Хранит ли модель параметры в скобках целиком. Нет — если там несколько
 * полей (`[:30,1.5]`) или первое поле не стало углом (`[::30]`): тогда связь
 * запоминает исходный текст и пишет его дословно.
 */
const isLossySpec = (spec: string, angle: number | null): boolean => {
  const fields = spec.split(',');

  return fields.length > 1 || ((fields[0]?.trim() ?? '') !== '' && angle === null);
};

/**
 * Курсор по коду. Разбор рекурсивный — атом читает свои ветви и продолжение,
 * продолжение читает следующий атом, — поэтому позиция живёт в поле, а шаги
 * разбора ссылаются друг на друга через `this`.
 */
class ChemfigReader {
  private pos = 0;

  constructor(private readonly source: string) {}

  get eof(): boolean {
    return this.pos >= this.source.length;
  }

  peek(): string | undefined {
    return this.source[this.pos];
  }

  next(): string {
    const char = this.source[this.pos];

    if (char === undefined) throw this.error('Unexpected end of code');

    this.pos += 1;

    return char;
  }

  skipSpaces(): void {
    while (isSpace(this.peek())) this.pos += 1;
  }

  error(message: string): ChemfigSyntaxError {
    return new ChemfigSyntaxError(`${message} at position ${this.pos}`, this.pos);
  }

  /** Текст до парной закрывающей скобки; открывающая уже прочитана. */
  readBalanced(open: string, close: string): string {
    const start = this.pos;
    let depth = 1;
    let text = '';

    while (!this.eof) {
      const char = this.next();

      if (char === open) depth += 1;

      if (char === close) {
        depth -= 1;

        if (depth === 0) return text;
      }

      text += char;
    }

    throw new ChemfigSyntaxError(`Unclosed "${open}" at position ${start}`, start);
  }

  /** Открывает ли текущая `(` ветвь: первым внутри идёт знак связи. */
  isBranchStart(): boolean {
    let index = this.pos + 1;

    while (isSpace(this.source[index])) index += 1;

    return isBondType(this.source[index]);
  }

  /** Подпись атома: всё до знака связи, ветви или закрывающей скобки. */
  readLabel(): string {
    let label = '';

    while (!this.eof) {
      const char = this.peek();

      if (isBondType(char) || char === ')') break;

      if (char === '(') {
        if (this.isBranchStart()) break;

        // Скобки без связи внутри — часть подписи: `Si(CH_3)_3`.
        this.next();
        label += `(${this.readBalanced('(', ')')})`;

        continue;
      }

      label += this.next();
    }

    return label.trim();
  }

  /**
   * Атом с его связями: сколько угодно ветвей в скобках и не больше одной
   * связи продолжения — следующий атом сам читает своё продолжение.
   */
  readAtom(): ChemAtom {
    const label = this.readLabel();
    const bonds: ChemBond[] = [];

    for (;;) {
      this.skipSpaces();

      const char = this.peek();

      if (char === '(' && this.isBranchStart()) {
        this.next();
        bonds.push(this.readBond(true));
        this.skipSpaces();

        if (this.peek() !== ')') throw this.error('Expected ")" to close the branch');

        this.next();

        continue;
      }

      if (isBondType(char)) bonds.push(this.readBond(false));

      break;
    }

    return { label, bonds };
  }

  readBond(branch: boolean): ChemBond {
    const type = this.next() as ChemBondType;
    let angle: number | null = null;
    let spec: string | null = null;

    if (this.peek() === '[') {
      this.next();

      const text = this.readBalanced('[', ']');

      angle = parseAngleSpec(text);
      spec = isLossySpec(text, angle) ? text : null;
    }

    const bond: ChemBond = { type, angle, branch, target: this.readAtom() };

    if (spec !== null) bond.spec = spec;

    return bond;
  }

  /** Весь остаток должен быть прочитан: иначе в коде есть то, чего мы не понимаем. */
  expectEnd(): void {
    this.skipSpaces();

    if (!this.eof) throw this.error(`Unexpected "${this.peek()}"`);
  }
}

const parseChain = (code: string): ChemChain => {
  const reader = new ChemfigReader(code);

  reader.skipSpaces();

  let startAngle = 0;
  let startSpec: string | null = null;

  if (reader.peek() === '[') {
    reader.next();

    const text = reader.readBalanced('[', ']');
    const angle = parseAngleSpec(text);

    startAngle = angle ?? 0;
    startSpec = isLossySpec(text, angle) ? text : null;
  }

  const root = reader.readAtom();

  reader.expectEnd();

  if (!root.label && root.bonds.length === 0) throw new ChemfigSyntaxError('Empty structure', 0);

  const chain: ChemChain = { kind: 'chain', root, startAngle };

  if (startSpec !== null) chain.startSpec = startSpec;

  return chain;
};

/** Фрагмент у вершины кольца — атом с заместителями: `N`, `(-OH)`, `N(-CH_3)`. */
const parseFragment = (text: string): ChemAtom => {
  const reader = new ChemfigReader(text);
  const atom = reader.readAtom();

  reader.expectEnd();

  return atom;
};

const RING_START = /(\*\*?)(\d+)\(/;

/**
 * Атомы простой цепочки (одна связь продолжения у каждого, без углов и
 * параметров) и типы связей между ними; `false` — цепочка не простая.
 */
const collectSimpleChain = (atom: ChemAtom, atoms: ChemAtom[], types: ChemBondType[]): boolean => {
  atoms.push(atom);

  const [bond] = atom.bonds;

  if (!bond) return true;

  if (atom.bonds.length > 1 || bond.branch || bond.angle !== null || bond.spec !== undefined) return false;

  types.push(bond.type);

  return collectSimpleChain(bond.target, atoms, types);
};

/**
 * Цепочка префикса `A-B-*6(…)` в обратном порядке: к кольцу примыкает её
 * последний атом, остальные уходят от него наружу. `null` — префикс не
 * простая цепочка, перевернуть без потерь нельзя.
 */
const reversePrefixChain = (head: ChemAtom): ChemAtom | null => {
  const atoms: ChemAtom[] = [];
  const types: ChemBondType[] = [];

  if (!collectSimpleChain(head, atoms, types)) return null;

  const copies = atoms.map((atom): ChemAtom => ({ label: atom.label, bonds: [] }));

  types.forEach((type, index) => {
    const target = copies[index];

    if (target) copies[index + 1]?.bonds.push({ type, angle: null, branch: false, target });
  });

  return copies[copies.length - 1] ?? null;
};

/**
 * Кольцо `*n(…)`. Знаки связи на верхнем уровне скобок — стороны кольца;
 * текст между ними принадлежит вершине, до которой дошли: `*6(-=-N=-=)`
 * ставит азот в четвёртую вершину. Текст перед `*` относится к первой
 * вершине: `CH_3-*6(…)` — заместитель, `N*5(…)` — подпись.
 */
const parseRing = (code: string): ChemRing | null => {
  const match = RING_START.exec(code);

  if (!match) return null;

  const aromatic = match[1] === '**';
  const size = Number(match[2]);

  if (size < MIN_RING_SIZE || size > MAX_RING_SIZE) {
    throw new ChemfigSyntaxError(`Ring size ${size} is not supported`, match.index);
  }

  const reader = new ChemfigReader(code.slice(match.index + match[0].length));
  const content = reader.readBalanced('(', ')');

  reader.expectEnd();

  const bonds: ChemBondType[] = [];
  const fragments: string[] = Array.from({ length: size }, () => '');
  let current = '';
  let depth = 0;
  // Разбор что-то отбросил: модель не повторит код без потерь.
  let lossy = false;

  const flush = (): void => {
    const text = current.trim();

    current = '';

    if (!text) return;

    if (bonds.length < size) fragments[bonds.length] += text;
    else lossy = true;
  };

  [...content].forEach((char) => {
    if (char === '(') depth += 1;

    if (char === ')') depth -= 1;

    if (depth < 0) throw new ChemfigSyntaxError('Unbalanced ")" inside the ring', match.index);

    if (depth === 0 && isBondType(char)) {
      flush();
      bonds.push(char);

      return;
    }

    current += char;
  });

  flush();

  // Сторон не столько, сколько вершин: chemfig нарисует незамкнутое кольцо
  // или лишние связи, модель — замкнутое.
  if (bonds.length !== size) lossy = true;

  const vertices: Array<ChemAtom | null> = fragments.map((fragment) =>
    fragment ? parseFragment(fragment) : null,
  );

  // Параметры перед кольцом (`[:30]**6`) запоминаем дословно: рендер кольцо
  // ими не вращает, но в коде они должны остаться.
  const before = code.slice(0, match.index).trim();
  const spec = /^\[([^\]]*)\]/.exec(before);
  const prefix = before.slice(spec?.[0].length ?? 0).trim();

  if (prefix) {
    const last = prefix[prefix.length - 1];
    const first = vertices[0] ?? { label: '', bonds: [] };

    if (isBondType(last)) {
      const head = parseFragment(prefix.slice(0, -1));
      const nearest = reversePrefixChain(head);

      if (!nearest) lossy = true;

      first.bonds.unshift({ type: last, angle: null, branch: true, target: nearest ?? head });
    } else if (first.label || /[-=~[\]]/.test(prefix)) {
      // Подпись перед кольцом при подписанной вершине или со связями внутри:
      // одной подписью вершины её не выразить.
      lossy = true;
      first.label ||= prefix;
    } else {
      first.label = prefix;
    }

    vertices[0] = first;
  }

  const ring: ChemRing = {
    kind: 'ring',
    size,
    aromatic,
    bonds: Array.from({ length: size }, (_, index) => bonds[index] ?? '-'),
    vertices,
  };

  if (spec) ring.startSpec = spec[1] ?? '';

  if (lossy) ring.lossy = true;

  return ring;
};

/**
 * Разбирает код chemfig в структуру. Бросает `ChemfigSyntaxError`, если код
 * выходит за поддерживаемое подмножество или не сбалансирован.
 */
export const parseChemfig = (code: string): ChemStructure => {
  const inner = unwrapChemfig(code);

  if (!inner) throw new ChemfigSyntaxError('Empty structure', 0);

  return parseRing(inner) ?? parseChain(inner);
};

/** То же, но `null` вместо исключения: для превью и запасного вида в документе. */
export const tryParseChemfig = (code: string): ChemStructure | null => {
  try {
    return parseChemfig(code);
  } catch (error) {
    if (error instanceof ChemfigSyntaxError) return null;

    throw error;
  }
};
