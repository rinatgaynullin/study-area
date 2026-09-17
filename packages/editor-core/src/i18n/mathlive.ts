/**
 * Русские строки для собственного интерфейса MathLive — его контекстного меню,
 * подсказок панели и экранной клавиатуры.
 *
 * MathLive поставляется с переводами только для de, en, es, fr, it, ja и pl,
 * поэтому без этой таблицы меню остаётся английским даже при `locale = 'ru'`.
 * Ключи в точности повторяют идентификаторы самого MathLive, включая пробелы
 * (`menu.insert matrix`); `%@` — его подстановка. Записи `*-template` — это
 * LaTeX, а не текст, и намеренно отсутствуют: их MathLive берёт свои.
 */
const mathliveRu: Record<string, string> = {
  // Экранная клавиатура
  'keyboard.tooltip.symbols': 'Символы',
  'keyboard.tooltip.greek': 'Греческие буквы',
  'keyboard.tooltip.numeric': 'Цифры',
  'keyboard.tooltip.alphabetic': 'Латинские буквы',

  // Подсказки панели
  'tooltip.copy to clipboard': 'Копировать в буфер обмена',
  'tooltip.cut to clipboard': 'Вырезать в буфер обмена',
  'tooltip.paste from clipboard': 'Вставить из буфера обмена',
  'tooltip.undo': 'Отменить',
  'tooltip.redo': 'Повторить',
  'tooltip.menu': 'Меню',
  'tooltip.toggle virtual keyboard': 'Экранная клавиатура',

  // Матрицы и массивы
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

  // Режим ввода
  'menu.mode': 'Режим',
  'menu.mode-math': 'Математика',
  'menu.mode-text': 'Текст',
  'menu.mode-latex': 'LaTeX',

  // Вставка
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

  // Начертание
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

  // Вычисления
  'menu.evaluate': 'Вычислить',
  'menu.simplify': 'Упростить',
  'menu.solve': 'Решить',
  'menu.solve-for': 'Решить относительно %@',

  // Буфер обмена
  'menu.cut': 'Вырезать',
  'menu.copy': 'Копировать',
  'menu.copy-as-latex': 'Копировать как LaTeX',
  'menu.copy-as-typst': 'Копировать как Typst',
  'menu.copy-as-ascii-math': 'Копировать как ASCII Math',
  'menu.copy-as-mathml': 'Копировать как MathML',
  'menu.paste': 'Вставить',
  'menu.select-all': 'Выделить всё',

  // Цвета
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

/** Таблицы строк MathLive по языкам: код языка → ключ MathLive → перевод. */
export interface MathliveStrings {
  [locale: string]: Record<string, string>;
}

/**
 * Локали, которые пакет добавляет MathLive поверх встроенных.
 *
 * Сеттер MathLive не заменяет таблицу целиком, а дополняет её, а `localize()`
 * ищет по цепочке ru-RU → ru → en, поэтому ключа языка без региона достаточно
 * для всех региональных вариантов.
 */
export const MATHLIVE_STRINGS: MathliveStrings = {
  ru: mathliveRu,
};
