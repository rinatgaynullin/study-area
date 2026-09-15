/**
 * Russian strings for MathLive's own UI — its context menu, toolbar tooltips
 * and virtual keyboard.
 *
 * MathLive bundles translations for de, en, es, fr, it, ja and pl only, so
 * without this map its menu stays English even under `locale="ru"`. Keys match
 * MathLive's own identifiers exactly, spaces included (`menu.insert matrix`);
 * `%@` is its placeholder. The `*-template` entries are LaTeX, not prose, and
 * are deliberately absent so MathLive keeps its own.
 */
export const mathliveRu: Record<string, string> = {
  // Virtual keyboard
  'keyboard.tooltip.symbols': 'Символы',
  'keyboard.tooltip.greek': 'Греческие буквы',
  'keyboard.tooltip.numeric': 'Цифры',
  'keyboard.tooltip.alphabetic': 'Латинские буквы',

  // Toolbar tooltips
  'tooltip.copy to clipboard': 'Копировать в буфер обмена',
  'tooltip.cut to clipboard': 'Вырезать в буфер обмена',
  'tooltip.paste from clipboard': 'Вставить из буфера обмена',
  'tooltip.undo': 'Отменить',
  'tooltip.redo': 'Повторить',
  'tooltip.menu': 'Меню',
  'tooltip.toggle virtual keyboard': 'Экранная клавиатура',

  // Matrices and arrays
  'menu.insert matrix': 'Вставить матрицу',
  'menu.borders': 'Границы',
  'menu.array.add row above': 'Добавить строку выше',
  'menu.array.add row below': 'Добавить строку ниже',
  'menu.array.add column before': 'Добавить столбец слева',
  'menu.array.add column after': 'Добавить столбец справа',
  'menu.array.delete row': 'Удалить строку',
  'menu.array.delete rows': 'Удалить выбранные строки',
  'menu.array.delete column': 'Удалить столбец',
  'menu.array.delete columns': 'Удалить выбранные столбцы',

  // Mode
  'menu.mode': 'Режим',
  'menu.mode-math': 'Математика',
  'menu.mode-text': 'Текст',
  'menu.mode-latex': 'LaTeX',

  // Insert
  'menu.insert': 'Вставить',
  'menu.insert.abs': 'Модуль числа',
  'menu.insert.nth-root': 'Корень n-й степени',
  'menu.insert.log-base': 'Логарифм по основанию a',
  'menu.insert.heading-calculus': 'Математический анализ',
  'menu.insert.derivative': 'Производная',
  'menu.insert.nth-derivative': 'Производная n-го порядка',
  'menu.insert.integral': 'Интеграл',
  'menu.insert.sum': 'Сумма',
  'menu.insert.product': 'Произведение',
  'menu.insert.heading-complex-numbers': 'Комплексные числа',
  'menu.insert.modulus': 'Модуль',
  'menu.insert.argument': 'Аргумент',
  'menu.insert.real-part': 'Действительная часть',
  'menu.insert.imaginary-part': 'Мнимая часть',
  'menu.insert.conjugate': 'Сопряжённое число',

  // Font style
  'menu.font-style': 'Начертание',
  'tooltip.bold': 'Полужирный',
  'tooltip.italic': 'Курсив',
  'tooltip.blackboard': 'Ажурный',
  'tooltip.fraktur': 'Фрактура',
  'tooltip.script': 'Рукописный',
  'tooltip.caligraphic': 'Каллиграфический',
  'tooltip.typewriter': 'Моноширинный',
  'tooltip.roman-upright': 'Прямой',
  'tooltip.row-by-col': '%@ × %@',

  'menu.accent': 'Диакритический знак',
  'menu.decoration': 'Оформление',
  'menu.color': 'Цвет текста',
  'menu.background-color': 'Цвет фона',

  // Computation
  'menu.evaluate': 'Вычислить',
  'menu.simplify': 'Упростить',
  'menu.solve': 'Решить',
  'menu.solve-for': 'Решить относительно %@',

  // Clipboard
  'menu.cut': 'Вырезать',
  'menu.copy': 'Копировать',
  'menu.copy-as-latex': 'Копировать как LaTeX',
  'menu.copy-as-typst': 'Копировать как Typst',
  'menu.copy-as-ascii-math': 'Копировать как ASCII Math',
  'menu.copy-as-mathml': 'Копировать как MathML',
  'menu.paste': 'Вставить',
  'menu.select-all': 'Выделить всё',

  // Colours
  'color.red': 'Красный',
  'color.orange': 'Оранжевый',
  'color.yellow': 'Жёлтый',
  'color.lime': 'Лаймовый',
  'color.green': 'Зелёный',
  'color.teal': 'Бирюзовый',
  'color.cyan': 'Голубой',
  'color.blue': 'Синий',
  'color.indigo': 'Индиго',
  'color.purple': 'Фиолетовый',
  'color.magenta': 'Пурпурный',
  'color.black': 'Чёрный',
  'color.dark-grey': 'Тёмно-серый',
  'color.grey': 'Серый',
  'color.light-grey': 'Светло-серый',
  'color.white': 'Белый',
};

/** Locales this package supplies to MathLive on top of the ones it bundles. */
export const MATHLIVE_STRINGS: Record<string, Record<string, string>> = {
  ru: mathliveRu,
};
