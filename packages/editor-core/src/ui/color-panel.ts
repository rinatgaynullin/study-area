import type { Translate } from '../types';
import { el, icon } from './dom';

export interface ColorPanelOptions {
  t: Translate;
  /** Образцы, из которых собирается сетка. */
  palette: string[];
  /** Цвет текущего выделения: подсвечивается в сетке. Пустая строка — цвета нет. */
  activeColor: string;
  onSelect(color: string): void;
  onReset(): void;
}

/** С чего начинает «свой цвет», когда у выделения цвета ещё нет. */
const FALLBACK_CUSTOM_COLOR = '#000000';

/**
 * Панель выбора цвета для выпадающего меню тулбара.
 *
 * Возвращает готовый элемент, а не компонент с жизненным циклом: панель живёт
 * ровно столько, сколько открыт дропдаун, и пересобирается на каждом открытии.
 * Значит, подписки уходят вместе с узлом и снимать их отдельно не нужно.
 */
export function createColorPanel(options: ColorPanelOptions): HTMLElement {
  const { t } = options;

  // Число колонок объявлено для клавиатуры меню: стрелки вверх и вниз ходят
  // по строкам сетки, а не по одному образцу.
  const grid = el('div', { class: 'rte-colors__grid', attrs: { 'data-menu-columns': 6 } });

  for (const color of options.palette) {
    const isActive = options.activeColor === color;
    const swatch = el('button', {
      class: isActive ? 'rte-colors__swatch rte-colors__swatch--active' : 'rte-colors__swatch',
      // Цвет — единственное, чем образец отличается от соседа, поэтому он же
      // и подпись для тех, кто читает страницу не глазами. Образцы — пункты
      // меню: по ним ходят стрелки, и выбранный сообщает о себе.
      attrs: {
        type: 'button',
        role: 'menuitemradio',
        'aria-checked': String(isActive),
        title: color,
        'aria-label': color,
      },
    });
    swatch.style.background = color;
    swatch.addEventListener('click', () => options.onSelect(color));
    grid.appendChild(swatch);
  }

  const resetButton = el('button', {
    class: 'rte-colors__reset',
    attrs: { type: 'button', role: 'menuitem' },
    children: [icon('noColor', 16), el('span', { text: t('color_reset') })],
  });
  resetButton.addEventListener('click', () => options.onReset());

  const customInput = el('input', { attrs: { type: 'color' } });
  // Поле принимает только #rrggbb: всё остальное браузер молча заменит чёрным.
  customInput.value = options.activeColor || FALLBACK_CUSTOM_COLOR;
  // Слушаем change, а не input: иначе цвет применялся бы на каждое движение
  // мыши по палитре браузера, и в историю правок попал бы весь этот путь.
  customInput.addEventListener('change', () => options.onSelect(customInput.value));

  const customField = el('label', {
    class: 'rte-colors__custom',
    children: [el('span', { text: t('color_custom') }), customInput],
  });

  return el('div', {
    class: 'rte-colors',
    children: [
      grid,
      el('div', {
        class: 'rte-colors__actions',
        children: [resetButton, customField],
      }),
    ],
  });
}
