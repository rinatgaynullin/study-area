import Highlight from '@tiptap/extension-highlight';

/**
 * Подсветка текста в старом редакторе задавалась инлайновым стилем
 * (`inlineStyles` во Froala), а не тегом `<mark>`, который умеет разбирать
 * штатное расширение. Без этого правила схема выбрасывает `background-color`
 * вместе с остальными неизвестными стилями, и подсветка теряется при первом же
 * сохранении.
 *
 * Цвет переносится как есть: он приходит из данных и не подчиняется токенам
 * темы — normalизовать его значило бы менять вид старого контента.
 */
export const LegacyHighlight = Highlight.extend({
  parseHTML() {
    return [
      ...(this.parent?.() ?? []),
      {
        tag: 'span[style*="background-color"]',
        // Спан без подсветки (например, носитель цвета текста) правилу не
        // подходит — иначе он превратился бы в марку с пустым цветом.
        getAttrs: (element) => ((element as HTMLElement).style.backgroundColor ? null : false),
      },
    ];
  },
});
