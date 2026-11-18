import { el, type Translate } from '@rich-editor/core';
import { createBuilderIcon } from './builder-icons';

export type DrawingColorId = 'blue' | 'cyan' | 'green' | 'yellow' | 'orange' | 'red' | 'pink' | 'purple' | 'brown' | 'gray';

/** Значения цветов палитры: по ним шаблоны получают свой цвет. */
export const DRAWING_COLOR_HEX: Record<DrawingColorId, string> = {
  blue: '#2563eb',
  cyan: '#0891b2',
  green: '#16a34a',
  yellow: '#ca8a04',
  orange: '#f97316',
  red: '#dc2626',
  pink: '#db2777',
  purple: '#8b5cf6',
  brown: '#92400e',
  gray: '#64748b',
};

export interface DrawingColor {
  id: DrawingColorId;
  /** Значение, которое плитка пишет в сцену. */
  value: string;
  labelKey: string;
  /** Прежние значения того же цвета: элемент с ними показывается с этой плиткой, сцена не меняется. */
  synonyms: readonly string[];
}

/** Палитра конструкторов: две строки по пять плиток, порядок — порядок сетки. */
export const DRAWING_COLORS: readonly DrawingColor[] = [
  { id: 'blue', value: DRAWING_COLOR_HEX.blue, labelKey: 'drawings_color_blue', synonyms: ['#3b82f6'] },
  { id: 'cyan', value: DRAWING_COLOR_HEX.cyan, labelKey: 'drawings_color_cyan', synonyms: [] },
  { id: 'green', value: DRAWING_COLOR_HEX.green, labelKey: 'drawings_color_green', synonyms: ['#10b981'] },
  { id: 'yellow', value: DRAWING_COLOR_HEX.yellow, labelKey: 'drawings_color_yellow', synonyms: [] },
  { id: 'orange', value: DRAWING_COLOR_HEX.orange, labelKey: 'drawings_color_orange', synonyms: ['#f59e0b'] },
  { id: 'red', value: DRAWING_COLOR_HEX.red, labelKey: 'drawings_color_red', synonyms: ['#ef4444'] },
  { id: 'pink', value: DRAWING_COLOR_HEX.pink, labelKey: 'drawings_color_pink', synonyms: [] },
  { id: 'purple', value: DRAWING_COLOR_HEX.purple, labelKey: 'drawings_color_purple', synonyms: [] },
  { id: 'brown', value: DRAWING_COLOR_HEX.brown, labelKey: 'drawings_color_brown', synonyms: [] },
  { id: 'gray', value: DRAWING_COLOR_HEX.gray, labelKey: 'drawings_color_gray', synonyms: ['#475569'] },
];

/** Плиток в ряду: стрелки вверх и вниз шагают через столько плиток. */
const COLUMNS = 5;

/** Галочка на тёмной плитке и на светлой. */
const INK_LIGHT = '#ffffff';
const INK_DARK = '#1f2937';

/** Что получает фокус после выбора: выбранная плитка или кнопка «Обычный цвет». */
const CHECKED_TILE = '.rte-builder__colors [role="radio"][tabindex="0"]';
const DEFAULT_BUTTON = '.rte-builder__color-default';

/** Цвет палитры по значению из сцены — сама плитка или её синоним, без учёта регистра. */
export const findDrawingColor = (value: string): DrawingColor | undefined => {
  const key = value.toLowerCase();

  return DRAWING_COLORS.find((color) => color.value === key || color.synonyms.includes(key));
};

/** Линейная яркость канала sRGB. */
const channel = (byte: number): number => {
  const value = byte / 255;

  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};

/** Относительная яркость hex-цвета (#rgb или #rrggbb); `null` — не hex. */
const luminance = (color: string): number | null => {
  const digits = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())?.[1];

  if (!digits) return null;

  const full = digits.length === 3 ? digits.replace(/./g, (digit) => digit + digit) : digits;
  const part = (start: number): number => channel(parseInt(full.slice(start, start + 2), 16));

  return 0.2126 * part(0) + 0.7152 * part(2) + 0.0722 * part(4);
};

const DARK_LUMINANCE = luminance(INK_DARK) ?? 0;

/** Цвет галочки на плитке: белый или тёмный — тот, что контрастнее фона. */
export const checkInk = (color: string): string => {
  const background = luminance(color);

  if (background === null) return INK_LIGHT;

  const onLight = 1.05 / (background + 0.05);
  const onDark = (background + 0.05) / (DARK_LUMINANCE + 0.05);

  return onLight >= onDark ? INK_LIGHT : INK_DARK;
};

