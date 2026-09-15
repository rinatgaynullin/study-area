import { TextStyle } from '@tiptap/extension-text-style';

/**
 * Сужает разбор `textStyle` до спанов, которые несут стили этой марки.
 *
 * Штатное правило цепляется к любому `<span>` с атрибутом `style`. Для
 * разметки старого редактора это даёт фантомные марки: обёртка подписи
 * `<span class="fr-img-caption" style="width: 120px">` превращается в марку
 * без единого атрибута и рендерится пустым `<span>`.
 *
 * Помимо мусора в документе это ломает идемпотентность: первый проход
 * добавляет обёртку, второй — уже нет, и HTML меняется при каждом открытии.
 *
 * Перечислены ровно те свойства, которыми марка управляет в этой сборке:
 * цвет (`Color`) и кегль (`FontSize`).
 */
const OWNED_STYLES = ['color', 'fontSize'] as const;

export const StrictTextStyle = TextStyle.extend({
  parseHTML() {
    return [
      {
        tag: 'span',
        consuming: false,
        getAttrs: (element) => {
          const style = (element as HTMLElement).style;
          return OWNED_STYLES.some((property) => style[property]) ? {} : false;
        },
      },
    ];
  },
});
