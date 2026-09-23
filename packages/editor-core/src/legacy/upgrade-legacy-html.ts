import { extractFormulaType, normalizeMathML } from '../formula/mathml';
import { decodeWirisMathml } from './decode-wiris-mathml';

/**
 * Приводит разметку, сохранённую старым редактором (Froala + Wiris), к
 * контрактам узлов нового редактора.
 *
 * Запускается до санитайзера — как и `inlineMathMLToFormulaNodes`, потому что
 * восстанавливаемый MathML сам нуждается в санитизации, а часть исходной
 * разметки санитайзер вырезал бы раньше, чем мы успели её разобрать.
 *
 * Без этого шага схема ProseMirror уничтожает legacy-контент при открытии на
 * редактирование: формула Wiris теряет `data-mathml` и вырождается в картинку,
 * а вывод MathJax и структурные формулы химии исчезают целиком, потому что
 * `<svg>` не является узлом схемы.
 */

/** Картинка-формула, которую ставил Wiris. */
const WIRIS_IMAGE = 'img.Wirisformula, img.Wiriscas';

/**
 * Блоки, которые нечем смоделировать: готовый вывод MathJax и структурные
 * формулы химии из JSME. Исходного MathML в них нет, разобрать их не во что —
 * поэтому сохраняем разметку как есть в атомарном узле.
 */
const LEGACY_EMBEDS = '.formula-rendered, .formula-chemistry-structure';

const toFormulaSpan = (document_: Document, mathml: string): HTMLElement => {
  const span = document_.createElement('span');

  span.setAttribute('data-formula', 'true');
  span.setAttribute('data-formula-type', extractFormulaType(mathml));
  span.setAttribute('data-mathml', mathml);
  span.setAttribute('contenteditable', 'false');
  span.className = 'rte-formula';

  return span;
};

const toLegacyEmbed = (document_: Document, html: string): HTMLElement => {
  const span = document_.createElement('span');

  span.setAttribute('data-legacy-embed', 'true');
  span.setAttribute('contenteditable', 'false');
  span.className = 'rte-legacy-embed';
  span.innerHTML = html;

  return span;
};

export const upgradeLegacyHtml = (html: string): string => {
  if (!html) return html;

  if (typeof DOMParser === 'undefined') return html;

  // Разбор документа стоит дорого — пропускаем его, если признаков legacy нет.
  if (!/Wiris|formula-rendered|formula-chemistry-structure/i.test(html)) return html;

  const parsed = new DOMParser().parseFromString(html, 'text/html');

  Array.from(parsed.querySelectorAll(WIRIS_IMAGE)).forEach((image) => {
    const mathml = normalizeMathML(decodeWirisMathml(image.getAttribute('data-mathml') ?? ''));

    // MathML не восстановился — оставляем картинку: она хотя бы отрисуется.
    if (!mathml) return;

    image.replaceWith(toFormulaSpan(parsed, mathml));
  });

  Array.from(parsed.querySelectorAll(LEGACY_EMBEDS)).forEach((embed) => {
    // Вложенный embed уже уедет вместе с родителем.
    if (embed.parentElement?.closest(LEGACY_EMBEDS)) return;

    embed.replaceWith(toLegacyEmbed(parsed, embed.innerHTML));
  });

  return parsed.body.innerHTML;
};