/** Плитка, на которую переходит фокус по клавише; `null` — клавиша не для сетки. */
export const nextTileIndex = (key: string, index: number, count: number): number | null => {
  switch (key) {
    case 'ArrowRight':
      return (index + 1) % count;
    case 'ArrowLeft':
      return (index - 1 + count) % count;
    case 'ArrowDown':
      return index + COLUMNS < count ? index + COLUMNS : index;
    case 'ArrowUp':
      return index >= COLUMNS ? index - COLUMNS : index;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
};

export interface ColorPickerOptions {
  t: Translate;
  label: string;
  /** Цвет из сцены; `''` — цвета нет (обычный цвет элемента). */
  value: string;
  /** Под сеткой кнопка «Обычный цвет»: она убирает цвет (значение `''`). */
  allowDefault: boolean;
  onChange(value: string): void;
}

interface Tile {
  value: string;
  button: HTMLButtonElement;
}

/**
 * Поле «Цвет»: сетка плиток-радиокнопок и, если можно, кнопка «Обычный цвет».
 * Цвет не из палитры (пришёл из сцены) — одиннадцатая плитка «Цвет из
 * чертежа»; выбор плитки палитры убирает её при следующей отрисовке.
 *
 * Текущий цвет и плитки — общее состояние щелчка и клавиатуры, поэтому класс.
 */
export class ColorPicker {
  readonly element: HTMLElement;

  private readonly group: HTMLElement;

  private readonly reset: HTMLButtonElement | null;

  private tiles: Tile[] = [];

  private value: string;

  constructor(private readonly options: ColorPickerOptions) {
    this.value = options.value;
    this.group = el('div', { class: 'rte-builder__colors', attrs: { role: 'radiogroup', 'aria-label': options.label } });
    this.reset = options.allowDefault
      ? el('button', {
        class: 'rte-builder__tool rte-builder__color-default',
        attrs: { type: 'button', 'aria-pressed': 'false', 'data-color': 'default' },
        text: options.t('drawings_color_default'),
      })
      : null;
    this.element = el('div', {
      class: 'rte-builder__prop rte-builder__prop--color',
      children: [el('span', { class: 'rte-builder__prop-label', text: options.label }), this.group, this.reset],
    });

    this.group.addEventListener('click', (event) => {
      const tile = this.tileOf(event.target);

      if (tile) this.choose(tile.value, CHECKED_TILE);
    });
    this.group.addEventListener('keydown', (event) => this.onKeyDown(event));
    this.reset?.addEventListener('click', () => this.choose('', DEFAULT_BUTTON));
    this.renderTiles();
  }

  /** Новое значение без пересоздания поля. */
  setValue(value: string): void {
    this.value = value;
    this.renderTiles();
  }

  private tileOf(target: EventTarget | null): Tile | undefined {
    return this.tiles.find((tile) => tile.button === target || (target instanceof Node && tile.button.contains(target)));
  }

  private onKeyDown(event: KeyboardEvent): void {
    const index = this.tiles.findIndex((tile) => tile.button === event.target);
    const next = index === -1 ? null : nextTileIndex(event.key, index, this.tiles.length);
    const tile = next === null ? undefined : this.tiles[next];

    if (!tile) return;

    event.preventDefault();
    this.choose(tile.value, CHECKED_TILE);
  }

  /**
   * Выбор плитки или «Обычного цвета». Тот же цвет сцену не трогает; другой —
   * уходит в `onChange`. Фокус остаётся на нажатом (`focusTarget` — его
   * селектор), даже если плитки перестроены или панель свойств после правки
   * собрала поле заново.
   */
  private choose(value: string, focusTarget: string): void {
    const host = this.element.closest('.rte-builder__props');

    if (value.toLowerCase() !== this.value.toLowerCase()) {
      this.setValue(value);
      this.options.onChange(value);
    }

    const root = this.element.isConnected ? this.element : host;

    root?.querySelector<HTMLElement>(focusTarget)?.focus();
  }

  private renderTiles(): void {
    const { t } = this.options;
    const current = this.value;
    const known = current === '' ? undefined : findDrawingColor(current);
    const entries: Array<{ id: string; value: string; label: string; checked: boolean }> = DRAWING_COLORS.map((color) => ({
      id: color.id,
      value: color.value,
      label: t(color.labelKey),
      checked: color === known,
    }));

    if (current !== '' && !known) entries.push({ id: 'other', value: current, label: t('drawings_color_other'), checked: true });

    // Ничего не выбрано — в порядок Tab попадает первая плитка.
    const focusable = Math.max(0, entries.findIndex((entry) => entry.checked));

    this.tiles = entries.map((entry, index) => {
      const button = el('button', {
        class: 'rte-builder__color',
        attrs: {
          type: 'button',
          role: 'radio',
          'aria-checked': String(entry.checked),
          'aria-label': entry.label,
          title: entry.label,
          tabindex: index === focusable ? '0' : '-1',
          'data-color': entry.id,
        },
      });

      // Фон — из палитры или строка сцены; браузер сам отбросит то, что цветом не является.
      button.style.backgroundColor = entry.value;

      if (entry.checked) {
        const mark = createBuilderIcon('check');

        mark.classList.add('rte-builder__color-check');
        mark.style.color = checkInk(entry.value);
        button.appendChild(mark);
      }

      return { value: entry.value, button };
    });

    this.group.replaceChildren(...this.tiles.map((tile) => tile.button));
    this.reset?.setAttribute('aria-pressed', String(current === ''));
  }
}
