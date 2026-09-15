import { TextStyle } from '@tiptap/extension-text-style';

/**
 * Добавляет размер шрифта к марке `textStyle`.
 *
 * Штатное расширение хранит только цвет, поэтому `font-size` из инлайнового
 * стиля отбрасывался при разборе. Для контента, сохранённого старым
 * редактором, это визуальная регрессия: заголовок, набранный 72 пикселями,
 * отрисовывался базовым кеглем.
 *
 * Правило не привязано к legacy-режиму намеренно. Иначе один и тот же документ
 * выглядел бы по-разному в зависимости от флага, а требование ровно обратное:
 * разметка должна выглядеть одинаково, пришла она из старого редактора или
 * была вставлена в новый.
 */
export const TextStyleWithFontSize = TextStyle.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      fontSize: {
        default: null,
        parseHTML: (element) => element.style.fontSize || null,
        renderHTML: (attributes) => {
          const fontSize = attributes.fontSize as string | null;
          return fontSize ? { style: `font-size: ${fontSize}` } : {};
        },
      },
    };
  },
});
