import type { SvgPoint } from './coords';

/** Цвет подсветки выделения в конструкторах. */
export const HIGHLIGHT_COLOR = '#ec4899';

/** Основной цвет линий и текста: наследуется от документа, поэтому работает в тёмной теме. */
export const INK = 'currentColor';

export const escapeXml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Число без хвоста плавающей точки; `-0` тоже становится `0`. */
export const fmt = (value: number): string => String(Number(value.toFixed(2)));

export const pointsAttr = (points: SvgPoint[]): string =>
  points.map((point) => `${fmt(point.x)},${fmt(point.y)}`).join(' ');

/** Путь по ломаной: `M x y L x y …`. */
export const polylinePath = (points: SvgPoint[], close = false): string => {
  const body = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${fmt(point.x)} ${fmt(point.y)}`).join(' ');

  return close && points.length > 0 ? `${body} Z` : body;
};

export interface StrokeOptions {
  color?: string;
  width?: number;
  dashed?: boolean | string;
  opacity?: number;
  linecap?: 'round' | 'square' | 'butt';
  linejoin?: 'round';
  fill?: string;
  className?: string;
}

export interface TextOptions {
  size?: number;
  weight?: number | string;
  color?: string;
  anchor?: 'start' | 'middle' | 'end';
  italic?: boolean;
  /** Белая обводка под текстом, чтобы подпись читалась поверх линий. */
  halo?: boolean | number;
  /** Текст уже размечен (`<tspan>`) и экранирован — не экранировать повторно. */
  markup?: boolean;
  className?: string;
  baseline?: 'central';
}

const strokeAttrs = (options: StrokeOptions, defaults: Required<Pick<StrokeOptions, 'color' | 'width'>>): string => {
  const parts = [
    `fill="${options.fill ?? 'none'}"`,
    `stroke="${options.color ?? defaults.color}"`,
    `stroke-width="${fmt(options.width ?? defaults.width)}"`,
  ];

  if (options.dashed) {
    parts.push(`stroke-dasharray="${typeof options.dashed === 'string' ? options.dashed : '6,4'}"`);
  }

  if (options.opacity !== undefined) parts.push(`opacity="${fmt(options.opacity)}"`);

  if (options.linecap) parts.push(`stroke-linecap="${options.linecap}"`);

  if (options.linejoin) parts.push(`stroke-linejoin="${options.linejoin}"`);

  if (options.className) parts.push(`class="${options.className}"`);

  return parts.join(' ');
};

/**
 * Накопитель разметки SVG с общими примитивами.
 *
 * Всё, что попадает в текст, экранируется здесь — подписи приходят от
 * нейросети и от ученика, а открываются у учителя. Цвета по умолчанию —
 * `currentColor`, подложки — классы под тему; явный цвет элемента
 * (`#2563eb` у силы) остаётся как есть.
 */
export class SvgBuilder {
  private readonly parts: string[] = [];

  /** Произвольная готовая разметка — только из своих же примитивов. */
  raw(markup: string): void {
    this.parts.push(markup);
  }

  line(a: SvgPoint, b: SvgPoint, options: StrokeOptions = {}): void {
    this.parts.push(
      `<line x1="${fmt(a.x)}" y1="${fmt(a.y)}" x2="${fmt(b.x)}" y2="${fmt(b.y)}" ${strokeAttrs(options, { color: INK, width: 1.8 })} />`,
    );
  }

  path(d: string, options: StrokeOptions = {}): void {
    this.parts.push(`<path d="${d}" ${strokeAttrs(options, { color: INK, width: 1.8 })} />`);
  }

  polyline(points: SvgPoint[], options: StrokeOptions = {}): void {
    this.parts.push(`<polyline points="${pointsAttr(points)}" ${strokeAttrs(options, { color: INK, width: 1.8 })} />`);
  }

  polygon(points: SvgPoint[], options: StrokeOptions = {}): void {
    this.parts.push(`<polygon points="${pointsAttr(points)}" ${strokeAttrs(options, { color: 'none', width: 0 })} />`);
  }

  circle(center: SvgPoint, radius: number, options: StrokeOptions = {}): void {
    this.parts.push(
      `<circle cx="${fmt(center.x)}" cy="${fmt(center.y)}" r="${fmt(radius)}" ${strokeAttrs(options, { color: INK, width: 1.8 })} />`,
    );
  }

  ellipse(center: SvgPoint, rx: number, ry: number, options: StrokeOptions = {}): void {
    this.parts.push(
      `<ellipse cx="${fmt(center.x)}" cy="${fmt(center.y)}" rx="${fmt(rx)}" ry="${fmt(ry)}" ${strokeAttrs(options, { color: INK, width: 1.8 })} />`,
    );
  }

  rect(x: number, y: number, width: number, height: number, options: StrokeOptions & { rx?: number } = {}): void {
    const radius = options.rx !== undefined ? ` rx="${fmt(options.rx)}"` : '';

    this.parts.push(
      `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(width)}" height="${fmt(height)}"${radius} ${strokeAttrs(options, { color: INK, width: 1.8 })} />`,
    );
  }

  /** Подпись; с `halo` — сначала та же надпись белой обводкой под ней. */
  text(at: SvgPoint, content: string, options: TextOptions = {}): void {
    const body = options.markup ? content : escapeXml(content);
    const attrs = [
      `x="${fmt(at.x)}" y="${fmt(at.y)}"`,
      `font-family="system-ui, Arial, sans-serif"`,
      `font-size="${fmt(options.size ?? 11)}"`,
      `font-weight="${options.weight ?? 700}"`,
      `text-anchor="${options.anchor ?? 'middle'}"`,
    ];

    if (options.italic) attrs.push('font-style="italic"');

    if (options.baseline) attrs.push(`dominant-baseline="${options.baseline}"`);

    if (options.className) attrs.push(`class="${options.className}"`);

    if (options.halo) {
      const width = typeof options.halo === 'number' ? options.halo : 3;

      this.parts.push(
        `<text ${attrs.join(' ')} class="rte-drawing__halo" fill="#fff" stroke="#fff" stroke-width="${fmt(width)}" stroke-linejoin="round">${body}</text>`,
      );
    }

    this.parts.push(`<text ${attrs.join(' ')} fill="${options.color ?? INK}">${body}</text>`);
  }

  /** Группа с трансформацией вокруг точки: поворот блоков, сосудов, платформ. */
  group(at: SvgPoint, rotateDegrees: number, draw: (inner: SvgBuilder) => void): void {
    const inner = new SvgBuilder();

    draw(inner);

    const rotate = rotateDegrees ? ` rotate(${fmt(rotateDegrees)})` : '';

    this.parts.push(`<g transform="translate(${fmt(at.x)}, ${fmt(at.y)})${rotate}">${inner.toString()}</g>`);
  }

  toString(): string {
    return this.parts.join('');
  }
}

export interface SvgDocumentOptions {
  width: number;
  height: number;
  className: string;
  /** Что положить в `<defs>`: штриховка и прочие шаблоны. */
  defs?: string;
}

/** Штриховка под 45° — цвет берётся из `color` элемента, которому она назначена. */
export const DIAGONAL_STRIPE_DEFS =
  '<pattern id="rte-drawing-stripe" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">'
  + '<line x1="0" y1="0" x2="0" y2="10" stroke="currentColor" stroke-width="1.2" /></pattern>';

/** Обёртка `<svg>` фиксированного размера с `viewBox` от нуля, как в PinQueen. */
export const wrapSvg = (content: string, options: SvgDocumentOptions): string =>
  `<svg class="${options.className}" xmlns="http://www.w3.org/2000/svg" `
  + `width="${options.width}" height="${options.height}" viewBox="0 0 ${options.width} ${options.height}" `
  + `role="presentation" aria-hidden="true" focusable="false">`
  + (options.defs ? `<defs>${options.defs}</defs>` : '')
  + content
  + '</svg>';
